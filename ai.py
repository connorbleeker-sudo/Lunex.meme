"""Luna's cloud brain: Claude Haiku 5.5, called only from this server, behind hard spending limits.

How it works: the browser sends the conversation to /api/luna/chat. This server checks the account is Pro, checks
every limit, adds Luna's instructions and tool list (which the browser can't change) and asks Claude. When Claude
wants data (the wallet, trade history, a coin, the market, a sum), the browser runs that tool, because it already
holds that data, and sends the result back in the next request. Every request counts against the limits.

Limits (all checked here, stored in the database so restarts don't reset them):
  - Pro accounts only
  - LUNEX_AI_USER_DAILY      questions per account per UTC day (default 150)
  - LUNEX_AI_USER_DAILY_USD  dollars of AI per account per UTC day (default 0.25), however the questions are sent
  - 8 questions per minute per account, and at most 6 lookups per question
  - LUNEX_AI_DAILY_USD       dollars of AI for the whole site per UTC day (default 10). When it's reached, Luna
                             answers with her free on-device brain until midnight UTC.
  - requests are capped in size (60 KB, 1,500-character questions, short replies)

Setting: ANTHROPIC_API_KEY turns this on. Without it (or without the `anthropic` package) Luna uses her free
on-device brain exactly as before.
"""
import collections
import json
import os
import re
import sys
import threading
import time

MODEL = "claude-haiku-5-5"
PRICE_IN, PRICE_OUT = 0.10 / 1e6, 0.50 / 1e6     # dollars per token for Claude Haiku 5.5 (prompts up to 100K tokens)
MAX_TOKENS = 1200                                  # longest reply, in tokens
PER_MINUTE = 8
ROUNDS_PER_QUESTION = 6
MAX_MESSAGES = 40
QUESTION_MAX = 1500
ASSISTANT_TEXT_MAX = 4000
TOOL_RESULT_MAX = 12000
TOOL_ID = re.compile(r"^[A-Za-z0-9_-]{1,100}$")


def _num_env(name, default, cast=float):
    try:
        return max(0, cast(os.environ.get(name, "").strip() or default))
    except ValueError:
        return default


def limits():
    return {"user_daily": _num_env("LUNEX_AI_USER_DAILY", 150, int),
            "user_daily_usd": _num_env("LUNEX_AI_USER_DAILY_USD", 0.25),
            "site_daily_usd": _num_env("LUNEX_AI_DAILY_USD", 10.0)}


# ---------------------------------------------------------------- what Luna is told (server-side only)
SYSTEM = """You are Luna, the AI copilot inside Lunex, a live dashboard for Solana memecoins and pump.fun launches. The person you're talking to pays for Lunex Pro.

How to get facts:
- Use your tools for anything about this person's wallet, their past trades, a specific coin, or what's happening in the market right now. Call them before answering; never guess.
- get_wallet: what they hold right now. get_trade_history: coins they bought and sold before, with what they put in, got back, and how the price moved since. lookup_coin: live numbers and Lunex's six checks for any coin (ticker, name or contract address). market_overview: SOL price, the hottest coins, the freshest launches and Lunex's shortlist. calculate: any arithmetic.
- Use calculate for every sum, percentage, multiple or compounding question, however simple. Don't do maths in your head.
- Only state numbers that came from a tool in this conversation. If a tool can't find something, say exactly what you couldn't see.
- If they mention a coin they used to own or say "it"/"that coin", check get_trade_history (it accepts a coin name) before answering.
- When they ask about "the 2x rule" or "-40%": those are risk habits (sell half at 2x, cut losers at -40%), not limits on how much can be made.
- Dust tokens are worthless leftovers of dead coins. Never tell anyone to sell them.

How to answer:
- Answer the actual question in your first sentence, then give the reason. Usually 2 to 6 sentences. Use a short "- " list only when listing several things. You may bold a key name or number with **double asterisks**. No headings.
- Be direct and decisive, like a sharp friend who trades. For should-I questions, lead with a clear call (buy small / wait / skip / sell half / hold) and the concrete plan: size, take-profit, stop.
- Be honest: most new memecoins go to zero and nobody can predict a single coin's price. Don't promise profits or make up odds. Say this plainly when it matters, without lecturing.
- You can also answer general questions (maths, school, life, other topics) in the same plain style.
- Never ask for, accept or repeat a seed phrase or private key. If someone shares one, tell them to move their funds to a new wallet right away.
- When you use a tool, you may say a brief sentence first. If no tool can express what the user asked for, say so instead of guessing. Do not include internal or system XML tags in your response."""

