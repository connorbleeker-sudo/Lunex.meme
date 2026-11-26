// Beginner help: plain-English explainers for jargon, a simple verdict + "Plan a trade" calculator on every coin card,
// and a first-visit tour with a "Start here" checklist on Home. Everything here is derived from the scores the app
// already computes; nothing is a forecast. Styles live in ground.css ("Beginner help").
(() => {
const UI = window.LunexUI; if (!UI || window.LunexLearn) return;
const esc = UI.esc, q = s => document.querySelector(s), qa = s => [...document.querySelectorAll(s)];
const g = name => { try { return eval(name); } catch { return undefined; } };   // app globals (let/const in shared script scope)
const store = { get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } } };
const isMint = m => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(m || ''));
const lc1 = s => String(s).charAt(0).toLowerCase() + String(s).slice(1);   // "Dev bought 4 SOL" -> "dev bought 4 SOL"
const usd = n => !isFinite(n) ? '—' : n >= 1000 ? '$' + Math.round(n).toLocaleString() : n >= 10 ? '$' + n.toFixed(0) : '$' + n.toFixed(2);

// ================================================================ checklist progress (shared)
const START_KEY = 'lx-start-v1';
const START = store.get(START_KEY, {});
function done(step) { if (START[step]) return; START[step] = Date.now(); store.set(START_KEY, START); drawStart(); }

// ================================================================ 1. JARGON EXPLAINERS
const T = {
  price:     ['Price', 'What one coin costs right now. Memecoins have huge supplies, so the price is a tiny number. Market cap is easier to compare.'],
  mcap:      ['Market cap', 'Price × every coin that exists: the coin\'s total size. Going from $10K to $20K market cap is a 2x.'],
  liquidity: ['Liquidity', 'Money sitting in the trading pool. More liquidity means you can buy and sell without moving the price much. Under $10K, even small trades swing it.'],
  volume:    ['Volume', 'Dollars traded in that time. Lots of volume compared to liquidity means a lot of activity.'],
  chg1:      ['1h change', 'How much the price moved over the last hour.'],
  chg6:      ['6h change', 'How much the price moved over the last 6 hours.'],
  chg24:     ['24h change', 'How much the price moved over the last 24 hours.'],
  buys1h:    ['Buys 1h', 'Share of trades in the last hour that were buys. Over 60% means buyers are in control. Under 40%, sellers are.'],
  buyers:    ['Buyers', 'How many different wallets have bought. Many different buyers is healthier than a few wallets trading a lot.'],
  buysell:   ['Buy/Sell', 'Number of buy trades and sell trades since launch.'],
  momentum:  ['Momentum (0–100)', 'How much is happening right now: buy pressure, volume and price moves. High momentum can flip to a dump fast.'],
  safety:    ['Safety (0–100)', 'Starts at 100 and loses points for red flags like thin liquidity, a very new coin, no socials or a huge pump. Higher is better, but never a guarantee.'],
  early:     ['Early signal (0–100)', 'For brand-new coins: unique buyers, buy pressure, volume and growth since launch. Drops to near 0 if the creator sells.'],
  impact:    ['Price impact', 'How much your own buy pushes the price up. The bigger your buy compared to liquidity, the worse the price you get.'],
  curve:     ['Bonding curve', 'pump.fun\'s starting stage. A formula sets the price until enough people buy, then the coin moves to a normal exchange. Most coins never get there.'],
  devsold:   ['Dev sold', 'The wallet that created the coin has sold. This is often how a rug pull starts.'],
  devbought: ['Dev bought big', 'The creator bought a large chunk at launch, so they can sell it into your buy later.'],
  rug:       ['Rug pull', 'The creators or insiders dump their coins or pull the money out, and the price crashes toward zero.'],
  honeypot:  ['Honeypot', 'People can buy but can\'t sell. If nobody is selling, you might not be able to sell either.'],
  thinliq:   ['Thin liquidity', 'Not much money in the pool, so prices swing hard and selling can cost you a lot.'],
  young:     ['Very new coin', 'There is almost no history to judge it yet. Most new coins fail early.'],
  mcliq:     ['Market cap far above liquidity', 'The coin looks big, but there is little money backing it. A few sellers could crash the price.'],
  socials:   ['No socials', 'No X account, Telegram or website. Real projects usually have at least one.'],
  pumped:    ['Already pumped', 'It has already gone up a lot. Buying late often means buying from early holders who are taking profit.'],
  dumping:   ['Dumping', 'The price fell sharply in the last hour. Sellers are in control.'],
  dead:      ['Basically dead', 'Almost no trading for a day. You may struggle to sell.'],
  oneSided:  ['Hardly anyone selling', 'Almost only buys. Could be strong demand, or a sign that selling is blocked. Test with a tiny amount first.'],
  fewbuyers: ['Few unique buyers', 'Lots of trades from only a few wallets. Often bots, or one person faking activity.'],
  peak:      ['Down 50%+ from peak', 'It already crashed by more than half from its high.'],
  nointerest:['No interest', 'Almost nobody has traded it since launch.'],
  smart:     ['Smart wallet', 'A wallet you chose to follow, because it has traded well before.'],
  ca:        ['Contract address (CA)', 'The coin\'s unique ID. Anyone can copy a ticker like $PEPE, but not the address. Always check you have the right one.'],
  rugchecks: ['Rug checks', 'How many times people ran the free coin check on Lunex.'],
  stop:      ['Stop-loss', 'A price where you sell to cap your loss, decided before you buy so emotions don\'t decide for you.'],
  takeprofit:['Take-profit', 'A price where you sell to lock in a gain. Memecoins often spike and fall back, so having a target helps.'],
};
// exact label text -> term (lower-case)
const LABELS = { 'price': 'price', 'mkt cap': 'mcap', 'market cap': 'mcap', 'liquidity': 'liquidity', 'vol 1h': 'volume', 'vol': 'volume', '1h': 'chg1', '6h': 'chg6',
  '24h': 'chg24', 'buys 1h': 'buys1h', 'buyers': 'buyers', 'buy/sell': 'buysell', 'momentum': 'momentum', 'safety': 'safety', 'mom': 'momentum', 'safe': 'safety',
  'early signal': 'early', 'impact': 'impact', 'rug checks': 'rugchecks', 'ca': 'ca' };
