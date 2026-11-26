/* ==========================================================================
   LUNEX // NOVA ENGINE
   - WebGL background: one shader, six scenes (moon, radar, plasma, waves,
     network, vault) that cross-dissolve as you change page.
   - GPU particle swarm (12k points) that morphs into a new formation per page
     and reacts to the cursor.
   - FX layer: bursts, comets, shockwaves, screen shake, chroma glitch.
   - Live instruments for each page, drawn from the app's real data.
   Loaded after the main app script, so it can read its globals (tokens,
   coins, launches, solUsd, smartTrades, getWallets, xTweets…) and wrap its
   event functions (onCreate, onSmartTrade, showAlert, renderScanner…).
   ========================================================================== */
(() => {
'use strict';
const q = s => document.querySelector(s), qa = s => [...document.querySelectorAll(s)];
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
const lerp = (a, b, t) => a + (b - a) * t;
const g = name => { try { return eval(name); } catch { return undefined; } };   // read app globals (let/const live in shared script scope)
const hashStr = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0) / 4294967295; };
if (calm) document.documentElement.classList.add('nv-calm');

// ---------------------------------------------------------------- page meta
const PAGES = {
  overview: { mode: 0, c1: [1, .42, .17], c2: [1, .7, .48] },
  luna:     { mode: 4, c1: [1, .5, .82], c2: [.62, .56, 1] },
  scanner:  { mode: 1, c1: [.24, .91, 1], c2: [.24, 1, .69], n: '01', eye: 'Source: DexScreener pairs', title: 'Radar', sub: 'Every boosted and newly profiled pair, scored for momentum and risk as trades come in. Hotter pairs sit closer to the center of the sweep.', viz: 'radar', tag: 'SOURCE DEXSCREENER' },
  pump:     { mode: 2, c1: [1, .48, .24], c2: [1, .78, .38], n: '02', eye: 'Source: pump.fun via PumpPortal', title: 'Launches', sub: 'New pump.fun coins land here about a second after they mint. Most fail within the hour, and the red flags under each coin usually say why.', viz: 'bay', tag: 'SOURCE PUMPPORTAL' },
  xfeed:    { mode: 3, c1: [.64, .42, 1], c2: [1, .31, .85], n: '03', eye: 'Source: X search', title: 'Chatter', sub: 'Posts from accounts that have moved crypto prices before, scored by follower count and how fast likes are coming in. Accounts over 10M followers trigger an alert.', viz: 'scope', tag: 'POSTS PER MINUTE' },
  smart:    { mode: 4, c1: [.24, 1, .69], c2: [.83, 1, .24], n: '04', eye: 'Source: Solana RPC', title: 'Wallets', sub: 'The wallets you track, linked to the coins they buy and sell. When two of them buy the same coin within 30 minutes, it shows up as a convergence.', viz: 'graph', tag: 'WALLET TO COIN LINKS' },
  mine:     { mode: 5, c1: [1, .78, .38], c2: [1, .62, .37], n: '05', eye: 'Source: your public address', title: 'Vault', sub: 'Your entries, profit and loss, and the take-profit and stop-loss levels you set. Alerts fire when a level is hit.', viz: 'vault', tag: 'ON-CHAIN BALANCE' },
  atlas:    { mode: 1, c1: [.49, .91, 1], c2: [.72, .65, 1], n: '06', eye: 'Derived from the radar', title: 'Constellation', sub: 'Every pair on the radar, with safety on the x-axis and momentum on the y-axis. Top right means hot and comparatively safe. Few coins land there.' },
  guide:    { mode: 3, c1: [.89, .87, 1], c2: [.65, .6, 1], n: '07', eye: 'Reference', title: 'Field guide', sub: 'What each score measures, and what it can\'t tell you.' },
};
let page = (q('nav button.on') || {}).dataset?.p || 'overview';
document.body.dataset.page = page;

// ================================================================ WEBGL
const bg = document.createElement('canvas'); bg.id = 'nv-bg'; document.body.prepend(bg);
const gl = bg.getContext('webgl', { antialias: false, alpha: false, premultipliedAlpha: false, powerPreference: 'high-performance' });
const GL = { ok: !!gl, A: PAGES[page].mode, B: PAGES[page].mode, X: 1, c1: [...PAGES[page].c1], c2: [...PAGES[page].c2], P: 0, PO: [0, 0], mouse: [0, 0], mt: [0, 0], scroll: 0, I: 1, It: 1 };

const FRAG = `
precision highp float;
uniform vec2 R,M,PO; uniform float T,P,X,I,S,A,B; uniform vec3 C1,C2;
float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;mat2 m=mat2(1.6,1.2,-1.2,1.6);for(int i=0;i<4;i++){v+=a*noise(p);p=m*p;a*=.5;}return v;}
vec3 stars(vec2 uv){vec3 c=vec3(0);for(int l=0;l<2;l++){float sc=55.+float(l)*85.;vec2 gg=uv*sc+float(l)*17.;vec2 id=floor(gg);vec2 f=fract(gg)-.5;float h=hash(id);if(h>.962){vec2 o=vec2(hash(id+1.),hash(id+2.))-.5;float d=length(f-o*.7);float tw=.55+.45*sin(T*(1.+h*3.)+h*40.);c+=vec3(.82,.86,1.)*smoothstep(.07,0.,d)*tw*(h-.962)*26.;}}return c;}
vec3 nebula(vec2 uv){float t=T*.018;vec2 q=vec2(fbm(uv*1.2+t),fbm(uv*1.2-t+5.2));float f=fbm(uv*1.5+q*1.9+vec2(t*.6,0.));vec3 c=mix(vec3(.006,.008,.02),C1*.28,smoothstep(.38,.98,f));c=mix(c,C2*.24,smoothstep(.55,1.,q.y)*.75);return c*(.55+.45*f);}
vec2 moonC(){return vec2(clamp(.5*R.x/R.y-.42,.18,.62),.02)+M*.035+vec2(0.,S*.35);}
vec3 sMoon(vec2 uv){
  vec2 c=moonC();float Rr=.30;vec2 p=uv-c;float r=length(p);vec3 col=vec3(0);
  float out1=step(Rr,r);
  col+=C1*.65*exp(-max(r-Rr,0.)*10.)*out1+C2*.28*exp(-max(r-Rr,0.)*3.2)*out1;
  if(r<Rr){
    float z=sqrt(Rr*Rr-r*r);vec3 n=normalize(vec3(p,z));
    float lon=atan(n.x,n.z)+T*.02;float lat=asin(clamp(n.y,-1.,1.));vec2 st=vec2(lon,lat)*2.4;
    float h=fbm(st*1.7)*.65+fbm(st*6.)*.35;
    float cr=0.;
    for(int i=0;i<3;i++){vec2 gg=st*(2.5+float(i)*2.6);vec2 id=floor(gg);vec2 f=fract(gg)-.5;float hh=hash(id+float(i)*7.);
      if(hh>.5){vec2 o=(vec2(hash(id+3.),hash(id+9.))-.5)*.45;float d=length(f-o);float rad=.12+.2*hash(id+5.);
        cr+=(-.55*smoothstep(rad,rad*.55,d)+.5*smoothstep(rad*1.3,rad,d)*smoothstep(rad*.85,rad,d))/(1.+float(i)*.8);}}
    vec3 L=normalize(vec3(-.75,.42,.5));
    float dif=dot(n,L);float lit=smoothstep(-.12,.75,dif);
    vec3 alb=mix(vec3(.11,.11,.13),vec3(.9,.9,.94),h)+cr*.28;
    col=alb*lit*1.05;
    float rim=pow(1.-n.z,2.6);
    col+=C1*rim*1.1+C2*rim*rim*.7;
    col+=C1*.035*(1.-lit);
  }
  float ang=atan(p.y,p.x);float sw=mod(ang-T*.55,6.2832);float tr=6.2832-sw;
  col+=C2*smoothstep(.0035,0.,abs(r-Rr*1.5))*(.2+.9*exp(-tr*1.4));
  col+=C1*smoothstep(.003,0.,abs(r-Rr*2.05))*.16;
  col+=C2*.09*exp(-tr*2.2)*smoothstep(Rr*2.05,Rr*1.05,r)*out1;
  return col;
}
vec3 sRadar(vec2 uv){
  vec2 c=vec2(.56,-.04)+M*.02;vec2 p=uv-c;float r=length(p);float a=atan(p.y,p.x);
  float sw=mod(a-T*.85,6.2832);float tr=6.2832-sw;vec3 col=vec3(0);
  float rr=abs(fract(r*5.)-.5)/5.;col+=C1*smoothstep(.0035,0.,rr)*.2*smoothstep(1.25,0.,r);
  float sp=abs(fract(a/6.2832*12.)-.5)/12.*6.2832*r;col+=C1*smoothstep(.0025,0.,sp)*.07*smoothstep(1.,0.,r);
  col+=C2*exp(-tr*3.2)*.32*smoothstep(1.15,0.,r);
  col+=C2*smoothstep(.004,0.,abs(sin(sw)*r))*step(cos(sw),0.)*0.;
  for(int i=0;i<16;i++){float fi=float(i);float ba=fi*2.39+1.;float br=.12+.8*hash(vec2(fi,3.));vec2 bp=vec2(cos(ba),sin(ba))*br;
    float bt=6.2832-mod(ba-T*.85,6.2832);float life=exp(-bt*.8);float d=length(p-bp);
    col+=C2*(smoothstep(.016,0.,d)*1.6+smoothstep(.09,0.,d)*.18)*life;}
  return col;
}
vec3 sPlasma(vec2 uv){
  vec2 p=uv;p.x*=1.5;float t=T*.32;
  float f=fbm(vec2(p.x*2.6,p.y*1.1-t*2.)+fbm(p*1.8+t)*1.6);
  float streak=pow(fbm(vec2(p.x*13.,p.y*.7-t*3.4)),3.)*2.2;
  vec3 col=C1*smoothstep(.45,.98,f)*.62*smoothstep(.85,-.7,uv.y);
  col+=C2*streak*.55*smoothstep(1.,-.8,uv.y);
  col+=mix(C1,vec3(1.),.3)*.22*exp(-(uv.y+.62)*(uv.y+.62)*40.)*(.6+.4*fbm(vec2(uv.x*6.,T)));
  return col;
}
vec3 sWaves(vec2 uv){
  vec3 col=vec3(0);
  for(int i=0;i<8;i++){float fi=float(i);float y=sin(uv.x*(1.8+fi*.65)+T*(.55+fi*.13)+fi*1.7)*(.1+.035*fi)*sin(T*.27+fi)+(fi-3.5)*.085;
    float d=abs(uv.y-y);col+=mix(C1,C2,fi/7.)*(.0022/(d+.0022))*.2;}
  col*=.82+.18*sin(uv.y*700.);
  return col;
}
vec3 sNet(vec2 uv){
  vec2 gg=uv*3.6+vec2(T*.02,0.);vec2 id=floor(gg),f=fract(gg);float md=9.,md2=9.;vec3 col=vec3(0);
  for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){vec2 o=vec2(float(x),float(y));vec2 h2=vec2(hash(id+o),hash(id+o+7.));
    vec2 pt=o+.5+.4*sin(T*.35+6.2831*h2)-f;float d=length(pt);if(d<md){md2=md;md=d;}else if(d<md2){md2=d;}
    col+=C1*(smoothstep(.05,0.,d)*.9+smoothstep(.2,0.,d)*.06);}
  float e=md2-md;col+=C1*smoothstep(.035,0.,e)*.11;
  col+=C2*smoothstep(.025,0.,e)*pow(.5+.5*sin(md*18.-T*3.5),10.)*.35;
  return col;
}
vec3 sVault(vec2 uv){
  float n1=fbm(uv*2.6+vec2(T*.04,0.));float n2=fbm(uv*2.6+n1*2.2+vec2(0.,T*.06));
  float caus=pow(1.-abs(n2*2.-1.),14.);
  vec3 col=mix(C1,C2,n1)*caus*.32;
  vec2 q=uv-vec2(.52,0.);float r=length(q);float a=atan(q.y,q.x);
  col+=C1*smoothstep(.0035,0.,abs(r-.40))*(.35+.65*step(.5,fract((a+T*.12)*12./6.2832)))*.5;
  col+=C2*smoothstep(.003,0.,abs(r-.34))*(.3+.7*step(.8,fract((a-T*.2)*40./6.2832)))*.4;
  col+=C1*smoothstep(.003,0.,abs(r-.47))*.15;
  return col;
}
vec3 scene(float m,vec2 uv){if(m<.5)return sMoon(uv);if(m<1.5)return sRadar(uv);if(m<2.5)return sPlasma(uv);if(m<3.5)return sWaves(uv);if(m<4.5)return sNet(uv);return sVault(uv);}
void main(){
  vec2 uv=(gl_FragCoord.xy-.5*R)/R.y;
  vec3 col=nebula(uv+M*.02)+stars(uv+M*.012);
  vec3 s=X>.999?scene(B,uv):mix(scene(A,uv),scene(B,uv),smoothstep(0.,1.,X));
  col+=s*I;
  vec2 po=(PO-.5*R)/R.y;float d=length(uv-po);float rad=(1.-P)*1.7;
  float w=smoothstep(.07,0.,abs(d-rad))*P;
  col+=mix(C1,C2,.5)*w*1.3+C1*P*P*.1;
  col*=1.-.5*pow(length(uv*vec2(.75,1.)),2.3);
  col=1.-exp(-col*1.5);
  gl_FragColor=vec4(col,1.);
}`;
const QVERT = `attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}`;

