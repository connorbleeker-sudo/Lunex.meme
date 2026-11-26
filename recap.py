"""Lunex weekly recap email (standard library only).

Every Monday from 15:00 UTC, each account with the recap switched on gets one email: their practice
portfolio, their alerts, how their community calls did, the week's best community calls, and the week's
launch count. Every email has a one-click unsubscribe link and a List-Unsubscribe header.

Settings (environment variables):
  LUNEX_SMTP_HOST=smtp.example.com     SMTP server of your email provider (Resend, Postmark, SES, Gmail...)
  LUNEX_SMTP_PORT=587                  587 = STARTTLS, 465 = SSL
  LUNEX_SMTP_USER=... / LUNEX_SMTP_PASS=...
  LUNEX_MAIL_FROM="Lunex <recap@yourdomain.com>"
  LUNEX_POSTAL_ADDRESS="..."           your business postal address (US CAN-SPAM requires it in the footer)
  LUNEX_PUBLIC_URL=https://...         the site's address, used for links in the email
  LUNEX_SECRET=...                     signs unsubscribe links (one is generated and stored if unset)
"""
import datetime
import hashlib
import hmac
import html
import json
import os
import secrets
import smtplib
import ssl
import threading
import time
import urllib.parse
from email.message import EmailMessage

import live

_db = None
_legal = None


def configured():
    return bool(os.environ.get("LUNEX_SMTP_HOST") and os.environ.get("LUNEX_MAIL_FROM"))


def _secret():
    s = os.environ.get("LUNEX_SECRET", "")
    if s:
        return s
    with _db() as con:
        row =con.execute("SELECT v FROM kv WHERE k='secret'").fetchone()
        if row:
            return row[0]
        s = secrets.token_hex(32)
        con.execute("INSERT INTO kv VALUES ('secret', ?)", (s,))
        return s


def unsub_token(uid):
    return hmac.new(_secret().encode(), f"unsub:{uid}".encode(), hashlib.sha256).hexdigest()[:32]


def check_unsub(uid, token):
    return hmac.compare_digest(unsub_token(uid), token or "")


def base_url():
    return (os.environ.get("LUNEX_PUBLIC_URL") or "http://localhost:8765").rstrip("/")


def unsub_url(uid):
    return f"{base_url()}/unsubscribe?u={uid}&t={unsub_token(uid)}"


# ---------------------------------------------------------------- content
def _user_data(con, uid, key):
    row = con.execute("SELECT value FROM user_data WHERE user_id=? AND key=?", (uid, key)).fetchone()
    try:
        return json.loads(row[0]) if row else None
    except ValueError:
        return None


def _call_moves(rows, limit=8):
    """[(row, pct_change_since_call)] for calls that carry a coin and a price, priced now via DexScreener."""
    out, prices = [], {}
    for r in rows:
        if not r["mint"] or not r["price"]:
            continue
        if r["mint"] not in prices:
            if len(prices) >= limit:
                continue
            got = live.price_of(r["mint"])
            prices[r["mint"]] = got[1] if got else None
        now = prices[r["mint"]]
        if now:
            out.append((r, (now / r["price"] - 1) * 100))
    return out


