// Practice mode: trade any Solana coin with pretend SOL at live DexScreener prices.
// State lives in localStorage 'lx-practice' (synced to the account by account.js), so it follows you across devices.
(() => {
const UI = window.LunexUI, root = document.querySelector('#practiceApp');
if (!UI || !root) return;
const q = s => root.querySelector(s), esc = UI.esc, KEY = 'lx-practice', START = 10;
const DEX = 'https://api.dexscreener.com';
const livelier = window.livelier || ((a, b) => { const act = p => (p.volume?.h1 || 0) * 24 + (p.volume?.h24 || 0) + ((p.txns?.h24?.buys || 0) + (p.txns?.h24?.sells || 0)) * 5; const x = act(a), y = act(b); return x !== y ? x > y : (a.liquidity?.usd || 0) > (b.liquidity?.usd || 0); });   // pick the pool the coin is actually trading in
const getJ = async u => { const r = await fetch(u); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Something went wrong.'); return j; };

const fresh = () => ({ start: START, cash: START, positions: {}, history: [], equityLog: [], lastEquity: START, created: Date.now() });
let S = load();
function load() { try { const s = JSON.parse(localStorage.getItem(KEY)); return s && typeof s.cash === 'number' ? s : fresh(); } catch { return fresh(); } }
function save() { localStorage.setItem(KEY, JSON.stringify(S)); }
const prices = {};            // mint -> { usd, t }
let solPx = 0;

async function getSolPx() {
  let v = 0; try { v = eval('solUsd'); } catch { }          // the dashboard's live SOL price (a global in index.html), if it has one
  if (typeof v === 'number' && v > 0) return (solPx = v);
  if (solPx) return solPx;
  try {
    const pairs = await getJ(`${DEX}/tokens/v1/solana/So11111111111111111111111111111111111111112`);
    const best = pairs.filter(p => /USD/.test(p.quoteToken.symbol)).sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
    if (best) solPx = +best.priceUsd;
  } catch { }
  return solPx;
}
async function refreshPrices() {
  const mints = Object.keys(S.positions); if (!mints.length) return;
  for (let i = 0; i < mints.length; i += 30) {
    try {
      const pairs = await getJ(`${DEX}/tokens/v1/solana/${mints.slice(i, i + 30).join(',')}`);
      const best = {};
      pairs.forEach(p => { const k = p.baseToken.address; if (!best[k] || livelier(p, best[k])) best[k] = p; });
      Object.entries(best).forEach(([k, p]) => prices[k] = { usd: +p.priceUsd, t: Date.now() });
    } catch { }
  }
}
const valueSol = (pos) => { const p = prices[pos.mint]; return p && solPx ? pos.tokens * p.usd / solPx : pos.costSol; };
function equity() { return S.cash + Object.values(S.positions).reduce((s, p) => s + valueSol(p), 0); }
function summary() {
  const eq = equity(), sells = S.history.filter(h => h.side === 'sell');
  const pcts = Object.values(S.positions).map(p => ({ sym: p.sym, pct: (valueSol(p) / p.costSol - 1) * 100 })).concat(sells.map(h => ({ sym: h.sym, pct: h.pnlPct })));
  const best = pcts.sort((a, b) => b.pct - a.pct)[0];
  return { equity: eq, start: S.start, cash: S.cash, open: Object.keys(S.positions).length, trades: S.history.length,
    wins: sells.filter(h => h.pnlPct > 0).length, closed: sells.length, best };
}
window.LunexPractice = { summary };
const logTrade = () => fetch('/api/practice/log', { method: 'POST' }).catch(() => { });

// ---------------------------------------------------------------- trading
async function buy(coin, sol) {
  sol = Math.round(sol * 1000) / 1000;
  if (!(sol > 0)) throw new Error('Pick an amount.');
  if (sol > S.cash + 1e-9) throw new Error(`You only have ${S.cash.toFixed(3)} pretend SOL left.`);
  const px = await getSolPx(); if (!px || !coin.priceUsd) throw new Error("Couldn't get a live price for that coin.");
  const tokens = sol * px / coin.priceUsd, pos = S.positions[coin.mint];
  if (pos) { pos.tokens += tokens; pos.costSol += sol; pos.entryUsd = (pos.costSol * px) / pos.tokens; }
  else S.positions[coin.mint] = { mint: coin.mint, sym: coin.symbol, name: coin.name, img: coin.image || '', tokens, costSol: sol, entryUsd: coin.priceUsd, t: Date.now() };
  prices[coin.mint] = { usd: coin.priceUsd, t: Date.now() };
  S.cash = Math.round((S.cash - sol) * 1e6) / 1e6;
  S.history.unshift({ side: 'buy', mint: coin.mint, sym: coin.symbol, sol, priceUsd: coin.priceUsd, t: Date.now() });
  S.history = S.history.slice(0, 200); snapshot(); save(); logTrade();
}
async function sell(mint, frac) {
  const pos = S.positions[mint]; if (!pos) return;
  await refreshPrices(); await getSolPx();
  const p = prices[mint]; if (!p || !solPx) throw new Error("Couldn't get a live price to sell at. Try again.");
  const tokens = pos.tokens * frac, got = tokens * p.usd / solPx, cost = pos.costSol * frac;
  S.cash = Math.round((S.cash + got) * 1e6) / 1e6;
  S.history.unshift({ side: 'sell', mint, sym: pos.sym, sol: got, priceUsd: p.usd, t: Date.now(), pnlPct: (got / cost - 1) * 100, pnlSol: got - cost });
  if (frac >= .999) delete S.positions[mint]; else { pos.tokens -= tokens; pos.costSol -= cost; }
  S.history = S.history.slice(0, 200); snapshot(); save(); logTrade();
}
function snapshot() {
  const eq = equity(); S.lastEquity = Math.round(eq * 1e4) / 1e4;
  const last = S.equityLog[S.equityLog.length - 1];
  if (!last || Date.now() - last.t > 5 * 60000 || Math.abs(last.v - eq) / (last.v || 1) > .02) S.equityLog.push({ t: Date.now(), v: S.lastEquity });
  S.equityLog = S.equityLog.slice(-240);
}

// ---------------------------------------------------------------- UI
root.innerHTML = `
  <div class="pr-top">
    <div class="pr-eq"><small>PRACTICE PORTFOLIO</small><b id="prEq">10.00 SOL</b><span id="prEqSub"></span><svg id="prSpark" viewBox="0 0 300 60" preserveAspectRatio="none" aria-hidden="true"></svg></div>
    <div class="pr-kpis" id="prKpis"></div>
  </div>
  <div class="pr-grid">
    <section class="pr-card pr-buy" aria-labelledby="pr-buy-h">
      <h3 id="pr-buy-h">Buy a coin</h3>
      <form id="prFind" autocomplete="off"><input name="q" spellcheck="false" placeholder="Contract address or $TICKER" aria-label="Contract address or ticker" maxlength="60"><button type="submit">Find</button></form>
      <div id="prCoin" aria-live="polite"><p class="pr-muted">Find a coin, or pick one that's hot on the radar:</p><div class="pr-hot" id="prHot"></div></div>
    </section>
    <section class="pr-card pr-pos" aria-labelledby="pr-pos-h">
      <div class="pr-head"><h3 id="pr-pos-h">Open positions</h3><button type="button" class="pr-link" id="prRefresh">Refresh prices</button></div>
      <div id="prPositions"></div>
      <p class="pr-rule">House rules that keep accounts alive: <b>take your initial out at 2x</b>, <b>cut at −40%</b>, and size every buy small.</p>
    </section>
  </div>
  <section class="pr-card pr-hist" aria-labelledby="pr-hist-h">
    <div class="pr-head"><h3 id="pr-hist-h">Trade history</h3><button type="button" class="pr-link pr-reset" id="prReset">Reset to 10 SOL</button></div>
    <div id="prHistory"></div>
  </section>
  <p class="pr-fine">Practice uses pretend SOL and live DexScreener prices. Real trades also pay network and platform fees and can slip on thin markets, so real results are usually worse. Not financial advice.</p>`;

const pct = v => `<b class="${v >= 0 ? 'up' : 'down'}">${v >= 0 ? '+' : ''}${v.toFixed(1)}%</b>`;
function draw() {
  const s = summary(), ch = (s.equity / s.start - 1) * 100;
  q('#prEq').textContent = s.equity.toFixed(3) + ' SOL';
  q('#prEqSub').innerHTML = `${pct(ch)} since you started${solPx ? ` · ≈ ${UI.money(s.equity * solPx)}` : ''}`;
  q('#prKpis').innerHTML = [['Cash', s.cash.toFixed(3) + ' SOL'], ['Open', s.open], ['Closed trades', s.closed], ['Win rate', s.closed ? Math.round(s.wins / s.closed * 100) + '%' : '—']]
    .map(([k, v]) => `<div><small>${k}</small><b>${v}</b></div>`).join('');
  // sparkline
  const pts = S.equityLog.concat([{ t: Date.now(), v: s.equity }]);
  if (pts.length > 1) {
    const vs = pts.map(p => p.v), lo = Math.min(...vs, S.start), hi = Math.max(...vs, S.start), sp = hi - lo || 1;
    const xy = pts.map((p, i) => `${(i / (pts.length - 1) * 300).toFixed(1)},${(56 - (p.v - lo) / sp * 52).toFixed(1)}`).join(' ');
    const base = 56 - (S.start - lo) / sp * 52;
    q('#prSpark').innerHTML = `<line x1="0" x2="300" y1="${base}" y2="${base}" stroke="rgba(255,255,255,.15)" stroke-dasharray="3 4"/><polyline points="${xy}" fill="none" stroke="${ch >= 0 ? '#3dffb0' : '#ff4d6d'}" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
  } else q('#prSpark').innerHTML = '';
  // positions
  const P = Object.values(S.positions);
  q('#prPositions').innerHTML = P.length ? `<table class="pr-table"><thead><tr><th>Coin</th><th>In</th><th>Now</th><th>P&amp;L</th><th></th></tr></thead><tbody>${P.map(p => {
    const v = valueSol(p), c = (v / p.costSol - 1) * 100, hint = c >= 100 ? '<small class="pr-hint up">2x: take your initial out</small>' : c <= -40 ? '<small class="pr-hint down">−40%: your stop says cut</small>' : '';
    return `<tr><td><b>$${esc(p.sym)}</b>${hint}</td><td>${p.costSol.toFixed(3)}</td><td>${v.toFixed(3)}</td><td>${pct(c)}</td>
      <td class="pr-acts"><button type="button" data-sell="${esc(p.mint)}" data-f=".5">Sell half</button><button type="button" data-sell="${esc(p.mint)}" data-f="1">Sell all</button></td></tr>`; }).join('')}</tbody></table>`
    : '<p class="pr-muted">No open positions. Buy something on the left.</p>';
  // history
  q('#prHistory').innerHTML = S.history.length ? `<ul class="pr-hlist">${S.history.slice(0, 30).map(h => `<li><span class="pr-side ${h.side}">${h.side.toUpperCase()}</span>
    <b>$${esc(h.sym)}</b><span>${h.sol.toFixed(3)} SOL</span>${h.side === 'sell' ? pct(h.pnlPct) : '<span></span>'}<time>${UI.ago(h.t / 1000)} ago</time></li>`).join('')}</ul>`
    : '<p class="pr-muted">Your trades will show up here.</p>';
}
function drawHot() {
  let toks = []; try { toks = eval('tokens') || []; } catch { }
  const hot = toks.filter(t => t.pair.chainId === 'solana').sort((a, b) => (b.a.momentum + b.a.safety * .5) - (a.a.momentum + a.a.safety * .5)).slice(0, 6);
  const box = q('#prHot'); if (!box) return;
  box.innerHTML = hot.length ? hot.map(t => `<button type="button" data-mint="${esc(t.pair.baseToken.address)}">
    <b>$${esc(t.pair.baseToken.symbol)}</b><small>M${t.a.momentum} · S${t.a.safety}</small></button>`).join('') : '<span class="pr-muted">Radar is loading…</span>';
}

let coin = null;
async function find(v) {
  const box = q('#prCoin'); coin = null;
  const work = getJ('/api/public/check?q=' + encodeURIComponent(v)).then(r => ({ r }), e => ({ e }));
  await UI.scan(box, ['Finding the market', 'Getting the live price', 'Scoring momentum and safety'], 200);
  const { r, e } = await work;
  if (e) { box.innerHTML = `<p class="pr-err">${esc(e.message)}</p>`; return; }
  if (r.fresh) { box.innerHTML = `<p class="pr-muted">$${esc(r.symbol)} launched ${r.ageSec}s ago and has no market price yet. Try again in a minute.</p>`; return; }
  coin = r; const a = r.analysis, max = Math.max(0, S.cash);
  box.innerHTML = `<div class="pr-coin"><div class="pr-coin-top">${r.image ? `<img src="${esc(r.image)}" alt="" onerror="this.remove()">` : ''}<div><b>$${esc(r.symbol)}</b><small>${esc(r.name)} · ${UI.money(a.fdv)} mcap</small></div></div>
    <div class="pr-coin-dials">${UI.dial(a.momentum, 'momentum', 'Momentum', 64)}${UI.dial(a.safety, 'safety', 'Safety', 64)}
      <div class="pr-flags">${a.flags.slice(0, 3).map(f => `<span>${esc(f)}</span>`).join('') || '<span class="ok">No major red flags</span>'}</div></div>
    <div class="pr-amts">${[.1, .25, .5, 1].map(x => `<button type="button" data-amt="${x}" ${x > max ? 'disabled' : ''}>${x} SOL</button>`).join('')}
      <label><span class="sr">Custom amount</span><input type="number" id="prAmt" min="0.01" step="0.01" max="${max.toFixed(3)}" placeholder="Custom"></label></div>
    <button type="button" class="pr-go" id="prBuyGo">Buy with pretend SOL</button><p class="pr-err" id="prBuyErr" role="alert"></p></div>`;
}
let amt = .25;
root.addEventListener('click', async e => {
  const t = e.target.closest('button'); if (!t) return;
  if (t.dataset.mint) { q('#prFind').q.value = t.dataset.mint; find(t.dataset.mint); }
  if (t.dataset.amt) { amt = +t.dataset.amt; root.querySelectorAll('[data-amt]').forEach(b => b.classList.toggle('on', b === t)); const i = q('#prAmt'); if (i) i.value = ''; }
  if (t.id === 'prBuyGo' && coin) {
    const custom = +(q('#prAmt')?.value || 0), sol = custom || amt;
    try { t.disabled = true; await buy(coin, sol); window.SFX && SFX.buy && SFX.buy(); q('#prCoin').innerHTML = `<p class="pr-ok">Bought ${sol} SOL of $${esc(coin.symbol)} (pretend). It's in your positions.</p><div class="pr-hot" id="prHot"></div>`; drawHot(); draw(); }
    catch (x) { q('#prBuyErr').textContent = x.message; } finally { t.disabled = false; }
  }
  if (t.dataset.sell) {
    try { t.disabled = true; await sell(t.dataset.sell, +t.dataset.f); window.SFX && SFX.sell && SFX.sell(); draw(); }
    catch (x) { alert(x.message); } finally { t.disabled = false; }
  }
  if (t.id === 'prRefresh') { t.disabled = true; await refreshPrices(); await getSolPx(); snapshot(); save(); draw(); t.disabled = false; }
  if (t.id === 'prReset' && confirm('Reset your practice portfolio to 10 pretend SOL? Positions and history are cleared.')) { S = fresh(); save(); draw(); }
});
q('#prFind').addEventListener('submit', e => { e.preventDefault(); const v = e.target.q.value.trim(); if (v) find(v); });

window.practiceBuy = mint => {
  document.querySelector('nav button[data-p="practice"]')?.click();
  q('#prFind').q.value = mint; find(mint);
  setTimeout(() => q('#prFind').scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
};

// keep prices fresh while the page is open
const tick = async () => {
  if (document.body.dataset.page === 'practice' || document.body.dataset.page === 'overview') { await getSolPx(); await refreshPrices(); snapshot(); save(); }
  if (document.body.dataset.page === 'practice') { draw(); drawHot(); }
};
draw(); setTimeout(() => { drawHot(); tick(); }, 2500); setInterval(tick, 15000);
addEventListener('storage', e => { if (e.key === KEY) { S = load(); draw(); } });
})();