// particle swarm: positions computed on GPU from a seed per particle
const PVERT = `
precision highp float;
attribute vec4 a;
uniform vec2 R,M;uniform float T,A,B,X,S,DPR,P;uniform vec3 C1,C2;
varying vec3 vC;varying float vA;
vec2 moonC(){return vec2(clamp(.5*R.x/R.y-.42,.18,.62),.02)+M*.035+vec2(0.,S*.35);}
vec3 form(float m){
  float r=a.x,th=a.y*6.2832,sp=a.z,hh=a.w;
  if(m<.5){vec2 mc=moonC();float rad=.335+pow(r,2.4)*.75+(hh>.7?.04*sin(th*3.+T):0.);float ang=th+T*(.06+sp*.14)/rad;
    vec2 p=vec2(cos(ang)*rad,sin(ang)*rad*.26+(hh-.5)*.03*rad);
    float c=cos(-.32),s=sin(-.32);p=vec2(c*p.x-s*p.y,s*p.x+c*p.y);
    float behind=step(0.,sin(ang))*step(length(p),.31);
    return vec3(p+mc,behind);}
  if(m<1.5){float rad=pow(r,.7)*1.05;float ang=th;vec2 c=vec2(.56,-.04);
    return vec3(c+vec2(cos(ang),sin(ang))*rad+vec2(sin(T*.5+hh*30.),cos(T*.4+hh*20.))*.004,0.);}
  if(m<2.5){float x=(a.y-.5)*2.6;float y=mod(hh*2.2+T*(.05+sp*.22),2.2)-1.1;
    return vec3(x*(.25+.75*r)+sin(T*.8+hh*40.)*.02,y,0.);}
  if(m<3.5){float x=(a.y-.5)*2.8;float lane=floor(r*8.);float y=sin(x*(1.8+lane*.65)+T*(.55+lane*.13)+lane*1.7)*(.1+.035*lane)*sin(T*.27+lane)+(lane-3.5)*.085;
    return vec3(x,y+(hh-.5)*.012,0.);}
  if(m<4.5){float k=floor(hh*9.);vec2 cc=vec2(cos(k*2.4+.5),sin(k*2.4+.5))*vec2(.78,.36)+vec2(.15,0.);
    float rr=pow(r,2.2)*.16;float ang=th+T*(.2+sp*.6);return vec3(cc+vec2(cos(ang),sin(ang))*rr,0.);}
  float ang=th+T*(hh>.5?.07:-.11);float rad=(hh>.5?.40:.34)+(r-.5)*.03+(hh>.85?.07:0.);
  return vec3(vec2(cos(ang),sin(ang))*rad+vec2(.52,0.),0.);
}
void main(){
  float k=smoothstep(0.,1.,X);
  vec3 fa=form(A),fb=form(B);
  float swirl=sin(k*3.1416);
  vec3 f=mix(fa,fb,k);
  f.xy+=vec2(sin(a.y*40.+T),cos(a.x*40.+T))*swirl*.08;
  float asp=R.x/R.y;vec2 mp=M*vec2(.5*asp,.5);
  vec2 d=f.xy-mp;float dl=length(d);f.xy+=normalize(d+1e-5)*.07*exp(-dl*11.);
  f.xy+=normalize(f.xy+1e-5)*P*.05*sin(a.z*20.);
  gl_Position=vec4(f.x/(.5*asp),f.y/.5,0.,1.);
  float w0=mix(A<.5?1.:0.,B<.5?1.:0.,k);
  gl_PointSize=(.8+a.z*2.2+P*2.)*DPR*(1.+w0*.5);
  vC=mix(C1,C2,a.w)*(1.+P);
  if(w0>0.){vC=mix(vC,mix(vec3(1.),C2,a.x),w0*(1.-a.x)*.6);}
  float hide=mix(A<.5?fa.z:0.,B<.5?fb.z:0.,k);
  vA=(.25+.55*a.z)*(1.-hide*.97)*(.55+.45*sin(T*(1.+a.w*3.)+a.x*50.))*(1.+w0*(1.8-a.x*1.4));
}`;
const PFRAG = `precision highp float;varying vec3 vC;varying float vA;void main(){float d=length(gl_PointCoord-.5);float al=smoothstep(.5,0.,d);al*=al;gl_FragColor=vec4(vC*al*vA,1.);}`;

let progQ, progP, uQ = {}, uP = {}, pCount = 0, pbuf;
function sh(type, src) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
function prog(v, f) { const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, v)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, f)); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); return p; }
function unis(p, names) { const o = {}; names.forEach(n => o[n] = gl.getUniformLocation(p, n)); return o; }
if (GL.ok) {
  try {
    progQ = prog(QVERT, FRAG); uQ = unis(progQ, ['R', 'M', 'PO', 'T', 'P', 'X', 'I', 'S', 'A', 'B', 'C1', 'C2']);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    GL.qbuf = gl.getParameter(gl.ARRAY_BUFFER_BINDING);
    progP = prog(PVERT, PFRAG); uP = unis(progP, ['R', 'M', 'T', 'A', 'B', 'X', 'S', 'DPR', 'P', 'C1', 'C2']);
    pCount = innerWidth < 800 ? 4000 : 8000;
    const seeds = new Float32Array(pCount * 4); for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    pbuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, pbuf); gl.bufferData(gl.ARRAY_BUFFER, seeds, gl.STATIC_DRAW);
  } catch (e) { console.warn('[nova] WebGL disabled:', e.message); GL.ok = false; }
}
let SCALE = 1;
function resizeGL() {
  // The background is soft (nebula, glow), so rendering it at ~60% resolution looks the same and costs far less.
  SCALE = innerWidth > 1800 ? .5 : .6;
  bg.width = Math.round(innerWidth * SCALE); bg.height = Math.round(innerHeight * SCALE);
  if (GL.ok) gl.viewport(0, 0, bg.width, bg.height);
}
resizeGL(); addEventListener('resize', resizeGL);
function setScene(p) {
  const m = PAGES[p] || PAGES.overview;
  if (m.mode !== GL.B) { GL.A = GL.X < .5 ? GL.A : GL.B; GL.B = m.mode; GL.X = 0; }
  GL.tc1 = m.c1; GL.tc2 = m.c2;
}
GL.tc1 = GL.c1; GL.tc2 = GL.c2;
function pulse(x, y, s = 1) { GL.P = Math.max(GL.P, s); GL.PO = [x * SCALE, (innerHeight - y) * SCALE]; }

