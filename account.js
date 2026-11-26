// Lunex account layer for the dashboard. The server injects window.LUNEX_USER into the page.
// - copies the account's saved wallet into the Vault and Luna before their scripts read it
// - adds the account menu to the header (plan, wallet, upgrade, sign out)
(() => {
const U = window.LUNEX_USER;
if (!U) return;
const SOL_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// wallet from the account -> the places the app looks for it (runs before the app's own scripts)
if (U.wallet) {
  try {
    if (JSON.parse(localStorage.getItem('mr_my') || 'null') !== U.wallet) localStorage.setItem('mr_my', JSON.stringify(U.wallet));
    if (localStorage.getItem('luna-wallet') !== U.wallet) localStorage.setItem('luna-wallet', U.wallet);
  } catch { }
}
document.documentElement.dataset.plan = U.plan;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const short = w => w ? w.slice(0, 4) + '…' + w.slice(-4) : 'Not set';

window.LunexAccount = {
  user: U,
  isPro: () => U.plan === 'pro',
  upgrade() { window.LunexCheckout ? window.LunexCheckout.open() : alert('Checkout is still loading. Try again in a second.'); },
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
    <button type="button" class="acct-btn" aria-haspopup="true" aria-expanded="false" title="${esc(U.email)}">
      <span class="acct-av">${esc((U.name || U.email)[0].toUpperCase())}</span>
      <span class="acct-plan ${U.plan === 'pro' ? 'is-pro' : ''}">${U.plan === 'pro' ? 'PRO' : 'FREE'}</span>
    </button>
    <div class="acct-menu" role="menu">
      <div class="acct-who"><b>${esc(U.name)}</b><small>${esc(U.email)}</small></div>
      <div class="acct-row"><span>Plan</span><b>${U.plan === 'pro' ? (U.lifetime ? 'Pro' : U.card ? 'Pro · card' : 'Pro until ' + fmtDate(U.proUntil)) : 'Free'}</b></div>
      <div class="acct-row"><span>Wallet</span><b class="acct-wallet">${esc(short(U.wallet))}</b></div>
      <form class="acct-wform" hidden><input placeholder="New public wallet address" spellcheck="false"><button type="submit">Save</button><p class="acct-err"></p></form>
      <button type="button" class="acct-item" data-act="wallet">${U.wallet ? 'Change wallet' : 'Add wallet'}</button>
      ${U.plan !== 'pro' ? '<button type="button" class="acct-item acct-up" data-act="upgrade">Upgrade to Pro: unlock Luna</button>'
        : (!U.lifetime && !U.card ? '<button type="button" class="acct-item acct-up" data-act="upgrade">Extend Pro</button>' : '')}
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
    if (act === 'wallet') { const f = el.querySelector('.acct-wform'); f.hidden = !f.hidden; if (!f.hidden) f.querySelector('input').focus(); }
  });
  el.querySelector('.acct-wform').addEventListener('submit', async e => {
    e.preventDefault();
    const v = e.target.querySelector('input').value.trim(), err = e.target.querySelector('.acct-err');
    if (v.split(/\s+/).length >= 12 || v.length > 60) { e.target.querySelector('input').value = ''; err.textContent = 'That looks like a seed phrase or private key. Cleared, not sent.'; return; }
    if (!SOL_ADDR.test(v)) { err.textContent = "That isn't a valid Solana address."; return; }
    const r = await fetch('/api/wallet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wallet: v }) });
    if (!r.ok) { err.textContent = 'Could not save. Try again.'; return; }
    localStorage.setItem('mr_my', JSON.stringify(v)); localStorage.setItem('luna-wallet', v);
    location.reload();
  });
}
const start = () => { mount(); banner(); };
document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', start) : start();
})();
