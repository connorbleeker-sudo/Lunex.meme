// Served by the server in place of luna.js for Free accounts: Luna's code never reaches the browser.
// Shows what Pro unlocks on the Luna tab, marks the tab as Pro, and adds a teaser on Home.
(() => {
const q = s => document.querySelector(s);
const page = q('#p-luna');
const upgrade = () => window.LunexAccount ? window.LunexAccount.upgrade() : alert('Pro checkout is coming soon.');

const preview = `
  <div class="lk-chat" aria-hidden="true">
    <div class="lk-msg me">is $TEEETHY a good buy?</div>
    <div class="lk-msg bot"><div class="ld-verdict v-buy"><b>BUY</b><span>84% confidence</span></div>
      <p><b>Yes, buy $TEEETHY.</b> Passes 5/6 checks: momentum building, safety 65+, not already parabolic.</p>
      <p class="lk-blur"><b>The play:</b> $0.39 at $56.4K market cap. Take profit at $112.8K (2x): +$0.39. Stop at $33.9K (−40%): −$0.16.</p></div>
    <div class="lk-msg me">trade for me</div>
  </div>`;

if (page) page.innerHTML = `
  <div class="lk">
    <div class="lk-copy">
      
      <h1>Luna tells you <em>what to do.</em></h1>
      <p>Straight calls on any coin: <b>buy, skip or sell</b>, with a confidence score and the exact plan. How much to put in, where to take profit, where to cut. Sized to your wallet.</p>
      <ul>
        <li><b>Buy / skip / sell calls</b> on every coin and launch</li>
        <li><b>Money plans</b> with real take-profit and stop numbers</li>
        <li><b>Trade for me:</b> her best setup in one tap, approved in your wallet</li>
        <li><b>Ask anything:</b> runs on your own device, fast and private</li>
      </ul>
      <button type="button" class="lk-up">Upgrade to Pro</button>
      <p class="acct-upgrade-note lk-note" hidden>Pro checkout is coming soon. Your account will unlock Luna the moment it's switched on.</p>
    </div>
    ${preview}
  </div>`;
page && page.querySelector('.lk-up').addEventListener('click', () => { page.querySelector('.lk-note').hidden = false; upgrade(); });

// nav: mark Luna as a Pro tab
const tab = q('nav button[data-p="luna"]'); if (tab) tab.classList.add('nv-locked');

// home: teaser where "Meet Luna" would be
const tele = q('.ov-telemetry');
if (tele) {
  const sec = document.createElement('div'); sec.className = 'ov-meet lk-home';
  sec.innerHTML = `<div class="lk-copy"><h2>Unlock <em>Luna.</em></h2>
    <p>Buy, skip and sell calls on any coin, with the exact plan sized to your wallet. Upgrade to put her to work.</p>
    <button type="button" class="lk-up">Upgrade to Pro</button><p class="acct-upgrade-note lk-note" hidden>Pro checkout is coming soon. Your account will unlock Luna the moment it's switched on.</p></div>${preview}`;
  tele.after(sec);
  sec.querySelector('.lk-up').addEventListener('click', () => { sec.querySelector('.lk-note').hidden = false; upgrade(); });
}
})();
