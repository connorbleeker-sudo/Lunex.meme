"""Lunex payments: Pro passes paid in USDC/SOL (verified on-chain) or by card (Stripe subscriptions).

Settings (environment variables, e.g. Railway > Variables):
  LUNEX_PAY_WALLET=<public address>   wallet that receives crypto payments (required for crypto)
  LUNEX_PRICE_WEEK=20                 USD price of a 7-day pass   (default 20)
  LUNEX_PRICE_MONTH=60                USD price of a 30-day pass  (default 60)
  STRIPE_SECRET_KEY=sk_...            Stripe secret key           (card payments)
  STRIPE_WEBHOOK_SECRET=whsec_...     signing secret of the webhook endpoint /api/stripe/webhook
  STRIPE_PRICE_WEEK=price_...         recurring weekly Price id from the Stripe dashboard
  STRIPE_PRICE_MONTH=price_...        recurring monthly Price id
"""
import hashlib
import hmac
import json
import math
import os
import re
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request

USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
INVOICE_TTL = 30 * 60          # a quote is valid for 30 minutes
SOL_SLIPPAGE = 0.985           # accept a SOL payment 1.5% under the quote (rounding, price moves)
SOL_ADDR = re.compile(r"^[1-9A-HJ-NP-Za-km-z]{32,44}$")


# ---------------------------------------------------------------- settings
def plans():
    def num(k, d):
        try:
            return max(0.5, float(os.environ.get(k, d)))
        except ValueError:
            return float(d)
    return {"week": {"id": "week", "label": "7 days", "usd": num("LUNEX_PRICE_WEEK", 20), "days": 7},
            "month": {"id": "month", "label": "30 days", "usd": num("LUNEX_PRICE_MONTH", 60), "days": 30}}


def pay_wallet():
    w = os.environ.get("LUNEX_PAY_WALLET", "").strip()
    return w if SOL_ADDR.match(w) else ""


def stripe_ready():
    return bool(os.environ.get("STRIPE_SECRET_KEY") and (os.environ.get("STRIPE_PRICE_WEEK") or os.environ.get("STRIPE_PRICE_MONTH")))


def public_config():
    return {"wallet": pay_wallet(), "usdcMint": USDC_MINT, "plans": list(plans().values()),
            "crypto": bool(pay_wallet()), "card": stripe_ready(),
            "cardPlans": [p for p in ("week", "month") if os.environ.get("STRIPE_PRICE_" + p.upper())]}


# ---------------------------------------------------------------- database
def migrate(con):
    cols = {r[1] for r in con.execute("PRAGMA table_info(users)")}
    if "pro_until" not in cols:
        con.execute("ALTER TABLE users ADD COLUMN pro_until REAL DEFAULT 0")
    if "stripe_customer" not in cols:
        con.execute("ALTER TABLE users ADD COLUMN stripe_customer TEXT DEFAULT ''")
    con.executescript("""
    CREATE TABLE IF NOT EXISTS invoices (
        ref TEXT PRIMARY KEY, user_id INTEGER NOT NULL, plan TEXT NOT NULL, currency TEXT NOT NULL,
        amount_raw INTEGER NOT NULL, usd REAL NOT NULL, days INTEGER NOT NULL, created REAL NOT NULL,
        status TEXT DEFAULT 'open');
    CREATE TABLE IF NOT EXISTS payments (
        proof TEXT PRIMARY KEY, user_id INTEGER NOT NULL, method TEXT NOT NULL, plan TEXT,
        usd REAL, days INTEGER, created REAL NOT NULL);""")


def grant(con, user_id, days, method, proof, plan, usd, until=None):
    """Extend Pro. `proof` (tx signature / Stripe invoice id) can only ever be used once."""
    try:
        con.execute("INSERT INTO payments VALUES (?,?,?,?,?,?,?)", (proof, user_id, method, plan, usd, days, time.time()))
    except Exception:
        return False  # already counted
    row = con.execute("SELECT pro_until FROM users WHERE id=?", (user_id,)).fetchone()
    current = max(time.time(), (row[0] or 0) if row else 0)
    new_until = max(until, current) if until else current + days * 86400
    con.execute("UPDATE users SET pro_until=? WHERE id=?", (new_until, user_id))
    return True


# ---------------------------------------------------------------- crypto
_sol = {"px": 0, "at": 0}


def sol_price():
    if time.time() - _sol["at"] < 60 and _sol["px"]:
        return _sol["px"]
    try:
        with urllib.request.urlopen("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd", timeout=8) as r:
            px = float(json.loads(r.read())["solana"]["usd"])
        _sol.update(px=px, at=time.time())
    except Exception:
        pass
    return _sol["px"]


_B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def _b58(b):
    n, out = int.from_bytes(b, "big"), ""
    while n:
        n, r = divmod(n, 58)
        out = _B58[r] + out
    return "1" * (len(b) - len(b.lstrip(b"\0"))) + out


