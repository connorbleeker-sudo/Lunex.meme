// Community Calls: traders post coins with a call (BUY / WATCH / SELL / AVOID). The server stamps each call with the
// coin's price at that moment, so everyone can see how it played out. Links aren't clickable (anti-phishing),
// messages can be reported (3 reports hide one), and you can delete your own.
(() => {
const UI = window.LunexUI, U = window.LUNEX_USER, root = document.querySelector('#callsApp');
if (!UI || !root || !U) return;
const q = s => root.querySelector(s), esc = UI.esc, DEX = 'https://api.dexscreener.com';
const livelier = window.livelier || ((a, b) => { const act = p => (p.volume?.h1 || 0) * 24 + (p.volume?.h24 || 0) + ((p.txns?.h24?.buys || 0) + (p.txns?.h24?.sells || 0)) * 5; const x = act(a), y = act(b); return x !== y ? x > y : (a.liquidity?.usd || 0) > (b.liquidity?.usd || 0); });   // pick the pool the coin is actually trading in
const CALLS = [['BUY', 'I\'d buy this'], ['WATCH', 'On my radar'], ['SELL', 'Taking profit / out'], ['AVOID', 'Stay away']];
const api = async (path, body) => {
  const r = await fetch(path, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Something went wrong.'); return j;
};

// ---------------------------------------------------------------- live prices for "since the call"
const px = {}; let pxAt = 0;
async function loadPrices(mints) {
  const need = [...new Set(mints)].filter(m => m && !(px[m] && Date.now() - px[m].t < 60000));
  for (let i = 0; i < need.length; i += 30) {
    try {
      const pairs = await (await fetch(`${DEX}/tokens/v1/solana/${need.slice(i, i + 30).join(',')}`)).json();
      const best = {};
      pairs.forEach(p => { const k = p.baseToken.address; if (!best[k] || livelier(p, best[k])) best[k] = p; });
      Object.entries(best).forEach(([k, p]) => px[k] = { usd: +p.priceUsd, img: p.info?.imageUrl || '', t: Date.now() });
    } catch { }
  }
}
async function fillMoves(scope) {
  const ems = [...scope.querySelectorAll('em[data-mint][data-p]')];
  await loadPrices(ems.map(e => e.dataset.mint));
  ems.forEach(e => {
    const now = px[e.dataset.mint]?.usd, was = +e.dataset.p;
    if (!now || !was) { e.textContent = ''; return; }
    const c = (now / was - 1) * 100;
    e.className = c >= 0 ? 'up' : 'down'; e.textContent = `${c >= 0 ? '+' : ''}${c.toFixed(c > -10 && c < 10 ? 1 : 0)}% since`;
  });
}
window.LunexCalls = { fillMoves };

// ---------------------------------------------------------------- layout
root.innerHTML = `
  <div class="cl-wrap">
    <section class="cl-main" aria-label="Community calls">
      <div class="cl-stream" id="clStream" aria-live="polite"><p class="cl-muted">Loading calls…</p></div>
      <form class="cl-compose" id="clForm" autocomplete="off">
        <div class="cl-attach" id="clAttach" hidden></div>
        <div class="cl-calls" role="radiogroup" aria-label="Your call"><span class="cl-calls-lbl" aria-hidden="true">Your call</span>${CALLS.map(([c, d]) => `<button type="button" role="radio" aria-checked="false" data-c="${c}" title="${d}" class="c-${c.toLowerCase()}">${c}<span>${d}</span></button>`).join('')}</div>
        <div class="cl-row">
          <input id="clCoin" spellcheck="false" placeholder="Coin address (optional)" aria-label="Coin contract address" maxlength="44">
          <input id="clText" placeholder="Why? Keep it short and useful…" aria-label="Message" maxlength="280">
          <button type="submit" class="cl-send">Post</button>
        </div>
        <p class="cl-err" id="clErr" role="alert"></p>
      </form>
    </section>
    <aside class="cl-side">
      <div class="cl-card"><h3>Best calls this week</h3><div id="clTop"><p class="cl-muted">Waiting for calls with coins…</p></div></div>
      <div class="cl-card"><h3>House rules</h3><ul class="cl-rules">
        <li>Post coins with a reason. Calls are opinions, <b>not financial advice</b>.</li>
        <li>No paid shilling, scams or impersonation. Links aren't clickable here.</li>
        <li><b>Never share a seed phrase or private key.</b> Anyone asking is a scammer.</li>
        <li>Report anything shady. Three reports hide a message.</li></ul></div>
    </aside>
  </div>`;

let lastId = 0, call = '', unseen = 0, msgs = [];
const stream = q('#clStream');
function msgHtml(m) {
  const coin = m.mint ? `<div class="cl-coin">
      ${UI.coinImg ? UI.coinImg(m.mint, px[m.mint]?.img) : px[m.mint]?.img ? `<img src="${esc(px[m.mint].img)}" alt="" onerror="this.remove()">` : ''}
      ${m.call ? `<span class="cl-call c-${esc(m.call.toLowerCase())}">${esc(m.call)}</span>` : ''}<b>$${esc(m.sym || '?')}</b>
      <small>${m.fdv ? UI.money(m.fdv) + ' mcap at call' : ''}</small><em data-mint="${esc(m.mint)}" data-p="${m.price || 0}"></em>
      <span class="cl-coin-acts"><button type="button" data-look="${esc(m.mint)}">Card</button><button type="button" data-pbuy="${esc(m.mint)}">Practice</button></span></div>` : '';
  return `<article class="cl-msg${m.mine ? ' mine' : ''}" data-id="${m.id}">
    <span class="cl-av" aria-hidden="true">${esc((m.name || '?')[0].toUpperCase())}</span>
    <div class="cl-body"><div class="cl-hd"><b>${esc(m.name)}</b>${m.pro ? '<span class="cl-pro">PRO</span>' : ''}<time>${UI.ago(m.t)} ago</time>
      ${m.mine ? `<button type="button" class="cl-x" data-del="${m.id}">Delete</button>` : `<button type="button" class="cl-x" data-rep="${m.id}">Report</button>`}</div>
      ${m.text ? `<p>${esc(m.text)}</p>` : ''}${coin}</div></article>`;
}
async function poll() {
  try {
    const { messages, hidden } = await api('/api/chat' + (lastId ? '?after=' + lastId : ''));
    (hidden || []).forEach(id => { stream.querySelector(`[data-id="${id}"]`)?.remove(); msgs = msgs.filter(m => m.id !== id); });
    if (!lastId) stream.innerHTML = messages.length ? '' : '<p class="cl-muted cl-empty">No calls yet. Post the first one: attach a coin, pick your call, say why.</p>';
    if (messages.length) {
      stream.querySelector('.cl-empty')?.remove();
      await loadPrices(messages.filter(m => m.mint).map(m => m.mint));
      const atBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 80;
      messages.forEach(m => { stream.insertAdjacentHTML('beforeend', msgHtml(m)); msgs.push(m); });
      const fresh = lastId; lastId = messages[messages.length - 1].id;
      if (fresh && document.body.dataset.page !== 'calls') { unseen += messages.filter(m => !m.mine).length; badge(); }
      if (atBottom || !fresh) stream.scrollTop = stream.scrollHeight;
      fillMoves(stream); drawTop();
    }
  } catch { if (!lastId) stream.innerHTML = '<p class="cl-muted">Calls are unavailable right now.</p>'; }
}
function badge() { const b = document.querySelector('#callsCount'); if (b) { b.textContent = unseen; b.style.display = unseen ? '' : 'none'; } }
document.querySelector('nav button[data-p="calls"]')?.addEventListener('click', () => { unseen = 0; badge(); setTimeout(() => stream.scrollTop = stream.scrollHeight, 50); });

async function drawTop() {
  const week = Date.now() / 1000 - 7 * 86400, best = {};
  msgs.filter(m => m.mint && m.price && m.t > week && (m.call === 'BUY' || m.call === 'WATCH')).forEach(m => { if (!best[m.mint] || m.t < best[m.mint].t) best[m.mint] = m; });   // earliest caller gets the credit
  const list = Object.values(best); await loadPrices(list.map(m => m.mint));
  const ranked = list.map(m => ({ m, c: px[m.mint]?.usd ? (px[m.mint].usd / m.price - 1) * 100 : null })).filter(x => x.c != null).sort((a, b) => b.c - a.c).slice(0, 5);
  q('#clTop').innerHTML = ranked.length ? `<ol class="cl-top">${ranked.map(({ m, c }) => `<li><b>$${esc(m.sym)}</b><span>${esc(m.name)}</span><em class="${c >= 0 ? 'up' : 'down'}">${c >= 0 ? '+' : ''}${c.toFixed(0)}%</em></li>`).join('')}</ol>
    <p class="cl-muted cl-small">Since the first BUY or WATCH call this week. Past moves don't predict future ones.</p>` : '<p class="cl-muted">Waiting for calls with coins…</p>';
}

// ---------------------------------------------------------------- composing
const coinIn = q('#clCoin'), att = q('#clAttach');
async function attach(mint) {
  coinIn.value = mint; att.hidden = false; att.innerHTML = '<span class="cl-muted">Looking up the coin…</span>';
  try {
    const r = await api('/api/public/check?q=' + encodeURIComponent(mint));
    if (r.fresh) { att.innerHTML = `<b>$${esc(r.symbol)}</b><span class="cl-muted">brand new, no price yet</span>`; return; }
    att.innerHTML = `${r.image ? `<img src="${esc(r.image)}" alt="" onerror="this.remove()">` : ''}<b>$${esc(r.symbol)}</b>${UI.dial(r.analysis.momentum, 'momentum', 'Mom', 46)}${UI.dial(r.analysis.safety, 'safety', 'Safe', 46)}<span class="cl-muted">${UI.money(r.analysis.fdv)} mcap</span><button type="button" class="cl-x" id="clDetach">Remove</button>`;
  } catch (e) { att.innerHTML = `<span class="cl-err">${esc(e.message)}</span>`; }
}
coinIn.addEventListener('change', () => { const v = coinIn.value.trim(); if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v)) attach(v); else if (!v) att.hidden = true; });
root.addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.c) { call = call === b.dataset.c ? '' : b.dataset.c; root.querySelectorAll('[data-c]').forEach(x => x.setAttribute('aria-checked', x.dataset.c === call)); }
  if (b.id === 'clDetach') { coinIn.value = ''; att.hidden = true; }
  if (b.dataset.look && window.lookupCoin) window.lookupCoin(b.dataset.look);
  if (b.dataset.pbuy && window.practiceBuy) window.practiceBuy(b.dataset.pbuy);
  if (b.dataset.del && confirm('Delete your message?')) { await api('/api/chat/delete', { id: +b.dataset.del }).catch(() => { }); b.closest('.cl-msg')?.remove(); msgs = msgs.filter(m => m.id !== +b.dataset.del); }
  if (b.dataset.rep && confirm('Report this message as spam, a scam or abuse?')) { await api('/api/chat/report', { id: +b.dataset.rep }).catch(() => { }); b.textContent = 'Reported'; b.disabled = true; }
});
q('#clForm').addEventListener('submit', async e => {
  e.preventDefault();
  const text = q('#clText').value.trim(), mint = coinIn.value.trim(), err = q('#clErr'), btn = q('.cl-send');
  if (mint && !call) { err.textContent = 'Pick your call: BUY, WATCH, SELL or AVOID.'; return; }
  if (!text && !mint) { err.textContent = 'Write something or attach a coin.'; return; }
  err.textContent = ''; btn.disabled = true;
  try {
    await api('/api/chat', { text, mint, call });
    q('#clText').value = ''; coinIn.value = ''; att.hidden = true; call = ''; root.querySelectorAll('[data-c]').forEach(x => x.setAttribute('aria-checked', 'false'));
    await poll(); stream.scrollTop = stream.scrollHeight;
  } catch (x) { err.textContent = x.message; } finally { btn.disabled = false; }
});

window.postCall = mint => {
  document.querySelector('nav button[data-p="calls"]')?.click();
  attach(mint); setTimeout(() => q('#clText').focus(), 100);
};

poll(); setInterval(poll, 4000);
setInterval(() => { stream.querySelectorAll('.cl-msg time').forEach((t, i) => { const m = msgs[i]; if (m) t.textContent = UI.ago(m.t) + ' ago'; }); if (document.body.dataset.page === 'calls') fillMoves(stream); }, 30000);
})();
