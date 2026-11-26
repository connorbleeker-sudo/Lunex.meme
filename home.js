// Home overview, live parts: real all-time numbers from the server, plus a row of live panels:
// a rug check with Luna, the newest pump.fun launches, the latest community calls and your practice portfolio.
(() => {
const UI = window.LunexUI; if (!UI) return;
const q = s => document.querySelector(s), esc = UI.esc;
const getJ = async u => { const r = await fetch(u); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Something went wrong.'); return j; };
const onHome = () => document.body.dataset.page === 'overview';
const go = p => q(`nav button[data-p="${p}"]`)?.click();

// ---------------------------------------------------------------- numbers
function countTo(el, to) {
  const from = +(el.dataset.v || 0); el.dataset.v = to;
  if (from === to) { el.textContent = to.toLocaleString(); return; }
  const t0 = performance.now(), dur = from ? 700 : 1500;
  const step = now => { const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3); el.textContent = Math.round(from + (to - from) * e).toLocaleString(); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
async function stats() {
  try {
    const s = await getJ('/api/public/stats');
    document.querySelectorAll('[data-stat]').forEach(el => countTo(el, s[el.dataset.stat] || 0));
    const since = q('[data-stat-since]');
    if (since) since.textContent = 'every pump.fun coin since ' + new Date(s.since * 1000).toLocaleDateString([], { month: 'short', day: 'numeric' });
    const dot = q('#ovLiveDot'); if (dot) dot.classList.toggle('on', !!s.live);
  } catch { }
}
stats(); setInterval(() => { if (onHome()) stats(); }, 5000);

// ---------------------------------------------------------------- panels
const host = q('#ovLive');
if (host) host.innerHTML = `
  <article class="ovl ovl-check"><div class="ovl-hd"><h3>Check any coin</h3><small>Free · scored in seconds</small></div>
    <div class="ovl-check-body"><div class="ovl-luna" id="ovlLuna"></div>
      <form id="ovlCheck" autocomplete="off"><input name="q" spellcheck="false" placeholder="Contract address or $TICKER" aria-label="Contract address or ticker" maxlength="60"><button type="submit">Check</button></form></div>
    <div class="ovl-check-out" id="ovlOut" aria-live="polite"><p class="ovl-muted">Paste a coin and Luna runs the six checks.</p></div></article>
  <article class="ovl ovl-feed"><div class="ovl-hd"><h3><span class="ovl-dot" id="ovLiveDot"></span>Just launched</h3><button type="button" class="ovl-link" data-go="pump">All launches →</button></div>
    <ol id="ovlFeed"><li class="ovl-muted">Connecting to pump.fun…</li></ol></article>
  <article class="ovl ovl-calls"><div class="ovl-hd"><h3>Latest calls</h3><button type="button" class="ovl-link" data-go="calls">Open Calls →</button></div>
    <div id="ovlCalls"><p class="ovl-muted">Loading calls…</p></div></article>
  <article class="ovl ovl-practice"><div class="ovl-hd"><h3>Practice portfolio</h3><button type="button" class="ovl-link" data-go="practice">Open Practice →</button></div>
    <div id="ovlPractice"></div></article>`;
host?.addEventListener('click', e => { const b = e.target.closest('[data-go]'); if (b) go(b.dataset.go); });

// rug check with Luna reacting
const luna = q('#ovlLuna') ? UI.luna(q('#ovlLuna'), { size: 96 }) : null;
let busy = false;
q('#ovlCheck')?.addEventListener('submit', async e => {
  e.preventDefault(); const v = e.target.q.value.trim(); if (!v || busy) return;
  busy = true; luna && luna.mood('think', 0);
  const out = q('#ovlOut'), work = getJ('/api/public/check?q=' + encodeURIComponent(v)).then(r => ({ r }), err => ({ err }));
  await UI.scan(out, ['Finding the market', 'Reading buys and sells', 'Measuring liquidity', 'Scoring momentum and safety'], 230);
  const { r, err } = await work; busy = false;
  if (err) { out.innerHTML = `<p class="ovl-err">${esc(err.message)}</p>`; luna && luna.mood('sad'); return; }
  if (r.fresh) { out.innerHTML = `<p class="ovl-muted"><b>$${esc(r.symbol)}</b> launched ${r.ageSec}s ago. Too new to score yet.</p>`; luna && luna.mood('think'); return; }
  const a = r.analysis;
  out.innerHTML = `<div class="ovl-res"><div class="ovl-res-top"><b>$${esc(r.symbol)}</b><span class="ovl-risk r-${a.risk}">${{ low: 'Lower risk', medium: 'Medium risk', high: 'High risk' }[a.risk]}</span></div>
    <div class="ovl-res-dials">${UI.dial(a.momentum, 'momentum', 'Momentum', 70)}${UI.dial(a.safety, 'safety', 'Safety', 70)}
      <ul>${(a.flags.slice(0, 3).map(f => `<li>${esc(f)}</li>`).join('')) || '<li class="ok">No major red flags</li>'}</ul></div>
    <div class="ovl-res-acts"><button type="button" data-lookup="${esc(r.mint)}">Full card</button><button type="button" data-pbuy="${esc(r.mint)}">Practice buy</button><button type="button" data-call="${esc(r.mint)}">Post a call</button></div></div>`;
  luna && luna.mood(a.risk === 'high' ? 'alarm' : a.risk === 'low' ? 'happy' : 'think');
});
q('#ovlOut')?.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.lookup && window.lookupCoin) window.lookupCoin(b.dataset.lookup);
  if (b.dataset.pbuy && window.practiceBuy) window.practiceBuy(b.dataset.pbuy);
  if (b.dataset.call && window.postCall) window.postCall(b.dataset.call);
});

// newest launches from the server's pump.fun listener
let lastT = 0;
async function feed() {
  const ol = q('#ovlFeed'); if (!ol) return;
  try {
    const { launches } = await getJ('/api/public/feed?after=' + lastT);
    if (!lastT) ol.innerHTML = '';
    launches.slice(-8).forEach(x => {
      const li = document.createElement('li'); if (lastT) li.className = 'in';
      li.innerHTML = `<button type="button" data-mint="${esc(x.mint)}"><b>$${esc(x.symbol || '???')}</b><span>${esc(x.name)}</span><time data-t="${x.t}">${UI.ago(x.t)}</time></button>`;
      ol.prepend(li);
    });
    while (ol.children.length > 8) ol.lastElementChild.remove();
    if (launches.length) lastT = launches[launches.length - 1].t;
    if (!ol.children.length) ol.innerHTML = '<li class="ovl-muted">Waiting for the next launch…</li>';
    ol.querySelectorAll('time[data-t]').forEach(t => t.textContent = UI.ago(+t.dataset.t));
  } catch { }
}
q('#ovlFeed')?.addEventListener('click', e => {
  const b = e.target.closest('button[data-mint]'); if (!b) return;
  const f = q('#ovlCheck'); f.q.value = b.dataset.mint; f.requestSubmit();
});
feed(); setInterval(() => { if (onHome()) feed(); }, 3000);

// latest community calls (with how they've done since)
async function calls() {
  const box = q('#ovlCalls'); if (!box) return;
  try {
    const { messages } = await getJ('/api/chat');
    const list = messages.filter(m => m.mint && m.call).slice(-5).reverse();
    if (!list.length) { box.innerHTML = '<p class="ovl-muted">No calls yet. Be the first: open Calls and post a coin you like (or one you\'d avoid).</p>'; return; }
    box.innerHTML = `<ul class="ovl-calls">${list.map(m => `<li><span class="cl-call c-${esc(m.call.toLowerCase())}">${esc(m.call)}</span><b>$${esc(m.sym || '?')}</b><span>${esc(m.name)}</span><em data-mint="${esc(m.mint)}" data-p="${m.price}"></em><time>${UI.ago(m.t)}</time></li>`).join('')}</ul>`;
    window.LunexCalls && window.LunexCalls.fillMoves(box);
  } catch { box.innerHTML = '<p class="ovl-muted">Calls are unavailable right now.</p>'; }
}
calls(); setInterval(() => { if (onHome()) calls(); }, 30000);

// practice summary
function practice() {
  const box = q('#ovlPractice'); if (!box) return;
  const s = window.LunexPractice && window.LunexPractice.summary();
  if (!s || !s.trades) {
    box.innerHTML = `<p class="ovl-muted">Start with <b>10 pretend SOL</b> and trade any coin at live prices. No risk, real lessons.</p><button type="button" class="ovl-cta" data-go="practice">Start practicing</button>`;
    return;
  }
  const ch = (s.equity / s.start - 1) * 100;
  box.innerHTML = `<div class="ovl-pf"><b>${s.equity.toFixed(2)} SOL</b><span class="${ch >= 0 ? 'up' : 'down'}">${ch >= 0 ? '+' : ''}${ch.toFixed(1)}%</span></div>
    <p class="ovl-muted">${s.open} open position${s.open === 1 ? '' : 's'} · ${s.trades} trade${s.trades === 1 ? '' : 's'} · best ${s.best ? '$' + esc(s.best.sym) + ' ' + (s.best.pct >= 0 ? '+' : '') + s.best.pct.toFixed(0) + '%' : '—'}</p>`;
}
setTimeout(practice, 500); setInterval(() => { if (onHome()) practice(); }, 5000);
})();