def reference_for(ref):
    """Solana Pay reference key for an invoice: a public key that only this payment's transaction will mention,
    so the server can find the payment on-chain without the customer having to tell us the signature."""
    return _b58(hashlib.sha256(b"lunex-pay-ref:" + ref.encode()).digest())


def _amount_str(raw, decimals):
    return (f"{raw / 10 ** decimals:.{decimals}f}").rstrip("0").rstrip(".")


def solana_pay_url(ref, currency, raw, days):
    q = {"amount": _amount_str(raw, 6 if currency == "usdc" else 9)}
    if currency == "usdc":
        q["spl-token"] = USDC_MINT
    q.update({"reference": reference_for(ref), "label": "Lunex", "message": f"Lunex Pro: {days} days", "memo": "lunex:" + ref})
    return f"solana:{pay_wallet()}?" + urllib.parse.urlencode(q, quote_via=urllib.parse.quote)


def create_invoice(con, user_id, plan_id, currency):
    p = plans().get(plan_id)
    if not p:
        raise ValueError("Pick a plan.")
    if not pay_wallet():
        raise ValueError("Crypto payments aren't switched on yet.")
    if currency == "usdc":
        raw = round(p["usd"] * 1_000_000)                        # USDC has 6 decimals
    elif currency == "sol":
        px = sol_price()
        if not px:
            raise ValueError("Couldn't get the SOL price right now. Try USDC or try again.")
        raw = math.ceil(p["usd"] / px * 1_000_000_000)           # lamports
    else:
        raise ValueError("Pay in USDC or SOL.")
    ref = secrets.token_urlsafe(9)
    con.execute("INSERT INTO invoices VALUES (?,?,?,?,?,?,?,?,?)",
                (ref, user_id, plan_id, currency, raw, p["usd"], p["days"], time.time(), "open"))
    return {"ref": ref, "memo": "lunex:" + ref, "currency": currency, "amountRaw": raw,
            "amount": raw / (1_000_000 if currency == "usdc" else 1_000_000_000),
            "usd": p["usd"], "days": p["days"], "wallet": pay_wallet(), "usdcMint": USDC_MINT,
            "reference": reference_for(ref), "payUrl": solana_pay_url(ref, currency, raw, p["days"]),
            "expires": time.time() + INVOICE_TTL}


def _memos(tx):
    out = []
    msg = tx.get("transaction", {}).get("message", {})
    inner = [i for grp in (tx.get("meta", {}).get("innerInstructions") or []) for i in grp.get("instructions", [])]
    for ins in (msg.get("instructions") or []) + inner:
        if ins.get("program") == "spl-memo" and isinstance(ins.get("parsed"), str):
            out.append(ins["parsed"])
    return out


def verify_payment(con, user_id, ref, signature, rpc):
    """Returns ('ok', until) / ('pending', msg) / ('error', msg). rpc(method, params) -> result."""
    inv = con.execute("SELECT * FROM invoices WHERE ref=? AND user_id=?", (ref, user_id)).fetchone()
    if not inv:
        return "error", "That payment request wasn't found. Start again."
    if inv["status"] == "paid":
        row = con.execute("SELECT pro_until FROM users WHERE id=?", (user_id,)).fetchone()
        return "ok", row[0]
    if not re.match(r"^[1-9A-HJ-NP-Za-km-z]{64,90}$", signature or ""):
        return "error", "Missing transaction signature."
    tx = rpc("getTransaction", [signature, {"encoding": "jsonParsed", "maxSupportedTransactionVersion": 0, "commitment": "confirmed"}])
    if not tx:
        return "pending", "Waiting for the network to confirm your payment…"
    meta = tx.get("meta") or {}
    if meta.get("err"):
        return "error", "That transaction failed on-chain, so nothing was paid."
    keys = [k.get("pubkey") if isinstance(k, dict) else k for k in tx["transaction"]["message"]["accountKeys"]]
    # a payment belongs to this invoice if it carries our memo (wallet button) or our reference key (QR / Solana Pay)
    if reference_for(ref) not in keys and not any(m.strip().endswith("lunex:" + ref) for m in _memos(tx)):
        return "error", "That transaction isn't for this payment request."
    if inv["created"] + INVOICE_TTL + 15 * 60 < (tx.get("blockTime") or time.time()):
        return "error", "That payment request had expired. Start a new one."
    wallet = pay_wallet()
    if inv["currency"] == "usdc":
        def bal(arr):
            return sum(int(b["uiTokenAmount"]["amount"]) for b in (arr or []) if b.get("owner") == wallet and b.get("mint") == USDC_MINT)
        received = bal(meta.get("postTokenBalances")) - bal(meta.get("preTokenBalances"))
        ok = received >= inv["amount_raw"]
    else:
        if wallet not in keys:
            return "error", "That transaction didn't pay the Lunex wallet."
        i = keys.index(wallet)
        received = meta["postBalances"][i] - meta["preBalances"][i]
        ok = received >= inv["amount_raw"] * SOL_SLIPPAGE
    if not ok:
        return "error", "The amount received was less than the price, so Pro wasn't switched on. Contact support with your transaction."
    if not grant(con, user_id, inv["days"], inv["currency"], signature, inv["plan"], inv["usd"]):
        return "error", "That transaction was already used for a payment."
    con.execute("UPDATE invoices SET status='paid' WHERE ref=?", (ref,))
    row = con.execute("SELECT pro_until FROM users WHERE id=?", (user_id,)).fetchone()
    return "ok", row[0]


