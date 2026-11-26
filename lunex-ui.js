// Lunex shared UI kit, used on the welcome page and in the app (public file, no secrets, no Luna logic):
//   LunexUI.dial(value, kind, label)   animated score ring for momentum / safety
//   LunexUI.luna(host, {size})          the Luna mascot: blinks, bobs, eyes follow the cursor, .mood('happy'|'alarm'|'sad'|'think'|'talk')
//   LunexUI.scan(host, steps)           a short "running the checks" animation; resolves when it's done
//   LunexUI.money / ago / esc           formatting helpers
(() => {
if (window.LunexUI) return;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => n == null || isNaN(n) ? '—' : n >= 1e9 ? '$' + (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? '$' + (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? '$' + (n / 1e3).toFixed(1) + 'K' : n >= 1 ? '$' + n.toFixed(2) : '$' + n.toPrecision(3);
const ago = t => { const s = Math.max(0, Date.now() / 1000 - t); return s < 60 ? Math.round(s) + 's' : s < 3600 ? Math.round(s / 60) + 'm' : s < 86400 ? Math.round(s / 3600) + 'h' : Math.round(s / 86400) + 'd'; };
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------------------------------------------------------------- styles (injected once)
const css = `
.lx-dial{--c:#3dffb0;position:relative;display:inline-grid;place-items:center;width:var(--sz,74px);height:var(--sz,74px);flex:none}
.lx-dial svg{position:absolute;inset:0;width:100%;height:100%;transform:rotate(135deg)}
.lx-dial .tr{fill:none;stroke:rgba(255,255,255,.09);stroke-width:7;stroke-linecap:round;stroke-dasharray:75 100}
.lx-dial .val{fill:none;stroke:var(--c);stroke-width:7;stroke-linecap:round;stroke-dasharray:var(--v) 100;filter:drop-shadow(0 0 5px var(--c));animation:lx-dial .9s cubic-bezier(.2,.8,.2,1) both}
.lx-dial b{position:relative;font:800 calc(var(--sz,74px)*.3)/1 'Bricolage Grotesque',system-ui,sans-serif;letter-spacing:-.03em;color:#f0eef3;margin-top:-4px}
.lx-dial small{position:absolute;bottom:calc(var(--sz,74px)*.04);font:600 calc(var(--sz,74px)*.115)/1 'IBM Plex Mono',monospace;letter-spacing:.06em;text-transform:uppercase;color:#aaa8b6}
@keyframes lx-dial{from{stroke-dasharray:0 100}}
.lx-luna{position:relative;width:var(--lsz,160px);height:var(--lsz,160px);flex:none}
.lx-luna .luna{width:100%;height:100%;overflow:visible;display:block}
.lx-luna .l-ring-back{stroke:#ff7fd1;opacity:.35}.lx-luna .l-ring-front{stroke:#ff7fd1;opacity:.85;filter:drop-shadow(0 0 4px #ff7fd1)}
.lx-luna .l-sat{fill:#fff;filter:drop-shadow(0 0 4px #fff)}.lx-luna .l-visor{stroke:rgba(255,255,255,.35);transition:stroke .3s}
.lx-luna .l-eye{fill:#ff7fd1;filter:drop-shadow(0 0 5px #ff7fd1);transform-box:fill-box;transform-origin:center;animation:lxl-blink 5.5s infinite;transition:fill .3s,opacity .2s}
.lx-luna .l-happy,.lx-luna .l-sad{stroke:#ff7fd1;opacity:0;transition:opacity .2s;filter:drop-shadow(0 0 4px #ff7fd1)}
.lx-luna .l-cheek{fill:#ff7ab6;opacity:0;transition:opacity .3s}.lx-luna .l-tip{fill:#ff7fd1;filter:drop-shadow(0 0 6px #ff7fd1);animation:lxl-tip 1.8s infinite}
.lx-luna .l-bob{transform-box:view-box;transform-origin:80px 86px;animation:lxl-bob 4.2s ease-in-out infinite}
.lx-luna .l-eyes{transition:transform .18s ease-out}.lx-luna .l-ant{transform-box:view-box;transform-origin:80px 41px}
.lx-luna .l-aura{opacity:.7;transform-box:view-box;transform-origin:80px 86px;animation:lxl-aura 3.5s ease-in-out infinite}
@keyframes lxl-blink{0%,93%,100%{transform:scaleY(1)}96%{transform:scaleY(.08)}}@keyframes lxl-tip{50%{opacity:.35}}
@keyframes lxl-bob{50%{transform:translateY(-5px) rotate(-2.5deg)}}@keyframes lxl-aura{50%{opacity:1;transform:scale(1.04)}}
@keyframes lxl-hop{0%,100%{transform:translateY(0)}40%{transform:translateY(-14px) rotate(4deg)}70%{transform:translateY(2px)}}
@keyframes lxl-shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-4px) rotate(-3deg)}75%{transform:translateX(4px) rotate(3deg)}}
@keyframes lxl-wig{50%{transform:rotate(-14deg)}}@keyframes lxl-talk{to{stroke:#ff7fd1}}
.lx-luna.m-happy .l-eye{opacity:0}.lx-luna.m-happy .l-happy{opacity:1}.lx-luna.m-happy .l-cheek{opacity:.65}.lx-luna.m-happy .l-bob{animation:lxl-hop .55s ease 3}
.lx-luna.m-alarm .l-eye{fill:#ff3d6e;filter:drop-shadow(0 0 7px #ff3d6e)}.lx-luna.m-alarm .l-bob{animation:lxl-shake .14s linear 10}.lx-luna.m-alarm .l-tip{fill:#ff3d6e;animation-duration:.25s}.lx-luna.m-alarm .l-visor{stroke:#ff3d6e}
.lx-luna.m-sad .l-eye{opacity:0}.lx-luna.m-sad .l-sad{opacity:1}.lx-luna.m-sad .l-bob{animation:none;transform:translateY(5px) rotate(5deg)}
.lx-luna.m-think .l-eyes{transform:translate(4px,-4px)!important}.lx-luna.m-think .l-ant{animation:lxl-wig .5s ease-in-out infinite}
.lx-luna.m-talk .l-visor{animation:lxl-talk .22s ease-in-out infinite alternate}
.lx-scan{display:grid;gap:8px;margin:0;padding:0;list-style:none}
.lx-scan li{display:flex;align-items:center;gap:10px;font:14px 'IBM Plex Sans',system-ui,sans-serif;color:#7d7b89;transition:color .2s}
.lx-scan li i{display:grid;place-items:center;flex:none;width:20px;height:20px;border-radius:50%;border:2px solid rgba(255,255,255,.15);font-style:normal;font-size:11px;font-weight:700}
.lx-scan li.run{color:#f0eef3}.lx-scan li.run i{border-color:#ff7fd1 transparent #ff7fd1 #ff7fd1;animation:lx-spin .6s linear infinite}
.lx-scan li.ok{color:#aaa8b6}.lx-scan li.ok i{background:#3dffb0;border-color:#3dffb0;color:#06120c}
@keyframes lx-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.lx-dial .val,.lx-luna *{animation:none!important}}`;
const st = document.createElement('style'); st.id = 'lunex-ui-css'; st.textContent = css;
(document.head || document.documentElement).appendChild(st);

// ---------------------------------------------------------------- score dial
function dialColor(v, kind) {
  if (kind === 'safety') return v >= 70 ? '#3dffb0' : v >= 45 ? '#ffc861' : '#ff4d6d';
  return v >= 60 ? '#ff7a3d' : v >= 35 ? '#ffc861' : '#7cb8ff';        // momentum: hot -> warm -> cold
}
function dial(value, kind = 'momentum', label, size) {
  const v = Math.max(0, Math.min(100, Math.round(+value || 0)));
  return `<span class="lx-dial" role="img" aria-label="${esc(label || kind)} ${v} out of 100" style="--c:${dialColor(v, kind)};--v:${(v * .75).toFixed(1)}${size ? `;--sz:${size}px` : ''}">
    <svg viewBox="0 0 40 40" aria-hidden="true"><circle class="tr" cx="20" cy="20" r="16" pathLength="100"/><circle class="val" cx="20" cy="20" r="16" pathLength="100"/></svg>
    <b>${v}</b><small>${esc(label || kind)}</small></span>`;
}

// ---------------------------------------------------------------- Luna mascot
let LN = 0;
function lunaSVG() {
  const n = 'x' + (++LN);
  return `<svg class="luna" viewBox="0 0 160 160" aria-hidden="true"><defs>
    <radialGradient id="lb${n}" cx="36%" cy="30%" r="78%"><stop offset="0" stop-color="#f6f3ec"/><stop offset=".35" stop-color="#d9d4c9"/><stop offset=".75" stop-color="#8f897d"/><stop offset="1" stop-color="#2a2722"/></radialGradient>
    <linearGradient id="lv${n}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b0a09"/><stop offset="1" stop-color="#1d1b18"/></linearGradient>
    <radialGradient id="la${n}"><stop offset="0" stop-color="#ff7fd1" stop-opacity=".25"/><stop offset="1" stop-color="#ff7fd1" stop-opacity="0"/></radialGradient>
    <clipPath id="lc${n}"><circle cx="80" cy="86" r="46"/></clipPath></defs>
  <circle class="l-aura" cx="80" cy="86" r="78" fill="url(#la${n})"/>
  <g class="l-bob">
    <ellipse class="l-ring-back" cx="80" cy="92" rx="70" ry="15" fill="none" stroke-width="2" stroke-dasharray="2 6"/>
    <g class="l-ant"><path d="M80 41 Q77 27 88 18" fill="none" stroke="#cfc9bd" stroke-width="3.2" stroke-linecap="round"/><circle class="l-tip" cx="89" cy="16" r="5.5"/></g>
    <circle cx="80" cy="86" r="46" fill="url(#lb${n})"/>
    <g clip-path="url(#lc${n})" fill="#5e574c" opacity=".38"><circle cx="54" cy="60" r="7"/><circle cx="106" cy="114" r="10"/><circle cx="114" cy="66" r="4.5"/><circle cx="60" cy="120" r="5"/><circle cx="96" cy="52" r="3"/></g>
    <path d="M52 56 a40 40 0 0 1 30 -14" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".55"/>
    <rect class="l-visor" x="43" y="71" width="74" height="31" rx="15.5" fill="url(#lv${n})" stroke-width="1.6"/>
    <g class="l-eyes"><rect class="l-eye" x="59.5" y="78.5" width="11" height="16" rx="5.5"/><rect class="l-eye" x="89.5" y="78.5" width="11" height="16" rx="5.5"/></g>
    <path class="l-happy" d="M58 92 q7 -10 14 0 M88 92 q7 -10 14 0" fill="none" stroke-width="4.2" stroke-linecap="round"/>
    <path class="l-sad" d="M58 85 q7 7 14 0 M88 85 q7 7 14 0" fill="none" stroke-width="4.2" stroke-linecap="round"/>
    <circle class="l-cheek" cx="50" cy="109" r="5.5"/><circle class="l-cheek" cx="110" cy="109" r="5.5"/>
    <path class="l-ring-front" d="M10 92 A70 15 0 0 0 150 92" fill="none" stroke-width="2.6" stroke-linecap="round"/>
    ${reduce ? '' : '<circle class="l-sat" r="3.6"><animateMotion dur="6s" repeatCount="indefinite" path="M150 92 A70 15 0 1 1 10 92 A70 15 0 1 1 150 92"/></circle>'}
  </g></svg>`;
}
const mascots = [];
function luna(host, opts = {}) {
  const el = document.createElement('div'); el.className = 'lx-luna'; el.setAttribute('aria-hidden', 'true');
  if (opts.size) el.style.setProperty('--lsz', opts.size + 'px');
  el.innerHTML = lunaSVG(); host.appendChild(el);
  const m = { el, eyes: el.querySelector('.l-eyes'), t: 0,
    mood(mood, ms = 2600) {
      clearTimeout(m.t); el.classList.remove('m-happy', 'm-alarm', 'm-sad', 'm-think', 'm-talk');
      if (mood) { void el.offsetWidth; el.classList.add('m-' + mood); if (ms) m.t = setTimeout(() => el.classList.remove('m-' + mood), ms); }
    } };
  mascots.push(m); return m;
}
addEventListener('pointermove', e => {
  mascots.forEach(m => {
    const r = m.el.getBoundingClientRect(); if (!r.width || r.bottom < 0 || r.top > innerHeight) return;
    const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height * .55), d = Math.hypot(dx, dy) || 1, k = Math.min(1, d / 300);
    m.eyes.style.transform = `translate(${dx / d * 5 * k}px, ${dy / d * 3.5 * k}px)`;
  });
}, { passive: true });

// ---------------------------------------------------------------- scan animation
function scan(host, steps, stepMs = 260) {
  host.innerHTML = `<ol class="lx-scan" aria-live="polite">${steps.map(s => `<li><i aria-hidden="true"></i><span>${esc(s)}</span></li>`).join('')}</ol>`;
  const lis = [...host.querySelectorAll('li')];
  if (reduce) { lis.forEach(li => { li.className = 'ok'; li.querySelector('i').textContent = '✓'; }); return Promise.resolve(); }
  return new Promise(res => {
    let i = 0;
    const tick = () => {
      if (i > 0) { lis[i - 1].className = 'ok'; lis[i - 1].querySelector('i').textContent = '✓'; }
      if (i >= lis.length) return res();
      lis[i].className = 'run'; i++;
      setTimeout(tick, stepMs + Math.random() * 120);
    };
    tick();
  });
}

window.LunexUI = { dial, dialColor, luna, scan, money, ago, esc };
})();