// ================================================================ 2D FX LAYER
const fxc = document.createElement('canvas'); fxc.id = 'nv-fx'; document.body.appendChild(fxc);
const fx = fxc.getContext('2d');
const parts = [], comets = [], rings = [];
function resizeFX() { const d = Math.min(devicePixelRatio || 1, 2); fxc.width = innerWidth * d; fxc.height = innerHeight * d; fx.setTransform(d, 0, 0, d, 0, 0); }
resizeFX(); addEventListener('resize', resizeFX);
const css = v => getComputedStyle(document.body).getPropertyValue(v).trim() || '#ff6a2b';
function burst(x, y, color = css('--acc'), n = 60, speed = 7) {
  if (calm) return;
  for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, v = Math.random() * speed + 1;
    parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, decay: .012 + Math.random() * .02, size: Math.random() * 2.4 + .6, color }); }
  rings.push({ x, y, r: 4, life: 1, color });
}
function comet(label, color = css('--acc')) {
  if (calm) return;
  const y = 120 + Math.random() * innerHeight * .45;
  comets.push({ x: innerWidth + 40, y, vx: -(7 + Math.random() * 5), vy: (Math.random() - .3) * 1.4, label, color, life: 1, trail: [] });
}
function screenFx(kind) {
  if (calm) return;
  const c = 'nv-' + kind; document.body.classList.remove(c); void document.body.offsetWidth; document.body.classList.add(c);
  setTimeout(() => document.body.classList.remove(c), 600);
}
let fxIdle = true;
function drawFX(k = 1) {   // k = elapsed time in 60fps frames, so effects run at the same speed on any machine
  if (!parts.length && !rings.length && !comets.length) { if (!fxIdle) { fx.clearRect(0, 0, innerWidth, innerHeight); fxIdle = true; } return; }
  fxIdle = false;
  fx.clearRect(0, 0, innerWidth, innerHeight);
  fx.globalCompositeOperation = 'lighter';
  const damp = Math.pow(.965, k);
  for (let i = parts.length - 1; i >= 0; i--) { const p = parts[i];
    p.x += p.vx * k; p.y += p.vy * k; p.vx *= damp; p.vy = p.vy * damp + .04 * k; p.life -= p.decay * k;
    if (p.life <= 0) { parts.splice(i, 1); continue; }
    fx.globalAlpha = p.life; fx.fillStyle = p.color; fx.shadowColor = p.color; fx.shadowBlur = 12;
    fx.beginPath(); fx.arc(p.x, p.y, p.size * (0.5 + p.life), 0, 7); fx.fill(); }
  for (let i = rings.length - 1; i >= 0; i--) { const r = rings[i];
    r.r += (9 * r.life + 2) * k; r.life -= .022 * k; if (r.life <= 0) { rings.splice(i, 1); continue; }
    fx.globalAlpha = r.life * .8; fx.strokeStyle = r.color; fx.lineWidth = 2 * r.life; fx.shadowColor = r.color; fx.shadowBlur = 20;
    fx.beginPath(); fx.arc(r.x, r.y, r.r, 0, 7); fx.stroke(); }
  for (let i = comets.length - 1; i >= 0; i--) { const c = comets[i];
    c.x += c.vx * k; c.y += c.vy * k; c.trail.unshift([c.x, c.y]); if (c.trail.length > 34) c.trail.pop();
    if (c.x < -200) { comets.splice(i, 1); continue; }
    fx.shadowColor = c.color; fx.shadowBlur = 18;
    for (let k = 1; k < c.trail.length; k++) { fx.globalAlpha = (1 - k / c.trail.length) * .9; fx.strokeStyle = c.color; fx.lineWidth = 3 * (1 - k / c.trail.length);
      fx.beginPath(); fx.moveTo(...c.trail[k - 1]); fx.lineTo(...c.trail[k]); fx.stroke(); }
    fx.globalAlpha = 1; fx.fillStyle = '#fff'; fx.beginPath(); fx.arc(c.x, c.y, 3, 0, 7); fx.fill();
    fx.shadowBlur = 0; fx.font = '500 11px "IBM Plex Mono", monospace'; fx.fillStyle = c.color; fx.fillText(c.label, c.x + 12, c.y - 10);
    if (Math.random() < .5) parts.push({ x: c.x, y: c.y, vx: Math.random() - .5 + c.vx * .1, vy: Math.random() - .5, life: .8, decay: .03, size: 1.2, color: c.color }); }
  fx.globalAlpha = 1; fx.shadowBlur = 0; fx.globalCompositeOperation = 'source-over';
}

// ================================================================ CURSOR
let mx = innerWidth / 2, my = innerHeight / 2, rx = mx, ry = my;
// The pointer only nudges the background scene (parallax). No custom cursor, trail,
// click bursts, card tilt/glare or magnetic buttons: the UI holds still under the mouse.
addEventListener('pointermove', e => {
  mx = e.clientX; my = e.clientY;
  GL.mt = [(mx / innerWidth) * 2 - 1, -((my / innerHeight) * 2 - 1)];
}, { passive: true });

// ================================================================ TEXT FX
function splitChars(el) {
  if (el.dataset.split) return; el.dataset.split = 1;
  let c = 0;
  const walk = node => [...node.childNodes].forEach(n => {
    if (n.nodeType === 3) {
      const frag = document.createDocumentFragment();
      n.textContent.split(/(\s+)/).forEach(word => {
        if (!word) return;
        if (/^\s+$/.test(word)) { frag.appendChild(document.createTextNode(word)); return; }
        const w = document.createElement('span'); w.style.whiteSpace = 'nowrap';
        [...word].forEach(ch => { const s = document.createElement('span'); s.className = 'ch'; s.style.setProperty('--c', c++); s.textContent = ch; w.appendChild(s); });
        frag.appendChild(w);
      });
      n.replaceWith(frag);
    } else if (n.nodeType === 1 && n.tagName !== 'BR') walk(n);
  });
  walk(el);
}
function playTitle(el) { if (!el) return; splitChars(el); el.classList.remove('nv-play'); void el.offsetWidth; el.classList.add('nv-play'); }
const GLYPHS = '▓▒░<>/\\[]{}=+*^?#01ABCDEF$%';
function scramble(el) {
  if (!el || calm) return;
  const final = el.dataset.final || (el.dataset.final = el.textContent); let f = 0; const total = 26;
  clearInterval(el._sc);
  el._sc = setInterval(() => {
    f++; const n = Math.floor(final.length * f / total);
    el.textContent = final.slice(0, n) + [...final.slice(n)].map(ch => ch === ' ' ? ' ' : GLYPHS[Math.random() * GLYPHS.length | 0]).join('');
    if (f >= total) { clearInterval(el._sc); el.textContent = final; }
  }, 28);
}
function rollNumber(el, to, fmtFn = v => Math.round(v).toLocaleString()) {
  const from = +el.dataset.v || 0; if (from === to && el.textContent !== 'n/a') return; el.dataset.v = to;
  const t0 = performance.now(), dur = 900;
  const step = t => { const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 4); el.textContent = fmtFn(from + (to - from) * e); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}

// ================================================================ PAGE HEADS + INSTRUMENTS
const vizzes = [];   // {canvas, kind, mini}
function mountViz(canvas, kind, mini = false) {
  const o = { canvas, kind, mini, ctx: canvas.getContext('2d'), w: 0, h: 0, hits: [] };
  const ro = new ResizeObserver(() => { const d = Math.min(devicePixelRatio || 1, 1.5), r = canvas.getBoundingClientRect(); o.w = r.width; o.h = r.height; canvas.width = r.width * d; canvas.height = r.height * d; o.ctx.setTransform(d, 0, 0, d, 0, 0); });
  ro.observe(canvas);
  // only draw instruments that are actually on screen
  new IntersectionObserver(es => es.forEach(e => o.vis = e.isIntersecting)).observe(canvas);
  vizzes.push(o); return o;
}
for (const [id, m] of Object.entries(PAGES)) {
  if (!m.title) continue;
  const sec = q('#p-' + id); if (!sec || sec.querySelector('.nv-head')) continue;
  const head = document.createElement('div'); head.className = 'nv-head';
  head.innerHTML = `<div><div class="nv-eyebrow"><span>${m.n}</span> ${m.eye}</div><h1 class="nv-title">${m.title}</h1><p class="nv-sub">${m.sub}</p></div>` +
    (m.viz ? `<div class="nv-viz"><canvas class="nv-click" data-viz="${m.viz}"></canvas><i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i><span class="tag">${m.tag}</span><span class="readout" data-ro="${m.viz}">initialising…</span><span class="readout readout-r" data-ro2="${m.viz}"></span></div>` : '');
  sec.prepend(head);
}
qa('canvas[data-viz]').forEach(c => mountViz(c, c.dataset.viz, !!c.closest('.ov-sys')));

// --- shared state for instruments
const bay = { rockets: [], total: 0 };
const scope = { spikes: [], lastCount: 0 };
const vault = { total: 0, pnl: null, shown: 0 };
const graphFlash = [];
function ro(kind, text, right) { const a = q(`[data-ro="${kind}"]`), b = q(`[data-ro2="${kind}"]`); if (a && text != null) a.textContent = text; if (b && right != null) b.textContent = right; }