# ---------------------------------------------------------------- Stripe (cards)
def stripe_api(method, path, params=None):
    key = os.environ.get("STRIPE_SECRET_KEY", "")
    if not key:
        raise ValueError("Card payments aren't switched on yet.")
    data = urllib.parse.urlencode(params or {}, doseq=True).encode() if method == "POST" else None
    url = "https://api.stripe.com/v1" + path + ("?" + urllib.parse.urlencode(params) if method == "GET" and params else "")
    req = urllib.request.Request(url, data=data, method=method, headers={"Authorization": "Bearer " + key})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        try:
            msg = json.loads(e.read())["error"]["message"]
        except Exception:
            msg = "Stripe error " + str(e.code)
        raise ValueError(msg)


def stripe_checkout(user, plan_id, base_url):
    price = os.environ.get("STRIPE_PRICE_WEEK" if plan_id == "week" else "STRIPE_PRICE_MONTH", "")
    if not price:
        raise ValueError("Card payments for that plan aren't set up yet.")
    params = {"mode": "subscription", "line_items[0][price]": price, "line_items[0][quantity]": 1,
              "success_url": base_url + "/?paid=card", "cancel_url": base_url + "/?paid=cancel",
              "client_reference_id": str(user["id"]), "subscription_data[metadata][user_id]": str(user["id"]),
              "subscription_data[metadata][plan]": plan_id, "allow_promotion_codes": "true"}
    if user["stripe_customer"]:
        params["customer"] = user["stripe_customer"]
    else:
        params["customer_email"] = user["email"]
    return stripe_api("POST", "/checkout/sessions", params)["url"]


def stripe_portal(user, base_url):
    if not user["stripe_customer"]:
        raise ValueError("No card subscription on this account.")
    return stripe_api("POST", "/billing_portal/sessions", {"customer": user["stripe_customer"], "return_url": base_url + "/"})["url"]


def verify_stripe_signature(payload, header, secret, tolerance=300):
    parts = {}
    for item in (header or "").split(","):
        k, _, v = item.partition("=")
        parts.setdefault(k.strip(), []).append(v.strip())
    try:
        ts = int(parts["t"][0])
    except Exception:
        return False
    if abs(time.time() - ts) > tolerance:
        return False
    expected = hmac.new(secret.encode(), f"{ts}.".encode() + payload, hashlib.sha256).hexdigest()
    return any(hmac.compare_digest(expected, s) for s in parts.get("v1", []))


def _period_end(sub):
    end = sub.get("current_period_end")
    if not end:
        items = (sub.get("items") or {}).get("data") or []
        end = items[0].get("current_period_end") if items else None
    return end


def stripe_webhook(con, payload, sig_header):
    secret = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
    if not secret or not verify_stripe_signature(payload, sig_header, secret):
        return 400, "bad signature"
    event = json.loads(payload)
    obj = event.get("data", {}).get("object", {})
    kind = event.get("type")
    if kind == "checkout.session.completed" and obj.get("mode") == "subscription":
        uid = int(obj.get("client_reference_id") or 0)
        if uid:
            con.execute("UPDATE users SET stripe_customer=? WHERE id=?", (obj.get("customer") or "", uid))
            sub_id = obj.get("subscription")
            if sub_id:
                sub = stripe_api("GET", "/subscriptions/" + sub_id)
                end = _period_end(sub)
                if end:
                    grant(con, uid, 0, "card", "sub-start:" + sub_id, (sub.get("metadata") or {}).get("plan"), None, until=end + 3600)
    elif kind in ("invoice.paid", "invoice.payment_succeeded"):
        cust = obj.get("customer")
        row = con.execute("SELECT id FROM users WHERE stripe_customer=?", (cust,)).fetchone() if cust else None
        uid = row[0] if row else None
        if not uid:  # invoice can arrive before checkout.session.completed: use the subscription's metadata
            md = ((obj.get("parent") or {}).get("subscription_details") or {}).get("metadata") or obj.get("subscription_details", {}).get("metadata") or {}
            uid = int(md.get("user_id") or 0) or None
            if uid and cust:
                con.execute("UPDATE users SET stripe_customer=? WHERE id=?", (cust, uid))
        lines = (obj.get("lines") or {}).get("data") or []
        end = lines[0].get("period", {}).get("end") if lines else None
        if uid and end:
            grant(con, uid, 0, "card", "inv:" + obj.get("id", secrets.token_hex(6)), None, (obj.get("amount_paid") or 0) / 100, until=end + 3600)
    return 200, "ok"
