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

Legal pages (/privacy, /terms, /refunds, /cookies) and the footers fill these in:
  LUNEX_LEGAL_NAME="Lunex LLC"   the legal name of the business that runs Lunex
  LUNEX_CONTACT_EMAIL=...        where users reach you (privacy requests, billing, legal notices)
  LUNEX_LEGAL_STATE=Delaware     US state whose law governs the Terms

Live stats and feed: see live.py (a pump.fun listener runs in the background; LUNEX_LIVE=off disables it).
Weekly recap email: see recap.py for the SMTP settings. Without them, no email is sent.
Community calls: python server.py chat-hide <id> hides a message.
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

import ai
import live
import payments
import recap

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
PUBLIC_PAGES = {"/welcome", "/welcome.html", "/welcome.css", "/welcome.js", "/favicon.ico", "/favicon.svg", "/legal.css", "/lunex-ui.js", "/welcome-live.js"}
LEGAL_PAGES = {"/privacy": "privacy.html", "/terms": "terms.html", "/refunds": "refunds.html", "/cookies": "cookies.html"}


SYNC_KEYS = {"mr_wallets", "mr_trades", "mr_xaccounts", "mr_handles", "mr_xdiscover", "nv-sound", "luna-picks", "lx-practice"}   # never API keys
CHAT_CALLS = {"BUY", "SELL", "WATCH", "AVOID"}
AGREE_ERROR ="To create an account, confirm you're 18 or older and agree to the Terms and Privacy Policy."


def legal_values():
    """Business details for the legal pages and footers. Unset values show a visible placeholder so they get noticed."""
    import html as _html
    v = {"LEGAL_NAME": os.environ.get("LUNEX_LEGAL_NAME", "").strip() or "Lunex",
         "CONTACT_EMAIL": os.environ.get("LUNEX_CONTACT_EMAIL", "").strip() or "[set LUNEX_CONTACT_EMAIL]",
         "LEGAL_STATE": os.environ.get("LUNEX_LEGAL_STATE", "").strip() or "[set LUNEX_LEGAL_STATE]",
         "YEAR": time.strftime("%Y")}
    return {k: _html.escape(s) for k, s in v.items()}


