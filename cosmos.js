(() => {
 'use strict';
 const one=s=>document.querySelector(s), all=s=>[...document.querySelectorAll(s)];
 const titles={scanner:['MARKET INTELLIGENCE','The scanner.','Explore live pairs. Compare momentum, liquidity, and risk in one view.'],pump:['NEW ONCHAIN ACTIVITY','The launchpad.','A live window into new pump.fun launches.'],xfeed:['SOCIAL INTELLIGENCE','The conversation.','Context from the accounts and conversations you track.'],smart:['PUBLIC WALLET ACTIVITY','Follow the footprints.','Track the public wallets you choose to watch.'],mine:['YOUR OBSERVATION DECK','My wallet.','Your existing wallet tools, holdings, and alerts.']};
 Object.entries(titles).forEach(([id,t])=>{const head=document.createElement('div');head.className='page-heading';head.innerHTML=`<div class="eyebrow">${t[0]}</div><h2>${t[1]}</h2><p>${t[2]}</p>`;one('#p-'+id).prepend(head)});
 const pages=new Set(all('nav button[data-p]').map(b=>b.dataset.p));
 function open(id,update=true){if(!pages.has(id))return;const b=one(`nav button[data-p="${id}"]`);b.click();if(update&&location.hash!=='#'+id)history.pushState(null,'','#'+id);window.scrollTo({top:0,behavior:'instant'});observe();if(id==='atlas')updateOverview();}
 all('[data-open]').forEach(b=>b.addEventListener('click',()=>open(b.dataset.open)));
 all('nav button[data-p]').forEach(b=>b.addEventListener('click',()=>{if(location.hash!=='#'+b.dataset.p)history.pushState(null,'','#'+b.dataset.p);window.scrollTo({top:0,behavior:'instant'});observe()}));
 window.addEventListener('hashchange',()=>open(location.hash.slice(1),false));
 window.addEventListener('popstate',()=>open(location.hash.slice(1)||'overview',false));
 let reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
 try{const saved=localStorage.getItem('mr_motion');if(saved!==null)reduced=saved==='off'}catch{}
 const motion=one('#motion-toggle');
 function setMotion(){document.documentElement.classList.toggle('reduced-motion',reduced);motion.textContent='Motion: '+(reduced?'off':'on');motion.setAttribute('aria-pressed',String(reduced));}
 motion.onclick=()=>{reduced=!reduced;setMotion();try{localStorage.setItem('mr_motion',reduced?'off':'on')}catch{}};setMotion();
 const observer=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){e.target.classList.remove('pending');observer.unobserve(e.target)}}),{threshold:.1});
 function observe(){all('.page.on .reveal:not([data-observed])').forEach(e=>{e.dataset.observed='true';e.classList.add('pending');observer.observe(e)})}observe();
 let lastSignature='';
 function updateOverview(){
  if(typeof tokens==='undefined'||!tokens.length)return;
  const signature=tokens.map(t=>t.pair.baseToken.address+':'+t.pair.priceUsd+':'+t.a.momentum).join('|');if(signature===lastSignature)return;lastSignature=signature;
  const list=[...tokens].sort((a,b)=>b.a.momentum-a.a.momentum);
  one('#overview-count').textContent=list.length;one('#overview-volume').textContent=fmt(list.reduce((s,t)=>s+(Number(t.a.v1)||0),0));one('#overview-hot').textContent=list.filter(t=>t.a.momentum>=70).length;one('#overview-time').textContent=new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});one('#overview-note').textContent='last observed scanner update';
  one('#spotlight').innerHTML=list.slice(0,3).map((t,i)=>`<article class="signal-card"><span class="signal-chain">${esc(t.pair.chainId)} / MOMENTUM ${t.a.momentum}</span><h3>$${esc(t.pair.baseToken.symbol)}</h3><p>${esc(t.pair.baseToken.name)}</p><div class="signal-numbers"><span>PRICE<b>${fmt(+t.pair.priceUsd)}</b></span><span>1H CHANGE<b class="${t.a.c1>=0?'up':'down'}">${pct(t.a.c1)}</b></span><span>SAFETY<b>${t.a.safety}/100</b></span></div><button data-signal="${i}">Inspect signal</button></article>`).join('');
  all('[data-signal]').forEach(b=>b.onclick=()=>{open('atlas');showDetail(list[+b.dataset.signal])});
  one('#map-points').replaceChildren();list.forEach(t=>{const b=document.createElement('button');b.className='map-point';b.style.left=(5+t.a.safety*.9)+'%';b.style.bottom=(5+t.a.momentum*.9)+'%';b.title=`$${t.pair.baseToken.symbol} · Momentum ${t.a.momentum} · Safety ${t.a.safety}`;b.setAttribute('aria-label',b.title);if(t.a.safety<50){b.style.background='#f2809b';b.style.borderColor='#f9adc1'}b.onclick=()=>showDetail(t);one('#map-points').append(b)});
 }
 function showDetail(t){one('#signal-detail').innerHTML='<div class="eyebrow">SELECTED SIGNAL</div>'+dexCard(t.pair,t.a);}
 new MutationObserver(updateOverview).observe(one('#grid'),{childList:true});updateOverview();
 const canvas=one('#starfield'),ctx=canvas.getContext('2d');let w=0,h=0,stars=[],mx=0,my=0;
 function resize(){w=innerWidth;h=innerHeight;const d=Math.min(devicePixelRatio||1,1.5);canvas.width=w*d;canvas.height=h*d;ctx.setTransform(d,0,0,d,0,0);stars=Array.from({length:Math.min(150,Math.floor(w/9))},()=>({x:Math.random()*w,y:Math.random()*h,r:Math.random()*.9+.2,a:Math.random()*.5+.15,z:Math.random()+.3}));draw(0)}
 function draw(time){ctx.clearRect(0,0,w,h);stars.forEach(s=>{ctx.globalAlpha=s.a*(.8+.2*Math.sin(time*.0004+s.x));ctx.fillStyle='#c4bddf';ctx.beginPath();ctx.arc((s.x+mx*s.z+w)%w,(s.y+my*s.z+h)%h,s.r,0,Math.PI*2);ctx.fill()});ctx.globalAlpha=1;}
 let previous=0;function frame(t){if(!reduced&&!document.hidden&&t-previous>40){draw(t);previous=t}requestAnimationFrame(frame)}
 window.addEventListener('resize',resize);window.addEventListener('pointermove',e=>{mx=(e.clientX/w-.5)*12;my=(e.clientY/h-.5)*12},{passive:true});
 let ticking=false;window.addEventListener('scroll',()=>{if(!ticking){requestAnimationFrame(()=>{const total=document.documentElement.scrollHeight-innerHeight;one('#scroll-progress').style.width=(total>0?scrollY/total*100:0)+'%';if(!reduced)one('.orbital-scene').style.setProperty('--parallax',Math.min(scrollY*.18,110)+'px');ticking=false});ticking=true}},{passive:true});
 resize();requestAnimationFrame(frame);if(pages.has(location.hash.slice(1)))open(location.hash.slice(1),false);
})();
