// Lunex account settings page (/account). The server injects window.LUNEX_USER; details come from /api/account.
(() => {
const U = window.LUNEX_USER;
if (!U) { location.href = '/welcome'; return; }
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SOL_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const now = () => Date.now() / 1000;
const fmtDay = t => new Date(t * 1000).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
const fmtWhen = t => new Date(t * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const money = n => '$' + (n % 1 ? Number(n).toFixed(2) : n);
const msg = (id, t, tone) => { const m = $(id); m.textContent = t || ''; m.dataset.tone = tone || ''; };

async function api(path, body) {
  const r = await fetch(path, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Something went wrong. Try again.');
  return j;
}
const busy = async (btn, fn) => { btn.disabled = true; try { await fn(); } finally { btn.disabled = false; } };

let D = null;

// ---------------------------------------------------------------- header + profile
function drawMe() {
  const u = D.user;
  $('#av').textContent = (u.name || u.email)[0].toUpperCase();
  $('#meName').textContent = u.name; $('#meEmail').textContent = u.email;
  $('#nameForm [name=name]').value = u.name;
  $('#email').textContent = u.email;
  $('#since').textContent = D.created ? fmtDay(D.created) : '—';
  $('#methods').textContent = [D.hasPassword && 'Email + password', u.google && 'Google'].filter(Boolean).join(' · ') || '—';
  $('#terms').textContent = D.termsAccepted ? fmtWhen(D.termsAccepted) : 'Before sign-up consent existed';
  $('#delEmail').textContent = u.email;
  $('#delSub').textContent = 'Permanently deletes your account, wallet link and any Pro time left.' + (u.card ? ' Your card subscription is cancelled first, so you won\'t be charged again.' : '') + ' This can\'t be undone.';
}

// ---------------------------------------------------------------- plan hero
function drawPlan() {
  const u = D.user, el = $('#plan');
  const month = (D.plans || []).find(p => p.id === 'month'), week = (D.plans || []).find(p => p.id === 'week');
  const perks = `<ul class="perks">
      <li><b>Buy, skip or sell calls</b>on any coin, with a confidence score</li>
      <li><b>Money plans</b>with exact take-profit and stop numbers</li>
      <li><b>Trade for me</b>her best setup in one tap, approved in your wallet</li>
      <li><b>Private</b>Luna runs on your device</li></ul>`;
  if (u.plan !== 'pro') {
    el.className = 'card plan-hero is-free';
    el.innerHTML = `<div class="ph-top"><div><span class="pill free">Free plan</span>
        <h2 id="plan-h">You're watching. <em>Luna can tell you what to do.</em></h2>
        <p class="sub">Free gets you the radar, launches, wallets and alerts. Pro adds Luna: a straight call on any coin and the exact plan, sized to your wallet.</p></div>
      <div class="ph-actions"><a class="btn big" href="/pay?plan=month">Unlock Luna · ${month ? money(month.usd) : '$20'}/month</a></div></div>
      ${perks}
      <p class="ph-fine">${month ? `About ${Math.round(month.usd / month.days * 100)}¢ a day` : ''}${week ? ` · or ${money(week.usd)} for a single week` : ''} · Pay in USDC, SOL or card · Crypto passes never auto-renew · Card plans cancel anytime</p>`;
    return;
  }
  el.className = 'card plan-hero is-pro';
  let status, meter = '', actions = '';
  if (u.lifetime) status = 'Pro with no end date. Luna is unlocked.';
  else if (u.card) { status = 'Pro by card. Renews automatically until you cancel.'; actions = '<button type="button" class="btn" id="manageBilling">Manage billing</button>'; }
  else {
    const left = Math.max(0, u.proUntil - now()), days = Math.ceil(left / 86400);
    const last = (D.payments || []).find(p => p.days), total = (last && last.days) || 30;
    status = `Your pass runs until <b>${esc(fmtWhen(u.proUntil))}</b>. It won't renew by itself.`;
    meter = `<div class="meter"><div class="meter-bar"><i style="width:${Math.min(100, Math.max(3, left / (total * 86400) * 100)).toFixed(1)}%"></i></div>
      <div class="meter-txt"><span>${days} day${days === 1 ? '' : 's'} left</span><span>${total}-day pass</span></div></div>`;
    actions = `<a class="btn" href="/pay?plan=month">Add 30 days${month ? ' · ' + money(month.usd) : ''}</a>`;
  }
  el.innerHTML = `<div class="ph-top"><div><span class="pill pro">★ Pro</span>
      <h2 id="plan-h">Luna is <em>unlocked.</em></h2><p class="sub">${status}</p></div>
    <div class="ph-actions">${actions}<a class="btn ghost" href="/#luna">Open Luna</a></div></div>${meter}${perks}`;
  const mb = $('#manageBilling');
  if (mb) mb.onclick = () => busy(mb, async () => { try { const { url } = await api('/api/stripe/portal', {}); location.href = url; } catch (e) { alert(e.message); } });
}

// ---------------------------------------------------------------- payments
function drawPayments() {
  const P = D.payments || [];
  if (!P.length) { $('#payList').innerHTML = `<div class="empty">No payments yet.${D.user.plan === 'pro' ? '' : ' When you unlock Pro, receipts show up here.'}</div>`; return; }
  const how = m => ({ usdc: 'USDC', sol: 'SOL', card: 'Card' }[m] || m);
  $('#payList').innerHTML = `<table class="pays"><thead><tr><th>Date</th><th>What</th><th>Paid</th><th>Method</th><th>Receipt</th></tr></thead><tbody>${P.map(p => `<tr>
    <td>${esc(fmtDay(p.created))}</td>
    <td>${p.days ? `${p.days}-day Pro pass` : p.method === 'card' ? 'Pro subscription' : 'Pro'}</td>
    <td>${p.usd ? money(p.usd) : '—'}</td><td>${esc(how(p.method))}</td>
    <td>${p.proof && p.method !== 'card' ? `<a href="https://solscan.io/tx/${encodeURIComponent(p.proof)}" target="_blank" rel="noopener">${esc(p.proof.slice(0, 8))}…</a>` : p.method === 'card' ? 'In Stripe' : '—'}</td></tr>`).join('')}</tbody></table>`;
}

// ---------------------------------------------------------------- security
function drawSecurity() {
  $('#curWrap').hidden = !D.hasPassword;
  $('#pwBtn').textContent = D.hasPassword ? 'Change password' : 'Set a password';
  $('#secSub').textContent = D.hasPassword ? 'Change your password or sign out of other devices.'
    : 'You sign in with Google. You can also set a password to sign in with your email.';
  $('#sessions').textContent = D.sessions === 1 ? 'Only this device is signed in' : `${D.sessions} devices or browsers signed in, including this one`;
}

// ---------------------------------------------------------------- this device
const LS = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return localStorage.getItem(k); } };
function drawDevice() {
  $('#sound').checked = localStorage.getItem('nv-sound') !== 'off';
  const n = ('Notification' in window) ? Notification.permission : 'unsupported';
  $('#notifState').textContent = { granted: 'On. Alerts pop up even when the tab is in the background.', denied: 'Blocked in your browser settings. Allow notifications for this site to turn them on.', default: 'Off. Turn on to get alerts when the tab is in the background.', unsupported: "This browser doesn't support them." }[n];
  $('#notifBtn').hidden = n !== 'default';
  const count = k => { const v = LS(k); return Array.isArray(v) ? v.length : v && typeof v === 'object' ? Object.keys(v).length : 0; };
  const keys = ['mr_xkey', 'mr_ppkey'].filter(k => LS(k)).length;
  $('#localStats').innerHTML = [['Tracked wallets', count('mr_wallets')], ['Take-profit / stop alerts', count('mr_trades')], ['X accounts followed', count('mr_xaccounts')], ['Saved API keys', keys]]
    .map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
  $('#clearKeys').hidden = !keys;
}
$('#sound').addEventListener('change', e => { localStorage.setItem('nv-sound', e.target.checked ? 'on' : 'off'); msg('#devMsg', e.target.checked ? 'Sound effects on.' : 'Sound effects off.', 'good'); });
$('#notifBtn').addEventListener('click', async () => { try { await Notification.requestPermission(); } catch { } drawDevice(); });
$('#clearKeys').addEventListener('click', () => {
  if (!confirm('Remove the X and PumpPortal API keys saved in this browser? You can add them again any time.')) return;
  ['mr_xkey', 'mr_ppkey'].forEach(k => localStorage.removeItem(k)); drawDevice(); msg('#devMsg', 'Saved API keys removed from this browser.', 'good');
});
$('#clearLocal').addEventListener('click', () => {
  if (!confirm('Clear all Lunex data in this browser? This removes API keys, sound settings and Luna\'s downloaded model from this device. Watchlists, alerts and your practice portfolio are saved to your account and come back next time you open the dashboard.')) return;
  Object.keys(localStorage).filter(k => /^(mr_|nv-|luna|lx-)/.test(k)).forEach(k => localStorage.removeItem(k));
  try { caches && caches.keys().then(ks => ks.filter(k => /webllm|mlc|tvmjs/i.test(k)).forEach(k => caches.delete(k))); } catch { }
  if (D.user.wallet) { localStorage.setItem('mr_my', JSON.stringify(D.user.wallet)); localStorage.setItem('luna-wallet', D.user.wallet); }
  drawDevice(); msg('#devMsg', 'Lunex data cleared from this browser.', 'good');
});

// ---------------------------------------------------------------- weekly recap email
function drawRecap() {
  $('#recap').checked = !!D.recapOn;
  $('#recapState').textContent = (D.recapOn ? 'On. ' : 'Off. ') + (D.mailReady ? `Sent to ${D.user.email}.` : 'Email sending isn\'t set up on this server yet, so nothing goes out until it is.');
  $('#recapTest').hidden = !D.mailReady;
}
$('#recap').addEventListener('change', async e => {
  try { await api('/api/account/recap', { on: e.target.checked }); D.recapOn = e.target.checked; drawRecap(); msg('#recapMsg', e.target.checked ? 'Weekly recap on.' : 'Weekly recap off.', 'good'); }
  catch (x) { e.target.checked = !e.target.checked; msg('#recapMsg', x.message, 'bad'); }
});
$('#recapTest').addEventListener('click', e => busy(e.currentTarget, async () => {
  try { await api('/api/account/recap-test', {}); msg('#recapMsg', `Test sent to ${D.user.email}.`, 'good'); } catch (x) { msg('#recapMsg', x.message, 'bad'); }
}));

// ---------------------------------------------------------------- wallet
function drawWallet() {
  $('#walletForm [name=wallet]').value = D.user.wallet || '';
  $('#walletRemove').hidden = !D.user.wallet;
}
async function saveWallet(v) {
  await api('/api/wallet', { wallet: v });
  D.user.wallet = v;
  if (v) { localStorage.setItem('mr_my', JSON.stringify(v)); localStorage.setItem('luna-wallet', v); }
  else { localStorage.removeItem('mr_my'); localStorage.removeItem('luna-wallet'); }
  drawWallet();
}
$('#walletForm').addEventListener('submit', e => {
  e.preventDefault();
  const inp = e.target.wallet, v = inp.value.trim();
  if (v.split(/\s+/).length >= 12 || v.length > 60) { inp.value = ''; msg('#walletMsg', 'That looks like a seed phrase or private key. It was cleared and not sent. Only paste your PUBLIC address.', 'bad'); return; }
  if (!SOL_ADDR.test(v)) { msg('#walletMsg', "That isn't a valid Solana wallet address.", 'bad'); return; }
  busy(e.submitter || e.target.querySelector('[type=submit]'), async () => {
    try { await saveWallet(v); msg('#walletMsg', 'Wallet saved.', 'good'); } catch (x) { msg('#walletMsg', x.message, 'bad'); }
  });
});
$('#walletRemove').addEventListener('click', async () => {
  try { await saveWallet(''); msg('#walletMsg', 'Wallet removed from your account.', 'good'); } catch (x) { msg('#walletMsg', x.message, 'bad'); }
});
$('#phantomFill').addEventListener('click', async () => {
  const p = (window.phantom && window.phantom.solana) || (window.solana && window.solana.isPhantom && window.solana);
  if (!p) { msg('#walletMsg', "Phantom isn't installed in this browser. Paste your address instead.", 'bad'); return; }
  try { const r = await p.connect(); $('#walletForm [name=wallet]').value = r.publicKey.toString(); msg('#walletMsg', 'Filled from Phantom. Press Save wallet to keep it.', 'good'); }
  catch { msg('#walletMsg', 'Phantom connection was cancelled.', 'bad'); }
});

// ---------------------------------------------------------------- forms
$('#nameForm').addEventListener('submit', e => {
  e.preventDefault();
  const name = e.target.name.value.trim();
  if (!name) { msg('#nameMsg', 'Enter a name.', 'bad'); return; }
  busy(e.target.querySelector('button'), async () => {
    try { await api('/api/account/profile', { name }); D.user.name = name; drawMe(); msg('#nameMsg', 'Name saved.', 'good'); }
    catch (x) { msg('#nameMsg', x.message, 'bad'); }
  });
});
$('#pwForm').addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target;
  if (f.new.value.length < 8) { msg('#pwMsg', 'Use a new password with at least 8 characters.', 'bad'); return; }
  busy($('#pwBtn'), async () => {
    try {
      await api('/api/account/password', { current: f.current.value, new: f.new.value });
      f.reset(); D.hasPassword = true; D.sessions = 1; drawSecurity();
      msg('#pwMsg', 'Password saved. Other devices were signed out.', 'good');
    } catch (x) { msg('#pwMsg', x.message, 'bad'); }
  });
});
$('#signOutOthers').addEventListener('click', e => busy(e.currentTarget, async () => {
  try { const { removed } = await api('/api/account/signout-others', {}); D.sessions = 1; drawSecurity(); msg('#sessMsg', removed ? `Signed out ${removed} other session${removed === 1 ? '' : 's'}.` : 'No other devices were signed in.', 'good'); }
  catch (x) { msg('#sessMsg', x.message, 'bad'); }
}));
$('#delForm').addEventListener('submit', e => {
  e.preventDefault();
  const v = e.target.confirm.value.trim();
  if (v.toLowerCase() !== D.user.email.toLowerCase()) { msg('#delMsg', 'Type your account email exactly to confirm.', 'bad'); return; }
  busy(e.target.querySelector('button'), async () => {
    try {
      await api('/api/account/delete', { confirm: v });
      Object.keys(localStorage).filter(k => /^(mr_my|luna-wallet)$/.test(k)).forEach(k => localStorage.removeItem(k));
      location.href = '/welcome?deleted=1';
    } catch (x) { msg('#delMsg', x.message, 'bad'); }
  });
});
$('#signOut').addEventListener('click', async () => { await fetch('/api/logout', { method: 'POST' }).catch(() => { }); location.href = '/welcome'; });

// ---------------------------------------------------------------- side nav follows the scroll
const links = $$('.side nav a'), secs = links.map(a => $(a.getAttribute('href'))).filter(Boolean);
const spy = () => {
  let cur = secs[0];
  for (const s of secs) if (s.getBoundingClientRect().top < 140) cur = s;
  if (innerHeight + scrollY >= document.body.scrollHeight - 4) cur = secs[secs.length - 1];
  links.forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#' + cur.id));
};
addEventListener('scroll', spy, { passive: true });

// ---------------------------------------------------------------- go
(async () => {
  try { D = await api('/api/account'); }
  catch (e) { $('main').insertAdjacentHTML('afterbegin', `<p class="msg" data-tone="bad">${esc(e.message)}</p>`); return; }
  drawMe(); drawPlan(); drawPayments(); drawWallet(); drawSecurity(); drawRecap(); drawDevice(); spy();
  if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
})();
})();