const DRAW = {
  radar(o, t) {
    const { ctx: c, w, h } = o, cx = w * (o.mini ? .5 : .62), cy = h * .5, R = Math.min(w * (o.mini ? .45 : .42), h * .46);
    const acc = o.mini ? '#3de8ff' : css('--acc'), acc2 = o.mini ? '#3dffb0' : css('--acc2');
    c.clearRect(0, 0, w, h); c.lineWidth = 1;
    for (let i = 1; i <= 4; i++) { c.strokeStyle = 'rgba(61,232,255,' + (.08 + i * .03) + ')'; c.beginPath(); c.arc(cx, cy, R * i / 4, 0, 7); c.stroke(); }
    c.strokeStyle = 'rgba(61,232,255,.08)'; for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); c.stroke(); }
    const sweep = (t * .0011) % (Math.PI * 2);
    const grd = c.createConicGradient ? c.createConicGradient(sweep - Math.PI * .5, cx, cy) : null;
    if (grd) { grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(.82, 'rgba(0,0,0,0)'); grd.addColorStop(1, acc.startsWith('#') ? acc + '55' : 'rgba(61,232,255,.33)');
      c.fillStyle = grd; c.save(); c.translate(cx, cy); c.rotate(Math.PI * .5); c.translate(-cx, -cy); c.beginPath(); c.arc(cx, cy, R, 0, 7); c.fill(); c.restore(); }
    c.strokeStyle = acc; c.shadowColor = acc; c.shadowBlur = 14; c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(sweep) * R, cy + Math.sin(sweep) * R); c.stroke(); c.shadowBlur = 0;
    const toks = (g('tokens') || []).slice(0, 80); o.hits = [];
    toks.forEach(({ pair, a }) => {
      const ang = hashStr(pair.baseToken.address) * Math.PI * 2, rr = R * (1 - a.momentum / 100 * .88);
      const x = cx + Math.cos(ang) * rr, y = cy + Math.sin(ang) * rr;
      let since = sweep - ang; while (since < 0) since += Math.PI * 2;
      const glow = Math.exp(-since * 1.1);
      const col = a.safety >= 70 ? '#4fd68a' : a.safety >= 45 ? '#f0b43c' : '#ff5f56';
      c.globalAlpha = .25 + .75 * glow; c.fillStyle = col; c.shadowColor = col; c.shadowBlur = 16 * glow;
      c.beginPath(); c.arc(x, y, 2 + glow * 3 + (a.momentum > 70 ? 1.5 : 0), 0, 7); c.fill();
      if (!o.mini && (glow > .35 || a.momentum >= 75)) { c.shadowBlur = 0; c.globalAlpha = .5 + glow * .5; c.font = '10px "IBM Plex Mono", monospace'; c.fillText('$' + pair.baseToken.symbol, x + 8, y - 6); }
      o.hits.push({ x, y, addr: pair.baseToken.address });
    });
    c.globalAlpha = 1; c.shadowBlur = 0;
    c.fillStyle = acc2; c.beginPath(); c.arc(cx, cy, 3, 0, 7); c.fill();
    if (!o.mini) { const hot = toks.filter(x => x.a.momentum >= 60).length; ro('radar', `${toks.length} contacts · ${hot} running hot`, 'click a blip to inspect'); }
  },
  bay(o, t) {
    const { ctx: c, w, h } = o, acc = o.mini ? '#ff7a3d' : css('--acc'), acc2 = o.mini ? '#ffc861' : css('--acc2');
    c.clearRect(0, 0, w, h);
    const lanes = 6;
    for (let i = 0; i < lanes; i++) { const y = h * (i + 1) / (lanes + 1); c.strokeStyle = 'rgba(255,122,61,.09)'; c.setLineDash([2, 8]); c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
    c.setLineDash([]);
    const sx = w * .08; c.fillStyle = 'rgba(255,122,61,.08)'; c.fillRect(0, 0, sx, h);
    c.strokeStyle = acc; c.globalAlpha = .4 + .3 * Math.sin(t * .004); c.beginPath(); c.moveTo(sx, 0); c.lineTo(sx, h); c.stroke(); c.globalAlpha = 1;
    if (o.mini && bay.rockets.length < 3 && Math.random() < .02) bay.rockets.push(mkRocket('$' + ['MOON', 'PEPE', 'CAT', 'DOGE', 'WIF', 'BONK'][Math.random() * 6 | 0], true));
    bay.rockets.forEach(r => { if (o.mini !== r.mini) return;
      r.x += r.v * (o.mini ? .6 : 1); r.v *= 1.012; const x = sx + r.x * (w - sx), y = h * (r.lane + 1) / (lanes + 1);
      const grad = c.createLinearGradient(x - 140, y, x, y); grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(1, acc);
      c.strokeStyle = grad; c.lineWidth = 2.5; c.shadowColor = acc; c.shadowBlur = 16; c.beginPath(); c.moveTo(Math.max(sx, x - 140), y); c.lineTo(x, y); c.stroke();
      c.fillStyle = '#fff'; c.beginPath(); c.arc(x, y, 3, 0, 7); c.fill(); c.shadowBlur = 0;
      if (!o.mini || r.x < .7) { c.fillStyle = acc2; c.font = '11px "IBM Plex Mono", monospace'; c.fillText(r.label, x + 9, y - 7); }
    });
    bay.rockets = bay.rockets.filter(r => r.x < 1.15);
    if (!o.mini) {
      if (!bay.rockets.some(r => !r.mini)) { c.fillStyle = 'rgba(255,200,97,' + (.35 + .25 * Math.sin(t * .003)) + ')'; c.font = '11px "IBM Plex Mono", monospace'; c.fillText('AWAITING NEXT MINT…', sx + 22, h / 2 + 4); }
      ro('bay', `${g('launches') || 0} launches this session`, `tracking ${(g('coins') || new Map()).size}`);
    }
  },
  scope(o, t) {
    const { ctx: c, w, h } = o, acc = o.mini ? '#a46bff' : css('--acc'), acc2 = o.mini ? '#ff4fd8' : css('--acc2');
    c.clearRect(0, 0, w, h);
    c.strokeStyle = 'rgba(164,107,255,.08)'; c.lineWidth = 1;
    for (let x = 0; x < w; x += 28) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke(); }
    for (let y = 0; y < h; y += 28) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
    if (o.mini && Math.random() < .01) scope.spikes.push({ x: 1, a: .4 + Math.random() * .5, big: Math.random() < .2 });
    [acc2, acc].forEach((col, li) => {
      c.beginPath(); c.strokeStyle = col; c.lineWidth = li ? 2 : 1; c.shadowColor = col; c.shadowBlur = li ? 14 : 6; c.globalAlpha = li ? 1 : .5;
      for (let x = 0; x <= w; x += 2) {
        const u = x / w; let y = Math.sin(u * 22 + t * .004 + li) * 4 + Math.sin(u * 61 - t * .007) * 2;
        scope.spikes.forEach(s => { const d = (u - s.x) * 60; y += Math.exp(-d * d) * s.a * h * .38 * Math.sin(d * 3) * (li ? 1 : .6); });
        x ? c.lineTo(x, h / 2 + y) : c.moveTo(x, h / 2 + y);
      }
      c.stroke();
    });
    c.shadowBlur = 0; c.globalAlpha = 1;
    scope.spikes.forEach(s => { s.x -= .0035; if (s.big && s.x > 0) { c.fillStyle = '#ff5f56'; c.font = '10px "IBM Plex Mono", monospace'; c.fillText('▲ BIG MOVE', s.x * w + 6, 18); } });
    scope.spikes = scope.spikes.filter(s => s.x > -.1);
    if (!o.mini) { const xt = g('xTweets'); const n = xt ? xt.size : 0; const key = (g('xKey') || (() => null))();
      ro('scope', key ? `${n} posts intercepted` : 'no feed key · standing by', key ? 'listening' : ''); }
  },
  graph(o, t) {
    const { ctx: c, w, h } = o, acc = o.mini ? '#3dffb0' : css('--acc'), acc2 = o.mini ? '#d4ff3d' : css('--acc2');
    c.clearRect(0, 0, w, h);
    let wallets = (g('getWallets') || (() => []))(); const trades = (g('smartTrades') || []).slice(0, 40);
    const demo = !wallets.length || o.mini;
    if (demo) wallets = Array.from({ length: 6 }, (_, i) => ({ addr: 'demo' + i, name: '' }));
    const mints = demo ? Array.from({ length: 5 }, (_, i) => ({ mint: 'c' + i, symbol: '' })) :
      [...new Map(trades.map(tr => [tr.mint, { mint: tr.mint, symbol: tr.symbol }])).values()].slice(0, 9);
    const wp = {}, mp = {};
    wallets.forEach((wl, i) => { const a = (i / wallets.length) * Math.PI * 2 + t * .00012; wp[wl.addr] = [w * .3 + Math.cos(a) * w * .18, h / 2 + Math.sin(a) * h * .34]; });
    mints.forEach((m, i) => { const a = (i / Math.max(1, mints.length)) * Math.PI * 2 - t * .00018; mp[m.mint] = [w * .72 + Math.cos(a) * w * .15, h / 2 + Math.sin(a) * h * .32]; });
    const edges = demo ? wallets.flatMap((wl, i) => [[wl.addr, 'c' + (i % 5), 'buy'], [wl.addr, 'c' + ((i * 3 + 1) % 5), i % 3 ? 'buy' : 'sell']]) :
      trades.filter(tr => wp[tr.wallet?.addr] && mp[tr.mint]).map(tr => [tr.wallet.addr, tr.mint, tr.txType]);
    edges.forEach(([a, b, side], k) => { const p1 = wp[a], p2 = mp[b]; if (!p1 || !p2) return;
      const col = side === 'buy' ? acc : '#ff5f56'; c.strokeStyle = col; c.globalAlpha = .18; c.lineWidth = 1;
      c.beginPath(); c.moveTo(...p1); c.quadraticCurveTo(w / 2, h / 2 + (k % 2 ? -40 : 40), ...p2); c.stroke();
      const u = ((t * .0004 + k * .17) % 1); const ix = (1 - u) * (1 - u) * p1[0] + 2 * (1 - u) * u * (w / 2) + u * u * p2[0], iy = (1 - u) * (1 - u) * p1[1] + 2 * (1 - u) * u * (h / 2 + (k % 2 ? -40 : 40)) + u * u * p2[1];
      c.globalAlpha = .9; c.fillStyle = col; c.shadowColor = col; c.shadowBlur = 10; c.beginPath(); c.arc(ix, iy, 2, 0, 7); c.fill(); c.shadowBlur = 0; });
    c.globalAlpha = 1;
    const now = performance.now();
    wallets.forEach(wl => { const [x, y] = wp[wl.addr]; const fl = graphFlash.find(f => f.addr === wl.addr && now - f.t < 1500);
      c.fillStyle = acc; c.shadowColor = acc; c.shadowBlur = fl ? 30 : 12; c.beginPath(); c.arc(x, y, fl ? 7 : 4.5, 0, 7); c.fill(); c.shadowBlur = 0;
      if (!demo && wl.name) { c.fillStyle = 'rgba(236,231,221,.8)'; c.font = '10px "IBM Plex Mono", monospace'; c.fillText(wl.name.slice(0, 12), x + 8, y + 3); } });
    mints.forEach(m => { const [x, y] = mp[m.mint]; c.strokeStyle = acc2; c.lineWidth = 1.5; c.shadowColor = acc2; c.shadowBlur = 10;
      c.beginPath(); c.arc(x, y, 6, 0, 7); c.stroke(); c.shadowBlur = 0;
      if (!demo && m.symbol) { c.fillStyle = acc2; c.font = '10px "IBM Plex Mono", monospace'; c.fillText('$' + m.symbol, x + 10, y + 3); } });
    if (!o.mini) {
      if (demo) { c.fillStyle = 'rgba(236,231,221,' + (.45 + .2 * Math.sin(t * .003)) + ')'; c.font = '11px "IBM Plex Mono", monospace'; c.fillText('ADD A WALLET → ITS FOOTPRINTS APPEAR HERE', 22, 34); }
      ro('graph', `${demo ? 0 : wallets.length} wallets · ${demo ? 0 : mints.length} coins touched`, `${trades.length} trades seen`);
    }
  },
  vault(o, t) {
    const { ctx: c, w, h } = o, acc = o.mini ? '#ffc861' : css('--acc'), acc2 = o.mini ? '#ff9e5e' : css('--acc2');
    c.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2, R = Math.min(w, h) * .36;
    vault.shown = lerp(vault.shown, vault.total, .06);
    c.lineWidth = 1; c.strokeStyle = 'rgba(255,200,97,.15)'; c.beginPath(); c.arc(cx, cy, R * 1.22, 0, 7); c.stroke();
    for (let i = 0; i < 72; i++) { const a = i / 72 * Math.PI * 2 + t * .0002; const l = i % 6 ? 4 : 10;
      c.strokeStyle = i % 6 ? 'rgba(255,200,97,.25)' : acc; c.beginPath(); c.moveTo(cx + Math.cos(a) * R * 1.1, cy + Math.sin(a) * R * 1.1); c.lineTo(cx + Math.cos(a) * (R * 1.1 + l), cy + Math.sin(a) * (R * 1.1 + l)); c.stroke(); }
    c.lineWidth = 10; c.strokeStyle = 'rgba(255,255,255,.05)'; c.beginPath(); c.arc(cx, cy, R, 0, 7); c.stroke();
    const pnl = o.mini ? Math.sin(t * .0008) * .5 : (vault.pnl ?? 0);
    const frac = o.mini ? .5 + .4 * Math.sin(t * .0006) : Math.max(.03, Math.min(1, .5 + pnl / Math.max(1, vault.total) * .5));
    const col = pnl >= 0 ? acc : '#ff5f56';
    c.strokeStyle = col; c.shadowColor = col; c.shadowBlur = 24; c.lineCap = 'round';
    c.beginPath(); c.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2); c.stroke(); c.shadowBlur = 0; c.lineCap = 'butt';
    const sa = t * .0015; c.lineWidth = 2; c.strokeStyle = acc2; c.globalAlpha = .7; c.beginPath(); c.arc(cx, cy, R * .78, sa, sa + .7); c.stroke(); c.globalAlpha = 1;
    if (!o.mini) {
      c.textAlign = 'center'; c.fillStyle = '#ece7dd'; c.font = `${Math.round(R * .42)}px "Bricolage Grotesque", sans-serif`;
      c.fillText(vault.total ? '$' + vault.shown.toFixed(2) : 'n/a', cx, cy + R * .1);
      c.font = '10px "IBM Plex Mono", monospace'; c.fillStyle = vault.pnl == null ? 'rgba(236,231,221,.5)' : (vault.pnl >= 0 ? '#4fd68a' : '#ff5f56');
      c.fillText(vault.pnl == null ? 'CONNECT OR PASTE A WALLET' : `P/L ${vault.pnl >= 0 ? '+' : '−'}$${Math.abs(vault.pnl).toFixed(2)}`, cx, cy + R * .42); c.textAlign = 'left';
      ro('vault', vault.total ? 'vault unlocked' : 'vault sealed', (g('getTrades') || (() => []))().length + ' alerts armed');
    }
  },
  atlas(o, t) {
    const { ctx: c, w, h } = o, acc = css('--acc'), acc2 = css('--acc2');
    c.clearRect(0, 0, w, h);
    const pad = 46, X = s => pad + (s / 100) * (w - pad * 2), Y = m => h - pad - (m / 100) * (h - pad * 2);
    c.fillStyle = 'rgba(79,214,138,.05)'; c.fillRect(X(60), Y(100), X(100) - X(60), Y(60) - Y(100));
    c.strokeStyle = 'rgba(255,255,255,.06)'; c.lineWidth = 1;
    for (let i = 0; i <= 10; i++) { c.beginPath(); c.moveTo(X(i * 10), pad); c.lineTo(X(i * 10), h - pad); c.stroke(); c.beginPath(); c.moveTo(pad, Y(i * 10)); c.lineTo(w - pad, Y(i * 10)); c.stroke(); }
    c.font = '10px "IBM Plex Mono", monospace'; c.fillStyle = 'rgba(79,214,138,.6)'; c.fillText('HOT + SOLID', X(62), Y(97));
    c.fillStyle = 'rgba(255,61,110,.55)'; c.fillText('HOT + RISKY', X(2), Y(97));
    const toks = (g('tokens') || []).slice(0, 120);
    const pts = toks.map(({ pair, a }) => {
      const j = hashStr(pair.baseToken.address);
      return { x: X(a.safety) + (j - .5) * 14, y: Y(a.momentum) + (hashStr(pair.pairAddress || 'x') - .5) * 14, r: 1.5 + Math.min(7, Math.log10((a.v1 || 0) + 10) * 1.3), pair, a, j };
    });
    c.lineWidth = 1;
    pts.forEach((p, i) => { const near = pts.map((q2, k) => ({ k, d: Math.hypot(q2.x - p.x, q2.y - p.y) })).filter(z => z.k !== i).sort((a, b) => a.d - b.d).slice(0, 2);
      near.forEach(z => { if (z.d > 120) return; c.strokeStyle = acc; c.globalAlpha = .14 * (1 - z.d / 120); c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(pts[z.k].x, pts[z.k].y); c.stroke(); }); });
    const hover = o.hover;
    pts.forEach(p => { const tw = .6 + .4 * Math.sin(t * .003 + p.j * 50);
      const col = p.a.safety >= 70 ? '#4fd68a' : p.a.safety >= 45 ? '#f0b43c' : '#ff5f56';
      c.globalAlpha = tw; c.fillStyle = col; c.shadowColor = col; c.shadowBlur = 18;
      c.beginPath(); c.arc(p.x, p.y, p.r, 0, 7); c.fill();
      const isH = hover && Math.hypot(hover[0] - p.x, hover[1] - p.y) < 16;
      if (isH || p.a.momentum >= 80) { c.shadowBlur = 0; c.globalAlpha = 1; c.fillStyle = '#ece7dd'; c.fillText('$' + p.pair.baseToken.symbol + (isH ? `  M${p.a.momentum} S${p.a.safety}` : ''), p.x + p.r + 6, p.y - 4);
        if (isH) { c.strokeStyle = acc2; c.beginPath(); c.arc(p.x, p.y, p.r + 8 + Math.sin(t * .01) * 2, 0, 7); c.stroke(); } } });
    c.globalAlpha = 1; c.shadowBlur = 0;
    o.hits = pts.map(p => ({ x: p.x, y: p.y, p }));
    ro('atlas', `${pts.length} stars · ${pts.filter(p => p.a.momentum >= 60 && p.a.safety >= 60).length} in the hot + solid corner`);
  },
};
document.addEventListener('pointermove', e => {
  const cv = e.target.closest && e.target.closest('canvas[data-viz="atlas"]'); const o = vizzes.find(v => v.kind === 'atlas'); if (!o) return;
  if (!cv) { o.hover = null; return; } const r = cv.getBoundingClientRect(); o.hover = [e.clientX - r.left, e.clientY - r.top];
}, { passive: true });
document.addEventListener('click', e => {
  const cv = e.target.closest && e.target.closest('canvas[data-viz="atlas"]'); if (!cv) return;
  const o = vizzes.find(v => v.canvas === cv), r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  const hit = (o.hits || []).map(hh => ({ ...hh, d: Math.hypot(hh.x - x, hh.y - y) })).sort((a, b) => a.d - b.d)[0];
  if (!hit || hit.d > 22 || typeof window.dexCard !== 'function') return;
  burst(e.clientX, e.clientY, css('--acc2'), 50, 7); pulse(e.clientX, e.clientY, .5);
  const d = q('#signal-detail'); d.innerHTML = '<div class="nv-eyebrow">SIGNAL INSPECTOR</div>' + window.dexCard(hit.p.pair, hit.p.a);
  const card = d.querySelector('.card'); if (card) { card.style.setProperty('--i', 0); card.style.animation = 'nv-rise .9s var(--ease) both'; }
});
function mkRocket(label, mini = false) { return { label, lane: Math.random() * 6 | 0, x: 0, v: .0025 + Math.random() * .002, mini }; }

