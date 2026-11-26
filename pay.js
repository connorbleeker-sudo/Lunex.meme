// Lunex checkout page (/pay). The server injects window.LUNEX_USER.
// Two ways to pay, both in USDC or SOL, both verified on-chain by the server before Pro switches on:
//  - Scan to pay: a Solana Pay QR / link that any wallet app understands. The wallet never connects to this site;
//    the server finds the payment by the invoice's reference key (/api/pay/check).
//  - Browser wallet: Phantom, Solflare or Backpack sign a transfer built here, Lunex sends it (/api/pay/confirm).
const U = window.LUNEX_USER;
if (!U) location.href = '/welcome';

const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = t => new Date(t * 1000).toLocaleDateString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const now = () => Date.now() / 1000;

let cfg = null, plan = new URLSearchParams(location.search).get('plan') === 'month' ? 'month' : 'week';
let cur = 'usdc', tab = 'qr', busy = false, finished = false, drawToken = 0;
const invoices = {};          // "plan:currency" -> invoice
const watching = new Map();   // ref -> invoice, every code shown this visit keeps being watched until it expires

async function api(path, body) {
  const r = await fetch(path, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok && !j.status) throw new Error(j.error || j.message || 'Something went wrong. Try again.');
  return j;
}
const status = (t, tone) => { const s = $('#status'); s.innerHTML = t || ''; s.dataset.tone = tone || ''; };
const P = () => cfg.plans.find(p => p.id === plan);
const usd = n => '$' + (n % 1 ? n.toFixed(2) : n);

// ---------------------------------------------------------------- summary
function drawSummary() {
  const W = cfg.plans.find(p => p.id === 'week');
  $('.plans').innerHTML = cfg.plans.map(p => `<button type="button" role="radio" class="plan" data-plan="${p.id}" aria-checked="${p.id === plan}">
    <b>${usd(p.usd)}</b><span>${esc(p.label)}</span>${p.id === 'month' && W ? `<small>save ${Math.round((1 - p.usd / (W.usd * 30 / 7)) * 100)}%</small>` : ''}</button>`).join('');
  $$('.plan').forEach(b => b.onclick = () => { if (busy || plan === b.dataset.plan) return; plan = b.dataset.plan; drawSummary(); refresh(); });
  $('#totalAmt').textContent = usd(P().usd);
  $('#totalSub').textContent = `${P().days} days of Pro · doesn't renew by itself`;
  const active = U.plan === 'pro' && U.proUntil > now();
  $('#who').innerHTML = U.lifetime ? `Signed in as <b>${esc(U.email)}</b>. This account already has Pro with no end date.`
    : `Paying for <b>${esc(U.email)}</b>${active ? `. Your Pro runs until ${esc(fmtDate(U.proUntil))}; this adds ${P().days} days on top.` : '.'}`;
}

// ---------------------------------------------------------------- invoices
async function invoice(force) {
  const key = plan + ':' + cur, have = invoices[key];
  if (have && !force && have.expires - now() > 90) return have;
  const inv = await api('/api/pay/invoice', { plan, currency: cur });
  invoices[key] = inv; watching.set(inv.ref, inv);
  return inv;
}
const amountText = inv => inv.currency === 'usdc' ? `${inv.amount.toFixed(2)} USDC` : `${inv.amount.toFixed(4)} SOL`;

// ---------------------------------------------------------------- QR
let QR = null;
async function qrSvg(text) {
  QR = QR || (await import('https://esm.sh/qrcode@1.5.4')).default;
  return QR.toString(text, { type: 'svg', errorCorrectionLevel: 'Q', margin: 0, color: { dark: '#0b0604', light: '#ffffff' } });
}

async function refresh(force) {
  if (finished) return;
  status('');
  if (tab === 'wallet') { drawWallets(); return; }
  const token = ++drawToken, box = $('#qr');
  box.classList.remove('stale'); box.innerHTML = '<div class="qr-load"></div>';
  $('#qrAmt').textContent = '…'; $('#qrAmtSub').textContent = '';
  try {
    const inv = await invoice(force);
    if (token !== drawToken) return;
    $('#qrAmt').textContent = amountText(inv);
    $('#qrAmtSub').textContent = inv.currency === 'usdc' ? `${usd(inv.usd)} · ${inv.days} days of Pro` : `≈ ${usd(inv.usd)} · SOL price locked for 30 minutes`;
    $('#openWallet').href = inv.payUrl;
    try {
      const svg = await qrSvg(inv.payUrl);
      if (token !== drawToken) return;
      box.innerHTML = svg + '<div class="qr-badge"><span></span></div>';
    } catch {
      box.innerHTML = '<div class="qr-expired">The QR code couldn\'t load. Use Open wallet app or Copy payment link.</div>';
    }
    tick();
  } catch (e) {
    if (token === drawToken) { box.innerHTML = ''; status(esc(e.message), 'bad'); }
  }
}

