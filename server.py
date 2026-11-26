"""Lunex server: serves the site, handles accounts, and relays read-only Solana RPC / X searches.

Run:   python server.py              then open http://localhost:8765
Admin: python server.py users                list accounts (and paid passes)
       python server.py payments             recent payments
       python server.py pro  you@email.com   give an account Pro with no end date
       python server.py free you@email.com   back to Free (also ends a paid pass)

Payments: see payments.py for LUNEX_PAY_WALLET, prices and the Stripe settings.

Google sign-in: set GOOGLE_CLIENT_ID (env var) or put {"google_client_id": "..."} in lunex.config.json.

Hosting settings (environment variables, e.g. in Railway > Variables):
  LUNEX_DB=/data/lunex.db        keep accounts on a persistent volume mounted at /data
  GOOGLE_CLIENT_ID=...           Google sign-in
  LUNEX_PRO_EMAILS=a@x.com,...   accounts that always get Pro (you, testers)
  SOLANA_RPC=https://...         a faster Solana RPC (e.g. Helius) instead of the free public one
  PORT                           set by the host automatically
"""
import hashlib
import hmac
import http.server
import json
import os
import re
import secrets
import sqlite3
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

import payments

HERE = os.path.dirname(os.path.abspath(__file__))
# Hosting: Railway (and most hosts) set PORT and route traffic through an HTTPS proxy.
HOSTED = bool(os.environ.get("PORT") or os.environ.get("RAILWAY_ENVIRONMENT"))
PORT = int(os.environ.get("PORT", 8765))
BIND = "0.0.0.0" if HOSTED else "127.0.0.1"
# Keep the database on a persistent volume when hosted (e.g. LUNEX_DB=/data/lunex.db), next to the code locally.
DB_PATH = os.environ.get("LUNEX_DB") or os.path.join(HERE, "lunex.db")
CONFIG_PATH = os.path.join(HERE, "lunex.config.json")
RPC = os.environ.get("SOLANA_RPC", "https://api.mainnet-beta.solana.com")
ALLOWED = {"getTokenAccountsByOwner", "getBalance", "getSignaturesForAddress", "getTransaction",
           "getSignatureStatuses", "sendTransaction", "getLatestBlockhash",
           "simulateTransaction"}  # sendTransaction only relays a tx the user's wallet already signed; simulate is a read-only dry run
X_SEARCH = "https://api.twitterapi.io/twitter/tweet/advanced_search"
X_V2_SEARCH = "https://api.x.com/2/tweets/search/recent"

SESSION_COOKIE = "lunex_session"
SESSION_DAYS = 30
SOL_ADDR = re.compile(r"^[1-9A-HJ-NP-Za-km-z]{32,44}$")
EMAIL = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,24}$")
PRO_FILES = {"/luna.js", "/brain.js", "/brain-worker.js"}           # Luna's AI: only sent to Pro accounts
NEVER_SERVE = re.compile(r"(^/\.|/\.|\.py$|\.db$|\.db-|lunex\.config\.json$|^/_original/|railway\.json$|requirements\.txt$)", re.I)
PUBLIC_PAGES = {"/welcome", "/welcome.html", "/welcome.css", "/welcome.js", "/favicon.ico"}


def config():
    cfg = {}
    try:
        with open(CONFIG_PATH, encoding="utf-8") as f:
            cfg = json.load(f)
    except Exception:
        pass
    cfg["google_client_id"] = os.environ.get("GOOGLE_CLIENT_ID") or cfg.get("google_client_id") or ""
    return cfg


# ---------------------------------------------------------------- database
_db_lock = threading.Lock()


def db():
    con = sqlite3.connect(DB_PATH, timeout=10)
    con.row_factory = sqlite3.Row
    return con


