// Lunex account layer for the dashboard. The server injects window.LUNEX_USER into the page.
// - copies the account's saved wallet into the Vault and Luna before their scripts read it
// - adds the account menu to the header (plan, wallet, upgrade, account settings, sign out); everything else lives on /account
(() => {
const U = window.LUNEX_USER;
if (!U) return;

// wallet from the account -> the places the app looks for it (runs before the app's own scripts)
if (U.wallet) {
  try {
    if (JSON.parse(localStorage.getItem('mr_my') || 'null') !== U.wallet) localStorage.setItem('mr_my', JSON.stringify(U.wallet));
    if (localStorage.getItem('luna-wallet') !== U.wallet) localStorage.setItem('luna-wallet', U.wallet);
  } catch { }
}
document.documentElement.dataset.plan = U.plan;

// account sync: watchlists, tracked wallets, alerts, X lists and the practice portfolio follow the account across
// devices. The server's copy is written into localStorage before the app reads it; later changes are pushed back.
// API keys are never synced.
(() => {
  const SYNC = ['mr_wallets', 'mr_trades', 'mr_xaccounts', 'mr_handles', 'mr_xdiscover', 'nv-sound', 'luna-picks', 'lx-practice'];
  const saved = window.LUNEX_SYNC || {}, rawSet = Storage.prototype.setItem, rawRemove = Storage.prototype.removeItem;
  const sent = {}, upNow = {};
  try {
    SYNC.forEach(k => {
      const local = localStorage.getItem(k);
      if (saved[k]) { sent[k] = saved[k].v; if (local !== saved[k].v) rawSet.call(localStorage, k, saved[k].v); }
      else if (local != null) upNow[k] = local;          // first time on this account: keep what this browser had
    });
  } catch { return; }
  let pending = {}, timer = 0;
  const flush = () => {
    clearTimeout(timer); timer = 0;
    const items = pending; pending = {};
    if (!Object.keys(items).length) return;
    fetch('/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }), keepalive: true })
      .then(r => { if (r.ok) Object.assign(sent, items); else throw 0; })
      .catch(() => { pending = { ...items, ...pending }; });
  };
  const queue = (k, v) => { if (sent[k] === v) return; pending[k] = v; clearTimeout(timer); timer = setTimeout(flush, 2000); };
  Storage.prototype.setItem = function (k, v) { rawSet.call(this, k, v); if (this === window.localStorage && SYNC.includes(k)) queue(k, String(v)); };
  Storage.prototype.removeItem = function (k) { rawRemove.call(this, k); if (this === window.localStorage && SYNC.includes(k)) queue(k, null); };
  Object.entries(upNow).forEach(([k, v]) => queue(k, v));
  addEventListener('pagehide', flush);
})();

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const short = w => w ? w.slice(0, 4) + '…' + w.slice(-4) : 'Not set';

window.LunexAccount = {
  user: U,
  isPro: () => U.plan === 'pro',
  upgrade() { location.href = '/pay'; },
  async billing() {
    const r = await fetch('/api/stripe/portal', { method: 'POST' }); const j = await r.json().catch(() => ({}));
    if (j.url) location.href = j.url; else alert(j.error || 'Billing page unavailable right now.');
  },
};
const fmtDate = t => new Date(t * 1000).toLocaleDateString([], { month: 'short', day: 'numeric' });
const now = Date.now() / 1000;

// renewal banner: crypto passes don't auto-renew, so remind people before (and right after) they run out
function banner() {
  if (U.lifetime || U.card || !U.proUntil) return;
  const left = U.proUntil - now;
  let text = '';
  if (left > 0 && left < 2 * 86400) text = `Your Pro pass ends ${left < 86400 ? 'in ' + Math.max(1, Math.round(left / 3600)) + ' hours' : 'tomorrow'}. Renew to keep Luna.`;
  else if (left <= 0 && left > -7 * 86400) text = 'Your Pro pass has ended, so Luna is locked. Renew to unlock her again.';
  if (!text || sessionStorage.getItem('lx-renew-hide') === String(Math.floor(U.proUntil))) return;
  const b = document.createElement('div'); b.className = 'lx-renew';
  b.innerHTML = `<span>${esc(text)}</span><button type="button" class="lx-renew-go">Renew Pro</button><button type="button" class="lx-renew-x" aria-label="Dismiss">✕</button>`;
  b.querySelector('.lx-renew-go').onclick = () => window.LunexAccount.upgrade();
  b.querySelector('.lx-renew-x').onclick = () => { sessionStorage.setItem('lx-renew-hide', String(Math.floor(U.proUntil))); b.remove(); };
  const ab = document.querySelector('#alertBar'); ab ? ab.before(b) : document.body.prepend(b);
}

function mount() {
  const header = document.querySelector('header'); if (!header || header.querySelector('.acct')) return;
  const el = document.createElement('div'); el.className = 'acct';
  el.innerHTML = `
    <button type="button" class="acct-btn" aria-expanded="false" aria-label="Account: ${esc(U.email)}" title="${esc(U.email)}">
      <span class="acct-av">${esc((U.name || U.email)[0].toUpperCase())}</span>
      <span class="acct-plan ${U.plan === 'pro' ? 'is-pro' : ''}">${U.plan === 'pro' ? 'PRO' : 'FREE'}</span>
    </button>
    <div class="acct-menu">
      <div class="acct-who"><b>${esc(U.name)}</b><small>${esc(U.email)}</small></div>
      <div class="acct-row"><span>Plan</span><b class="${U.plan === 'pro' ? 'acct-is-pro' : ''}">${U.plan === 'pro' ? (U.lifetime ? '★ Pro' : U.card ? '★ Pro · card' : '★ Pro until ' + fmtDate(U.proUntil)) : 'Free'}</b></div>
      <div class="acct-row"><span>Wallet</span><b class="acct-wallet">${esc(short(U.wallet))}</b></div>
      ${U.plan !== 'pro' ? '<button type="button" class="acct-item acct-up" data-act="upgrade">★ Unlock Luna with Pro</button>'
        : (!U.lifetime && !U.card ? '<button type="button" class="acct-item acct-up" data-act="upgrade">Extend Pro</button>' : '')}
      <a class="acct-item" href="/account">Account settings</a>
      ${U.card ? '<button type="button" class="acct-item" data-act="billing">Manage billing</button>' : ''}
      <button type="button" class="acct-item" data-act="logout">Sign out</button>
    </div>`;
  const bell = header.querySelector('#notifyBtn');
  bell ? bell.after(el) : header.appendChild(el);
  const btn = el.querySelector('.acct-btn');
  btn.addEventListener('click', e => { e.stopPropagation(); const open = el.classList.toggle('open'); btn.setAttribute('aria-expanded', open); });
  document.addEventListener('click', e => { if (!el.contains(e.target)) { el.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); } });
  el.querySelector('.acct-menu').addEventListener('click', async e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'logout') { await fetch('/api/logout', { method: 'POST' }).catch(() => { }); location.href = '/welcome'; }
    if (act === 'upgrade') { el.classList.remove('open'); window.LunexAccount.upgrade(); }
    if (act === 'billing') window.LunexAccount.billing();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && el.classList.contains('open')) { el.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); btn.focus(); } });
}
const start = () => { mount(); banner(); };
document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', start) : start();
})();