def fill_legal(html):
    for k, s in legal_values().items():
        html = html.replace("{{" + k + "}}", s)
    return html


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
        if "terms_accepted" not in {r[1] for r in con.execute("PRAGMA table_info(users)")}:
            # when the user confirmed they're 18+ and accepted the Terms and Privacy Policy (0 = account made before this existed)
            con.execute("ALTER TABLE users ADD COLUMN terms_accepted REAL DEFAULT 0")
        con.executescript("""
        CREATE TABLE IF NOT EXISTS user_data (          -- watchlists, alerts, practice: synced from the browser
            user_id INTEGER NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, updated REAL NOT NULL,
            PRIMARY KEY (user_id, key));
        CREATE TABLE IF NOT EXISTS chat (               -- community calls
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, name TEXT NOT NULL, pro INTEGER DEFAULT 0,
            text TEXT NOT NULL, mint TEXT DEFAULT '', sym TEXT DEFAULT '', call TEXT DEFAULT '', price REAL DEFAULT 0, fdv REAL DEFAULT 0,
            created REAL NOT NULL, hidden INTEGER DEFAULT 0, reports INTEGER DEFAULT 0);
        CREATE INDEX IF NOT EXISTS chat_created ON chat(created);
        CREATE TABLE IF NOT EXISTS chat_reports (msg_id INTEGER NOT NULL, user_id INTEGER NOT NULL, PRIMARY KEY (msg_id, user_id));""")
        live.migrate(con)
        recap.migrate(con)
        ai.migrate(con)


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
            "proUntil": 0 if lifetime else (u["pro_until"] or 0), "lifetime": lifetime, "card": bool(u["stripe_customer"]),
            "lunaCloud": ai.enabled()}


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

        # ---- public: no account needed
        if path == "/api/public/stats":
            self.send_json(live.public_stats())
            return
        if path == "/api/public/feed":
            try:
                after = float(urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).get("after", ["0"])[0])
            except ValueError:
                after = 0.0
            self.send_json({"launches": live.feed(after), "live": live.public_stats()["live"]})
            return
        if path == "/api/public/check":            # the free rug check
            if throttled("check:" + self.client_ip(), limit=20, window=60):
                self.send_json({"error": "That's a lot of checks. Wait a minute and try again."}, 429)
                return
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            try:
                res = live.rug_check(qs.get("q", [""])[0])
                live.bump("checks_all")
                self.send_json(res)
            except ValueError as e:
                self.send_json({"error": str(e)}, 400)
            except Exception:
                self.send_json({"error": "DexScreener didn't answer. Try again in a moment."}, 502)
            return
        if path == "/unsubscribe":
            return self.unsubscribe()

        if path in ("/welcome", "/welcome.html"):
            self.isolate = False
            self.serve_page("welcome.html")
            return
        legal_key = path.removesuffix(".html").rstrip("/")
        if legal_key in LEGAL_PAGES:                   # /privacy, /terms, /refunds, /cookies: public, no account needed
            self.isolate = False
            self.serve_page(LEGAL_PAGES[legal_key])
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
        if path in ("/account", "/account.html"):      # account settings
            self.isolate = False
            self.serve_app(user, "account.html")
            return
        if path == "/api/account":
            self.send_json(self.account_details(user))
            return
        if path == "/api/chat":
            return self.chat_list(user)
        if path == "/api/account/recap-preview":       # this week's recap email, as the user would get it
            with db() as con:
                _, body, _ = recap.build(con, user)
            self.isolate = False
            self.send_html(body)
            return
        if path == "/api/account/export":              # everything we hold about this account, as a JSON download
            data = json.dumps(self.account_export(user), indent=2).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Disposition", 'attachment; filename="lunex-account-data.json"')
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
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
        with db() as con:   # the account's saved watchlists/alerts/practice, so they're in place before the app reads them
            sync = {r["key"]: {"v": r["value"], "t": r["updated"]} for r in con.execute("SELECT key, value, updated FROM user_data WHERE user_id=?", (user["id"],))}
        sync_js = json.dumps(sync).replace("</", "<\\/")
        html = fill_legal(html).replace("<head>", f"<head>\n<script>window.LUNEX_USER={boot};window.LUNEX_SYNC={sync_js};</script>", 1)
        self.send_html(html)

    def serve_page(self, page):
        # public page with the business details filled in
        with open(os.path.join(HERE, page), encoding="utf-8") as f:
            self.send_html(fill_legal(f.read()))

    def send_html(self, html):
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

        if path == "/unsubscribe":                   # one-click unsubscribe from mail apps (List-Unsubscribe-Post)
            return self.unsubscribe()
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
        if path == "/api/account/delete":
            return self.api_delete_account(user)
        if path == "/api/account/profile":
            name = str((self.read_json() or {}).get("name", "")).strip()[:60]
            if not name:
                self.send_json({"error": "Enter a name."}, 400)
                return
            with _db_lock, db() as con:
                con.execute("UPDATE users SET name=? WHERE id=?", (name, user["id"]))
            self.send_json({"ok": True, "name": name})
            return
        if path == "/api/account/password":
            return self.api_password(user)
        if path == "/api/sync":
            return self.api_sync(user)
        if path == "/api/luna/chat":                  # Luna's cloud brain (ai.py): Pro only, every limit checked there
            if plan_of(user) != "pro":
                self.send_json({"error": "Luna is part of Lunex Pro."}, 403)
                return
            body = self.read_json(limit=60000)
            if body is None:
                self.send_json({"error": "That message is too long."}, 413)
                return
            code, payload = ai.handle(user, body, db, _db_lock)
            self.send_json(payload, code)
            return
        if path == "/api/chat":
            return self.chat_post(user)
        if path == "/api/chat/report":
            return self.chat_report(user)
        if path == "/api/chat/delete":
            mid = int((self.read_json() or {}).get("id") or 0)
            with _db_lock, db() as con:
                n = con.execute("DELETE FROM chat WHERE id=? AND user_id=?", (mid, user["id"])).rowcount
            self.send_json({"ok": bool(n)})
            return
        if path == "/api/practice/log":               # counts practice trades for the public stats
            if not throttled(f"practice:{user['id']}", limit=30, window=60):
                live.bump("practice_all")
            self.send_json({"ok": True})
            return
        if path == "/api/account/recap":
            on = 1 if (self.read_json() or {}).get("on") else 0
            with _db_lock, db() as con:
                con.execute("UPDATE users SET recap_opt=? WHERE id=?", (on, user["id"]))
            self.send_json({"ok": True, "on": bool(on)})
            return
        if path == "/api/account/recap-test":
            if not recap.configured():
                self.send_json({"error": "Email isn't set up on this server yet, so nothing can be sent. Use Preview to see it."}, 400)
                return
            if throttled(f"recap:{user['id']}", limit=3, window=3600):
                self.send_json({"error": "You've sent a few test emails already. Try again in an hour."}, 429)
                return
            try:
                with db() as con:
                    recap.send_to(con, user)
                self.send_json({"ok": True})
            except Exception as e:
                self.send_json({"error": f"Sending failed: {e}"}, 502)
            return
        if path == "/api/account/signout-others":
            tok = self.session_token() or ""
            with _db_lock, db() as con:
                n = con.execute("DELETE FROM sessions WHERE user_id=? AND token_hash<>?",
                                (user["id"], hashlib.sha256(tok.encode()).hexdigest())).rowcount
            self.send_json({"ok": True, "removed": n})
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
        if b.get("agree") is not True:
            self.send_json({"error": AGREE_ERROR}, 400)
            return
        try:
            with _db_lock, db() as con:
                cur = con.execute("INSERT INTO users (email, name, pw_hash, created, terms_accepted) VALUES (?,?,?,?,?)",
                                  (email, name, hash_password(pw), time.time(), time.time()))
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
        b = self.read_json() or {}
        cred, agree = str(b.get("credential", "")), b.get("agree") is True
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
            elif not agree:                          # a new account: needs the 18+ / Terms box ticked first
                self.send_json({"error": AGREE_ERROR, "needsAgree": True}, 400)
                return
            else:
                uid = con.execute("INSERT INTO users (email, name, google_sub, created, terms_accepted) VALUES (?,?,?,?,?)",
                                  (email, name, sub, time.time(), time.time())).lastrowid
            u = con.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
        self.send_json({"user": public_user(u)}, cookie=self.start_session(uid))

    def account_details(self, user):
        with db() as con:
            pays = con.execute("SELECT method, plan, usd, days, created, proof FROM payments WHERE user_id=? ORDER BY created DESC LIMIT 50",
                               (user["id"],)).fetchall()
            sessions = con.execute("SELECT COUNT(*) FROM sessions WHERE user_id=? AND expires>?", (user["id"], time.time())).fetchone()[0]
        return {"user": public_user(user), "created": user["created"], "termsAccepted": user["terms_accepted"] or 0,
                "recapOn": bool(user["recap_opt"]), "mailReady": recap.configured(),
                "hasPassword": bool(user["pw_hash"]), "sessions": sessions, "plans": payments.public_config()["plans"],
                "payments": [{"method": p["method"], "plan": p["plan"], "usd": p["usd"], "days": p["days"], "created": p["created"],
                              "proof": "" if p["proof"].startswith(("sub-start:", "inv:")) else p["proof"]} for p in pays]}

    def account_export(self, user):
        with db() as con:
            pays = [dict(r) for r in con.execute("SELECT method, plan, usd, days, created, proof FROM payments WHERE user_id=?", (user["id"],))]
        iso = lambda t: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t)) if t else None
        return {"exported": iso(time.time()), "account": {
            "email": user["email"], "name": user["name"], "wallet": user["wallet"], "plan": plan_of(user),
            "pro_until": iso(user["pro_until"]), "created": iso(user["created"]), "terms_accepted": iso(user["terms_accepted"]),
            "sign_in_methods": [m for m, on in (("password", user["pw_hash"]), ("google", user["google_sub"])) if on],
            "card_customer": bool(user["stripe_customer"])},
            "payments": [{**p, "created": iso(p["created"])} for p in pays],
            "note": "Watchlists, alert settings, tracked wallets and API keys are stored only in your browser, not on Lunex's servers."}

    def api_password(self, user):
        if throttled(self.client_ip()):
            self.send_json({"error": "Too many attempts. Wait a few minutes."}, 429)
            return
        b = self.read_json() or {}
        cur, new = str(b.get("current", "")), str(b.get("new", ""))
        if user["pw_hash"] and not check_password(cur, user["pw_hash"]):
            self.send_json({"error": "Your current password is wrong."}, 400)
            return
        if len(new) < 8:
            self.send_json({"error": "Use a new password with at least 8 characters."}, 400)
            return
        tok = self.session_token() or ""
        with _db_lock, db() as con:
            con.execute("UPDATE users SET pw_hash=? WHERE id=?", (hash_password(new), user["id"]))
            # a new password signs out every other device
            con.execute("DELETE FROM sessions WHERE user_id=? AND token_hash<>?", (user["id"], hashlib.sha256(tok.encode()).hexdigest()))
        self.send_json({"ok": True})

    # ------------------------------------------------------------ synced browser data (watchlists, alerts, practice)
    def api_sync(self, user):
        b = self.read_json(limit=400000) or {}
        items = b.get("items") if isinstance(b.get("items"), dict) else {}
        bad = [k for k in items if k not in SYNC_KEYS]
        if bad or not items:
            self.send_json({"error": "Nothing to save."}, 400)
            return
        now = time.time()
        with _db_lock, db() as con:
            for k, v in items.items():
                if v is None:
                    con.execute("DELETE FROM user_data WHERE user_id=? AND key=?", (user["id"], k))
                elif isinstance(v, str) and len(v) <= 150000:
                    con.execute("INSERT INTO user_data VALUES (?,?,?,?) ON CONFLICT(user_id, key) DO UPDATE SET value=excluded.value, updated=excluded.updated",
                                (user["id"], k, v, now))
        self.send_json({"ok": True, "t": now})

    # ------------------------------------------------------------ community calls
    def chat_list(self, user):
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        try:
            after = int(qs.get("after", ["0"])[0])
        except ValueError:
            after = 0
        with db() as con:
            if after:
                rows = con.execute("SELECT * FROM chat WHERE id>? AND hidden=0 ORDER BY id LIMIT 100", (after,)).fetchall()
            else:
                rows = con.execute("SELECT * FROM (SELECT * FROM chat WHERE hidden=0 ORDER BY id DESC LIMIT 80) ORDER BY id").fetchall()
            gone = [r[0] for r in con.execute("SELECT id FROM chat WHERE hidden=1 AND created>?", (time.time() - 86400,))]
        self.send_json({"messages": [{"id": r["id"], "name": r["name"], "pro": bool(r["pro"]), "text": r["text"], "mint": r["mint"],
                                      "sym": r["sym"], "call": r["call"], "price": r["price"], "fdv": r["fdv"], "t": r["created"],
                                      "mine": r["user_id"] == user["id"]} for r in rows], "hidden": gone})

    def chat_post(self, user):
        b = self.read_json() or {}
        text = re.sub(r"\s+", " ", str(b.get("text", ""))).strip()[:280]
        mint, call = str(b.get("mint", "")).strip(), str(b.get("call", "")).strip().upper()
        if mint and not SOL_ADDR.match(mint):
            self.send_json({"error": "That isn't a valid Solana contract address."}, 400)
            return
        if call and call not in CHAT_CALLS:
            call = ""
        if not text and not mint:
            self.send_json({"error": "Write something or attach a coin."}, 400)
            return
        if len(text.split()) >= 12 and all(w.isalpha() and w.islower() for w in text.split()[:12]):
            self.send_json({"error": "That looks like a seed phrase, so it wasn't posted. Never share one, anywhere."}, 400)
            return
        if throttled(f"chat:{user['id']}", limit=1, window=6) or throttled(f"chath:{user['id']}", limit=40, window=3600):
            self.send_json({"error": "Slow down a little. One message every few seconds."}, 429)
            return
        sym, price, fdv = "", 0.0, 0.0
        if mint:
            got = live.price_of(mint)                  # stamp the price at the moment of the call
            if got:
                sym, price, fdv = got
        name = (user["name"] or user["email"].split("@")[0])[:40]
        with _db_lock, db() as con:
            mid = con.execute("INSERT INTO chat (user_id, name, pro, text, mint, sym, call, price, fdv, created) VALUES (?,?,?,?,?,?,?,?,?,?)",
                              (user["id"], name, 1 if plan_of(user) == "pro" else 0, text, mint, sym, call if mint else "", price, fdv, time.time())).lastrowid
        if mint and call:
            live.bump("calls_all")
        self.send_json({"ok": True, "id": mid})

    def chat_report(self, user):
        mid = int((self.read_json() or {}).get("id") or 0)
        with _db_lock, db() as con:
            try:
                con.execute("INSERT INTO chat_reports VALUES (?, ?)", (mid, user["id"]))
                con.execute("UPDATE chat SET reports = reports + 1, hidden = CASE WHEN reports + 1 >= 3 THEN 1 ELSE hidden END WHERE id=?", (mid,))
            except sqlite3.IntegrityError:
                pass
        self.send_json({"ok": True})

    def unsubscribe(self):
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        try:
            uid = int(qs.get("u", ["0"])[0])
        except ValueError:
            uid = 0
        ok = uid and recap.check_unsub(uid, qs.get("t", [""])[0])
        if ok:
            with _db_lock, db() as con:
                con.execute("UPDATE users SET recap_opt=0 WHERE id=?", (uid,))
        self.isolate = False
        msg = ("You're unsubscribed from the weekly recap. You can turn it back on any time in Account settings."
               if ok else "That unsubscribe link isn't valid. Turn the recap off in Account settings instead.")
        self.send_html(fill_legal(f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Weekly recap · Lunex</title><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/legal.css"></head>
<body><main><p class="eyebrow">Email</p><h1>{'Unsubscribed.' if ok else 'Link not valid.'}</h1><p>{msg}</p><p><a href="/">Open Lunex</a></p></main></body></html>"""))

    def api_delete_account(self, user):
        """Permanently delete the signed-in account. The user types their email to confirm.
        Card subscriptions are cancelled first so nobody keeps getting charged for a deleted account.
        Payment records (amount, date, transaction id) are kept without the account, for tax and accounting."""
        b = self.read_json() or {}
        if str(b.get("confirm", "")).strip().lower() != user["email"].lower():
            self.send_json({"error": "Type your account email exactly to confirm."}, 400)
            return
        if user["stripe_customer"]:
            try:
                payments.stripe_cancel_all(user["stripe_customer"])
            except ValueError as e:
                self.send_json({"error": f"Couldn't cancel your card subscription, so nothing was deleted. Try again or email {legal_values()['CONTACT_EMAIL']}. ({e})"}, 502)
                return
        with _db_lock, db() as con:
            con.execute("DELETE FROM sessions WHERE user_id=?", (user["id"],))
            con.execute("DELETE FROM invoices WHERE user_id=?", (user["id"],))
            con.execute("DELETE FROM user_data WHERE user_id=?", (user["id"],))
            con.execute("DELETE FROM chat_reports WHERE user_id=?", (user["id"],))
            con.execute("DELETE FROM chat WHERE user_id=?", (user["id"],))
            # Luna usage: unlink it from the account but keep today's cost in the site-wide total, so the daily budget stays right
            con.execute("UPDATE ai_usage SET user_id = -user_id WHERE user_id=?", (user["id"],))
            con.execute("DELETE FROM users WHERE id=?", (user["id"],))
        self.send_json({"ok": True}, cookie=f"{SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0")

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
        elif argv[0] == "chat-hide" and len(argv) > 1:
            n = con.execute("UPDATE chat SET hidden=1 WHERE id=?", (int(argv[1]),)).rowcount
            print(f"Message {argv[1]} hidden" if n else f"No message {argv[1]}")
        else:
            print(__doc__)


if __name__ == "__main__":
    os.chdir(HERE)
    if len(sys.argv) > 1:
        admin(sys.argv[1:])
        sys.exit(0)
    init_db()
    live.start(db)
    recap.start(db, legal_values)
    print(f"Lunex running on {BIND}:{PORT}" + ("" if HOSTED else f"  ->  http://localhost:{PORT}"), flush=True)
    http.server.ThreadingHTTPServer((BIND, PORT), Handler).serve_forever()
