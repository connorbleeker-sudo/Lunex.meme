// Lunex welcome page: sign in / create account (email or Google), then ask for the wallet address.
(() => {
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const SOL_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
let mode = 'signin', me = null;

async function api(path, body) {
  const r = await fetch(path, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Something went wrong. Try again.');
  return j;
}

// ---------------------------------------------------------------- panes
function show(pane) {
  $$('.pane').forEach(p => p.hidden = p.dataset.pane !== pane);
  if (pane === 'wallet') setTimeout(() => $('#walletForm input').focus(), 50);
}
function setMode(m) {
  mode = m;
  $$('.tab').forEach(t => t.classList.toggle('on', t.dataset.mode === m));
  $$('.only-signup').forEach(el => el.hidden = m !== 'signup');
  $('#submitBtn').textContent = m === 'signup' ? 'Create account' : 'Sign in';
  $('#emailForm [name=password]').autocomplete = m === 'signup' ? 'new-password' : 'current-password';
  $('#err').textContent = '';
}
$$('.tab').forEach(t => t.addEventListener('click', () => setMode(t.dataset.mode)));
$$('[data-go]').forEach(b => b.addEventListener('click', () => {
  if (me) { location.href = '/'; return; }
  show('signin'); setMode(b.dataset.go); $('#auth').scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => $('#emailForm [name=email]').focus(), 300);
}));

// after any successful sign-in: wallet step if we don't have one yet, otherwise straight in
function signedIn(user) {
  me = user;
  if (!user.wallet) show('wallet'); else location.href = '/';
}

// ---------------------------------------------------------------- email
$('#emailForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, btn = $('#submitBtn'), err = $('#err');
  const email = f.email.value.trim(), password = f.password.value, name = f.name.value.trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) { err.textContent = 'Enter a valid email address.'; return; }
  if (password.length < 8) { err.textContent = 'Use a password with at least 8 characters.'; return; }
  btn.disabled = true; err.textContent = '';
  try { const { user } = await api(mode === 'signup' ? '/api/signup' : '/api/login', { email, password, name }); signedIn(user); }
  catch (x) { err.textContent = x.message; if (/already an account/.test(x.message)) setMode('signin'); }
  finally { btn.disabled = false; }
});

// ---------------------------------------------------------------- Google
async function setupGoogle() {
  let cid = '';
  try { cid = (await api('/api/config')).googleClientId; } catch { }
  if (!cid) { $('#gfallback').hidden = false; $('#gfallback').disabled = true; $('#gnote').hidden = false; return; }
  const ready = () => window.google && google.accounts && google.accounts.id;
  for (let i = 0; i < 50 && !ready(); i++) await new Promise(r => setTimeout(r, 100));
  if (!ready()) { $('#gfallback').hidden = false; $('#gfallback').disabled = true; $('#gnote').hidden = false; $('#gnote').textContent = "Google sign-in couldn't load. Check your connection or use email."; return; }
  google.accounts.id.initialize({
    client_id: cid,
    callback: async res => {
      $('#err').textContent = '';
      try { const { user } = await api('/api/google', { credential: res.credential }); signedIn(user); }
      catch (x) { $('#err').textContent = x.message; }
    },
  });
  google.accounts.id.renderButton($('#gbtn'), { theme: 'filled_black', size: 'large', shape: 'pill', text: 'continue_with', width: 360 });
}

// ---------------------------------------------------------------- wallet step
const phantom = () => (window.phantom && window.phantom.solana) || (window.solana && window.solana.isPhantom && window.solana) || null;
$('#phantomBtn').addEventListener('click', async () => {
  const p = phantom(), werr = $('#werr');
  if (!p) { werr.textContent = "Phantom isn't installed in this browser. Paste your address instead."; return; }
  try { const r = await p.connect(); $('#walletForm [name=wallet]').value = r.publicKey.toString(); werr.textContent = ''; }
  catch { werr.textContent = 'Phantom connection was cancelled. You can paste your address instead.'; }
});
$('#walletForm').addEventListener('submit', async e => {
  e.preventDefault();
  const v = e.target.wallet.value.trim(), werr = $('#werr');
  if (v.split(/\s+/).length >= 12 || v.length > 60) { e.target.wallet.value = ''; werr.textContent = "That looks like a seed phrase or private key. It was cleared and not sent. Only paste your PUBLIC address."; return; }
  if (!SOL_ADDR.test(v)) { werr.textContent = "That isn't a valid Solana wallet address."; return; }
  try { await api('/api/wallet', { wallet: v }); location.href = '/'; } catch (x) { werr.textContent = x.message; }
});
$('#skipWallet').addEventListener('click', () => { location.href = '/'; });

// ---------------------------------------------------------------- signed in already?
$('#signOut').addEventListener('click', async () => { await api('/api/logout', {}).catch(() => { }); me = null; $('#topAction').textContent = 'Sign in'; show('signin'); });
(async () => {
  setMode(new URLSearchParams(location.search).get('mode') === 'signup' ? 'signup' : 'signin');
  try {
    const { user } = await api('/api/me');
    if (user) {
      me = user; $('#topAction').textContent = 'Open dashboard';
      $('#hiName').textContent = user.name ? ', ' + user.name : '';
      $('#doneSub').textContent = `Signed in as ${user.email} · ${user.plan === 'pro' ? 'Pro' : 'Free'} plan.`;
      show(user.wallet ? 'done' : 'wallet');
    }
  } catch { }
  setupGoogle();
})();
$('#topAction').addEventListener('click', () => { if (me) location.href = '/'; });
// show the live Pro price (set on the server)
api('/api/pay/config').then(c => {
  const w = (c.plans || []).find(p => p.id === 'week'); const el = document.querySelector('.plan.pro .price');
  if (w && el) el.innerHTML = `$${w.usd % 1 ? w.usd.toFixed(2) : w.usd}<span>/week</span>`;
}).catch(() => { });
})();