// clicking a radar blip opens that coin
document.addEventListener('click', e => {
  const cv = e.target.closest && e.target.closest('canvas[data-viz="radar"]'); if (!cv) return;
  const o = vizzes.find(v => v.canvas === cv), r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  const hit = o.hits.map(hh => ({ ...hh, d: Math.hypot(hh.x - x, hh.y - y) })).sort((a, b) => a.d - b.d)[0];
  if (hit && hit.d < 22 && window.lookupCoin) { burst(e.clientX, e.clientY, css('--acc2'), 40, 6); window.lookupCoin(hit.addr); }
});

// ================================================================ OVERVIEW
function updateOverview() {
  const toks = g('tokens') || [];
  const set = (k, v, f) => { const el = q(`[data-count="${k}"]`); if (el) rollNumber(el, v, f); };
  set('launches', g('launches') || 0); set('pairs', toks.length); set('hot', toks.filter(t => t.a.momentum >= 60).length);
  const sol = g('solUsd'); if (sol) set('sol', sol, v => '$' + v.toFixed(2));
  const hud = q('#ov-hud-hot'); const top = [...toks].sort((a, b) => b.a.momentum - a.a.momentum)[0];
  if (hud && top) hud.textContent = '$' + top.pair.baseToken.symbol + ' · M' + top.a.momentum;
}

// ================================================================ TICKER
const ticker = document.createElement('div'); ticker.id = 'nv-ticker'; ticker.innerHTML = '<div class="track"></div>';
const ab = q('#alertBar'); ab.parentNode.insertBefore(ticker, ab);
function updateTicker() {
  const toks = [...(g('tokens') || [])].sort((a, b) => b.a.momentum - a.a.momentum).slice(0, 24); if (!toks.length) return;
  const item = ({ pair, a }) => `<a href="#" data-addr="${pair.baseToken.address}">◆ <b>$${String(pair.baseToken.symbol).replace(/[<>&"]/g, '')}</b> <span class="${a.c1 >= 0 ? 'up' : 'down'}">${a.c1 >= 0 ? '▲' : '▼'}${Math.abs(a.c1).toFixed(1)}%</span> · M${a.momentum} · S${a.safety}</a>`;
  const html = toks.map(item).join('');
  ticker.querySelector('.track').innerHTML = html + html;
}
ticker.addEventListener('click', e => { const a = e.target.closest('a[data-addr]'); if (!a) return; e.preventDefault(); window.lookupCoin && window.lookupCoin(a.dataset.addr); });