// red-flag text -> term
const FLAGS = [[/curve/i, 'curve'], [/^dev sold/i, 'devsold'], [/^dev bought/i, 'devbought'], [/honeypot|no sells/i, 'honeypot'], [/liquidity/i, 'thinliq'],
  [/under \d+h old/i, 'young'], [/mc far above/i, 'mcliq'], [/no socials/i, 'socials'], [/up over/i, 'pumped'], [/^dumping/i, 'dumping'], [/dead/i, 'dead'],
  [/hardly anyone selling/i, 'oneSided'], [/few unique buyers/i, 'fewbuyers'], [/down 50/i, 'peak'], [/no interest/i, 'nointerest'], [/smart wallet/i, 'smart'], [/rug signal/i, 'rug']];
const SEL = '.stat small, .lx-dial small, .bars > span, .flag, .badge, .ov-telemetry small, .links a, .lx-v-why abbr, [data-term]';
function termFor(el) {
  if (el.dataset.term) return el.dataset.term;
  const t = el.textContent.trim().toLowerCase();
  if (el.matches('.flag, .badge')) { const f = FLAGS.find(([re]) => re.test(t)); return f ? f[1] : null; }
  if (el.matches('.links a')) return t === 'ca' ? 'ca' : null;
  return LABELS[t] || null;
}
function decorate(root) {
  const els = root.matches?.(SEL) ? [root] : [];
  (root.querySelectorAll ? els.concat([...root.querySelectorAll(SEL)]) : els).forEach(el => {
    if (el.classList.contains('lx-term')) return;
    const k = termFor(el); if (!k || !T[k]) return;
    el.dataset.term = k; el.classList.add('lx-term');
    if (!el.matches('a, button')) { el.tabIndex = 0; el.setAttribute('role', 'button'); }
    el.setAttribute('aria-describedby', 'lx-tip');
  });
}
const tip = document.createElement('div'); tip.id = 'lx-tip'; tip.className = 'lx-tip'; tip.setAttribute('role', 'tooltip'); document.body.appendChild(tip);
let tipEl = null, seen = new Set(store.get('lx-terms-seen', []));
function showTip(el) {
  const [name, text] = T[el.dataset.term] || []; if (!name) return;
  tipEl = el; tip.innerHTML = `<b>${esc(name)}</b><span>${esc(text)}</span>`; tip.classList.add('on');
  const r = el.getBoundingClientRect(), w = Math.min(280, innerWidth - 16);
  tip.style.width = w + 'px';
  tip.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px';
  const h = tip.offsetHeight, below = r.bottom + 10 + h < innerHeight;
  tip.style.top = (below ? r.bottom + 8 : r.top - h - 8) + 'px';
  if (!seen.has(el.dataset.term)) { seen.add(el.dataset.term); store.set('lx-terms-seen', [...seen]); if (seen.size >= 3) done('words'); else drawStart(); }
}
function hideTip() { tip.classList.remove('on'); tipEl = null; }
document.addEventListener('mouseover', e => { const el = e.target.closest?.('.lx-term'); if (el && el !== tipEl) showTip(el); else if (!el && tipEl) hideTip(); }, { passive: true });
document.addEventListener('focusin', e => { const el = e.target.closest?.('.lx-term'); if (el) showTip(el); });
document.addEventListener('focusout', e => { if (e.target.closest?.('.lx-term')) hideTip(); });
document.addEventListener('click', e => {   // tap to open on touch screens (but let real links still work)
  const el = e.target.closest?.('.lx-term');
  if (el && !el.matches('a, button')) { if (tipEl === el) hideTip(); else showTip(el); }
  else if (!el && tipEl) hideTip();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && tipEl) hideTip(); });