def init_db():
    os.makedirs(os.path.dirname(DB_PATH) or ".", exist_ok=True)
    with _db_lock, db() as con:
        con.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            name TEXT DEFAULT '',
            pw_hash TEXT,
            google_sub TEXT UNIQUE,
            wallet TEXT DEFAULT '',
            plan TEXT DEFAULT 'free',
            created REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions (
            token_hash TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            expires REAL NOT NULL
        );""")
        payments.migrate(con)


def hash_password(pw):
    salt = secrets.token_bytes(16)
    h = hashlib.scrypt(pw.encode(), salt=salt, n=2 ** 14, r=8, p=1, dklen=32)
    return f"scrypt${salt.hex()}${h.hex()}"


def check_password(pw, stored):
    try:
        _, salt, h = stored.split("$")
        calc = hashlib.scrypt(pw.encode(), salt=bytes.fromhex(salt), n=2 ** 14, r=8, p=1, dklen=32)
        return hmac.compare_digest(calc.hex(), h)
    except Exception:
        return False


def plan_of(u):
    # LUNEX_PRO_EMAILS="you@x.com,friend@y.com" makes those accounts Pro without touching the database
    owners = {e.strip().lower() for e in os.environ.get("LUNEX_PRO_EMAILS", "").split(",") if e.strip()}
    if u["email"].lower() in owners or u["plan"] == "pro":       # owners / manually granted: Pro with no end date
        return "pro"
    return "pro" if (u["pro_until"] or 0) > time.time() else "free"   # paid pass still running


def public_user(u):
    lifetime = u["email"].lower() in {e.strip().lower() for e in os.environ.get("LUNEX_PRO_EMAILS", "").split(",") if e.strip()} or u["plan"] == "pro"
    return {"email": u["email"], "name": u["name"] or u["email"].split("@")[0], "wallet": u["wallet"] or "",
            "plan": plan_of(u), "google": bool(u["google_sub"]),
            "proUntil": 0 if lifetime else (u["pro_until"] or 0), "lifetime": lifetime, "card": bool(u["stripe_customer"])}


# simple per-IP throttle for sign-in attempts
_attempts = {}


def throttled(ip, limit=12, window=300):
    now = time.time()
    hits = [t for t in _attempts.get(ip, []) if now - t < window]
    hits.append(now)
    _attempts[ip] = hits
    return len(hits) > limit


class Handler(http.server.SimpleHTTPRequestHandler):
    isolate = True  # cross-origin isolation for the app (multi-core CPU brain); off for the sign-in page (Google popups)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if self.isolate:
            # Lets Luna's CPU brain use every processor core. "credentialless" keeps third-party images loading.
            self.send_header("Cross-Origin-Opener-Policy", "same-origin")
            self.send_header("Cross-Origin-Embedder-Policy", "credentialless")
        else:
            self.send_header("Cross-Origin-Opener-Policy", "same-origin-allow-popups")
        super().end_headers()

    # ------------------------------------------------------------ helpers
    def send_json(self, data, code=200, cookie=None):
        if not isinstance(data, (bytes, bytearray)):
            data = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        if cookie is not None:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(data)

    def redirect(self, to):
        self.send_response(302)
        self.send_header("Location", to)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def read_json(self, limit=20000):
        n = int(self.headers.get("Content-Length", 0) or 0)
        if n > limit:
            return None
        try:
            return json.loads(self.rfile.read(n) or b"{}")
        except Exception:
            return None

    def session_token(self):
        for part in (self.headers.get("Cookie") or "").split(";"):
            k, _, v = part.strip().partition("=")
            if k == SESSION_COOKIE:
                return v
        return None

    def current_user(self):
        tok = self.session_token()
        if not tok:
            return None
        th = hashlib.sha256(tok.encode()).hexdigest()
        with db() as con:
            row = con.execute("SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash=? AND s.expires>?",
                              (th, time.time())).fetchone()
        return row

    def start_session(self, user_id):
        tok = secrets.token_urlsafe(32)
        with _db_lock, db() as con:
            con.execute("INSERT INTO sessions VALUES (?,?,?)",
                        (hashlib.sha256(tok.encode()).hexdigest(), user_id, time.time() + SESSION_DAYS * 86400))
        return f"{SESSION_COOKIE}={tok}; Path=/; HttpOnly; SameSite=Lax; Max-Age={SESSION_DAYS * 86400}{self.secure_flag()}"

    def base_url(self):
        proto = self.headers.get("X-Forwarded-Proto") or ("https" if HOSTED else "http")
        host = self.headers.get("X-Forwarded-Host") or self.headers.get("Host") or f"localhost:{PORT}"
        return f"{proto}://{host}"

    def secure_flag(self):
        # over HTTPS (the host's proxy says so), the login cookie is never sent over plain http
        return "; Secure" if self.headers.get("X-Forwarded-Proto", "").lower() == "https" else ""

    def client_ip(self):
        # behind the host's proxy every request comes from the proxy; the real visitor is the first X-Forwarded-For entry
        if HOSTED:
            fwd = self.headers.get("X-Forwarded-For", "").split(",")[0].strip()
            if fwd:
                return fwd
        return self.client_address[0]

    # ------------------------------------------------------------ GET
    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if NEVER_SERVE.search(path):
            self.send_error(404)
            return
        user = self.current_user()

        if path == "/api/me":
            self.send_json({"user": public_user(user)} if user else {"user": None}, 200)
            return
        if path == "/api/config":
            self.send_json({"googleClientId": config()["google_client_id"]})
            return
        if path == "/api/pay/config":
            self.send_json(payments.public_config())
            return

        if path in ("/welcome", "/welcome.html"):
            self.isolate = False
            self.path = "/welcome.html"
            super().do_GET()
            return
        if path in PUBLIC_PAGES or path.startswith("/assets/"):
            self.isolate = path not in PUBLIC_PAGES
            super().do_GET()
            return

        # everything else needs an account
        if not user:
            if path in ("/", "/index.html"):
                self.redirect("/welcome")
            else:
                self.send_error(401)
            return

        if path in ("/", "/index.html"):
            self.serve_app(user)
            return
        if path in ("/pay", "/pay.html"):              # the full-page checkout
            self.isolate = False
            self.serve_app(user, "pay.html")
            return
        if path in PRO_FILES and plan_of(user) != "pro":
            if path == "/luna.js":            # free accounts get the upgrade screen instead of Luna
                self.path = "/luna-locked.js"
                super().do_GET()
            else:
                self.send_error(403)
            return

        if path.startswith("/x/search") or path.startswith("/x/v2search"):
            self.relay_x()
            return
        super().do_GET()

    def serve_app(self, user, page="index.html"):
        # inject the signed-in account so the page knows the user and their wallet before any script runs
        with open(os.path.join(HERE, page), encoding="utf-8") as f:
            html = f.read()
        boot = json.dumps(public_user(user)).replace("</", "<\\/")
        html = html.replace("<head>", f"<head>\n<script>window.LUNEX_USER={boot};</script>", 1)
        data = html.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def relay_x(self):
        official = self.path.startswith("/x/v2search?")
        key = self.headers.get("Authorization" if official else "X-API-Key", "")
        if not key:
            self.send_json(b'{"error":"missing API key"}', 400)
            return
        query = self.path.split("?", 1)[1] if "?" in self.path else ""
        if official:
            req = urllib.request.Request(f"{X_V2_SEARCH}?{query}", headers={"Authorization": key})
        else:
            req = urllib.request.Request(f"{X_SEARCH}?{query}", headers={"X-API-Key": key})
        try:
            with urllib.request.urlopen(req, timeout=25) as r:
                self.send_json(r.read(), r.status)
        except urllib.error.HTTPError as e:
            self.send_json(e.read() or b"{}", e.code)
        except Exception as e:
            self.send_json({"error": str(e)}, 502)

    # ------------------------------------------------------------ POST
    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/signup":
            return self.api_signup()
        if path == "/api/login":
            return self.api_login()
        if path == "/api/google":
            return self.api_google()
        if path == "/api/logout":
            tok = self.session_token()
            if tok:
                with _db_lock, db() as con:
                    con.execute("DELETE FROM sessions WHERE token_hash=?", (hashlib.sha256(tok.encode()).hexdigest(),))
            self.send_json({"ok": True}, cookie=f"{SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0")
            return

        if path == "/api/stripe/webhook":            # called by Stripe's servers; verified by signature, not by session
            n = int(self.headers.get("Content-Length", 0) or 0)
            payload = self.rfile.read(n) if n <= 500000 else b""
            try:
                with _db_lock, db() as con:
                    code, msg = payments.stripe_webhook(con, payload, self.headers.get("Stripe-Signature", ""))
            except Exception as e:
                code, msg = 500, str(e)
            self.send_json({"result": msg}, code)
            return

        user = self.current_user()
        if not user:
            self.send_json({"error": "Sign in first."}, 401)
            return
        if path == "/api/pay/invoice":
            b = self.read_json() or {}
            try:
                with _db_lock, db() as con:
                    inv = payments.create_invoice(con, user["id"], str(b.get("plan")), str(b.get("currency")))
                self.send_json(inv)
            except ValueError as e:
                self.send_json({"error": str(e)}, 400)
            return
        if path == "/api/pay/confirm":
            b = self.read_json() or {}
            try:
                sig = str(b.get("signature", ""))
                tx = rpc_call("getTransaction", [sig, {"encoding": "jsonParsed", "maxSupportedTransactionVersion": 0, "commitment": "confirmed"}]) \
                    if re.match(r"^[1-9A-HJ-NP-Za-km-z]{64,90}$", sig) else None   # network call outside the DB lock
                with _db_lock, db() as con:
                    status, info = payments.verify_payment(con, user["id"], str(b.get("ref", "")), sig, lambda *_: tx)
            except Exception:
                status, info = "pending", "Waiting for the network to confirm your payment…"
            self.send_json({"status": status, "proUntil": info} if status == "ok" else {"status": status, "message": info},
                           200 if status != "error" else 400)
            return
        if path == "/api/pay/check":                 # QR / Solana Pay: look for a payment carrying this invoice's reference key
            ref = str((self.read_json() or {}).get("ref", ""))
            with db() as con:
                inv = con.execute("SELECT status FROM invoices WHERE ref=? AND user_id=?", (ref, user["id"])).fetchone()
            if not inv:
                self.send_json({"status": "error", "message": "That payment request wasn't found. Start again."}, 400)
                return
            status, info = "pending", "Waiting for your payment…"
            try:
                sigs = [] if inv["status"] == "paid" else (rpc_call("getSignaturesForAddress", [
                    payments.reference_for(ref), {"limit": 10, "commitment": "confirmed"}]) or [])
                if inv["status"] == "paid":
                    sigs = [{"signature": ""}]
                for s in sigs:
                    if s.get("err"):
                        continue
                    sig = s.get("signature", "")
                    tx = rpc_call("getTransaction", [sig, {"encoding": "jsonParsed", "maxSupportedTransactionVersion": 0,
                                                           "commitment": "confirmed"}]) if sig else None
                    with _db_lock, db() as con:
                        st, inf = payments.verify_payment(con, user["id"], ref, sig, lambda *_: tx)
                    if st == "ok":
                        status, info = st, inf
                        break
                    if st == "error":
                        status, info = st, inf
            except Exception:
                pass
            self.send_json({"status": status, "proUntil": info} if status == "ok" else {"status": status, "message": info})
            return
        if path in ("/api/stripe/checkout", "/api/stripe/portal"):
            b = self.read_json() or {}
            try:
                url = (payments.stripe_checkout(user, str(b.get("plan")), self.base_url()) if path.endswith("checkout")
                       else payments.stripe_portal(user, self.base_url()))
                self.send_json({"url": url})
            except ValueError as e:
                self.send_json({"error": str(e)}, 400)
            return
        if path == "/api/wallet":
            body = self.read_json() or {}
            w = str(body.get("wallet", "")).strip()
            if w and not SOL_ADDR.match(w):
                self.send_json({"error": "That isn't a valid Solana wallet address."}, 400)
                return
            with _db_lock, db() as con:
                con.execute("UPDATE users SET wallet=? WHERE id=?", (w, user["id"]))
            self.send_json({"ok": True, "wallet": w})
            return
        if path == "/rpc":
            return self.relay_rpc()
        self.send_error(404)

    def api_signup(self):
        if throttled(self.client_ip()):
            self.send_json({"error": "Too many attempts. Wait a few minutes."}, 429)
            return
        b = self.read_json() or {}
        email, pw, name = str(b.get("email", "")).strip().lower(), str(b.get("password", "")), str(b.get("name", "")).strip()[:60]
        if not EMAIL.match(email):
            self.send_json({"error": "Enter a valid email address."}, 400)
            return
        if len(pw) < 8:
            self.send_json({"error": "Use a password with at least 8 characters."}, 400)
            return
        try:
            with _db_lock, db() as con:
                cur = con.execute("INSERT INTO users (email, name, pw_hash, created) VALUES (?,?,?,?)",
                                  (email, name, hash_password(pw), time.time()))
                uid = cur.lastrowid
        except sqlite3.IntegrityError:
            self.send_json({"error": "There's already an account with that email. Sign in instead."}, 409)
            return
        with db() as con:
            u = con.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
        self.send_json({"user": public_user(u)}, cookie=self.start_session(uid))

    def api_login(self):
        if throttled(self.client_ip()):
            self.send_json({"error": "Too many attempts. Wait a few minutes."}, 429)
            return
        b = self.read_json() or {}
        email, pw = str(b.get("email", "")).strip().lower(), str(b.get("password", ""))
        with db() as con:
            u = con.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
        if not u or not u["pw_hash"] or not check_password(pw, u["pw_hash"]):
            msg = "This account uses Google. Use Continue with Google." if (u and u["google_sub"] and not u["pw_hash"]) else "Wrong email or password."
            self.send_json({"error": msg}, 401)
            return
        self.send_json({"user": public_user(u)}, cookie=self.start_session(u["id"]))

    def api_google(self):
        cid = config()["google_client_id"]
        if not cid:
            self.send_json({"error": "Google sign-in isn't set up on this server yet."}, 400)
            return
        if throttled(self.client_ip()):
            self.send_json({"error": "Too many attempts. Wait a few minutes."}, 429)
            return
        cred = str((self.read_json() or {}).get("credential", ""))
        try:
            url = "https://oauth2.googleapis.com/tokeninfo?id_token=" + urllib.parse.quote(cred)
            with urllib.request.urlopen(url, timeout=10) as r:
                info = json.loads(r.read())
        except Exception:
            self.send_json({"error": "Google couldn't confirm that sign-in. Try again."}, 401)
            return
        if (info.get("aud") != cid or info.get("iss") not in ("accounts.google.com", "https://accounts.google.com")
                or str(info.get("email_verified")).lower() != "true" or int(info.get("exp", 0)) < time.time()):
            self.send_json({"error": "Google sign-in couldn't be verified."}, 401)
            return
        sub, email, name = info["sub"], info["email"].lower(), info.get("name", "")[:60]
        with _db_lock, db() as con:
            u = con.execute("SELECT * FROM users WHERE google_sub=?", (sub,)).fetchone() or \
                con.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
            if u:
                con.execute("UPDATE users SET google_sub=?, name=COALESCE(NULLIF(name,''),?) WHERE id=?", (sub, name, u["id"]))
                uid = u["id"]
            else:
                uid = con.execute("INSERT INTO users (email, name, google_sub, created) VALUES (?,?,?,?)",
                                  (email, name, sub, time.time())).lastrowid
            u = con.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
        self.send_json({"user": public_user(u)}, cookie=self.start_session(uid))

    def relay_rpc(self):
        n = int(self.headers.get("Content-Length", 0) or 0)
        body = self.rfile.read(n)
        try:
            method = json.loads(body).get("method")
        except Exception:
            method = None
        if method not in ALLOWED:
            self.send_error(400, "method not allowed")
            return
        req = urllib.request.Request(RPC, data=body, headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=25) as r:
                data, code = r.read(), r.status
        except urllib.error.HTTPError as e:
            data, code = e.read(), e.code
        except Exception as e:
            data, code = json.dumps({"error": {"message": str(e)}}).encode(), 502
        self.send_json(data, code)

    def log_message(self, *args):
        pass


def rpc_call(method, params):
    """Server-side Solana RPC call (used to verify payments)."""
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    req = urllib.request.Request(RPC, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read()).get("result")


def admin(argv):
    init_db()
    with _db_lock, db() as con:
        if argv[0] == "users":
            for u in con.execute("SELECT email, plan, wallet, google_sub IS NOT NULL AS g, pro_until FROM users ORDER BY created"):
                paid = time.strftime("%Y-%m-%d", time.localtime(u["pro_until"])) if (u["pro_until"] or 0) > time.time() else ""
                print(f"{u['email']:<40} {u['plan']:<5} {'paid until ' + paid if paid else '':<22} {'google' if u['g'] else 'email ':<7} {u['wallet'] or '-'}")
        elif argv[0] == "payments":
            for p in con.execute("SELECT p.*, u.email FROM payments p JOIN users u ON u.id=p.user_id ORDER BY p.created DESC LIMIT 50"):
                print(f"{time.strftime('%Y-%m-%d %H:%M', time.localtime(p['created']))}  {p['email']:<32} {p['method']:<5} ${p['usd'] or 0:<6} {p['days'] or '':<3} {p['proof'][:24]}")
        elif argv[0] in ("pro", "free") and len(argv) > 1:
            n = con.execute("UPDATE users SET plan=?" + (", pro_until=0" if argv[0] == "free" else "") + " WHERE email=?", (argv[0], argv[1].lower())).rowcount
            print(f"{argv[1]} is now {argv[0].upper()}" if n else f"No account with email {argv[1]}")
        else:
            print(__doc__)


if __name__ == "__main__":
    os.chdir(HERE)
    if len(sys.argv) > 1:
        admin(sys.argv[1:])
        sys.exit(0)
    init_db()
    print(f"Lunex running on {BIND}:{PORT}" + ("" if HOSTED else f"  ->  http://localhost:{PORT}"), flush=True)
    http.server.ThreadingHTTPServer((BIND, PORT), Handler).serve_forever()