// ================================================================ NAV / TRANSITIONS
const nav = q('nav'); const lens = document.createElement('span'); lens.id = 'nv-lens'; nav.prepend(lens);
function moveLens() {
  const b = q('nav button.on'); if (!b) return;
  const hidden = b.classList.contains('nv-hidden');
  q('.nv-more-btn')?.classList.toggle('on', hidden);
  lens.style.opacity = hidden ? 0 : 1;
  if (!hidden) { lens.style.left = b.offsetLeft + 'px'; lens.style.width = b.offsetWidth + 'px'; }
}
// "More" dropdown: its items click the hidden nav buttons so the app's own page switching runs
const more = q('.nv-more');
if (more) {
  more.querySelector('.nv-more-btn').addEventListener('click', e => { e.stopPropagation(); more.classList.toggle('open'); });
  more.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', e => { lastClick = [e.clientX, e.clientY]; more.classList.remove('open'); q(`nav button[data-p="${b.dataset.go}"]`).click(); }));
  document.addEventListener('click', e => { if (!more.contains(e.target)) more.classList.remove('open'); });
}
let lastClick = [innerWidth / 2, 80];
qa('nav button[data-p]').forEach((b, i) => {
  b.addEventListener('pointerdown', e => lastClick = [e.clientX, e.clientY]);
  b.addEventListener('click', () => goPage(b.dataset.p));
});
function goPage(p) {
  if (!PAGES[p]) return;
  const changed = p !== page; page = p; document.body.dataset.page = p;
  setScene(p); moveLens();
  if (!changed) return;
  if (location.hash.slice(1) !== p && !/wallet=/.test(location.hash)) history.replaceState(null, '', '#' + p);
  window.scrollTo({ top: 0, behavior: 'instant' });
  // page content swaps instantly; only the background scene cross-dissolves
  const [x, y] = lastClick;
  pulse(x, y, .6); window.SFX && SFX.page();
}
qa('[data-open]').forEach(b => b.addEventListener('click', e => { lastClick = [e.clientX, e.clientY]; const nb = q(`nav button[data-p="${b.dataset.open}"]`); nb && nb.click(); }));
addEventListener('resize', moveLens); setTimeout(moveLens, 300); document.fonts && document.fonts.ready.then(moveLens);
const startHash = location.hash.slice(1); if (PAGES[startHash] && startHash !== page) setTimeout(() => q(`nav button[data-p="${startHash}"]`)?.click(), 50);
addEventListener('hashchange', () => { const h = location.hash.slice(1); if (PAGES[h] && h !== page) q(`nav button[data-p="${h}"]`)?.click(); });

// ================================================================ HOOKS INTO LIVE DATA
function wrap(name, after) {
  const orig = window[name]; if (typeof orig !== 'function') return;
  window[name] = function (...args) { const r = orig.apply(this, args); try { after(...args); } catch (e) { } return r; };
}
wrap('onCreate', m => {
  bay.total++; bay.rockets.push(mkRocket('$' + (m.symbol || '???')));
  if (page === 'pump') { comet('$' + m.symbol, css('--acc')); pulse(innerWidth * .85, 160, .35); window.SFX && SFX.launch(); }
  else if (page === 'overview' && Math.random() < .5) comet('$' + m.symbol, '#ff9e5e');
});
wrap('onSmartTrade', (m, wallet, opts = {}) => {
  if (opts.silent) return;
  graphFlash.push({ addr: wallet.addr, t: performance.now() }); if (graphFlash.length > 30) graphFlash.shift();
  const b = q('nav button[data-p="smart"]').getBoundingClientRect();
  burst(b.left + b.width / 2, b.top + b.height / 2, m.txType === 'buy' ? '#4fd68a' : '#ff5f56', 50, 6);
  window.SFX && (m.txType === 'buy' ? SFX.buy() : SFX.sell());
});
wrap('showAlert', html => {
  const s = String(html);
  const cx = innerWidth / 2, cy = 140;
  const bar = q('#alertBar'); bar.className = '';
  if (/BIG MOVE|ic-siren/.test(s)) { bar.className = 'nv-al-big'; SFX.big(); pulse(cx, cy, 1); screenFx('shake'); screenFx('chroma'); burst(cx, cy, '#ff5f56', 140, 10); scope.spikes.push({ x: 1, a: 1, big: true }); }
  else if (/ic-target/.test(s)) { bar.className = 'nv-al-win'; SFX.target(); pulse(cx, cy, 1); for (let i = 0; i < 6; i++) setTimeout(() => burst(Math.random() * innerWidth, 120 + Math.random() * 260, i % 2 ? '#f0b43c' : '#4fd68a', 80, 10), i * 150); }
  else if (/ic-stop/.test(s)) { bar.className = 'nv-al-stop'; SFX.stop(); screenFx('chroma'); screenFx('shake'); burst(cx, cy, '#ff5f56', 60, 6); }
  else { SFX.msg(); pulse(cx, cy, .6); burst(cx, cy, css('--acc'), 60, 7); }
});
wrap('renderScanner', () => { updateTicker(); updateOverview(); });
wrap('renderX', () => {
  const xt = g('xTweets'); const n = xt ? xt.size : 0;
  if (n > scope.lastCount) { for (let i = 0; i < Math.min(4, n - scope.lastCount); i++) scope.spikes.push({ x: 1 + i * .06, a: .5 + Math.random() * .4, big: false }); }
  scope.lastCount = n;
});
// vault readout from the My Wallet summary
const ms = q('#mineSummary');
if (ms) new MutationObserver(() => {
  const stats = [...ms.querySelectorAll('.stat')]; const num = s => parseFloat(String(s).replace(/[^0-9.\-−]/g, '').replace('−', '-')) * (/K$/.test(s) ? 1e3 : /M$/.test(s) ? 1e6 : 1);
  const tv = stats.find(s => /Total value/i.test(s.textContent)); if (tv) vault.total = num(tv.querySelector('b').textContent) || 0;
  const pl = stats.find(s => /P\/L/i.test(s.textContent)); const pt = pl && pl.querySelector('b').textContent;
  vault.pnl = pt && /\d/.test(pt) ? (pt.trim().startsWith('−') ? -1 : 1) * num(pt.replace('−', '')) : (vault.total ? null : null);
}).observe(ms, { childList: true, subtree: true, characterData: true });

// ================================================================ BOOT SEQUENCE (once per session)
function boot() {
  if (calm || sessionStorage.getItem('nv-booted')) return;
  sessionStorage.setItem('nv-booted', 1);
  const el = document.createElement('div'); el.id = 'nv-boot';
  el.innerHTML = '<canvas></canvas><div class="bt"><h1>Lun<em>ex</em></h1><pre></pre></div><div class="skip">CLICK TO SKIP</div>';
  document.body.appendChild(el);
  const cv = el.querySelector('canvas'), c = cv.getContext('2d'); cv.width = innerWidth; cv.height = innerHeight;
  const lines = ['dexscreener pairs .............. <b>OK</b>', 'pumpportal stream .............. <b>OK</b>', 'solana rpc relay ............... <b>OK</b>', 'scoring model .................. <b>OK</b>'];
  let li = 0; const pre = el.querySelector('pre');
  const typer = setInterval(() => { if (li < lines.length) pre.innerHTML += (li ? '\n' : '') + lines[li++]; }, 300);
  let t0 = performance.now(), alive = true;
  const loop = t => { if (!alive) return; const k = (t - t0) / 1000; c.fillStyle = 'rgba(2,3,10,.2)'; c.fillRect(0, 0, cv.width, cv.height);
    const cx = cv.width / 2, cy = cv.height / 2, R = Math.max(cv.width, cv.height) * .6, a = k * 2.6;
    c.strokeStyle = 'rgba(236,231,221,.08)'; for (let i = 1; i < 8; i++) { c.beginPath(); c.arc(cx, cy, R * i / 8, 0, 7); c.stroke(); }
    c.strokeStyle = '#ff6a2b'; c.lineWidth = 1.5; c.shadowColor = '#ff6a2b'; c.shadowBlur = 12; c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); c.stroke(); c.shadowBlur = 0; c.lineWidth = 1;
    requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  el.addEventListener('pointerdown', () => setTimeout(() => window.SFX && SFX.boot(), 30), { once: true });
  const end = () => { if (!alive) return; alive = false; clearInterval(typer); el.classList.add('out'); pulse(innerWidth / 2, innerHeight / 2, 1); setTimeout(() => el.remove(), 1200); };
  el.addEventListener('click', end); setTimeout(end, 2500);
}
boot();