def build(con, user):
    uid, week_ago = user["id"], time.time() - 7 * 86400
    st = live.public_stats()
    name = html.escape(user["name"] or user["email"].split("@")[0])
    pro = (user["pro_until"] or 0) > time.time() or user["plan"] == "pro"

    practice = _user_data(con, uid, "lx-practice") or {}
    trades = _user_data(con, uid, "mr_trades") or []
    p_start, p_eq = practice.get("start") or 0, practice.get("lastEquity")
    mine = con.execute("SELECT * FROM chat WHERE user_id=? AND created>? AND hidden=0 ORDER BY created DESC LIMIT 20", (uid, week_ago)).fetchall()
    community = con.execute("SELECT * FROM chat WHERE created>? AND hidden=0 AND mint<>'' AND call IN ('BUY','WATCH') ORDER BY created DESC LIMIT 200", (week_ago,)).fetchall()
    my_moves = _call_moves(mine, 5)
    top = sorted(_call_moves(community, 12), key=lambda x: -x[1])
    seen, best = set(), []
    for r, ch in top:
        if r["mint"] in seen:
            continue
        seen.add(r["mint"]); best.append((r, ch))
        if len(best) == 3:
            break

    pct = lambda v: "0%" if abs(v) < .5 else f"{'+' if v > 0 else ''}{v:.0f}%"
    col = lambda v: "#3dffb0" if v >= 0 else "#ff4d6d"
    rows_html, rows_text = [], []

    def block(title, body_html, body_text):
        rows_html.append(f'<tr><td style="padding:18px 24px;border-top:1px solid #23232c"><div style="font:600 12px monospace;letter-spacing:.12em;color:#ff7fd1;text-transform:uppercase;margin-bottom:8px">{title}</div>{body_html}</td></tr>')
        rows_text.append(f"{title.upper()}\n{body_text}\n")

    if p_start and p_eq is not None:
        ch = (p_eq / p_start - 1) * 100
        block("Your practice portfolio", f'<div style="font:700 28px sans-serif;color:#f0eef3">{p_eq:.2f} SOL <span style="font-size:16px;color:{col(ch)}">{pct(ch)}</span></div>'
              f'<div style="color:#aaa8b6;font-size:14px">Started with {p_start:.0f} pretend SOL. {len(practice.get("positions") or {})} open position(s).</div>',
              f"{p_eq:.2f} SOL ({pct(ch)}) from a {p_start:.0f} SOL start.")
    else:
        block("Practice mode", '<div style="color:#aaa8b6;font-size:14px">Try your calls with 10 pretend SOL. No risk, real prices. Open <b style="color:#f0eef3">More → Practice</b> in Lunex.</div>',
              "Try your calls with 10 pretend SOL: More > Practice in Lunex.")

    hits = sum(1 for t in trades if isinstance(t, dict) and t.get("hit"))
    block("Your alerts", f'<div style="color:#aaa8b6;font-size:14px"><b style="color:#f0eef3">{len(trades)}</b> take-profit / stop alerts set, <b style="color:#f0eef3">{hits}</b> fired.</div>',
          f"{len(trades)} alerts set, {hits} fired.")

    if my_moves:
        li = "".join(f'<div style="padding:4px 0;color:#f0eef3;font-size:14px"><b>{html.escape(r["call"])}</b> ${html.escape(r["sym"] or "?")} <span style="color:{col(c)}">{pct(c)} since your call</span></div>' for r, c in my_moves)
        block("Your calls this week", li, "\n".join(f'{r["call"]} ${r["sym"]}: {pct(c)} since your call' for r, c in my_moves))
    if best:
        li = "".join(f'<div style="padding:4px 0;color:#f0eef3;font-size:14px">${html.escape(r["sym"] or "?")} by {html.escape(r["name"])} <span style="color:{col(c)}">{pct(c)}</span></div>' for r, c in best)
        block("Top community calls", li, "\n".join(f'${r["sym"]} by {r["name"]}: {pct(c)}' for r, c in best))

    block("This week on pump.fun", f'<div style="color:#aaa8b6;font-size:14px">Lunex scanned <b style="color:#f0eef3">{st["launches7d"]:,}</b> new launches in the last 7 days.</div>',
          f'Lunex scanned {st["launches7d"]:,} new launches in the last 7 days.')

    if not pro:
        block("Luna", '<div style="color:#aaa8b6;font-size:14px">Want a straight buy, skip or sell call on the coins you watch? <a href="' + base_url() + '/#luna" style="color:#ff7fd1">Unlock Luna with Pro</a>.</div>',
              f"Unlock Luna with Pro: {base_url()}/#luna")

    lg = _legal() if _legal else {}
    addr = html.escape(os.environ.get("LUNEX_POSTAL_ADDRESS", "").strip() or "[set LUNEX_POSTAL_ADDRESS]")
    un = unsub_url(uid)
    body = f"""<!doctype html><html><body style="margin:0;background:#060608;padding:24px 0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#0f0f16;border:1px solid #23232c;border-radius:20px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif">
<tr><td style="padding:28px 24px 8px"><div style="font:800 24px sans-serif;color:#f0eef3">Lun<span style="color:#ff6a2b">ex</span></div>
<div style="font:800 30px sans-serif;color:#f0eef3;margin-top:14px;line-height:1.1">Your week, {name}.</div></td></tr>
{''.join(rows_html)}
<tr><td style="padding:20px 24px"><a href="{base_url()}/" style="display:inline-block;padding:13px 22px;border-radius:999px;background:#ff6a2b;color:#0b0604;font:700 14px sans-serif;text-decoration:none">Open Lunex</a></td></tr>
<tr><td style="padding:18px 24px 24px;border-top:1px solid #23232c;color:#7d7b89;font-size:12px;line-height:1.6">
Signals, not financial advice. Most new memecoins go to zero.<br>
You get this because the weekly recap is on for {html.escape(user["email"])}. <a href="{un}" style="color:#aaa8b6">Unsubscribe</a> · <a href="{base_url()}/account#device" style="color:#aaa8b6">Email settings</a><br>
{lg.get("LEGAL_NAME", "Lunex")} · {addr}</td></tr>
</table></td></tr></table></body></html>"""
    text = f"Your week, {user['name'] or ''}.\n\n" + "\n".join(rows_text) + f"\nOpen Lunex: {base_url()}/\n\nUnsubscribe: {un}\n{lg.get('LEGAL_NAME', 'Lunex')} · {os.environ.get('LUNEX_POSTAL_ADDRESS', '')}\n"
    return "Your Lunex week", body, text


