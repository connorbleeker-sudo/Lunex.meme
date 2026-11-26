"""Lunex live layer (standard library only).

- A background listener on PumpPortal's public websocket that sees every new pump.fun launch, 24/7,
  so the site can show real all-time and last-24h totals the moment a page opens, plus a live feed.
- Persistent counters (launches, rug checks, community calls, practice trades) in the `stats` tables.
- The free rug check: DexScreener lookup + the same momentum/safety scoring the dashboard uses.

Settings: LUNEX_LIVE=off turns the listener off (e.g. for tests).
          LUNEX_CA_FILE=path/to/roots.pem  trusted roots for the listener, if the system store is out of date.
"""
import base64
import collections
import json
import math
import os
import socket
import ssl
import threading
import time
import urllib.parse
import urllib.request

PUMP_WS = "wss://pumpportal.fun/api/data"
DEX = "https://api.dexscreener.com"
_lock = threading.Lock()
_pending = collections.Counter()          # counters not yet written to the database
_pending_hours = collections.Counter()    # hour -> launches not yet written
_feed = collections.deque(maxlen=40)      # newest launches, newest last
_state = {"connected": False, "last": 0.0}
_db = None                                # set by start(): a function returning a sqlite connection


# ---------------------------------------------------------------- database
def migrate(con):
    con.executescript("""
    CREATE TABLE IF NOT EXISTS stats (k TEXT PRIMARY KEY, v REAL NOT NULL);
    CREATE TABLE IF NOT EXISTS stats_hourly (hour INTEGER PRIMARY KEY, launches INTEGER NOT NULL DEFAULT 0);""")
    con.execute("INSERT OR IGNORE INTO stats VALUES ('since', ?)", (time.time(),))


def bump(key, n=1):
    """Count something (e.g. 'checks_all'). Written to the database by the flusher every few seconds."""
    with _lock:
        _pending[key] += n