// ================================================================ ICON SET
// Hand-drawn 24px line icons, rendered with CSS masks so they take the text colour.
const ICONS = {
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  'bell-off': '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="M2 2l20 20"/>',
  siren: '<path d="M7 18v-6a5 5 0 1 1 10 0v6"/><path d="M5 21h14v-3H5z"/><path d="M21 12h1M18.5 4.5L18 5M2 12h1M12 2v1M4.9 4.9l.7.7"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  network: '<circle cx="5" cy="6" r="2.5"/><circle cx="19" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M6.5 8l4 8M17.5 8l-4 8M7.5 6h9"/>',
  zap: '<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  wallet: '<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.1-.2-4 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.3 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  warn: '<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>',
  snow: '<path d="M2 12h20M12 2v20M20 16l-4-4 4-4M4 8l4 4-4 4M16 4l-4 4-4-4M8 20l4-4 4 4"/>',
  chart: '<path d="M22 7l-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
  down: '<path d="M22 17l-8.5-8.5-5 5L2 7"/><path d="M16 17h6v-6"/>',
  star: '<path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>',
  crown: '<path d="M2 18h20M2 18L4 7l5 5 3-7 3 7 5-5 2 11"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  repeat: '<path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
  msg: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21.2l8.8-8.8a5.5 5.5 0 0 0 0-7.8z"/>',
  stop: '<path d="M7.9 2h8.2L22 7.9v8.2L16.1 22H7.9L2 16.1V7.9z"/><path d="M15 9l-6 6M9 9l6 6"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
  send: '<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  pill: '<path d="M10.5 20.5l10-10a5 5 0 1 0-7-7l-10 10a5 5 0 1 0 7 7z"/><path d="M8.5 8.5l7 7"/>',
  skull: '<circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><path d="M8 20v2h8v-2"/><path d="M16 20a2 2 0 0 0 1.6-3.3 8 8 0 1 0-11.2 0A2 2 0 0 0 8 20"/>',
  compass: '<circle cx="12" cy="12" r="10"/><path d="M16.2 7.8l-2.1 6.3-6.3 2.1 2.1-6.3z"/>',
  ban: '<circle cx="12" cy="12" r="10"/><path d="M4.9 4.9l14.2 14.2"/>',
  minus: '<path d="M5 12h14"/>',
  sound: '<path d="M11 5L6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>',
  mute: '<path d="M11 5L6 9H2v6h4l5 4z"/><path d="M22 9l-6 6M16 9l6 6"/>',
  spark: '<path d="M12 3l1.9 5.8L20 10.7l-6.1 1.9L12 18.5l-1.9-5.9L4 10.7l6.1-1.9z"/><path d="M19 3v4M17 5h4M5 17v3M3.5 18.5h3"/>',
  close: '<path d="M18 6L6 18M6 6l12 12"/>',
  up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  'down-chev': '<path d="M6 9l6 6 6-6"/>',
  plug: '<path d="M12 22v-5M9 8V2M15 8V2M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8z"/>',
  bolt: '<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
};
(() => {
  const st = document.createElement('style');
  st.textContent = '.ic{display:inline-block;width:1.08em;height:1.08em;vertical-align:-.17em;background:currentColor;flex:none;-webkit-mask:var(--ic) center/contain no-repeat;mask:var(--ic) center/contain no-repeat}' +
    Object.entries(ICONS).map(([k, v]) => `.ic-${k}{--ic:url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.5' stroke-linecap='square' stroke-linejoin='miter'>${v.replace(/"/g, "'")}</svg>`)}")}`).join('');
  document.head.appendChild(st);
})();
window.ICON = n => `<i class="ic ic-${n}"></i>`;

// ================================================================ SOUND DESIGN (all synthesized, no files)
const SFX = (() => {
  let ac = null, master, revIn, on = localStorage.getItem('nv-sound') !== 'off';
  function init() {
    if (ac) return;
    ac = new (window.AudioContext || window.webkitAudioContext)();
    const comp = ac.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 4; comp.connect(ac.destination);
    master = ac.createGain(); master.gain.value = .55; master.connect(comp);
    const conv = ac.createConvolver(), len = ac.sampleRate * 2.4, buf = ac.createBuffer(2, len, ac.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
    conv.buffer = buf; revIn = ac.createGain(); revIn.gain.value = .3; revIn.connect(conv); conv.connect(master);
  }
  function tone({ f = 440, f2, type = 'sine', a = .004, d = .2, v = .15, delay = 0, rv = .35, lp }) {
    if (!on || !ac) return;
    const t = ac.currentTime + delay, o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + a); g.gain.exponentialRampToValueAtTime(.0001, t + d);
    let node = o; if (lp) { const fl = ac.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = lp; o.connect(fl); node = fl; }
    node.connect(g); g.connect(master); if (rv) { const s = ac.createGain(); s.gain.value = rv; g.connect(s); s.connect(revIn); }
    o.start(t); o.stop(t + d + .05);
  }
  function noise({ d = .4, v = .1, f = 800, f2, q = 1, type = 'bandpass', delay = 0, rv = .3 }) {
    if (!on || !ac) return;
    const t = ac.currentTime + delay, len = Math.ceil(ac.sampleRate * d), b = ac.createBuffer(1, len, ac.sampleRate), dd = b.getChannelData(0);
    for (let i = 0; i < len; i++) dd[i] = Math.random() * 2 - 1;
    const s = ac.createBufferSource(); s.buffer = b; const fl = ac.createBiquadFilter(); fl.type = type; fl.Q.value = q;
    fl.frequency.setValueAtTime(f, t); if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + d);
    const g = ac.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + d * .3); g.gain.exponentialRampToValueAtTime(.0001, t + d);
    s.connect(fl); fl.connect(g); g.connect(master); if (rv) { const r = ac.createGain(); r.gain.value = rv; g.connect(r); r.connect(revIn); }
    s.start(t); s.stop(t + d);
  }
  let lastHover = 0;
  const lib = {
    hover() { const n = performance.now(); if (n - lastHover < 70) return; lastHover = n; tone({ f: 2400, d: .035, v: .018, rv: 0 }); },
    click() { tone({ f: 620, f2: 880, type: 'triangle', d: .08, v: .06, rv: .15 }); },
    page() { noise({ d: .75, v: .09, f: 250, f2: 4200, q: .7, rv: .5 }); tone({ f: 70, f2: 38, d: .7, v: .16, rv: .2, lp: 400 }); tone({ f: 880, f2: 1320, d: .5, v: .025, delay: .12, rv: .7 }); },
    launch() { tone({ f: 1100, f2: 1700, d: .12, v: .035, rv: .5 }); tone({ f: 1700, f2: 2500, d: .1, v: .02, delay: .07, rv: .6 }); },
    buy() { [523, 784, 1047].forEach((f, i) => tone({ f, type: 'triangle', d: .22, v: .05, delay: i * .055, rv: .5 })); },
    sell() { [784, 587, 392].forEach((f, i) => tone({ f, type: 'triangle', d: .22, v: .05, delay: i * .055, rv: .5 })); },
    big() { for (let i = 0; i < 2; i++) tone({ f: 520, f2: 1040, type: 'sawtooth', d: .32, v: .05, delay: i * .34, lp: 2600, rv: .35 }); noise({ d: 1.1, v: .14, f: 90, type: 'lowpass', rv: .4 }); tone({ f: 55, f2: 32, d: 1, v: .25, lp: 300 }); },
    target() { [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => { tone({ f, type: 'sine', d: .9, v: .055, delay: i * .07, rv: .8 }); tone({ f: f * 2, type: 'sine', d: .4, v: .012, delay: i * .07, rv: .8 }); }); },
    stop() { tone({ f: 140, f2: 48, d: .6, v: .3, lp: 500, rv: .3 }); noise({ d: .35, v: .1, f: 300, type: 'lowpass' }); tone({ f: 311, type: 'square', d: .25, v: .025, delay: .05, lp: 1200 }); },
    boot() { tone({ f: 55, f2: 110, d: 2.2, v: .12, type: 'sawtooth', lp: 700, rv: .6 }); [220, 330, 440, 660].forEach((f, i) => tone({ f, d: 1.6, v: .03, delay: .4 + i * .18, rv: .9 })); },
    msg() { tone({ f: 1320, f2: 1760, d: .09, v: .03, rv: .4 }); },
  };
  const api = {};
  for (const k in lib) api[k] = (...a) => { try { lib[k](...a); } catch { } };
  api.init = init; api.isOn = () => on;
  api.toggle = () => { on = !on; localStorage.setItem('nv-sound', on ? 'on' : 'off'); if (on) { init(); ac.resume(); api.click(); } return on; };
  addEventListener('pointerdown', () => { init(); ac.state === 'suspended' && ac.resume(); }, { once: false, passive: true });
  return api;
})();
window.SFX = SFX;
window.beep = () => { };   // the old raw beep is replaced by the sound design above
// header sound toggle
const sb = document.createElement('button'); sb.className = 'ghost nv-sound'; sb.title = 'Sound on/off';
const drawSb = () => sb.innerHTML = ICON(SFX.isOn() ? 'sound' : 'mute');
drawSb(); sb.onclick = () => { SFX.toggle(); drawSb(); }; q('#notifyBtn').before(sb);
// UI sounds
document.addEventListener('pointerover', e => { if (e.target.closest && e.target.closest('button, a, .ov-sys, nav button')) SFX.hover(); }, { passive: true });
document.addEventListener('click', e => { if (e.target.closest && e.target.closest('button, a')) SFX.click(); }, true);

