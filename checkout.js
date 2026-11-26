// Lunex checkout: the "Upgrade to Pro" window.
// Crypto: builds a USDC or SOL transfer to the Lunex wallet with a one-time reference memo; Phantom shows it and
// the user approves it there. The server then checks that exact transaction on-chain before switching Pro on.
// Card: hands off to Stripe Checkout (subscription), and back.
(() => {
const U = window.LUNEX_USER; if (!U) return;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
let cfg = null, plan = 'week', busy = false, solPx = 0;

const api = async (path, body) => {
  const r = await fetch(path, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok && !j.status) throw new Error(j.error || j.message || 'Something went wrong.');
  return j;
};
const phantom = () => (window.phantom && window.phantom.solana) || (window.solana && window.solana.isPhantom && window.solana) || null;
const fmtDate = t => new Date(t * 1000).toLocaleDateString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

// ---------------------------------------------------------------- window
const el = document.createElement('div'); el.id = 'lx-pay'; el.hidden = true;
el.innerHTML = `<div class="lxp-card" role="dialog" aria-modal="true" aria-labelledby="lxp-h">
  <button type="button" class="lxp-x" aria-label="Close">✕</button>
  <h2 id="lxp-h">Unlock <em>Luna.</em></h2>
  <p class="lxp-sub">Buy, skip and sell calls on any coin, money plans sized to your wallet, and Trade for me.</p>
  <div class="lxp-plans" role="radiogroup"></div>
  <div class="lxp-pay"></div>
  <p class="lxp-status" role="status"></p>
  <p class="lxp-fine">Crypto payments go straight to the Lunex wallet and are checked on the Solana blockchain. Lunex never sees your keys. Signals, not financial advice.</p>
</div>`;
document.addEventListener('DOMContentLoaded', () => document.body.appendChild(el));
if (document.body) document.body.appendChild(el);
const $ = s => el.querySelector(s);
const status = (t, tone) => { const s = $('.lxp-status'); s.innerHTML = t || ''; s.dataset.tone = tone || ''; };
el.addEventListener('click', e => { if (e.target === el || e.target.closest('.lxp-x')) close(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !el.hidden && !busy) close(); });
function close() { if (busy) return; el.hidden = true; status(''); }

function draw() {
  const P = cfg.plans;
  $('.lxp-plans').innerHTML = P.map(p => `<button type="button" role="radio" aria-checked="${p.id === plan}" class="lxp-plan${p.id === plan ? ' on' : ''}" data-plan="${p.id}">
    <b>$${p.usd % 1 ? p.usd.toFixed(2) : p.usd}</b><span>${esc(p.label)}</span>${p.id === 'month' ? `<small>save ${Math.round((1 - p.usd / (P[0].usd * 30 / 7)) * 100)}%</small>` : ''}</button>`).join('');
  const p = P.find(x => x.id === plan), sol = solPx ? (p.usd / solPx) : 0;
  const card = cfg.card && cfg.cardPlans.includes(plan);
  $('.lxp-pay').innerHTML = (cfg.crypto ? `
      <button type="button" class="lxp-btn primary" data-pay="usdc"><span class="lxp-ph"></span>Pay $${p.usd} in USDC</button>
      <button type="button" class="lxp-btn" data-pay="sol"><span class="lxp-ph"></span>Pay in SOL${sol ? ` (≈${sol.toFixed(3)} SOL)` : ''}</button>` : '')
    + (card ? `<button type="button" class="lxp-btn${cfg.crypto ? '' : ' primary'}" data-pay="card">Pay with card${plan === 'week' ? ' · renews weekly' : ' · renews monthly'}</button>` : '')
    + (!cfg.crypto && !card ? '<p class="lxp-none">Payments aren\'t switched on yet. Check back soon.</p>' : '');
  $('.lxp-plans').querySelectorAll('[data-plan]').forEach(b => b.onclick = () => { if (!busy) { plan = b.dataset.plan; draw(); } });
  $('.lxp-pay').querySelectorAll('[data-pay]').forEach(b => b.onclick = () => pay(b.dataset.pay));
}

async function open() {
  el.hidden = false; status('Loading…');
  try {
    cfg = await api('/api/pay/config');
    status(U.plan === 'pro' && U.proUntil ? `Your Pro pass runs until <b>${fmtDate(U.proUntil)}</b>. Paying now adds time on top.` : '');
    draw();
    fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd').then(r => r.json()).then(j => { solPx = j.solana.usd; if (!el.hidden) draw(); }).catch(() => { });
  } catch (e) { status(esc(e.message), 'bad'); }
}

// ---------------------------------------------------------------- paying
async function pay(method) {
  if (busy) return;
  if (method === 'card') {
    busy = true; status('Opening secure card checkout…');
    try { const { url } = await api('/api/stripe/checkout', { plan }); location.href = url; }
    catch (e) { busy = false; status(esc(e.message), 'bad'); }
    return;
  }
  const prov = phantom();
  if (!prov) { status('Phantom isn\'t installed in this browser. Get it at <a href="https://phantom.app" target="_blank" rel="noopener">phantom.app</a>, or pay by card.', 'bad'); return; }
  busy = true; el.classList.add('busy');
  try {
    status('Connecting to Phantom…');
    await prov.connect();
    const payer = prov.publicKey;
    status('Preparing your payment…');
    const inv = await api('/api/pay/invoice', { plan, currency: method });
    const [W, T, B] = await Promise.all([
      import('https://esm.sh/@solana/web3.js@1.98.0'),
      method === 'usdc' ? import('https://esm.sh/@solana/spl-token@0.4.9') : null,
      import('https://esm.sh/buffer@6.0.3'),
    ]);
    const from = new W.PublicKey(payer.toString()), to = new W.PublicKey(inv.wallet);
    const conn = new W.Connection(location.origin + '/rpc', 'confirmed');
    if (from.equals(to)) throw new Error('This is the Lunex wallet itself. Switch to a different Phantom account to pay.');
    // check the balance first: a payment that would fail makes Phantom flag the site as malicious
    status('Checking your balance…');
    const solBal = await conn.getBalance(from);
    if (method === 'usdc') {
      const accs = await conn.getParsedTokenAccountsByOwner(from, { mint: new W.PublicKey(inv.usdcMint) });
      const usdc = accs.value.reduce((s, a) => s + Number(a.account.data.parsed.info.tokenAmount.uiAmount || 0), 0);
      if (usdc < inv.amount) throw new Error(`This wallet has ${usdc.toFixed(2)} USDC. You need $${inv.amount} USDC, plus about 0.003 SOL for network fees.`);
      if (solBal < 3e6) throw new Error('You need a little SOL (about 0.003) in this wallet to cover the network fee.');
    } else if (solBal < inv.amountRaw + 5e5) {
      throw new Error(`This wallet has ${(solBal / 1e9).toFixed(4)} SOL. You need ${inv.amount.toFixed(4)} SOL plus a tiny network fee.`);
    }
    const tx = new W.Transaction();
    // explicit compute limit and fee, as Phantom's transaction guidelines ask
    tx.add(W.ComputeBudgetProgram.setComputeUnitLimit({ units: 120000 }));
    tx.add(W.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 20000 }));
    if (method === 'usdc') {
      const mint = new W.PublicKey(inv.usdcMint);
      const fromAta = T.getAssociatedTokenAddressSync(mint, from), toAta = T.getAssociatedTokenAddressSync(mint, to);
      tx.add(T.createAssociatedTokenAccountIdempotentInstruction(from, toAta, to, mint));
      tx.add(T.createTransferCheckedInstruction(fromAta, mint, toAta, from, BigInt(inv.amountRaw), 6));
    } else {
      tx.add(W.SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports: inv.amountRaw }));
    }
    tx.add(new W.TransactionInstruction({ programId: new W.PublicKey(MEMO_PROGRAM), keys: [], data: B.Buffer.from(inv.memo, 'utf8') }));
    tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash; tx.feePayer = from;
    // dry-run it before Phantom sees it, so a payment that can't go through never reaches the wallet
    const sim = await conn.simulateTransaction(tx);
    if (sim.value.err) {
      console.warn('Lunex payment simulation failed', sim.value.err, sim.value.logs);
      const logs = (sim.value.logs || []).join(' ');
      throw new Error(/insufficient/i.test(logs) || JSON.stringify(sim.value.err).includes('InsufficientFunds')
        ? `Not enough ${method.toUpperCase()} in that wallet (plus a tiny network fee).`
        : 'That payment would fail on the network, so it was not sent. Try again in a minute.');
    }
    status(`Approve <b>${inv.currency === 'usdc' ? '$' + inv.amount + ' USDC' : inv.amount.toFixed(4) + ' SOL'}</b> in Phantom…`);
    // Phantom signs, Lunex sends it through its own node (Phantom's recommended flow)
    const signed = await prov.signTransaction(tx);
    const signature = await conn.sendRawTransaction(signed.serialize(), { preflightCommitment: 'confirmed' });
    status('Payment sent. Confirming on the blockchain…');
    for (let i = 0; i < 45; i++) {
      const r = await api('/api/pay/confirm', { ref: inv.ref, signature });
      if (r.status === 'ok') { status(`<b>You're Pro until ${fmtDate(r.proUntil)}.</b> Unlocking Luna…`, 'good'); setTimeout(() => location.reload(), 1600); return; }
      if (r.status === 'error') throw new Error(r.message);
      await new Promise(res => setTimeout(res, 2000));
    }
    throw new Error('The network is slow to confirm. Your payment is safe: reopen this window in a minute, or contact support with transaction ' + signature.slice(0, 10) + '…');
  } catch (e) {
    const m = String(e && e.message || e);
    status(/reject|cancel|declin/i.test(m) ? 'Payment cancelled in Phantom. Nothing was charged.'
      : /insufficient|0x1\b|debit an account/i.test(m) ? `Not enough ${method.toUpperCase()} in that wallet (plus a tiny network fee).` : esc(m), 'bad');
  } finally { busy = false; el.classList.remove('busy'); }
}

window.LunexCheckout = { open };

// back from Stripe: the card subscription is switched on by Stripe's webhook, usually within seconds
const paid = new URLSearchParams(location.search).get('paid');
if (paid) {
  history.replaceState(null, '', location.pathname + location.hash);
  if (paid === 'card' && U.plan !== 'pro') {
    let n = 0;
    const tick = async () => { const { user } = await api('/api/me').catch(() => ({})); if (user && user.plan === 'pro') location.reload(); else if (++n < 20) setTimeout(tick, 2000); };
    setTimeout(tick, 1500);
  }
}
})();