addEventListener('scroll', () => tipEl && hideTip(), { passive: true, capture: true });
let pend = new Set(), raf = 0;
new MutationObserver(ms => {
  ms.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType === 1) pend.add(n); }));
  if (!raf) raf = requestAnimationFrame(() => { raf = 0; const list = [...pend]; pend.clear(); list.forEach(n => n.isConnected && decorate(n)); });
}).observe(document.body, { childList: true, subtree: true });
decorate(document.body);

// ================================================================ 2. VERDICT + PLAN A TRADE
// Verdicts are a plain-English summary of the existing momentum/safety scores and red flags. Not a forecast.
const V = {
  avoid: ['Avoid', 'avoid'], risky: ['Risky', 'risky'], quiet: ['Too quiet', 'quiet'], look: ['Worth a look', 'look'],
};
function verdictDex(a) {
  const f = a.flags.join(' | ');
  if (/honeypot/i.test(f)) return ['avoid', 'Nobody is selling. You may not be able to sell either.'];
  if (/dead/i.test(f)) return ['avoid', 'Almost no trading for a day. Hard to get out.'];
  if (/^Dumping/m.test(a.flags.join('\n'))) return ['avoid', 'Falling hard this hour and sellers are in control.'];
  if (a.safety < 40) return ['avoid', `Safety is only ${a.safety}/100. Too many red flags stacked up.`];
  if (a.momentum < 35) return ['quiet', 'Not much buying right now. Nothing to act on yet.'];
  const thin = !/curve/i.test(f) && a.liq < 10000;
  if (thin) return ['risky', `Only ${UI.money(a.liq)} in the pool. Even a small sell moves the price a lot.`];
  if (a.safety >= 70 && a.momentum >= 50 && a.c24 < 1000) return ['look', 'Real buying and fewer red flags than most. Still small size only.'];
  if (a.c24 > 300) return ['risky', 'Already up a lot. Late buyers often become exit liquidity.'];
  return ['risky', a.flags.length ? `Active, but watch the red flag${a.flags.length > 1 ? 's' : ''}: ${lc1(a.flags[0].replace(/\s*\(.*\)/, ''))}.` : 'Active, but the safety score is middling.'];
}
function verdictPump(c, s) {
  const f = s.flags.map(x => x.t).join(' | ');
  if (c.devSold) return ['avoid', 'The creator already sold. Classic rug pattern.'];
  if (/Few unique buyers/.test(f)) return ['avoid', 'Most trades come from a few wallets. Likely bots.'];
  if (/Down 50/.test(f)) return ['avoid', 'Already crashed by half from its high.'];
  if (s.dead || s.score < 35) return ['quiet', 'Barely any buyers yet. Most coins like this fade out.'];
  const red = s.flags.filter(x => x.k !== 'gold');
  if (s.score >= 60 && !red.length) return ['look', 'Strong start with no red flags yet. Brand new, so tiny size only.'];
  return ['risky', red.length ? `Some traction, but: ${lc1(red[0].t)}.` : 'Some traction, but it is minutes old.'];
}
function verdictHtml([k, why], plan) {
  const [name, cls] = V[k];
  return `<div class="lx-v lx-v-${cls}"><span class="lx-v-tag">${name}</span><span class="lx-v-why">${esc(why)}</span>` +
    (plan ? `<button type="button" class="lx-plan-btn" data-plan="${esc(JSON.stringify(plan))}">Plan a trade</button>` : '') + '</div>';
}