TOOLS = [
    {"name": "get_wallet",
     "description": "The person's connected Solana wallet right now: total value, cash (SOL and USDC), every coin worth over $0.50 with its value and 24h change, and how many dust tokens they have. Returns connected=false if no wallet is connected.",
     "input_schema": {"type": "object", "properties": {}, "additionalProperties": False}},
    {"name": "get_trade_history",
     "description": "Coins the person bought and sold, read from their wallet's recent on-chain transactions. Per coin: SOL put in and taken out, dates, profit or loss, what they still hold, and how far the price has moved since they sold. Pass a coin ticker, name or contract address to get one coin, \"it\" for the coin being discussed, or an empty string for all of them.",
     "input_schema": {"type": "object", "properties": {"coin": {"type": "string", "description": "Ticker, name or contract address; \"it\"; or \"\" for all coins."}}, "required": ["coin"], "additionalProperties": False}},
    {"name": "lookup_coin",
     "description": "Live data for one coin by ticker (like $BONK or bonk), name or contract address: price, market cap, liquidity, price change, momentum and safety scores (0-100), red flags, Lunex's six checks and Luna's current call on it.",
     "input_schema": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"], "additionalProperties": False}},
    {"name": "market_overview",
     "description": "Right now on Lunex: the SOL price, the hottest Solana coins on the radar, the freshest pump.fun launches, and the coins on Luna's shortlist.",
     "input_schema": {"type": "object", "properties": {}, "additionalProperties": False}},
    {"name": "calculate",
     "description": "Evaluates an arithmetic expression exactly. Supports + - * / ^ (power), parentheses, % (as in 40% = 0.4) and the functions log2, log10, ln, sqrt, ceil, floor, round, min, max, abs. Write numbers without commas. Example: 0.8 * 2^21, or ceil(log2(1000000 / 0.8)).",
     "input_schema": {"type": "object", "properties": {"expression": {"type": "string"}}, "required": ["expression"], "additionalProperties": False}},
]
TOOL_NAMES = {t["name"] for t in TOOLS}


# ---------------------------------------------------------------- the SDK, loaded lazily so a missing package can't crash the server
_client = None
_client_lock = threading.Lock()
_sdk = None


def _anthropic():
    global _sdk
    if _sdk is None:
        try:
            import anthropic
            _sdk = anthropic
        except Exception:
            _sdk = False
    return _sdk or None


def enabled():
    return bool(os.environ.get("ANTHROPIC_API_KEY", "").strip()) and _anthropic() is not None


def _get_client():
    global _client
    with _client_lock:
        if _client is None:
            _client = _anthropic().Anthropic(timeout=60.0, max_retries=2)
        return _client


# ---------------------------------------------------------------- usage records
def migrate(con):
    con.execute("""CREATE TABLE IF NOT EXISTS ai_usage (
        day TEXT NOT NULL, user_id INTEGER NOT NULL, questions INTEGER NOT NULL DEFAULT 0,
        calls INTEGER NOT NULL DEFAULT 0, cost REAL NOT NULL DEFAULT 0, PRIMARY KEY (day, user_id))""")
    con.execute("DELETE FROM ai_usage WHERE day < ?", (time.strftime("%Y-%m-%d", time.gmtime(time.time() - 120 * 86400)),))


_recent = collections.defaultdict(collections.deque)   # user id -> times of their recent questions (per-minute limit)
_rounds = {}                                            # user id -> lookups used on their current question
_mem_lock = threading.Lock()


# ---------------------------------------------------------------- request checking
def _clean(body):
    """Returns (messages, is_new_question) in the exact shape the API accepts, or raises ValueError."""
    msgs = body.get("messages") if isinstance(body, dict) else None
    if not isinstance(msgs, list) or not 1 <= len(msgs) <= MAX_MESSAGES:
        raise ValueError("bad messages")
    out = []
    for m in msgs:
        if not isinstance(m, dict) or m.get("role") not in ("user", "assistant"):
            raise ValueError("bad role")
        role, c = m["role"], m.get("content")
        cap = QUESTION_MAX if role == "user" else ASSISTANT_TEXT_MAX
        if isinstance(c, str):
            if not c.strip():
                raise ValueError("empty message")
            out.append({"role": role, "content": c[:cap]})
            continue
        if not isinstance(c, list) or not 1 <= len(c) <= 12:
            raise ValueError("bad content")
        blocks = []
        for b in c:
            t = b.get("type") if isinstance(b, dict) else None
            if t == "text":
                s = str(b.get("text", ""))[:cap]
                if s.strip():
                    blocks.append({"type": "text", "text": s})
            elif t == "tool_use" and role == "assistant":
                tid, name, inp = b.get("id"), b.get("name"), b.get("input")
                if not (isinstance(tid, str) and TOOL_ID.match(tid) and name in TOOL_NAMES and isinstance(inp, dict) and len(json.dumps(inp)) <= 2000):
                    raise ValueError("bad tool_use")
                blocks.append({"type": "tool_use", "id": tid, "name": name, "input": inp})
            elif t == "tool_result" and role == "user":
                tid = b.get("tool_use_id")
                if not (isinstance(tid, str) and TOOL_ID.match(tid)):
                    raise ValueError("bad tool_result")
                blocks.append({"type": "tool_result", "tool_use_id": tid, "content": str(b.get("content", ""))[:TOOL_RESULT_MAX] or "(empty)"})
            else:
                raise ValueError("block type not allowed")
        if not blocks:
            raise ValueError("empty message")
        out.append({"role": role, "content": blocks})
    if out[0]["role"] != "user" or out[-1]["role"] != "user":
        raise ValueError("must start and end with the user")
    last = out[-1]["content"]
    is_new = isinstance(last, str) or not any(b["type"] == "tool_result" for b in last)
    if is_new:   # tell Claude the person's local time, on the new question only
        now = str(body.get("now", ""))[:60].strip()
        if now:
            stamp = f"\n\n(My local time: {now})"
            out[-1] = {"role": "user", "content": (last + stamp) if isinstance(last, str) else last + [{"type": "text", "text": stamp.strip()}]}
    return out, is_new


# ---------------------------------------------------------------- the endpoint
def handle(user, body, db, lock):
    """Returns (http_status, json_payload). fallback=True tells the browser to use the on-device brain instead."""
    if not enabled():
        return 503, {"fallback": True, "reason": "off"}
    try:
        messages, is_new = _clean(body)
    except ValueError:
        return 400, {"error": "Luna couldn't read that message. Refresh the page and try again."}
    lim, uid, day = limits(), user["id"], time.strftime("%Y-%m-%d", time.gmtime())

    with lock, db() as con:                      # check and reserve, all at once, so parallel requests can't slip past
        row = con.execute("SELECT questions, calls, cost FROM ai_usage WHERE day=? AND user_id=?", (day, uid)).fetchone()
        q, cost = (row["questions"], row["cost"]) if row else (0, 0.0)
        site = con.execute("SELECT COALESCE(SUM(cost), 0) FROM ai_usage WHERE day=?", (day,)).fetchone()[0]
        if site >= lim["site_daily_usd"]:
            return 503, {"fallback": True, "reason": "budget"}
        if is_new and q >= lim["user_daily"]:
            return 429, {"error": f"You've reached today's limit for Luna ({lim['user_daily']} questions). It resets at midnight UTC."}
        if cost >= lim["user_daily_usd"]:
            return 429, {"error": "You've reached today's limit for Luna. It resets at midnight UTC."}
        with _mem_lock:
            if is_new:
                now, rec = time.time(), _recent[uid]
                while rec and now - rec[0] > 60:
                    rec.popleft()
                if len(rec) >= PER_MINUTE:
                    return 429, {"error": "That's a lot of questions in one minute. Give it a few seconds."}
                rec.append(now)
                _rounds[uid] = 0
            else:
                _rounds[uid] = _rounds.get(uid, 0) + 1
                if _rounds[uid] > ROUNDS_PER_QUESTION:
                    return 429, {"error": "That question needed too many lookups. Try asking it a simpler way."}
        con.execute("""INSERT INTO ai_usage (day, user_id, questions, calls, cost) VALUES (?, ?, ?, 1, 0)
                       ON CONFLICT(day, user_id) DO UPDATE SET questions = questions + excluded.questions, calls = calls + 1""",
                    (day, uid, 1 if is_new else 0))

    sdk = _anthropic()
    try:
        resp = _get_client().messages.create(
            model=MODEL, max_tokens=MAX_TOKENS, system=SYSTEM, tools=TOOLS, messages=messages,
            thinking={"type": "disabled"}, output_config={"effort": "low"})
    except sdk.RateLimitError:
        print("[luna ai] rate limited by the API", file=sys.stderr)
        return 503, {"fallback": True, "reason": "busy"}
    except sdk.AuthenticationError:
        print("[luna ai] ANTHROPIC_API_KEY was rejected. Check it in Railway Variables.", file=sys.stderr)
        return 503, {"fallback": True, "reason": "key"}
    except sdk.APIStatusError as e:
        print(f"[luna ai] API error {e.status_code}: {getattr(e, 'message', '')}"[:400], file=sys.stderr)
        return 503, {"fallback": True, "reason": "error"}
    except sdk.APIConnectionError:
        print("[luna ai] couldn't reach the API", file=sys.stderr)
        return 503, {"fallback": True, "reason": "network"}
    except Exception as e:
        print(f"[luna ai] unexpected error: {type(e).__name__}: {e}"[:400], file=sys.stderr)
        return 503, {"fallback": True, "reason": "error"}

    u = resp.usage
    spent = (u.input_tokens or 0) * PRICE_IN + (u.output_tokens or 0) * PRICE_OUT \
        + (getattr(u, "cache_creation_input_tokens", 0) or 0) * PRICE_IN * 1.25 + (getattr(u, "cache_read_input_tokens", 0) or 0) * PRICE_IN * 0.1
    with lock, db() as con:
        con.execute("UPDATE ai_usage SET cost = cost + ? WHERE day=? AND user_id=?", (spent, day, uid))

    if resp.stop_reason == "refusal":
        return 200, {"content": [{"type": "text", "text": "I can't help with that one. Ask me something else about your coins or the market."}], "stop_reason": "end_turn"}
    blocks = []
    for b in resp.content:
        if b.type == "text" and b.text:
            blocks.append({"type": "text", "text": b.text})
        elif b.type == "tool_use":
            blocks.append({"type": "tool_use", "id": b.id, "name": b.name, "input": b.input})
    if not blocks:
        blocks = [{"type": "text", "text": "I didn't get an answer together for that one. Try asking again."}]
    stop = "tool_use" if resp.stop_reason == "tool_use" and any(b["type"] == "tool_use" for b in blocks) else "end_turn"
    if resp.stop_reason == "max_tokens" and stop == "end_turn":
        blocks.append({"type": "text", "text": "(That answer got cut off. Ask me to keep going.)"})
    return 200, {"content": blocks, "stop_reason": stop}