function current() { return invoices[plan + ':' + cur]; }
function tick() {
  const inv = current(); if (!inv || tab !== 'qr' || finished) return;
  const left = Math.max(0, Math.round(inv.expires - now()));
  $('#timer').textContent = left ? `Code expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : 'Code expired';
  if (!left && !$('#qr').classList.contains('stale')) {
    $('#qr').classList.add('stale');
    $('#qr').insertAdjacentHTML('beforeend', '<div class="qr-expired"><div>This code expired.<br><button type="button" class="btn dark" id="newCode">Get a new code</button></div></div>');
    $('#newCode').onclick = () => refresh(true);
  }
}
setInterval(tick, 1000);

$('#copyLink').onclick = async () => {
  const inv = current(); if (!inv) return;
  try { await navigator.clipboard.writeText(inv.payUrl); $('#copyLink').textContent = 'Copied'; setTimeout(() => $('#copyLink').textContent = 'Copy payment link', 1600); }
  catch { status('Couldn\'t copy. Use Open wallet app instead.', 'bad'); }
};

// watch the chain for any code shown on this visit (people sometimes switch plan after scanning)
let checking = false;
async function watch() {
  if (checking || finished) return;
  checking = true;
  try {
    for (const [ref, inv] of watching) {
      if (now() > inv.expires + 20 * 60) { watching.delete(ref); continue; }
      const r = await api('/api/pay/check', { ref }).catch(() => null);
      if (!r) continue;
      if (r.status === 'ok') { success(r.proUntil); return; }
      if (r.status === 'error') { watching.delete(ref); status(esc(r.message), 'bad'); }
    }
  } finally { checking = false; }
}
setInterval(watch, 4000);

// ---------------------------------------------------------------- browser wallets
const WALLETS = [
  { id: 'phantom', name: 'Phantom', color: '#ab9ff2', url: 'https://phantom.app/download',
    get: () => (window.phantom && window.phantom.solana && window.phantom.solana.isPhantom && window.phantom.solana) || (window.solana && window.solana.isPhantom && window.solana) || null },
  { id: 'solflare', name: 'Solflare', color: '#fc7227', url: 'https://solflare.com/download', get: () => (window.solflare && window.solflare.isSolflare && window.solflare) || null },
  { id: 'backpack', name: 'Backpack', color: '#e33e3f', url: 'https://backpack.app/downloads', get: () => (window.backpack && window.backpack.isBackpack && window.backpack) || null },
];
function drawWallets() {
  const p = P(), any = WALLETS.some(w => w.get());
  $('#wallets').innerHTML = WALLETS.map(w => {
    const on = !!w.get();
    return `<button type="button" class="wallet" data-w="${w.id}" ${on ? '' : 'disabled'}>
      <span class="wl" style="background:${w.color}">${w.name[0]}</span>
      <span><b>${w.name}</b><small>${on ? 'Detected in this browser' : 'Not installed'}</small></span>
      ${on ? `<span class="go">Pay ${cur === 'usdc' ? usd(p.usd) + ' USDC' : 'in SOL'} →</span>` : `<a class="get" href="${w.url}" target="_blank" rel="noopener">Get it</a>`}
    </button>`;
  }).join('') + (any ? '' : '<p class="note">No wallet extension found in this browser. On your phone? Use <b>Scan to pay</b> and tap Open wallet app.</p>');
  $$('.wallet[data-w]').forEach(b => b.onclick = e => { if (!e.target.closest('a')) payWith(WALLETS.find(w => w.id === b.dataset.w)); });
}

let web3 = null, spl = null, Buf = null;
async function payWith(w) {
  if (busy || finished) return;
  const prov = w.get(); if (!prov) return;
  busy = true; document.body.classList.add('busy');
  try {
    status(`Connecting to ${w.name}…`);
    await prov.connect();
    const pk = prov.publicKey; if (!pk) throw new Error(`${w.name} didn't share a wallet address. Try again.`);
    status('Preparing your payment…');
    const inv = await invoice();
    [web3, spl, Buf] = await Promise.all([
      web3 || import('https://esm.sh/@solana/web3.js@1.98.0'),
      spl || (inv.currency === 'usdc' ? import('https://esm.sh/@solana/spl-token@0.4.9') : null),
      Buf || import('https://esm.sh/buffer@6.0.3'),
    ]);
    const W = web3, from = new W.PublicKey(pk.toString()), to = new W.PublicKey(inv.wallet);
    const conn = new W.Connection(location.origin + '/rpc', 'confirmed');
    if (from.equals(to)) throw new Error('That is the Lunex wallet itself. Switch to a different account in your wallet to pay.');

    // balance first: a payment that would fail makes wallets warn that the site is unsafe
    status('Checking your balance…');
    const solBal = await conn.getBalance(from);
    if (inv.currency === 'usdc') {
      const accs = await conn.getParsedTokenAccountsByOwner(from, { mint: new W.PublicKey(inv.usdcMint) });
      const have = accs.value.reduce((s, a) => s + Number(a.account.data.parsed.info.tokenAmount.uiAmount || 0), 0);
      if (have < inv.amount) throw new Error(`This wallet has ${have.toFixed(2)} USDC. You need ${inv.amount.toFixed(2)} USDC, plus about 0.003 SOL for the network fee.`);
      if (solBal < 3e6) throw new Error('You need a little SOL (about 0.003) in this wallet to cover the network fee.');
    } else if (solBal < inv.amountRaw + 5e5) {
      throw new Error(`This wallet has ${(solBal / 1e9).toFixed(4)} SOL. You need ${inv.amount.toFixed(4)} SOL plus a tiny network fee.`);
    }

    const tx = new W.Transaction();
    tx.add(W.ComputeBudgetProgram.setComputeUnitLimit({ units: 120000 }));
    tx.add(W.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 20000 }));
    if (inv.currency === 'usdc') {
      const T = spl, mint = new W.PublicKey(inv.usdcMint);
      const fromAta = T.getAssociatedTokenAddressSync(mint, from), toAta = T.getAssociatedTokenAddressSync(mint, to);
      tx.add(T.createAssociatedTokenAccountIdempotentInstruction(from, toAta, to, mint));
      tx.add(T.createTransferCheckedInstruction(fromAta, mint, toAta, from, BigInt(inv.amountRaw), 6));
    } else {
      tx.add(W.SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports: inv.amountRaw }));
    }
    tx.add(new W.TransactionInstruction({ programId: new W.PublicKey(MEMO_PROGRAM), keys: [], data: Buf.Buffer.from(inv.memo, 'utf8') }));
    tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash; tx.feePayer = from;

    const sim = await conn.simulateTransaction(tx);
    if (sim.value.err) {
      console.warn('Lunex payment simulation failed', sim.value.err, sim.value.logs);
      const logs = (sim.value.logs || []).join(' ') + JSON.stringify(sim.value.err);
      throw new Error(/insufficient/i.test(logs) ? `Not enough ${inv.currency.toUpperCase()} in that wallet (plus a tiny network fee).`
        : 'That payment would fail on the network, so it was not sent. Try again in a minute.');
    }

    status(`Approve <b>${amountText(inv)}</b> in ${w.name}…`);
    const signed = await prov.signTransaction(tx);
    const signature = await conn.sendRawTransaction(signed.serialize(), { preflightCommitment: 'confirmed' });
    status('Payment sent. Confirming on the blockchain…');
    for (let i = 0; i < 45; i++) {
      const r = await api('/api/pay/confirm', { ref: inv.ref, signature });
      if (r.status === 'ok') { success(r.proUntil); return; }
      if (r.status === 'error') throw new Error(r.message);
      await new Promise(res => setTimeout(res, 2000));
    }
    throw new Error('The network is slow to confirm. Your payment is safe: keep this page open or come back in a minute. Transaction ' + signature.slice(0, 10) + '…');
  } catch (e) {
    const m = String((e && e.message) || e);
    status(/reject|cancel|declin|denied/i.test(m) ? 'Payment cancelled in your wallet. Nothing was charged.'
      : /insufficient|0x1\b|debit an account/i.test(m) ? `Not enough ${cur.toUpperCase()} in that wallet (plus a tiny network fee).` : esc(m), 'bad');
  } finally { busy = false; document.body.classList.remove('busy'); }
}