// ================================================================ PLAYBOOK READS
// Plain-English read of each coin, built from the same live numbers the scores use.
const fmtUsd = n => n >= 1e6 ? '$' + (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? '$' + (n / 1e3).toFixed(1) + 'K' : '$' + Math.round(n);
function readDex(p, a) {
  const onCurve = p.dexId === 'pumpfun', bits = [];
  let tone = 'neutral';
  if (a.flags.some(f => /honeypot/i.test(f))) return { tone: 'bad', text: 'Buys are going through but nobody is selling. That is the classic honeypot pattern: you may not be able to sell at all. Treat it as untouchable.' };
  if (a.c24 > 1000) { tone = 'bad'; bits.push(`Already up ${Math.round(a.c24)}% today. Late buyers on moves like this usually end up as exit liquidity for the early ones.`); }
  else if (a.momentum >= 60 && a.safety >= 70) { tone = 'good'; bits.push('Strong buying with fewer red flags than most. This is the rare "hot and solid" setup, but it can still dump fast.'); }
  else if (a.momentum >= 60) { tone = 'warn'; bits.push('Running hot, but the risk flags are piling up. Momentum like this often reverses hard.'); }
  else if (a.momentum < 30) bits.push('Not much is happening here right now.');
  if (a.c1 < -20 && a.buyRatio < .45) { tone = 'bad'; bits.push('Sellers are in control this hour.'); }
  if (!onCurve && a.liq > 0) { const imp = Math.min(99, 400 * 100 / a.liq); bits.push(`With ${fmtUsd(a.liq)} liquidity, a $100 buy moves the price about ${imp < 1 ? imp.toFixed(1) : Math.round(imp)}%. Selling a bigger bag will hurt.`); }
  if (onCurve) bits.push('Still on the pump.fun bonding curve. Price only rises while new buyers keep arriving.');
  if (a.age != null && a.age < 36e5) bits.push('Under an hour old, so there is almost no history to trust.');
  bits.push(tone === 'good' ? 'If you play it: small size, and set the 2x / −40% alert straight away.' : 'If you touch it: only money you are fine losing, and set your exit before you buy.');
  return { tone, text: bits.join(' ') };
}
function readPump(c, s) {
  const ageM = (Date.now() - c.created) / 60000, trades = c.buys + c.sells, ratio = trades ? c.buys / trades : .5;
  const uniq = (g('tradeStream') ? c.buyers.size : Math.round(c.buys * .7));
  if (c.devSold) return { tone: 'bad', text: 'The dev sold. On pump.fun that is the number one rug tell: the person who knows the most just left. Most traders treat this as over.' };
  if (c.peak > c.startMcap * 1.5 && c.mcap < c.peak * .5) return { tone: 'bad', text: 'It already pumped and halved. Buying here is catching a falling knife unless fresh volume shows up.' };
  if (ageM > 5 && trades < 5) return { tone: 'bad', text: 'Five minutes in and nobody showed up. Dead launches almost never come back.' };
  const bits = []; let tone = 'neutral';
  if (c.smart.size) { tone = 'good'; bits.push(`${c.smart.size} of your tracked wallets bought. That is the strongest signal here, but they got in before you and may sell into your buy.`); }
  if (c.devBuySol >= 3) { tone = 'warn'; bits.push(`The dev bought ${c.devBuySol.toFixed(1)} SOL at launch, so they hold a big bag they can dump on buyers.`); }
  if (g('tradeStream') && trades > 10 && c.buyers.size < 4) { tone = 'bad'; bits.push('Lots of trades from very few wallets. That looks like bots faking activity.'); }
  if (uniq >= 15 && ratio > .6 && ageM < 15) { if (tone !== 'bad') tone = 'good'; bits.push(`About ${uniq} buyers in ${Math.max(1, Math.round(ageM))} min, with buys outpacing sells. Early runners look like this, though most still fail.`); }
  else if (s.score < 20 && ageM < 5) bits.push('Too early to read. Wait a minute or two and see if real buyers arrive.');
  if (c.meta && !c.meta.failed && !['twitter', 'telegram', 'website'].some(k => c.meta[k])) { bits.push('No X, Telegram or site, so nothing exists to bring a second wave of buyers.'); if (tone === 'good') tone = 'warn'; }
  bits.push('If you play it: tiny size, set the alert, and sell into strength rather than waiting for a moon.');
  return { tone, text: bits.join(' ') };
}
window.nvReadDex = readDex; window.nvReadPump = readPump;
const readHtml = r => `<div class="nv-read nv-read-${r.tone}"><span>${ICON('book')} Read</span><p>${r.text}</p></div>`;
// ---- sparkline thumbnails
let sparkN = 0;
function spark(vals, labels) {
  const v = vals.filter(x => isFinite(x) && x > 0); if (v.length < 2) return '';
  const w = 300, h = 54, min = Math.min(...v), max = Math.max(...v), rng = (max - min) || max * .02 || 1;
  const pts = v.map((y, i) => [i / (v.length - 1) * w, h - 5 - ((y - min) / rng) * (h - 12)]);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const up = v[v.length - 1] >= v[0], col = up ? 'var(--green)' : 'var(--red)', id = 'nvs' + (++sparkN);
  const chg = (v[v.length - 1] / v[0] - 1) * 100;
  return `<div class="nv-spark ${up ? 'is-up' : 'is-down'}"><svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:${col};stop-opacity:.38"/><stop offset="1" style="stop-color:${col};stop-opacity:0"/></linearGradient></defs>` +
    `<path d="${d} L${w} ${h} L0 ${h} Z" fill="url(#${id})"/><path d="${d}" fill="none" style="stroke:${col}" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>` +
    `<span class="nv-spark-chg">${chg >= 0 ? '+' : ''}${Math.abs(chg) >= 1000 ? Math.round(chg).toLocaleString() : chg.toFixed(1)}%</span>` +
    (labels ? `<div class="nv-spark-x">${labels.map(l => `<span>${l}</span>`).join('')}</div>` : '') + '</div>';
}
function dexSpark(p) {
  const now = +p.priceUsd, ch = p.priceChange || {}; if (!now) return '';
  const pts = [], lb = [];
  [['h24', '24h'], ['h6', '6h'], ['h1', '1h'], ['m5', '5m']].forEach(([k, l]) => { if (ch[k] != null && ch[k] > -99.9) { pts.push(now / (1 + ch[k] / 100)); lb.push(l); } });
  pts.push(now); lb.push('now');
  return spark(pts, lb);
}
window.nvSpark = spark;
if (typeof window.dexCard === 'function') {
  const origDex = window.dexCard;
  window.dexCard = function (p, a, extra = '') {
    const html = origDex(p, a, extra);
    try { return html.replace(/<div class="bars">/, dexSpark(p) + '<div class="bars">').replace(/<div class="flags">/, readHtml(readDex(p, a)) + '<div class="flags">'); } catch { return html; }
  };
}
// pump cards: attach reads after each render, and flash brand-new launches
const seenMints = new Set();
wrap('renderPump', () => {
  const all = g('coins'); if (!all) return;
  const now = Date.now();
  all.forEach(c => {   // record a market-cap history for each launch, for its sparkline
    const h = c.hist || (c.hist = [{ t: c.created, m: c.startMcap }]);
    const lastH = h[h.length - 1];
    if (c.mcap !== lastH.m && now - lastH.t > 1500) { h.push({ t: now, m: c.mcap }); if (h.length > 60) h.shift(); }
  });
  qa('#pumpGrid .card').forEach(card => {
    const link = card.querySelector('a[href*="pump.fun/coin/"]'); if (!link) return;
    const mint = link.href.split('/coin/')[1], c = all.get(mint); if (!c) return;
    if (!card.querySelector('.nv-spark') && c.hist && c.hist.length > 1) card.querySelector('.bars')?.insertAdjacentHTML('beforebegin', spark([...c.hist.map(x => x.m), c.mcap], ['launch', 'now']));
    if (!card.querySelector('.nv-read')) card.querySelector('.flags')?.insertAdjacentHTML('beforebegin', readHtml(readPump(c, window.pumpScore(c))));
    if (!seenMints.has(mint)) { seenMints.add(mint); card.classList.add('nv-new'); }
  });
});

// adaptive resolution: if frames get slow, render the background at lower resolution
let slowFrames = 0;
function adapt(dt) {
  if (dt > .028) slowFrames++; else slowFrames = Math.max(0, slowFrames - 1);
  if (slowFrames > 90 && SCALE > .45) { SCALE *= .8; bg.width = Math.round(innerWidth * SCALE); bg.height = Math.round(innerHeight * SCALE); if (GL.ok) gl.viewport(0, 0, bg.width, bg.height); slowFrames = 0; }
}

// ================================================================ MAIN LOOP
let last = performance.now(), T0 = last, frameN = 0;
function frame(now) {
  const dt = Math.min(.25, (now - last) / 1000); last = now; adapt(dt);
  const ease = k => 1 - Math.pow(1 - k, dt * 60);   // frame-rate independent smoothing
  if (!document.hidden) {
    GL.mouse[0] = lerp(GL.mouse[0], GL.mt[0], ease(.05)); GL.mouse[1] = lerp(GL.mouse[1], GL.mt[1], ease(.05));
    if (GL.X < 1) GL.X = Math.min(1, GL.X + dt / 1.6);
    for (let i = 0; i < 3; i++) { GL.c1[i] = lerp(GL.c1[i], GL.tc1[i], ease(.04)); GL.c2[i] = lerp(GL.c2[i], GL.tc2[i], ease(.04)); }
    GL.P = Math.max(0, GL.P - dt * .9);
    const sc = page === 'overview' ? Math.min(1.5, scrollY / innerHeight) : 0; GL.scroll = lerp(GL.scroll, sc, ease(.1));
    GL.It = page === 'overview' ? 1 : .62; GL.I = lerp(GL.I, GL.It, ease(.05));
    if (GL.ok) {
      const t = (now - T0) / 1000;
      gl.disable(gl.BLEND);
      gl.useProgram(progQ); gl.bindBuffer(gl.ARRAY_BUFFER, GL.qbuf);
      const lq = gl.getAttribLocation(progQ, 'p'); gl.enableVertexAttribArray(lq); gl.vertexAttribPointer(lq, 2, gl.FLOAT, false, 0, 0);
      gl.uniform2f(uQ.R, bg.width, bg.height); gl.uniform2f(uQ.M, GL.mouse[0], GL.mouse[1]); gl.uniform2f(uQ.PO, GL.PO[0], GL.PO[1]);
      gl.uniform1f(uQ.T, t); gl.uniform1f(uQ.P, GL.P); gl.uniform1f(uQ.X, GL.X); gl.uniform1f(uQ.I, GL.I); gl.uniform1f(uQ.S, GL.scroll);
      gl.uniform1f(uQ.A, GL.A); gl.uniform1f(uQ.B, GL.B); gl.uniform3fv(uQ.C1, GL.c1); gl.uniform3fv(uQ.C2, GL.c2);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.disableVertexAttribArray(lq);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(progP); gl.bindBuffer(gl.ARRAY_BUFFER, pbuf);
      const la = gl.getAttribLocation(progP, 'a'); gl.enableVertexAttribArray(la); gl.vertexAttribPointer(la, 4, gl.FLOAT, false, 0, 0);
      gl.uniform2f(uP.R, bg.width, bg.height); gl.uniform2f(uP.M, GL.mouse[0], GL.mouse[1]); gl.uniform1f(uP.T, t);
      gl.uniform1f(uP.A, GL.A); gl.uniform1f(uP.B, GL.B); gl.uniform1f(uP.X, GL.X); gl.uniform1f(uP.S, GL.scroll); gl.uniform1f(uP.P, GL.P);
      gl.uniform1f(uP.DPR, SCALE); gl.uniform3fv(uP.C1, GL.c1); gl.uniform3fv(uP.C2, GL.c2);
      gl.drawArrays(gl.POINTS, 0, pCount);
      gl.disableVertexAttribArray(la);
    }
    // instruments (only the visible ones)
    frameN++;
    if (frameN % 2 === 0) vizzes.forEach(o => { if (o.w && o.vis && o.canvas.offsetParent !== null) DRAW[o.kind] && DRAW[o.kind](o, now); });   // instruments at 30fps
    drawFX(dt * 60);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
setInterval(updateOverview, 1500); updateOverview(); updateTicker();

window.NOVA = { burst, comet, pulse, screenFx, goPage };
})();
