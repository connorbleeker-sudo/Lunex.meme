// Served by the server in place of luna.js for Free accounts: Luna's code never reaches the browser.
// Builds the Pro page on the Luna tab, marks the tab as Pro, adds a teaser on Home and a small,
// dismissible "Luna can call this" strip on the data pages. Every example is labelled as an example;
// live coins are real radar data with Luna's call hidden (her logic isn't in this file).
(() => {
const q = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const upgrade = () => window.LunexAccount ? window.LunexAccount.upgrade() : (location.href = '/pay');
const page = q('#p-luna');
let price = { month: 20, week: 7 };
const money = n => '$' + (n % 1 ? n.toFixed(2) : n);
const perDay = () => Math.round(price.month / 30 * 100) + '¢';
const ctaText = () => `Unlock Luna · ${money(price.month)}/month`;

// ---------------------------------------------------------------- example conversations (cycled in the demo)
const DEMOS = [
  { q: 'is $TEEETHY a good buy?', call: 'BUY', cls: 'buy', conf: 84,
    why: '<b>Yes, buy $TEEETHY.</b> Passes 5/6 checks: buyers in control, momentum building, safety 65+.',
    plan: '<b>The play:</b> $40 at $56.4K market cap.<br>Take profit at <b>$112.8K</b> (2x): <b class="up">+$40</b><br>Stop at <b>$33.9K</b> (−40%): <b class="down">−$16</b>' },
  { q: 'what about $MOONCAT?', call: 'SKIP', cls: 'skip', conf: 86,
    why: '<b>Skip $MOONCAT.</b> Fails 4/6: the dev already sold, buys aren\'t beating sells, no socials.',
    plan: 'Nothing to buy here. I\'ll flag it if the picture changes.' },
  { q: 'should I sell my $GLORP? up 2.3x', call: 'SELL HALF', cls: 'small', conf: 81,
    why: '<b>Take your initial out.</b> You\'re past your 2x target, so selling half makes the rest free.',
    plan: '<b>Then:</b> move your stop up to break-even and let the house money ride.' },
];

const demoHtml = d => `
  <div class="lk-msg me">${esc(d.q)}</div>
  <div class="lk-msg bot"><div class="ld-verdict v-${d.cls}"><b>${d.call}</b><span>${d.conf}% confidence</span></div>
    <p>${d.why}</p><p class="lk-plan">${d.plan}</p></div>`;

// ---------------------------------------------------------------- the Luna tab
const FEATS = [
  ['◎', 'Straight calls', 'BUY, SMALL BUY, WAIT or SKIP on any coin or fresh launch, with a confidence score and the reasons in one line.'],
  ['$', 'Money plans', 'How much to put in for your wallet size, the exact take-profit price at 2x and the stop at −40%.'],
  ['⚡', 'Trade for me', 'Her best setup right now, ticket opened and sized for you. You approve it in your own wallet.'],
  ['↘', 'When to sell', 'Paste a coin you hold and she checks it against your rules: take profit, hold, or cut.'],
  ['◐', 'Wallet check-up', 'She reads your real holdings: dead bags, position sizes, and the habits costing you money.'],
  ['?', 'Ask anything', 'Explain market cap, spot a rug, today\'s weather. Crypto or not, in plain words.'],
];
const DEX_CHECKS = ['Buyers in control', 'Momentum building', 'Safety 65+', 'Not already parabolic', 'Liquidity to exit', 'Socials live'];
const PUMP_CHECKS = ['Dev still holding', 'Real buyers arriving', 'Buys beating sells', 'Socials live', 'Not dumped from peak', 'Smart money in'];
const FAQ = [
  ['Is Luna financial advice?', 'No. Luna turns live market data into a clear call and a plan, but she can be wrong, and most new memecoins go to zero. Only trade what you can afford to lose.'],
  ['Can Luna move my money?', 'Never. Lunex never holds your keys. "Trade for me" opens a ticket, and nothing happens until you approve it in your own wallet.'],
  ['Where does Luna run?', 'On your own device. Her AI model downloads to your browser the first time, so what you ask her stays with you.'],
  ['How do I pay, and does it renew?', 'Pay in USDC, SOL or by card. Crypto passes never renew by themselves. Card plans renew monthly and you can cancel anytime from Account settings.'],
  ['What happens if I cancel?', 'You keep Pro until the end of the time you paid for, then Luna locks again. The radar, launches, wallets and alerts stay free.'],
];

function drawPage() {
  if (!page) return;
  page.innerHTML = `
  <div class="lk2">
    <section class="lk-hero">
      <div class="lk-copy">
        <span class="lk-eyebrow"><i>★</i> PRO · LUNA AI</span>
        <h1>Luna tells you <em>what to do.</em></h1>
        <p class="lk-lede">The radar shows you what's moving. Luna tells you what to do about it: a <b>straight call</b> on any coin, a <b>confidence score</b>, and <b>the exact plan</b>. How much to put in, where to take profit, where to cut. Sized to your wallet.</p>
        <div class="lk-cta"><button type="button" class="lk-up lk-main">${ctaText()}</button><a class="lk-ghost" href="#lk-how">How she decides ↓</a></div>
        <p class="lk-price"><span data-price="day">About ${perDay()} a day</span> · <span data-price="week">or ${money(price.week)} for one week</span> · cancel anytime</p>
        <ul class="lk-trust"><li>You approve every trade</li><li>Runs on your device</li><li>Never asks for your keys</li></ul>
      </div>
      <div class="lk-demo" aria-label="Example conversations with Luna">
        <div class="lk-demo-top"><span class="lk-dot"></span><b>Luna</b><small>Example conversation</small><span class="lk-demo-dots">${DEMOS.map((_, i) => `<i data-i="${i}"></i>`).join('')}</span></div>
        <div class="lk-chat" id="lkChat"></div>
        <div class="lk-input" aria-hidden="true"><span>Ask Luna anything…</span><b>★ Pro</b></div>
      </div>
    </section>

    <section class="lk-live" aria-labelledby="lk-live-h">
      <div class="lk-sec-head"><div><span class="lk-kicker">LIVE FROM YOUR RADAR</span><h2 id="lk-live-h">Luna has a call ready on <em>these right now.</em></h2></div>
        <p>Real coins, scored this minute. Momentum and safety are free. Her call and the plan are Pro.</p></div>
      <div class="lk-coins" id="lkCoins"><div class="lk-wait">Waiting for the radar to load coins…</div></div>
    </section>

    <section class="lk-feats" aria-labelledby="lk-feats-h">
      <div class="lk-sec-head"><div><span class="lk-kicker">WHAT YOU GET</span><h2 id="lk-feats-h">Everything the radar sees, <em>turned into a plan.</em></h2></div></div>
      <div class="lk-grid">${FEATS.map(([i, t, d]) => `<article><span class="lk-ico" aria-hidden="true">${i}</span><h3>${t}</h3><p>${d}</p></article>`).join('')}</div>
    </section>

    <section class="lk-how" id="lk-how" aria-labelledby="lk-how-h">
      <div class="lk-sec-head"><div><span class="lk-kicker">HOW SHE DECIDES</span><h2 id="lk-how-h">Six checks. <em>One call.</em></h2></div>
        <p>Every coin runs through six live checks. The more it passes, the stronger the call. Fail the big ones and it's a skip, however hot it looks.</p></div>
      <div class="lk-checks">
        <div><h3>Radar pairs</h3><ol>${DEX_CHECKS.map(c => `<li>${c}</li>`).join('')}</ol></div>
        <div><h3>Fresh launches</h3><ol>${PUMP_CHECKS.map(c => `<li>${c}</li>`).join('')}</ol></div>
        <div class="lk-scale"><h3>The call</h3>
          <p><b class="ld-verdict v-buy"><b>BUY</b></b><span>5–6 checks and strong scores</span></p>
          <p><b class="ld-verdict v-small"><b>SMALL BUY</b></b><span>4 checks: half size</span></p>
          <p><b class="ld-verdict v-wait"><b>WAIT</b></b><span>3 checks: she tells you what has to flip</span></p>
          <p><b class="ld-verdict v-skip"><b>SKIP</b></b><span>Dev sold, dumped, or too risky</span></p></div>
      </div>
    </section>

    <section class="lk-compare" aria-labelledby="lk-cmp-h">
      <div class="lk-sec-head"><div><span class="lk-kicker">FREE VS PRO</span><h2 id="lk-cmp-h">Keep everything. <em>Add Luna.</em></h2></div></div>
      <table>
        <thead><tr><th></th><th>Free</th><th class="pro">Pro</th></tr></thead>
        <tbody>
          ${[['Live radar, momentum and safety scores', 1, 1], ['Every pump.fun launch with rug flags', 1, 1], ['Smart-money wallet tracking', 1, 1], ['Take-profit and stop-loss alerts', 1, 1],
             ['Buy / skip / sell calls on any coin', 0, 1], ['Money plans sized to your wallet', 0, 1], ['Trade for me', 0, 1], ['Wallet check-up and sell coaching', 0, 1], ['Ask Luna anything', 0, 1]]
            .map(([t, f, p]) => `<tr><td>${t}</td><td>${f ? '<span class="y">✓</span>' : '<span class="n">—</span>'}</td><td class="pro">${p ? '<span class="y">✓</span>' : ''}</td></tr>`).join('')}
          <tr class="lk-cmp-price"><td></td><td>$0</td><td class="pro"><b data-price="month">${money(price.month)}</b>/month</td></tr>
        </tbody>
      </table>
    </section>

    <section class="lk-faq" aria-labelledby="lk-faq-h">
      <div class="lk-sec-head"><div><span class="lk-kicker">QUESTIONS</span><h2 id="lk-faq-h">Before you <em>unlock.</em></h2></div></div>
      ${FAQ.map(([t, d], i) => `<details${i === 0 ? ' open' : ''}><summary>${t}</summary><p>${d}</p></details>`).join('')}
    </section>

    <section class="lk-final">
      <h2>Stop guessing. <em>Ask Luna.</em></h2>
      <p><span data-price="month">${money(price.month)}</span> a month, about <span data-price="day">${perDay()}</span> a day. Pay in USDC, SOL or card.</p>
      <button type="button" class="lk-up lk-main">${ctaText()}</button>
      <small>Signals, not financial advice. Most new memecoins go to zero. <a href="/terms" target="_blank" rel="noopener">Terms</a> · <a href="/refunds" target="_blank" rel="noopener">Refunds</a></small>
    </section>
  </div>`;
  page.querySelectorAll('.lk-up').forEach(b => b.addEventListener('click', upgrade));
  page.querySelector('.lk-ghost').addEventListener('click', e => { e.preventDefault(); q('#lk-how').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  runDemo(); drawCoins();
}

// ---------------------------------------------------------------- demo chat: types out each example, then moves on
let demoI = 0, demoT = null, demoLuna = null;
function runDemo() {
  const box = q('#lkChat'); if (!box) return;
  const top = page.querySelector('.lk-demo-top');
  if (window.LunexUI && top && !demoLuna) { top.querySelector('.lk-dot')?.remove(); demoLuna = LunexUI.luna(top, { size: 46 }); top.prepend(demoLuna.el); }
  const show = i => {
    demoI = i;
    box.innerHTML = demoHtml(DEMOS[i]);
    page.querySelectorAll('.lk-demo-dots i').forEach((d, j) => d.classList.toggle('on', j === i));
    const [me, bot] = box.children; bot.classList.add('lk-pending');
    me.classList.add('lk-in');
    demoLuna && demoLuna.mood('think', 900);
    setTimeout(() => {
      bot.classList.remove('lk-pending'); bot.classList.add('lk-in');
      demoLuna && demoLuna.mood({ buy: 'happy', skip: 'alarm', small: 'talk' }[DEMOS[i].cls] || 'talk', 2200);
    }, 900);
    clearTimeout(demoT); demoT = setTimeout(() => show((i + 1) % DEMOS.length), 7000);
  };
  page.querySelectorAll('.lk-demo-dots i').forEach(d => d.addEventListener('click', () => show(+d.dataset.i)));
  show(0);
}

// ---------------------------------------------------------------- live coins (real radar data, call hidden)
function radarNow() {
  try { return typeof tokens !== 'undefined' && Array.isArray(tokens) ? tokens : []; } catch { return []; }
}
function topCoins(n) {
  return radarNow().filter(t => t && t.pair && t.a && t.pair.chainId === 'solana' && !(t.a.flags || []).some(f => /honeypot/i.test(f)))
    .sort((a, b) => (b.a.momentum + b.a.safety * .5) - (a.a.momentum + a.a.safety * .5)).slice(0, n);
}
const fmtCap = v => !v ? '—' : v >= 1e9 ? '$' + (v / 1e9).toFixed(1) + 'B' : v >= 1e6 ? '$' + (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? '$' + (v / 1e3).toFixed(1) + 'K' : '$' + Math.round(v);
let lastSig = '';
function drawCoins() {
  const box = q('#lkCoins'); if (!box) return;
  const list = topCoins(4), sig = list.map(t => t.pair.baseToken.address + t.a.momentum + t.a.safety).join('|');
  if (!list.length || sig === lastSig) return;
  lastSig = sig;
  box.innerHTML = list.map(t => {
    const p = t.pair, a = t.a, img = p.info && p.info.imageUrl;
    const ch = Number(p.priceChange && p.priceChange.h1);
    return `<article class="lk-coin">
      <div class="lk-coin-top">${img ? `<img src="${esc(img)}" alt="" loading="lazy" onerror="this.remove()">` : '<span class="lk-coin-ph"></span>'}
        <div><b>$${esc(p.baseToken.symbol)}</b><small>${esc(fmtCap(a.fdv || p.fdv))} mcap${isFinite(ch) ? ` · <span class="${ch >= 0 ? 'up' : 'down'}">${ch >= 0 ? '+' : ''}${ch.toFixed(0)}% 1h</span>` : ''}</small></div></div>
      <div class="lk-bars"><span>Momentum</span><i><em style="width:${Math.max(3, a.momentum)}%"></em></i><b>${a.momentum}</b>
        <span>Safety</span><i><em class="s" style="width:${Math.max(3, a.safety)}%"></em></i><b>${a.safety}</b></div>
      <button type="button" class="lk-lock" aria-label="Unlock Luna to see her call on $${esc(p.baseToken.symbol)}">
        <span class="lk-blurred" aria-hidden="true">████ · ██% · ███████████</span><span class="lk-lock-txt">🔒 See Luna's call</span></button>
    </article>`;
  }).join('');
  box.querySelectorAll('.lk-lock').forEach(b => b.addEventListener('click', upgrade));
}
setInterval(() => { if (page && page.classList.contains('on')) drawCoins(); }, 4000);
setTimeout(drawCoins, 2500);

// ---------------------------------------------------------------- nav: mark Luna as a Pro tab
const tab = q('nav button[data-p="luna"]'); if (tab) { tab.classList.add('nv-locked'); tab.setAttribute('aria-label', 'Luna (Pro)'); }

// ---------------------------------------------------------------- home: teaser where "Meet Luna" would be
const tele = q('.ov-telemetry');
if (tele) {
  const sec = document.createElement('div'); sec.className = 'ov-meet lk-home';
  sec.innerHTML = `<div class="lk-copy"><span class="lk-eyebrow"><i>★</i> PRO · LUNA AI</span><h2>The radar shows what's moving. <em>Luna tells you what to do.</em></h2>
    <ul class="lk-chips"><li>Buy / skip / sell calls</li><li>Exact take-profit &amp; stop</li><li>Trade for me</li><li>Runs on your device</li></ul>
    <div class="lk-cta"><button type="button" class="lk-up lk-main">${ctaText()}</button><button type="button" class="lk-ghost" data-open-luna>See what she does</button></div>
    <p class="lk-price"><span data-price="day">About ${perDay()} a day</span> · cancel anytime</p></div>
    <div class="lk-chat lk-static" aria-label="Example conversation with Luna">${demoHtml(DEMOS[0])}</div>`;
  (q('#ovLive') || tele).after(sec);
  if (window.LunexUI) { const m = LunexUI.luna(sec.querySelector('.lk-copy'), { size: 110 }); sec.querySelector('.lk-copy').prepend(m.el); setInterval(() => m.mood(['happy', 'talk', 'think'][Math.random() * 3 | 0], 1800), 8000); }
  sec.querySelector('.lk-up').addEventListener('click', upgrade);
  sec.querySelector('[data-open-luna]').addEventListener('click', () => q('nav button[data-p="luna"]')?.click());
}

// ---------------------------------------------------------------- data pages: one quiet strip each, dismissible
const STRIPS = {
  scanner: 'Hot pair? Luna gives you a straight <b>buy, wait or skip</b> on it, with the exact take-profit and stop.',
  pump: 'Fresh launch? Luna runs the <b>six launch checks</b> and tells you if it\'s worth a small buy, before it\'s too late.',
  smart: 'When smart money buys, Luna checks the coin and tells you <b>whether to follow</b>, and how much.',
  mine: 'Holding something? Ask Luna <b>when to sell</b>. She checks it against your 2x / −40% rules.',
};
const HIDE_KEY = 'lx-strip-hide';
const hidden = () => { try { return JSON.parse(sessionStorage.getItem(HIDE_KEY)) || []; } catch { return []; } };
Object.entries(STRIPS).forEach(([id, text]) => {
  const p = q('#p-' + id); if (!p || hidden().includes(id)) return;
  const s = document.createElement('div'); s.className = 'lk-strip';
  s.innerHTML = `<span class="lk-strip-ico" aria-hidden="true">★</span><p>${text}</p><button type="button" class="lk-strip-go">Unlock Luna</button><button type="button" class="lk-strip-x" aria-label="Hide this tip">✕</button>`;
  s.querySelector('.lk-strip-go').addEventListener('click', upgrade);
  s.querySelector('.lk-strip-x').addEventListener('click', () => { sessionStorage.setItem(HIDE_KEY, JSON.stringify([...hidden(), id])); s.remove(); });
  const head = p.querySelector(':scope > .nv-head');     // the page title block nova.js adds
  head ? head.after(s) : p.prepend(s);
});

// ---------------------------------------------------------------- real prices from the server
function applyPrice() {
  document.querySelectorAll('.lk-main').forEach(b => b.textContent = ctaText());
  document.querySelectorAll('[data-price=month]').forEach(e => e.textContent = money(price.month));
  document.querySelectorAll('[data-price=day]').forEach(e => e.textContent = e.closest('.lk-final') ? perDay() : `About ${perDay()} a day`);
  document.querySelectorAll('[data-price=week]').forEach(e => e.textContent = `or ${money(price.week)} for one week`);
}
drawPage();
fetch('/api/pay/config').then(r => r.json()).then(c => {
  const m = (c.plans || []).find(p => p.id === 'month'), w = (c.plans || []).find(p => p.id === 'week');
  if (m) price.month = m.usd; if (w) price.week = w.usd;
  applyPrice();
}).catch(() => { });
})();