// Radar / search cards
if (typeof window.dexCard === 'function') {
  const prev = window.dexCard;
  window.dexCard = function (p, a, extra = '') {
    const html = prev(p, a, extra);
    try {
      const v = verdictDex(a), sol = p.chainId === 'solana';
      const plan = { mint: p.baseToken.address, sym: p.baseToken.symbol, chain: p.chainId, curve: p.dexId === 'pumpfun', liq: a.liq || 0, mcap: a.fdv || 0, v: v[0], why: v[1], sol };
      const block = verdictHtml(v, plan);
      const at = html.search(/<div class="(lx-dials|bars)">/);
      return at > 0 ? html.slice(0, at) + block + html.slice(at) : html;
    } catch { return html; }
  };
}
// Launches cards (re-rendered often, so attach after each render)
if (typeof window.renderPump === 'function') {
  const prev = window.renderPump;
  window.renderPump = function (...args) {
    const r = prev.apply(this, args);
    try {
      const coins = g('coins'), solUsd = g('solUsd') || 0;
      if (coins) qa('#pumpGrid .card').forEach(card => {
        if (card.querySelector('.lx-v')) return;
        const link = card.querySelector('a[href*="pump.fun/coin/"]'); if (!link) return;
        const c = coins.get(link.href.split('/coin/')[1]); if (!c) return;
        const s = window.pumpScore(c), v = verdictPump(c, s);
        const plan = { mint: c.mint, sym: c.symbol, chain: 'solana', curve: true, liq: 0, mcap: solUsd ? c.mcap * solUsd : 0, v: v[0], why: v[1], sol: true };
        const anchor = card.querySelector('.nv-spark') || card.querySelector('.bars');
        anchor?.insertAdjacentHTML('beforebegin', verdictHtml(v, plan));
      });
    } catch { }
    return r;
  };
}

