/* ==========================================================================
   TRADE — Phantom-approved pump.fun trading.
   Flow: Lunex asks PumpPortal to BUILD an unsigned transaction for your
   wallet → your wallet (Phantom / Solflare / Backpack) pops up → you approve →
   the wallet signs and sends it. Your private key never leaves the wallet;
   nothing here can trade without your click in the wallet popup.
   ========================================================================== */
(() => {
'use strict';
const q = s => document.querySelector(s), qa = s => [...document.querySelectorAll(s)];
const g = name => { try { return eval(name); } catch { return undefined; } };
const I = n => (window.ICON ? window.ICON(n) : '');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => n == null || isNaN(n) ? 'n/a' : n >= 1e6 ? '$' + (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? '$' + (n / 1e3).toFixed(1) + 'K' : '$' + n.toFixed(2);
const sfx = k => window.SFX && window.SFX[k] && window.SFX[k]();
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const WEB3 = 'https://unpkg.com/@solana/web3.js@1.98.2/lib/index.iife.min.js';
const FEE_RESERVE = 0.01;   // keep a little SOL for network fees
const PP_TRADE = 'https://pumpportal.fun/api/trade-local';

let web3p = null;
function loadWeb3() {   // only fetched the first time you trade
  if (window.solanaWeb3) return Promise.resolve(window.solanaWeb3);
  return web3p ||= new Promise((res, rej) => { const s = document.createElement('script'); s.src = WEB3; s.onload = () => res(window.solanaWeb3); s.onerror = () => { web3p = null; rej(new Error("Couldn't load the Solana library. Check your connection.")); }; document.head.appendChild(s); });
}
const provider = () => window.phantom?.solana || window.solflare || window.backpack?.solana || window.solana || null;
async function rpc(method, params) { return window.rpc(method, params); }

// ---------------------------------------------------------------- UI
const ov = document.createElement('div'); ov.id = 'tr-ov';
ov.innerHTML = `<div class="tr-card" role="dialog" aria-modal="true" aria-label="Trade"></div>`;
document.body.appendChild(ov);
const card = ov.querySelector('.tr-card');
ov.addEventListener('click', e => { if (e.target === ov && !st.busy) close(); });
addEventListener('keydown', e => { if (e.key === 'Escape' && ov.classList.contains('open') && !st.busy) close(); });
function close() { ov.classList.remove('open'); }

const st = { mint: null, side: 'buy', coin: null, sol: 0, tokens: 0, solAmt: null, pct: 50, slip: 15, prio: 0.0003, arm: true, busy: false, risky: false, ack: false, status: '', step: 0, sig: null, err: '' };

async function open(opts = {}) {
  const mint = opts.mint; if (!B58.test(mint || '')) return;
  Object.assign(st, { mint, side: opts.side || 'buy', coin: null, solAmt: opts.sol ?? null, pct: opts.pct ?? 50, busy: false, ack: false, status: '', step: 0, sig: null, err: '' });
  ov.classList.add('open'); sfx('click');
  draw();
  await Promise.all([loadCoin(opts), loadBalances()]);
  if (st.solAmt == null) st.solAmt = defaultSol();
  draw();
}
async function loadCoin(opts) {
  try {
    const best = await window.loadPairs([{ chainId: 'solana', tokenAddress: st.mint }]);
    const p = best['solana:' + st.mint];
    const pc = (g('coins') || new Map()).get(st.mint);
    if (p) { const a = window.analyze(p); const r = window.nvReadDex ? window.nvReadDex(p, a) : null;
      st.coin = { sym: p.baseToken.symbol, name: p.baseToken.name, img: p.info?.imageUrl, mcap: p.marketCap || p.fdv, price: +p.priceUsd, a, read: r, curve: p.dexId === 'pumpfun' };
      st.risky = r?.tone === 'bad' || a.flags.some(f => /honeypot/i.test(f)); }
    else if (pc) { const s = window.pumpScore(pc); const r = window.nvReadPump ? window.nvReadPump(pc, s) : null;
      st.coin = { sym: pc.symbol, name: pc.name, img: pc.meta?.image, mcap: pc.mcap * (g('solUsd') || 0), read: r, curve: true, score: s.score };
      st.risky = r?.tone === 'bad'; }
    else st.coin = { sym: opts.sym || st.mint.slice(0, 4) + '…', name: 'Unknown coin', read: null };
  } catch { st.coin = { sym: opts.sym || '?', name: '' }; }
}
function walletAddr() { const p = provider(); return p?.publicKey?.toString() || (window.LUNA && window.LUNA.addr && window.LUNA.addr()) || localStorage.getItem('luna-wallet'); }
async function loadBalances() {
  const addr = walletAddr(); if (!addr) return;
  try {
    const [bal, a1, a2] = await Promise.all([rpc('getBalance', [addr]),
      rpc('getTokenAccountsByOwner', [addr, { mint: st.mint }, { encoding: 'jsonParsed' }]).catch(() => ({ value: [] })), Promise.resolve({ value: [] })]);
    st.sol = bal.value / 1e9;
    st.tokens = [...a1.value, ...a2.value].reduce((s, x) => s + (x.account.data.parsed.info.tokenAmount.uiAmount || 0), 0);
  } catch { }
}
function defaultSol() {
  const solPx = g('solUsd') || 0, pp = window.LUNA && window.LUNA.perPlay && window.LUNA.perPlay();
  const fromPlan = pp && solPx ? pp.amt / solPx : 0.01;
  return Math.max(0.001, Math.min(+(fromPlan).toFixed(4), Math.max(0, st.sol - FEE_RESERVE)));
}

function draw() {
  const c = st.coin, solPx = g('solUsd') || 0, buy = st.side === 'buy';
  const maxBuy = Math.max(0, st.sol - FEE_RESERVE);
  const usd = (st.solAmt || 0) * solPx, tokVal = st.tokens * (c?.price || 0);
  const tone = c?.read?.tone || 'neutral';
  const steps = ['Build', 'Approve in wallet', 'Sent', 'Confirmed'];
  card.innerHTML = `
    <button class="tr-x" aria-label="Close" ${st.busy ? 'disabled' : ''}>${I('close')}</button>
    <div class="tr-head">
      <span class="tr-img">${c?.img ? `<img src="${esc(c.img)}" alt="" onerror="this.remove()">` : esc((c?.sym || '?').slice(0, 1))}</span>
      <div><b>$${esc(c?.sym || '…')}</b><small>${esc(c?.name || 'Loading coin…')}${c?.mcap ? ' · ' + money(c.mcap) + ' MC' : ''}${c?.curve ? ' · on curve' : ''}</small></div>
    </div>
    <div class="tr-tabs"><button data-side="buy" class="${buy ? 'on buy' : ''}">Buy</button><button data-side="sell" class="${!buy ? 'on sell' : ''}">Sell</button></div>
    ${c?.read ? `<div class="tr-read tr-${tone}"><span>${I('book')} Luna's read</span><p>${c.read.text}</p></div>` : ''}
    ${buy ? `
      <label class="tr-lbl">Amount <span>Balance ${st.sol.toFixed(4)} SOL</span></label>
      <div class="tr-amt"><input type="number" min="0" step="0.001" value="${st.solAmt ?? ''}" data-k="solAmt"><span>SOL</span></div>
      <div class="tr-usd">≈ ${money(usd)}</div>
      <div class="tr-presets">${[['Per-play', defaultSol()], ['0.01', .01], ['0.025', .025], ['0.05', .05], ['Max', maxBuy]].map(([l, v]) => `<button type="button" data-sol="${(+v).toFixed(4)}">${l}</button>`).join('')}</div>
      <label class="tr-check"><input type="checkbox" data-k="arm" ${st.arm ? 'checked' : ''}> Arm my 2x / −40% alert after the buy</label>`
    : `
      <label class="tr-lbl">Sell <span>You hold ${st.tokens.toLocaleString(undefined, { maximumFractionDigits: 2 })}${tokVal ? ' · ' + money(tokVal) : ''}</span></label>
      <div class="tr-presets tr-pcts">${[25, 50, 100].map(p => `<button type="button" data-pct="${p}" class="${st.pct === p ? 'on' : ''}">${p === 100 ? 'All' : p + '%'}</button>`).join('')}</div>
      <div class="tr-usd">Selling ${st.pct}%${tokVal ? ' ≈ ' + money(tokVal * st.pct / 100) : ''}</div>`}
    <details class="tr-adv"><summary>Slippage ${st.slip}% · priority ${st.prio} SOL</summary>
      <div class="tr-adv-row"><label>Slippage %<input type="number" min="1" max="50" step="1" value="${st.slip}" data-k="slip"></label><label>Priority fee (SOL)<input type="number" min="0" max="0.01" step="0.0001" value="${st.prio}" data-k="prio"></label></div>
      <p>Higher slippage fills more reliably on fast coins but invites MEV bots. 10–20% is normal on pump.fun.</p></details>
    ${st.risky ? `<label class="tr-check tr-warn"><input type="checkbox" data-k="ack" ${st.ack ? 'checked' : ''}> Luna flags this coin as high risk. I understand and want to trade anyway.</label>` : ''}
    <div class="tr-fees">PumpPortal fee 0.5% · network + priority fee ~${(st.prio + 0.000005).toFixed(4)} SOL</div>
    ${st.step ? `<ol class="tr-steps">${steps.map((s, i) => `<li class="${i + 1 < st.step ? 'done' : i + 1 === st.step ? (st.err ? 'err' : 'now') : ''}">${s}</li>`).join('')}</ol>` : ''}
    ${st.status ? `<div class="tr-status ${st.err ? 'err' : ''}">${st.status}</div>` : ''}
    <button class="tr-go ${buy ? 'buy' : 'sell'}" ${goDisabled() ? 'disabled' : ''}>${st.busy ? 'Working…' : st.sig && !st.err ? 'Done' : buy ? `${I('wallet')} Approve buy in wallet` : `${I('wallet')} Approve sell in wallet`}</button>
    <p class="tr-safe">${I('lock')} Your wallet shows you the exact trade and asks you to approve it. Your private key never leaves your wallet.</p>`;
  card.querySelector('.tr-x').onclick = () => { if (!st.busy) close(); };
  card.querySelectorAll('[data-side]').forEach(b => b.onclick = () => { if (st.busy) return; st.side = b.dataset.side; st.step = 0; st.status = ''; st.err = ''; st.sig = null; draw(); });
  card.querySelectorAll('[data-sol]').forEach(b => b.onclick = () => { st.solAmt = +b.dataset.sol; draw(); });
  card.querySelectorAll('[data-pct]').forEach(b => b.onclick = () => { st.pct = +b.dataset.pct; draw(); });
  card.querySelectorAll('[data-k]').forEach(inp => inp.onchange = () => { const k = inp.dataset.k; st[k] = inp.type === 'checkbox' ? inp.checked : +inp.value; draw(); });
  card.querySelector('[data-k="solAmt"]')?.addEventListener('input', e => { st.solAmt = +e.target.value; card.querySelector('.tr-usd').textContent = '≈ ' + money(st.solAmt * solPx); const go = card.querySelector('.tr-go'); go.disabled = goDisabled(); });
  card.querySelector('.tr-go').onclick = () => { if (st.sig && !st.err) return close(); execute(); };
}
function goDisabled() {
  if (st.busy) return true; if (st.sig && !st.err) return false;
  if (st.risky && !st.ack) return true;
  if (st.side === 'buy') return !(st.solAmt > 0) || st.solAmt > Math.max(0, st.sol - FEE_RESERVE) + 1e-9;
  return !(st.tokens > 0);
}
function setStep(step, status, err) { st.step = step; st.status = status; st.err = err || ''; draw(); }

// ---------------------------------------------------------------- EXECUTE
async function execute() {
  st.busy = true; st.sig = null;
  const p = provider();
  try {
    if (!p) throw new Error('No wallet extension found. Open Lunex in the browser where Phantom (or Solflare / Backpack) is installed.');
    setStep(1, 'Connecting your wallet…');
    if (!p.publicKey) await p.connect();
    const owner = p.publicKey.toString();
    const lunaAddr = localStorage.getItem('luna-wallet');
    if (lunaAddr && lunaAddr !== owner) setStep(1, `Heads up: your wallet extension is ${owner.slice(0, 4)}…${owner.slice(-4)}, not the wallet Luna is watching. Trading from the extension's wallet.`);
    const slippage = Math.max(1, Math.min(50, +st.slip || 15)), priorityFee = Math.max(0, Math.min(0.01, +st.prio || 0));
    const body = st.side === 'buy'
      ? { publicKey: owner, action: 'buy', mint: st.mint, amount: +(+st.solAmt).toFixed(6), denominatedInSol: 'true', slippage, priorityFee, pool: 'auto' }
      : { publicKey: owner, action: 'sell', mint: st.mint, amount: Math.max(1, Math.min(100, st.pct)) + '%', denominatedInSol: 'false', slippage, priorityFee, pool: 'auto' };
    setStep(1, 'Building the transaction…');
    // PumpPortal only BUILDS the transaction; it can't sign or send it. That needs your wallet.
    const [web3, res] = await Promise.all([loadWeb3(), fetch(PP_TRADE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })]);
    if (!res.ok) { const txt = await res.text().catch(() => ''); throw new Error(friendly(txt || res.statusText || 'HTTP ' + res.status)); }
    const tx = web3.VersionedTransaction.deserialize(new Uint8Array(await res.arrayBuffer()));
    setStep(2, 'Check your wallet popup and approve the trade.');
    window.LUNA && window.LUNA.setMood && window.LUNA.setMood('think', 0);
    let sig;
    if (typeof p.signAndSendTransaction === 'function') { const out = await p.signAndSendTransaction(tx); sig = out.signature || out; }
    else { const signed = await p.signTransaction(tx); const b64 = btoa(String.fromCharCode(...signed.serialize())); sig = await rpc('sendTransaction', [b64, { encoding: 'base64', maxRetries: 3 }]); }
    st.sig = typeof sig === 'string' ? sig : String(sig);
    setStep(3, `Sent. Waiting for the network… <a href="https://solscan.io/tx/${esc(st.sig)}" target="_blank" rel="noopener">view</a>`);
    const ok = await confirm(st.sig);
    if (ok === 'failed') throw new Error('The transaction landed but failed on-chain (often slippage). Nothing was traded except the network fee.');
    setStep(4, `${ok === 'confirmed' ? 'Confirmed!' : 'Sent (still confirming).'} <a href="https://solscan.io/tx/${esc(st.sig)}" target="_blank" rel="noopener">View on Solscan</a>`);
    afterTrade();
  } catch (e) {
    const msg = /reject|denied|cancel|declined/i.test(e.message || '') ? 'You cancelled it in the wallet. Nothing was traded.' : friendly(e.message || String(e));
    st.err = msg; setStep(Math.max(1, st.step), msg, true);
    window.LUNA && window.LUNA.setMood && window.LUNA.setMood(/cancel/.test(msg) ? 'think' : 'sad', 2500);
  } finally { st.busy = false; draw(); }
}
function friendly(m) {
  m = String(m);
  if (/insufficient|0x1\b|lamports/i.test(m)) return 'Not enough SOL for this trade plus fees.';
  if (/slippage|0x1771|TooMuchSolRequired|TooLittleSolReceived/i.test(m)) return 'Price moved past your slippage. Try again or raise slippage a little.';
  if (/not found|invalid mint|bonding curve/i.test(m)) return "PumpPortal couldn't find a market for this coin.";
  return m.length > 200 ? m.slice(0, 200) + '…' : m;
}
async function confirm(sig) {
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000));
    try { const r = await rpc('getSignatureStatuses', [[sig], { searchTransactionHistory: true }]); const s = r.value[0];
      if (s?.err) return 'failed';
      if (s && (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized')) return 'confirmed'; } catch { }
  }
  return 'pending';
}
function afterTrade() {
  const c = st.coin || {}, buy = st.side === 'buy';
  sfx(buy ? 'target' : 'buy');
  window.NOVA && window.NOVA.burst(innerWidth / 2, innerHeight / 2, buy ? '#3dffb0' : '#ffc861', 120, 10);
  window.LUNA && window.LUNA.setMood && window.LUNA.setMood('happy', 3500);
  if (buy && st.arm && c.mcap && typeof window.autoAlert === 'function') window.autoAlert(st.mint, c.sym, c.mcap);
  const line = buy ? `Bought **${st.solAmt} SOL** of **$${c.sym}**.${st.arm && c.mcap ? ` I armed your alert: 2x at ${money(c.mcap * 2)}, stop at ${money(c.mcap * .6)}.` : ''} Now let the plan do the work.`
    : `Sold **${st.pct}%** of your **$${c.sym}**. Locked in.`;
  window.LUNA && window.LUNA.note && window.LUNA.note(line, 'happy');
  setTimeout(() => window.LUNA && window.LUNA.refresh && window.LUNA.refresh(), 4000);
}

// ---------------------------------------------------------------- ENTRY POINTS
window.TRADE = { open, buy: (mint, sol) => open({ mint, side: 'buy', sol }), sell: (mint, pct = 50) => open({ mint, side: 'sell', pct }) };
const tradeBtn = mint => `<a href="#" class="tr-link" onclick="TRADE.open({mint:'${esc(mint)}'});return false">${I('bolt')} Trade</a>`;
// radar / vault / constellation cards
if (typeof window.dexCard === 'function') {
  const orig = window.dexCard;
  window.dexCard = function (p, a, extra) { const h = orig(p, a, extra); return p.chainId === 'solana' ? h.replace('<div class="links">', '<div class="links">' + tradeBtn(p.baseToken.address)) : h; };
}
// launch bay cards (rebuilt every second)
if (typeof window.renderPump === 'function') {
  const orig = window.renderPump;
  window.renderPump = function (...a) { const r = orig.apply(this, a);
    qa('#pumpGrid .card .links').forEach(l => { if (l.querySelector('.tr-link')) return; const m = l.querySelector('a[href*="pump.fun/coin/"]'); if (m) l.insertAdjacentHTML('afterbegin', tradeBtn(m.href.split('/coin/')[1])); });
    return r; };
}
// target-hit alerts get a one-click "Sell half"
if (typeof window.showAlert === 'function') {
  const orig = window.showAlert;
  window.showAlert = function (html) { const r = orig.apply(this, arguments);
    try { if (/ic-target/.test(html)) { const sym = (String(html).match(/\$([A-Za-z0-9]+)/) || [])[1]; const t = ((g('getTrades') || (() => []))()).find(x => x.sym === sym);
      if (t) q('#alertBar').insertAdjacentHTML('beforeend', ` <button class="tr-alert-btn" onclick="TRADE.sell('${esc(t.mint)}', 50)">${I('bolt')} Sell half</button>`); } } catch { }
    return r; };
}

// ---------------------------------------------------------------- STYLES
const css = document.createElement('style');
css.textContent = `
#tr-ov{position:fixed;inset:0;z-index:110;display:grid;place-items:center;background:rgba(2,3,8,.62);backdrop-filter:blur(6px);opacity:0;pointer-events:none;transition:opacity .3s}
#tr-ov.open{opacity:1;pointer-events:auto}
.tr-card{position:relative;width:min(440px,calc(100vw - 24px));max-height:calc(100vh - 40px);overflow-y:auto;padding:22px;border-radius:26px;border:1px solid var(--edge2);
  background:linear-gradient(170deg,rgba(20,21,36,.98),rgba(8,9,16,.98));box-shadow:0 50px 120px -20px #000,0 0 80px -30px var(--acc);font-family:var(--sans);
  transform:translateY(20px) scale(.96);transition:transform .45s var(--ease)}
#tr-ov.open .tr-card{transform:none}
.tr-x{all:unset;position:absolute;top:14px;right:14px;width:32px;height:32px;border-radius:50%;display:grid;place-items:center;cursor:pointer;color:var(--dim);border:1px solid var(--edge)}
.tr-x:hover{color:var(--text);border-color:var(--acc)}
.tr-head{display:flex;align-items:center;gap:12px;margin-bottom:16px}
.tr-img{width:46px;height:46px;border-radius:50%;overflow:hidden;display:grid;place-items:center;background:#1b1c30;font-weight:600;color:var(--acc2);flex:none}
.tr-img img{width:100%;height:100%;object-fit:cover}
.tr-head b{display:block;font-family:var(--serif);font-weight:400;font-size:30px;line-height:1}
.tr-head small{font-size:12.5px;color:var(--dim)}
.tr-tabs{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:5px;border-radius:14px;background:rgba(0,0,0,.35);border:1px solid var(--edge);margin-bottom:14px}
.tr-tabs button{all:unset;text-align:center;padding:10px;border-radius:10px;cursor:pointer;font-weight:600;font-size:14px;color:var(--dim)}
.tr-tabs button.on.buy{background:var(--green);color:#03140c}.tr-tabs button.on.sell{background:var(--red);color:#fff}
.tr-read{border-radius:14px;padding:11px 13px;margin-bottom:14px;background:rgba(255,255,255,.03);border:1px solid var(--edge);border-left:3px solid var(--dim)}
.tr-read span{font-family:var(--mono);font-size:9.5px;letter-spacing:.18em;text-transform:uppercase;color:var(--dim);display:flex;gap:6px;align-items:center}
.tr-read p{margin:5px 0 0;font-size:13px;line-height:1.5;color:#cfd2ea}
.tr-good{border-left-color:var(--green)}.tr-warn{border-left-color:var(--amber)}.tr-bad{border-left-color:var(--red)}
.tr-lbl{display:flex;justify-content:space-between;font-size:13px;font-weight:500;margin:4px 0 7px}
.tr-lbl span{font-size:12px;color:var(--dim);font-weight:400}
.tr-amt{display:flex;align-items:center;border-radius:14px;border:1px solid var(--edge2);background:rgba(0,0,0,.35);padding:0 14px}
.tr-amt input{flex:1;border:0!important;background:transparent!important;box-shadow:none!important;font-family:var(--sans)!important;font-size:26px!important;font-weight:600;padding:12px 0!important;min-width:0}
.tr-amt span{font-weight:600;color:var(--dim)}
.tr-usd{font-size:12.5px;color:var(--dim);margin:6px 2px 10px}
.tr-presets{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}
.tr-presets button{all:unset;cursor:pointer;padding:7px 12px;border-radius:10px;border:1px solid var(--edge2);font-size:12.5px;color:#d7daf0}
.tr-presets button:hover,.tr-presets button.on{border-color:var(--acc);color:var(--acc2);background:rgba(255,255,255,.04)}
.tr-pcts button{flex:1;text-align:center;padding:12px}
.tr-check{display:flex;gap:9px;align-items:flex-start;font-size:13px;color:#cfd2ea;margin:4px 0 12px;line-height:1.45;cursor:pointer}
.tr-check input{margin-top:2px;accent-color:var(--acc)}
.tr-check.tr-warn{padding:10px 12px;border-radius:12px;background:rgba(255,61,110,.08);border:1px solid rgba(255,61,110,.3);color:#ffc7d3}
.tr-adv{margin:2px 0 12px;font-size:12.5px;color:var(--dim)}
.tr-adv summary{cursor:pointer}
.tr-adv-row{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}
.tr-adv-row label{display:flex;flex-direction:column;gap:4px;font-size:11.5px}
.tr-adv p{margin:8px 0 0;font-size:11.5px;line-height:1.5}
.tr-fees{font-size:11.5px;color:var(--faint);margin-bottom:12px}
.tr-steps{display:flex;gap:6px;list-style:none;padding:0;margin:0 0 10px;counter-reset:s}
.tr-steps li{flex:1;font-size:10.5px;text-align:center;padding:7px 4px;border-radius:9px;background:rgba(255,255,255,.04);color:var(--faint)}
.tr-steps li.done{color:var(--green);background:rgba(61,255,176,.08)}.tr-steps li.now{color:var(--acc2);background:rgba(255,255,255,.08);animation:l-tip 1.2s infinite}
.tr-steps li.err{color:var(--red);background:rgba(255,61,110,.1)}
.tr-status{font-size:13px;line-height:1.5;margin-bottom:12px;color:#d7daf0}.tr-status.err{color:#ffb3c2}
.tr-status a{color:var(--acc2)}
.tr-go{width:100%;padding:15px!important;font-size:15px!important;font-family:var(--sans)!important;text-transform:none!important;letter-spacing:0!important;display:flex!important;justify-content:center;align-items:center;gap:8px}
.tr-go.buy{background:var(--green)!important;color:#03140c!important;box-shadow:0 14px 40px -12px var(--green)!important}
.tr-go.sell{background:var(--red)!important;color:#fff!important;box-shadow:0 14px 40px -12px var(--red)!important}
.tr-go:disabled{opacity:.4;cursor:not-allowed;filter:grayscale(.4)}
.tr-safe{font-size:11.5px;color:var(--faint);text-align:center;margin:10px 0 0;line-height:1.5}
.tr-link{color:var(--green)!important;border-color:rgba(61,255,176,.35)!important}
.tr-alert-btn{margin-left:8px;padding:4px 12px!important;font-size:11.5px!important;background:var(--green)!important;color:#03140c!important}
`;
document.head.appendChild(css);
})();