def send(to, subject, body_html, body_text, unsubscribe):
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = os.environ["LUNEX_MAIL_FROM"], to, subject
    msg["List-Unsubscribe"] = f"<{unsubscribe}>"
    msg["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"
    msg.set_content(body_text)
    msg.add_alternative(body_html, subtype="html")
    host, port = os.environ["LUNEX_SMTP_HOST"], int(os.environ.get("LUNEX_SMTP_PORT", "587"))
    user, pw = os.environ.get("LUNEX_SMTP_USER", ""), os.environ.get("LUNEX_SMTP_PASS", "")
    ctx = ssl.create_default_context()
    if port == 465:
        with smtplib.SMTP_SSL(host, port, context=ctx, timeout=20) as s:
            if user:
                s.login(user, pw)
            s.send_message(msg)
    else:
        with smtplib.SMTP(host, port, timeout=20) as s:
            s.starttls(context=ctx)
            if user:
                s.login(user, pw)
            s.send_message(msg)


def send_to(con, user):
    subject, body_html, body_text = build(con, user)
    send(user["email"], subject, body_html, body_text, unsub_url(user["id"]))


# ---------------------------------------------------------------- weekly schedule
def _week_start(now=None):
    d = datetime.datetime.fromtimestamp(now or time.time(), datetime.timezone.utc)
    monday = (d - datetime.timedelta(days=d.weekday())).replace(hour=15, minute=0, second=0, microsecond=0)
    return monday.timestamp()


def _run():
    while True:
        time.sleep(30 * 60)
        if not configured():
            continue
        ws = _week_start()
        if time.time() < ws:
            continue
        try:
            with _db() as con:
                users = con.execute("SELECT * FROM users WHERE recap_opt=1 AND COALESCE(last_recap,0) < ? LIMIT 200", (ws,)).fetchall()
            for u in users:
                try:
                    with _db() as con:
                        send_to(con, u)
                        con.execute("UPDATE users SET last_recap=? WHERE id=?", (time.time(), u["id"]))
                except Exception:
                    with _db() as con:       # don't retry a broken address every half hour this week
                        con.execute("UPDATE users SET last_recap=? WHERE id=?", (time.time(), u["id"]))
                time.sleep(1)
        except Exception:
            pass


def migrate(con):
    cols = {r[1] for r in con.execute("PRAGMA table_info(users)")}
    if "recap_opt" not in cols:
        con.execute("ALTER TABLE users ADD COLUMN recap_opt INTEGER DEFAULT 1")
    if "last_recap" not in cols:
        con.execute("ALTER TABLE users ADD COLUMN last_recap REAL DEFAULT 0")
    con.execute("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)")


def start(db_factory, legal_fn):
    global _db, _legal
    _db, _legal = db_factory, legal_fn
    threading.Thread(target=_run, daemon=True, name="weekly-recap").start()
