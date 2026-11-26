// Welcome page, live parts: real stats strip, the free rug check (scan animation, dials, Luna reacting),
// the live pump.fun launch feed, and Luna next to her section.
(() => {
const UI = window.LunexUI; if (!UI) return;
const $ = s => document.querySelector(s), esc = UI.esc;
const getJ = async u => { const r = await fetch(u); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Something went wrong.'); return j; };

// ---------------------------------------------------------------- count-up numbers
function countTo(el, to) {
  const from = +(el.dataset.v || 0); el.dataset.v = to;
  if (from === to) { el.textContent = to.toLocaleString(); return; }
  const t0 = performance.now(), dur = from ? 700 : 1400;
  const step = now => { const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3); el.textContent = Math.round(from + (to - from) * e).toLocaleString(); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
async function stats() {
  try {
    const s = await getJ('/api/public/stats');
    document.querySelectorAll('[data-stat]').forEach(el => countTo(el, s[el.dataset.stat] || 0));
    const since = $('[data-stat-since]');
    if (since) since.textContent = ' since ' + new Date(s.since * 1000).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    $('#feedDot')?.classList.toggle('on', !!s.live);
  } catch { }
}
stats(); setInterval(stats, 5000);

// ---------------------------------------------------------------- live feed
let lastT = 0;
const list = $('#feedList');
function addLaunch(x, animate) {
  if (!list) return;
  list.querySelector('.feed-empty')?.remove();
  const li = document.createElement('li'); if (animate) li.className = 'in';
  li.innerHTML = `<span class="f-sym">$${esc(x.symbol || '???')}</span><span class="f-name">${esc(x.name)}</span>
    <span class="f-mc">${x.mcapSol ? x.mcapSol.toFixed(1) + ' SOL mcap' : ''}</span><span class="f-dev">${x.devBuySol ? 'dev bought ' + x.devBuySol.toFixed(2) + ' SOL' : 'no dev buy'}</span>
    <time data-t="${x.t}">${UI.ago(x.t)} ago</time>
    <button type="button" class="f-check" data-mint="${esc(x.mint)}">Check</button>`;
  list.prepend(li);
  while (list.children.length > 12) list.lastElementChild.remove();
}
async function feed() {
  try {
    const { launches } = await getJ('/api/public/feed?after=' + lastT);
    const first = !lastT;
    (first ? launches.slice(-12) : launches).forEach(x => addLaunch(x, !first));
    if (launches.length) lastT = launches[launches.length - 1].t;
    list?.querySelectorAll('time[data-t]').forEach(t => t.textContent = UI.ago(+t.dataset.t) + ' ago');
    if (first && !launches.length) list.innerHTML = '<li class="feed-empty">Waiting for the next launch…</li>';
  } catch { }
}
feed(); setInterval(feed, 3000);
list?.addEventListener('click', e => {
  const b = e.target.closest('.f-check'); if (!b) return;
  $('#checkQ').value = b.dataset.mint; $('#check').scrollIntoView({ behavior: 'smooth', block: 'center' });
  runCheck(b.dataset.mint);
});

// ---------------------------------------------------------------- rug check
const out = $('#checkOut'), lunaHost = $('#checkLuna');
const luna = lunaHost ? UI.luna(lunaHost, { size: 150 }) : null;
const STEPS = ['Finding the market', 'Reading buys and sells', 'Measuring liquidity', 'Checking age and socials', 'Scoring momentum', 'Scoring safety'];
let busy = false;
async function runCheck(q) {
  q = (q || '').trim(); if (!q || busy) return;
  busy = true; luna && luna.mood('think', 0);
  const work = getJ('/api/public/check?q=' + encodeURIComponent(q)).then(r => ({ r }), e => ({ e }));
  await UI.scan(out, STEPS);
  const { r, e } = await work;
  busy = false;
  if (e) { out.innerHTML = `<p class="check-err">${esc(e.message)}</p>`; luna && luna.mood('sad'); return; }
  if (r.fresh) {
    out.innerHTML = `<div class="cr"><div class="cr-top"><div><b>$${esc(r.symbol)}</b><small>${esc(r.name)}</small></div><span class="cr-risk r-medium">Too new to score</span></div>
      <p class="cr-note">Launched on pump.fun <b>${r.ageSec}s ago</b> at ${r.mcapSol} SOL market cap. There's no trading data yet. Brand-new coins are the riskiest of all: most fail within the hour.</p>
      ${lockHtml()}</div>`;
    luna && luna.mood('think'); return;
  }
  const a = r.analysis, risk = { low: ['Lower risk', 'r-low'], medium: ['Medium risk', 'r-medium'], high: ['High risk', 'r-high'] }[a.risk];
  const pct = v => `<b class="${v >= 0 ? 'up' : 'down'}">${v >= 0 ? '+' : ''}${(+v).toFixed(1)}%</b>`;
  out.innerHTML = `<div class="cr">
    <div class="cr-top">${r.image ? `<img src="${esc(r.image)}" alt="" onerror="this.remove()">` : ''}<div><b>$${esc(r.symbol)}</b><small>${esc(r.name)} · ${esc(r.dex)}</small></div>
      <span class="cr-risk ${risk[1]}">${risk[0]}</span></div>
    <div class="cr-dials">${UI.dial(a.momentum, 'momentum', 'Momentum', 92)}${UI.dial(a.safety, 'safety', 'Safety', 92)}
      <dl><div><dt>Market cap</dt><dd>${UI.money(a.fdv)}</dd></div><div><dt>Liquidity</dt><dd>${a.onCurve ? 'On curve' : UI.money(a.liq)}</dd></div>
        <div><dt>1h</dt><dd>${pct(a.c1)}</dd></div><div><dt>24h</dt><dd>${pct(a.c24)}</dd></div><div><dt>Buys (1h)</dt><dd>${Math.round(a.buyRatio * 100)}%</dd></div><div><dt>Vol 1h</dt><dd>${UI.money(a.v1)}</dd></div></dl></div>
    <ul class="cr-flags">${a.flags.length ? a.flags.map(f => `<li>${esc(f)}</li>`).join('') : '<li class="ok">No major red flags</li>'}</ul>
    ${lockHtml()}
    <p class="cr-fine">Scores describe trading right now, not a price forecast. Not financial advice.</p></div>`;
  luna && luna.mood(a.risk === 'high' ? 'alarm' : a.risk === 'low' ? 'happy' : 'think');
}
const lockHtml = () => `<button type="button" class="cr-lock" data-go="signup"><span class="cr-blur" aria-hidden="true">████ · ██% · ███████████████</span>
  <span class="cr-lock-txt">🔒 See Luna's call on this coin: <b>create a free account</b></span></button>`;
out?.addEventListener('click', e => { if (e.target.closest('.cr-lock')) document.querySelector('.tab[data-mode=signup]')?.click(), $('#auth').scrollIntoView({ behavior: 'smooth', block: 'center' }); });
$('#checkForm')?.addEventListener('submit', e => { e.preventDefault(); runCheck($('#checkQ').value); });
document.querySelectorAll('[data-try]').forEach(b => b.addEventListener('click', () => { $('#checkQ').value = '$' + b.dataset.try; runCheck(b.dataset.try); }));

// ---------------------------------------------------------------- Luna beside her section
const lc = $('.luna-copy');
if (lc) { const m = UI.luna(lc, { size: 130 }); lc.prepend(m.el); m.el.classList.add('luna-hero'); setInterval(() => m.mood(['happy', 'think', 'talk'][Math.random() * 3 | 0], 1800), 7000); }
})();