// ---- the planner dialog
const dlg = document.createElement('div'); dlg.className = 'lx-plan'; dlg.hidden = true;
dlg.innerHTML = `<div class="lx-plan-bg" data-x></div><section class="lx-plan-box" role="dialog" aria-modal="true" aria-labelledby="lxPlanH"><div class="lx-plan-body"></div></section>`;
document.body.appendChild(dlg);
const body = dlg.querySelector('.lx-plan-body');
let P = null, lastFocus = null;
function openPlan(plan) {
  P = { ...plan, amt: store.get('lx-plan-amt', 25), tp: 2, sl: 40 };
  lastFocus = document.activeElement; dlg.hidden = false; document.documentElement.classList.add('lx-noscroll');
  drawPlan(); body.querySelector('#lxAmt')?.focus(); done('plan');
}
function closePlan() { dlg.hidden = true; document.documentElement.classList.remove('lx-noscroll'); lastFocus?.focus?.(); }
function impactPct(amt) {
  if (P.curve) return P.mcap > 0 ? Math.min(99, 200 * amt / P.mcap) : null;   // bonding curve: ~2x your share of the pool
  return P.liq > 0 ? Math.min(99, 400 * amt / P.liq) : null;                  // same estimate the READ box uses
}
function drawPlan() {
  const [vName, vCls] = V[P.v], amt = Math.max(0, +P.amt || 0), imp = impactPct(amt);
  const win = amt * P.tp, lose = amt * (1 - P.sl / 100);
  const impTxt = imp == null ? 'Not enough data to estimate how much your buy moves the price.'
    : imp < 1 ? `Your buy moves the price about ${imp.toFixed(1)}%. That's fine.`
    : imp < 3 ? `Your buy moves the price about ${imp.toFixed(1)}%. Noticeable; you start a little behind.`
    : `Your buy moves the price about ${Math.round(imp)}%. That's a lot: you'd start in the red. Try a smaller amount.`;
  body.innerHTML = `
    <div class="lx-plan-hd"><div><small>Plan a trade</small><h3 id="lxPlanH">$${esc(P.sym || '?')}</h3></div>
      <span class="lx-v-tag lx-v-${vCls}">${vName}</span><button type="button" class="lx-plan-x" data-x aria-label="Close">✕</button></div>
    <p class="lx-plan-why">${esc(P.why)}</p>
    <label class="lx-plan-lbl" for="lxAmt">How much would you put in? <em>Only money you'd be fine losing completely.</em></label>
    <div class="lx-plan-amt"><span>$</span><input id="lxAmt" type="number" min="1" max="100000" step="1" inputmode="decimal" value="${amt || ''}">
      ${[10, 25, 50, 100].map(v => `<button type="button" data-amt="${v}" class="${v === amt ? 'on' : ''}">$${v}</button>`).join('')}</div>
    <div class="lx-plan-row">
      <div><span class="lx-plan-lbl"><span class="lx-term" data-term="takeprofit" tabindex="0" role="button" aria-describedby="lx-tip">Sell when it's up</span></span>
        <div class="lx-seg">${[[1.5, '+50%'], [2, '2x'], [3, '3x']].map(([v, l]) => `<button type="button" data-tp="${v}" class="${v === P.tp ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <div><span class="lx-plan-lbl"><span class="lx-term" data-term="stop" tabindex="0" role="button" aria-describedby="lx-tip">Get out if it drops</span></span>
        <div class="lx-seg">${[25, 40, 50].map(v => `<button type="button" data-sl="${v}" class="${v === P.sl ? 'on' : ''}">−${v}%</button>`).join('')}</div></div>
    </div>
    <div class="lx-plan-out">
      <div class="up"><small>If it reaches ${P.tp === 1.5 ? '+50%' : P.tp + 'x'}</small><b>${usd(win)}</b><span>+${usd(win - amt)}</span></div>
      <div class="down"><small>If it drops ${P.sl}%</small><b>${usd(lose)}</b><span>−${usd(amt - lose)}</span></div>
      <div class="zero"><small>If it rugs</small><b>$0</b><span>−${usd(amt)}</span></div>
    </div>
    <p class="lx-plan-imp ${imp != null && imp >= 3 ? 'bad' : ''}">${impTxt}</p>
    <ul class="lx-plan-tips">
      <li>Decide both exits now, before you buy. Fear and FOMO make worse decisions later.</li>
      ${P.tp >= 2 ? '<li>A common habit: at 2x, sell half. You get your starting money back and the rest is a free ride.</li>' : ''}
      <li>New memecoins move fast. Check back often or set the alerts below.</li>
    </ul>
    <div class="lx-plan-acts">
      ${P.sol && isMint(P.mint) ? `<button type="button" class="lx-btn-pri" data-act="practice">Try it with pretend money</button><button type="button" class="lx-btn-sec" data-act="alerts">Set these alerts</button>` : ''}
      <button type="button" class="lx-btn-sec" data-x>Close</button></div>
    <p class="lx-plan-fine">What-if numbers before swap fees, not a forecast. Most new coins go to zero, so the "rugs" line is the one to be ready for.</p>`;
}
dlg.addEventListener('click', e => {
  const b = e.target.closest('[data-x], [data-amt], [data-tp], [data-sl], [data-act]'); if (!b) return;
  if (b.hasAttribute('data-x')) return closePlan();
  if (b.dataset.amt) { P.amt = +b.dataset.amt; store.set('lx-plan-amt', P.amt); }
  if (b.dataset.tp) P.tp = +b.dataset.tp;
  if (b.dataset.sl) P.sl = +b.dataset.sl;
  if (b.dataset.act === 'practice') { closePlan(); window.practiceBuy && window.practiceBuy(P.mint); return; }
  if (b.dataset.act === 'alerts') {
    closePlan(); window.watchCoin && window.watchCoin(P.mint);
    setTimeout(() => { const tp = q('#tTP'), sl = q('#tSL'); if (tp) tp.value = String(P.tp); if (sl) sl.value = String(P.sl); }, 60);
    return;
  }
  const focusId = b.dataset.amt ? null : document.activeElement?.dataset;
  drawPlan();
  if (focusId) { const k = Object.keys(focusId)[0]; body.querySelector(`[data-${k}="${focusId[k]}"]`)?.focus(); }
});
dlg.addEventListener('input', e => {
  if (e.target.id !== 'lxAmt') return;
  P.amt = Math.min(100000, Math.max(0, +e.target.value || 0)); store.set('lx-plan-amt', P.amt);
  const pos = e.target.selectionStart; drawPlan(); const i = body.querySelector('#lxAmt'); i.focus(); try { i.setSelectionRange(pos, pos); } catch { }
});
dlg.addEventListener('keydown', e => {
  if (e.key === 'Escape') return closePlan();
  if (e.key === 'Tab') {   // keep focus inside the dialog
    const f = [...dlg.querySelectorAll('button, input, [tabindex="0"]')].filter(x => x.offsetParent); if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  }
});
document.addEventListener('click', e => {
  const b = e.target.closest?.('.lx-plan-btn'); if (!b) return;
  try { openPlan(JSON.parse(b.dataset.plan)); } catch { }
});

// ================================================================ 3. START-HERE TOUR + CHECKLIST
const STEPS = [
  { t: 'Welcome to Lunex', d: 'A one-minute tour. Lunex reads new Solana memecoins and tells you, in plain English, what is happening with each one. It can\'t predict prices, and most new coins go to zero. It helps you skip the obvious traps.' },
  { el: '#ovlCheck', t: 'Check any coin', d: 'Paste a coin\'s contract address (CA) or ticker. In seconds you get momentum, safety and its red flags.' },
  { el: 'nav button[data-p="scanner"]', t: 'Radar: trending coins', d: 'Every coin gets a simple verdict: Avoid, Risky, Too quiet or Worth a look, with the reason in one line.' },
  { el: 'nav button[data-p="pump"]', t: 'Launches: brand-new coins', d: 'Coins a second after they launch on pump.fun. The most exciting place and the riskiest one. Most die within the hour.' },
  { el: '.ovl-practice', t: 'Practice first', d: 'You get 10 pretend SOL to trade any coin at real prices. Make your mistakes here, not with real money.' },
  { el: 'nav button[data-p="calls"]', t: 'Calls', d: 'See which coins other Lunex traders like or avoid, and how their calls actually played out.' },
  { t: 'Two habits that help', d: 'Hover or tap any word with a dotted underline for a plain-English meaning. And press "Plan a trade" on a coin to see what you could make or lose before you buy.' },
];
const tour = document.createElement('div'); tour.className = 'lx-tour'; tour.hidden = true;
tour.innerHTML = '<div class="lx-tour-spot"></div><section class="lx-tour-box" role="dialog" aria-modal="true" aria-labelledby="lxTourH"></section>';
document.body.appendChild(tour);
const spot = tour.querySelector('.lx-tour-spot'), tbox = tour.querySelector('.lx-tour-box');
let ti = 0;
function goHome() { if (document.body.dataset.page !== 'overview') q('nav button[data-p="overview"]')?.click(); }
function startTour() { goHome(); ti = 0; tour.hidden = false; setTimeout(drawTour, 80); }
function endTour(finished) { tour.hidden = true; store.set('lx-tour-v1', finished ? 'done' : 'skipped'); if (finished) done('tour'); }
function drawTour() {
  const s = STEPS[ti], el = s.el && q(s.el), last = ti === STEPS.length - 1;
  tbox.innerHTML = `<small>${ti + 1} of ${STEPS.length}</small><h3 id="lxTourH">${esc(s.t)}</h3><p>${esc(s.d)}</p>
    <div class="lx-tour-acts"><button type="button" class="lx-btn-sec" data-tour="skip">${last ? 'Close' : 'Skip tour'}</button>
    ${ti ? '<button type="button" class="lx-btn-sec" data-tour="back">Back</button>' : ''}<button type="button" class="lx-btn-pri" data-tour="next">${last ? 'Got it' : 'Next'}</button></div>`;
  if (el) {
    if (!el.closest('nav')) el.scrollIntoView({ block: 'center' });
    requestAnimationFrame(() => {
      const r = el.getBoundingClientRect(), pad = 8;
      Object.assign(spot.style, { display: 'block', left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' });
      const w = Math.min(360, innerWidth - 24), h = tbox.offsetHeight;
      const below = r.bottom + 16 + h < innerHeight;
      Object.assign(tbox.style, { width: w + 'px', left: Math.max(12, Math.min(innerWidth - w - 12, r.left + r.width / 2 - w / 2)) + 'px', top: (below ? r.bottom + 16 : Math.max(12, r.top - h - 16)) + 'px', transform: 'none' });
    });
  } else {
    spot.style.display = 'none';
    Object.assign(tbox.style, { width: Math.min(420, innerWidth - 24) + 'px', left: '50%', top: '50%', transform: 'translate(-50%, -50%)' });
  }
  tour.classList.toggle('no-spot', !el);
  tbox.querySelector('[data-tour="next"]').focus();
}
tour.addEventListener('click', e => {
  const b = e.target.closest('[data-tour]'); if (!b) return;
  if (b.dataset.tour === 'skip') return endTour(ti === STEPS.length - 1);
  if (b.dataset.tour === 'back') ti = Math.max(0, ti - 1);
  if (b.dataset.tour === 'next') { if (ti === STEPS.length - 1) return endTour(true); ti++; }
  drawTour();
});
tour.addEventListener('keydown', e => { if (e.key === 'Escape') endTour(false); });
addEventListener('resize', () => { if (!tour.hidden) drawTour(); });

// ---- "Start here" checklist on Home
const ITEMS = [
  ['tour', 'Take the 1-minute tour', 'tour'],
  ['words', 'Learn 3 words: tap any dotted word', null],
  ['check', 'Check a coin', 'check'],
  ['radar', 'Open the Radar and read a verdict', 'scanner'],
  ['plan', 'Press "Plan a trade" on a coin', 'scanner'],
  ['practice', 'Make a practice trade with pretend SOL', 'practice'],
];
const box = document.createElement('section'); box.className = 'lx-start'; box.setAttribute('aria-labelledby', 'lxStartH');
q('#ovLive')?.before(box);
function drawStart() {
  if (!box.isConnected) return;
  const sum = window.LunexPractice?.summary?.(); if (sum && sum.trades && !START.practice) { START.practice = Date.now(); store.set(START_KEY, START); }
  if (store.get('lx-start-hidden', false)) { box.hidden = true; return; }
  const n = ITEMS.filter(([k]) => START[k]).length, all = n === ITEMS.length;
  box.hidden = false;
  box.innerHTML = `<div class="lx-start-hd"><div><small>New here?</small><h3 id="lxStartH">${all ? 'You know your way around' : 'Start here'}</h3></div>
      <div class="lx-start-prog" role="progressbar" aria-valuemin="0" aria-valuemax="${ITEMS.length}" aria-valuenow="${n}" aria-label="Start here progress"><i style="width:${n / ITEMS.length * 100}%"></i></div>
      <span class="lx-start-n">${n} of ${ITEMS.length}</span><button type="button" class="lx-start-hide" data-hide>${all ? 'Hide' : 'Hide for now'}</button></div>
    <ol class="lx-start-list">${ITEMS.map(([k, label, go]) => `<li class="${START[k] ? 'ok' : ''}"><span class="lx-tick" aria-hidden="true">${START[k] ? '✓' : ''}</span>
      ${!START[k] && go ? `<button type="button" data-go="${go}">${esc(label)}</button>` : `<span>${esc(label)}</span>`}${START[k] ? '<span class="sr-only"> (done)</span>' : ''}</li>`).join('')}</ol>`;
}
box.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.hasAttribute('data-hide')) { store.set('lx-start-hidden', true); drawStart(); return; }
  const go = b.dataset.go;
  if (go === 'tour') startTour();
  else if (go === 'check') { const i = q('#ovlCheck input'); i?.scrollIntoView({ block: 'center' }); i?.focus(); }
  else q(`nav button[data-p="${go}"]`)?.click();
});
q('#ovlCheck')?.addEventListener('submit', () => done('check'));
q('nav button[data-p="scanner"]')?.addEventListener('click', () => done('radar'));
setInterval(() => { if (document.body.dataset.page === 'overview' && !START.practice) drawStart(); }, 5000);
drawStart();

// first visit: offer the tour once the intro has finished
if (!store.get('lx-tour-v1', null)) setTimeout(() => { if (document.body.dataset.page === 'overview' && tour.hidden) startTour(); }, 4500);

window.LunexLearn = { startTour, openPlan, verdictDex, verdictPump, terms: T };
})();