def flush():
    if not _db:
        return
    with _lock:
        pend, hours = dict(_pending), dict(_pending_hours)
        _pending.clear(), _pending_hours.clear()
    if not pend and not hours:
        return
    try:
        with _db() as con:
            for k, n in pend.items():
                con.execute("INSERT INTO stats VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = v + excluded.v", (k, n))
            for h, n in hours.items():
                con.execute("INSERT INTO stats_hourly VALUES (?, ?) ON CONFLICT(hour) DO UPDATE SET launches = launches + excluded.launches", (h, n))
            con.execute("DELETE FROM stats_hourly WHERE hour < ?", (int(time.time() // 3600) - 24 * 40,))   # keep ~40 days
    except Exception:
        with _lock:                       # try again next time
            _pending.update(pend), _pending_hours.update(hours)


def public_stats():
    now_h = int(time.time() // 3600)
    with _lock:
        pend, ph = dict(_pending), dict(_pending_hours)
    out = {"launchesAll": 0, "checksAll": 0, "callsAll": 0, "practiceAll": 0, "since": time.time(),
           "launches24h": 0, "launches7d": 0}
    if _db:
        with _db() as con:
            kv = {k: v for k, v in con.execute("SELECT k, v FROM stats")}
            hours = {h: n for h, n in con.execute("SELECT hour, launches FROM stats_hourly WHERE hour > ?", (now_h - 24 * 7,))}
        out.update(launchesAll=int(kv.get("launches_all", 0)), checksAll=int(kv.get("checks_all", 0)),
                   callsAll=int(kv.get("calls_all", 0)), practiceAll=int(kv.get("practice_all", 0)), since=kv.get("since", time.time()))
        for h, n in ph.items():
            hours[h] = hours.get(h, 0) + n
        out["launches24h"] = sum(n for h, n in hours.items() if h > now_h - 24)
        out["launches7d"] = sum(hours.values())
    out["launchesAll"] += pend.get("launches_all", 0)
    out["checksAll"] += pend.get("checks_all", 0)
    out["callsAll"] += pend.get("calls_all", 0)
    out["practiceAll"] += pend.get("practice_all", 0)
    out["live"] = _state["connected"] and time.time() - _state["last"] < 120
    out["lastLaunch"] = _state["last"]
    return out


def feed(after=0.0):
    with _lock:
        return [x for x in _feed if x["t"] > after]


def recent_launch(mint):
    with _lock:
        return next((x for x in _feed if x["mint"] == mint), None)


# ---------------------------------------------------------------- minimal websocket client
def _tls():
    """Certificates are always verified. LUNEX_CA_FILE swaps in a different trusted-roots bundle, for machines
    whose system store has an out-of-date root (some Windows installs reject Let's Encrypt's newer chains)."""
    ca = os.environ.get("LUNEX_CA_FILE", "").strip()
    if ca:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        ctx.load_verify_locations(ca)
        return ctx
    return ssl.create_default_context()


class _WS:
    def __init__(self, url):
        u = urllib.parse.urlparse(url)
        host, port = u.hostname, u.port or 443
        raw = socket.create_connection((host, port), timeout=20)
        self.s = _tls().wrap_socket(raw, server_hostname=host)
        key = base64.b64encode(os.urandom(16)).decode()
        self.s.sendall((f"GET {u.path or '/'} HTTP/1.1\r\nHost: {host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                        f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\nUser-Agent: Lunex\r\n\r\n").encode())
        buf = b""
        while b"\r\n\r\n" not in buf:
            chunk = self.s.recv(4096)
            if not chunk:
                raise ConnectionError("closed during handshake")
            buf += chunk
        head, self.buf = buf.split(b"\r\n\r\n", 1)
        if b" 101" not in head.split(b"\r\n", 1)[0]:
            raise ConnectionError("handshake refused")
        self.s.settimeout(90)             # no data for 90s -> reconnect

    def _exact(self, n):
        while len(self.buf) < n:
            chunk = self.s.recv(65536)
            if not chunk:
                raise ConnectionError("closed")
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def send(self, data, opcode=1):
        data = data.encode() if isinstance(data, str) else data
        n, mask = len(data), os.urandom(4)
        hdr = bytearray([0x80 | opcode])
        if n < 126:
            hdr.append(0x80 | n)
        elif n < 65536:
            hdr.append(0x80 | 126); hdr += n.to_bytes(2, "big")
        else:
            hdr.append(0x80 | 127); hdr += n.to_bytes(8, "big")
        self.s.sendall(bytes(hdr) + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    def recv(self):
        msg = b""
        while True:
            b1, b2 = self._exact(2)
            fin, op, n = b1 & 0x80, b1 & 0x0F, b2 & 0x7F
            if n == 126:
                n = int.from_bytes(self._exact(2), "big")
            elif n == 127:
                n = int.from_bytes(self._exact(8), "big")
            mask = self._exact(4) if b2 & 0x80 else None
            data = self._exact(n)
            if mask:
                data = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
            if op == 9:
                self.send(data, 10)       # ping -> pong
                continue
            if op == 8:
                raise ConnectionError("server closed")
            if op in (0, 1, 2):
                msg += data
                if fin:
                    return msg.decode("utf-8", "replace")

    def close(self):
        try:
            self.s.close()
        except Exception:
            pass


def _on_launch(m):
    mint = str(m.get("mint", ""))
    if not (32 <= len(mint) <= 44):
        return
    t = time.time()
    item = {"mint": mint, "symbol": str(m.get("symbol", ""))[:16], "name": str(m.get("name", ""))[:40],
            "mcapSol": round(float(m.get("marketCapSol") or 0), 2), "devBuySol": round(float(m.get("solAmount") or 0), 3), "t": t}
    with _lock:
        _feed.append(item)
        _pending["launches_all"] += 1
        _pending_hours[int(t // 3600)] += 1
    _state["last"] = t


def _listen():
    backoff = 2
    while True:
        ws = None
        try:
            ws = _WS(PUMP_WS)
            ws.send(json.dumps({"method": "subscribeNewToken"}))
            _state["connected"], backoff = True, 2
            while True:
                try:
                    m = json.loads(ws.recv())
                except ValueError:
                    continue
                if isinstance(m, dict) and m.get("txType") == "create":
                    _on_launch(m)
        except Exception:
            _state["connected"] = False
        finally:
            if ws:
                ws.close()
        time.sleep(backoff)
        backoff = min(backoff * 2, 60)


def _flusher():
    while True:
        time.sleep(5)
        flush()


def start(db_factory):
    global _db
    _db = db_factory
    threading.Thread(target=_flusher, daemon=True, name="stats-flush").start()
    if os.environ.get("LUNEX_LIVE", "").lower() != "off":
        threading.Thread(target=_listen, daemon=True, name="pump-listener").start()


# ---------------------------------------------------------------- free rug check
def _get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Lunex", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())


def _clamp(v, lo=0, hi=100):
    return max(lo, min(hi, v))


def analyze(p):
    """Same scoring as the dashboard's analyze() in index.html: momentum and safety, 0-100, plus red flags."""
    liq = (p.get("liquidity") or {}).get("usd") or 0
    fdv = p.get("fdv") or p.get("marketCap") or 0
    tx = p.get("txns") or {}
    t1, t24 = tx.get("h1") or {"buys": 0, "sells": 0}, tx.get("h24") or {"buys": 0, "sells": 0}
    vol, ch = p.get("volume") or {}, p.get("priceChange") or {}
    v1, v24 = vol.get("h1") or 0, vol.get("h24") or 0
    c1, c6, c24 = ch.get("h1") or 0, ch.get("h6") or 0, ch.get("h24") or 0
    age = (time.time() * 1000 - p["pairCreatedAt"]) if p.get("pairCreatedAt") else None
    trades1 = (t1.get("buys") or 0) + (t1.get("sells") or 0)
    buy_ratio = (t1.get("buys") or 0) / trades1 if trades1 else 0.5
    m =_clamp((buy_ratio - .4) / .3 * 30, 0, 30) + _clamp((v1 / liq) * 40 if liq else 0, 0, 25) + _clamp(c1 / 2, -10, 20) \
        + _clamp(c6 / 5, -5, 10) + _clamp(math.log10(trades1 + 1) * 6, 0, 15)
    momentum = round(_clamp(m))
    flags, s = [], 100
    on_curve = p.get("dexId") == "pumpfun"
    if on_curve:
        flags.append("Still on pump.fun curve")
    if not on_curve and liq < 10000:
        s -= 30; flags.append("Liquidity under $10K")
    elif not on_curve and liq < 50000:
        s -= 20; flags.append("Thin liquidity (<$50K)")
    if age is not None and age < 36e5:
        s -= 20; flags.append("Under 1h old")
    elif age is not None and age < 6 * 36e5:
        s -= 12; flags.append("Under 6h old")
    if not on_curve and liq and fdv / liq > 30:
        s -= 15; flags.append("MC far above liquidity")
    b24, s24 = t24.get("buys") or 0, t24.get("sells") or 0
    if b24 > 20 and s24 == 0:
        s -= 35; flags.append("No sells (honeypot?)")
    elif s24 and b24 / s24 > 6:
        s -= 10; flags.append("Hardly anyone selling")
    info = p.get("info") or {}
    if not (len(info.get("socials") or []) + len(info.get("websites") or [])):
        s -= 12; flags.append("No socials/site")
    if c24 > 1000:
        s -= 30; flags.append("Up over 1000% in 24h (late entry risk)")
    elif c24 > 300:
        s -= 12; flags.append("Up over 300% in 24h")
    if c1 < -30:
        s -= 15; flags.append(f"Dumping: {c1:.1f}% in 1h")
    if v24 < 1000 and age and age > 864e5:
        s -= 25; flags.append("Basically dead (no volume)")
    safety = round(_clamp(s))
    if momentum >= 60 and safety >= 70 and c24 < 1000:
        label, tone = "Hot + solid", "good"
    elif momentum >= 60:
        label, tone = "Hot but risky", "warn"
    elif momentum >= 35:
        label, tone = "Warming up", "neutral"
    else:
        label, tone = "Cold", "dim"
    verdict = "high" if safety < 45 else "medium" if safety < 70 else "low"
    return {"momentum": momentum, "safety": safety, "flags": flags, "label": label, "tone": tone, "risk": verdict,
            "liq": liq, "fdv": fdv, "v1": v1, "v24": v24, "c1": c1, "c6": c6, "c24": c24, "age": age,
            "buyRatio": round(buy_ratio, 3), "onCurve": on_curve}


def rug_check(q):
    q = q.strip()
    if not q or len(q) > 60:
        raise ValueError("Paste a Solana contract address or a $ticker.")
    is_addr = 32 <= len(q) <= 44 and q.isalnum()
    if is_addr:
        pairs = _get(f"{DEX}/tokens/v1/solana/{urllib.parse.quote(q)}")
    else:   # some big coins list their symbol with a "$" (e.g. "$WIF"), and search treats the two differently: ask both ways
        pairs = []
        for term in (q.lstrip("$"), "$" + q.lstrip("$")):
            try:
                pairs += (_get(f"{DEX}/latest/dex/search?q={urllib.parse.quote(term)}") or {}).get("pairs") or []
            except Exception:
                pass
        pairs = list({p.get("pairAddress") or id(p): p for p in pairs}.values())   # the two searches overlap
    pairs = [p for p in pairs if p.get("chainId") == "solana"]
    if not pairs:
        fresh = recent_launch(q) if is_addr else None
        if fresh:
            return {"fresh": True, "symbol": fresh["symbol"], "name": fresh["name"], "mint": q,
                    "ageSec": round(time.time() - fresh["t"]), "mcapSol": fresh["mcapSol"]}
        raise ValueError("No Solana market found for that. Check the address, or try the $ticker.")
    if not is_addr:   # ticker search: prefer an exact symbol match, then the deepest market
        sym = q.lstrip("$").lower()
        exact = [p for p in pairs if (p.get("baseToken") or {}).get("symbol", "").lstrip("$").lower() == sym]
        pairs = exact or pairs
        # copycats share the ticker: pick the token with the most trading across all its markets
        vol = collections.Counter()
        for x in pairs:
            vol[(x.get("baseToken") or {}).get("address", "")] += (x.get("volume") or {}).get("h24") or 0
        top = vol.most_common(1)[0][0]
        pairs = [x for x in pairs if (x.get("baseToken") or {}).get("address") == top]
    p = max(pairs, key=_activity)
    bt, info = p.get("baseToken") or {}, p.get("info") or {}
    return {"symbol": bt.get("symbol", ""), "name": bt.get("name", ""), "mint": bt.get("address", ""), "dex": p.get("dexId", ""),
            "priceUsd": float(p.get("priceUsd") or 0), "image": info.get("imageUrl", ""), "url": p.get("url", ""),
            "analysis": analyze(p)}


def _activity(p):
    """Rank a coin's pools by how much it's actually trading there now. Dead or migrated pools can keep
    reporting liquidity with a frozen price, so liquidity alone picks the wrong (stale) market."""
    vol, tx = p.get("volume") or {}, (p.get("txns") or {}).get("h24") or {}
    return ((vol.get("h1") or 0) * 24 + (vol.get("h24") or 0) + ((tx.get("buys") or 0) + (tx.get("sells") or 0)) * 5,
            (p.get("liquidity") or {}).get("usd") or 0)


def price_of(mint):
    """Best Solana market for a mint: (symbol, priceUsd, fdv) or None. Used to stamp community calls."""
    try:
        pairs = [p for p in _get(f"{DEX}/tokens/v1/solana/{urllib.parse.quote(mint)}") if p.get("chainId") == "solana"]
    except Exception:
        return None
    if not pairs:
        return None
    p = max(pairs, key=_activity)
    return (p.get("baseToken") or {}).get("symbol", ""), float(p.get("priceUsd") or 0), float(p.get("fdv") or p.get("marketCap") or 0)