// ---------------------------------------------------------------- done
function success(until) {
  if (finished) return;
  finished = true;
  $('#payFlow').hidden = true; $('#done').hidden = false;
  $('#doneSub').textContent = until ? `Pro is on until ${fmtDate(until)}. Luna is unlocked.` : 'Pro is on. Luna is unlocked.';
}

// ---------------------------------------------------------------- controls
$$('[data-cur]').forEach(b => b.onclick = () => {
  if (busy || cur === b.dataset.cur) return;
  cur = b.dataset.cur; $$('[data-cur]').forEach(x => x.setAttribute('aria-checked', x === b)); refresh();
});
$$('[data-tab]').forEach(b => b.onclick = () => {
  if (busy || tab === b.dataset.tab) return;
  tab = b.dataset.tab;
  $$('[data-tab]').forEach(x => x.setAttribute('aria-selected', x === b));
  $$('[data-panel]').forEach(p => p.hidden = p.dataset.panel !== tab);
  refresh();
});

(async () => {
  try { cfg = await api('/api/pay/config'); }
  catch (e) { status(esc(e.message), 'bad'); return; }
  if (!cfg.crypto) {
    $('#payFlow').innerHTML = '<h2>Payment</h2><p class="status">Payments aren\'t switched on yet. Check back soon.</p>';
    return;
  }
  drawSummary();
  // phones: wallet apps open from the link, so lead with that; desktops without an extension still see the QR
  refresh();
  setTimeout(() => { if (tab === 'wallet') drawWallets(); }, 700);   // extensions can inject late
})();
