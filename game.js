/* 共鸣者：夜航试炼 - dependency-free Canvas prototype */
const canvas = document.querySelector('#game');
const ctx = canvas.getContext('2d');
const menu = document.querySelector('#menu');
const result = document.querySelector('#result');
const resultTitle = document.querySelector('#resultTitle');
const resultCopy = document.querySelector('#resultCopy');
const loadStatus = document.querySelector('#loadStatus');
const virtualControls = document.querySelector('#virtualControls');
const W = canvas.width, H = canvas.height, GROUND = 595;

const keys = new Set(), pressed = new Set();
let starting = false;
function inputKey(e) {
  if (e.key.startsWith('Arrow')) return e.key;
  if (e.code.startsWith('Key')) return e.code.slice(3).toLowerCase();
  if (e.code.startsWith('Digit')) return e.code.slice(5);
  return e.key.toLowerCase();
}
addEventListener('keydown', e => {
  const key = inputKey(e);
  if (!keys.has(key)) pressed.add(key);
  keys.add(key);
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key) || ['KeyW','KeyA','KeyS','KeyD','KeyJ','KeyK','KeyL','KeyI','Digit1','Digit2','Digit3','Digit4'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', e => keys.delete(inputKey(e)));
addEventListener('blur', () => { keys.clear(); pressed.clear(); });
canvas.addEventListener('pointerdown', () => canvas.focus());
document.querySelectorAll('[data-virtual-key]').forEach(button => {
  const key = button.dataset.virtualKey;
  const release = () => { keys.delete(key); button.classList.remove('is-held'); };
  button.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (!keys.has(key)) pressed.add(key);
    keys.add(key);
    button.classList.add('is-held');
    button.setPointerCapture?.(e.pointerId);
  });
  button.addEventListener('pointerup', release);
  button.addEventListener('pointercancel', release);
  button.addEventListener('pointerleave', e => { if (e.buttons === 0) release(); });
});

const assets = {
  fibi: { src: '非比/acd69683-f750-4b37-af4a-ad9af4f86087.png', crop: [0.02, 0.10, 0.30, 0.87], faceRight: false },
  floro: { src: 'fll/41dc874a-7a88-4f29-adce-d8f4ca108aee.png', crop: [0.01, 0.06, 0.31, 0.91], faceRight: true }
};

function prepareSprite(info) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const [x, y, w, h] = info.crop;
      const out = document.createElement('canvas'); out.width = Math.round(img.naturalWidth * w); out.height = Math.round(img.naturalHeight * h);
      const c = out.getContext('2d'); c.drawImage(img, img.naturalWidth*x, img.naturalHeight*y, out.width, out.height, 0, 0, out.width, out.height);
      const pixels = c.getImageData(0, 0, out.width, out.height), d = pixels.data;
      // Remove the white background by flood-filling from the crop edges. This keeps white clothes intact.
      const seen = new Uint8Array(out.width * out.height), stack = [];
      for (let xx=0; xx<out.width; xx++) { stack.push(xx, 0, xx, out.height-1); }
      for (let yy=0; yy<out.height; yy++) { stack.push(0, yy, out.width-1, yy); }
      const isBg = (idx) => d[idx] > 218 && d[idx+1] > 218 && d[idx+2] > 218 && Math.max(d[idx],d[idx+1],d[idx+2])-Math.min(d[idx],d[idx+1],d[idx+2]) < 18;
      while (stack.length) { const yy=stack.pop(), xx=stack.pop(), p=yy*out.width+xx; if (xx<0||yy<0||xx>=out.width||yy>=out.height||seen[p]) continue; seen[p]=1; const i=p*4; if (!isBg(i)) continue; d[i+3]=0; stack.push(xx+1,yy,xx-1,yy,xx,yy+1,xx,yy-1); }
      c.putImageData(pixels,0,0); resolve(out);
    };
    img.onerror = () => resolve(null); img.src = info.src;
  });
}

const state = { running:false, mode:'solo', players:[], enemies:[], projectiles:[], effects:[], particles:[], score:0, kills:0, spawn:0, elapsed:0, shake:0, bossSpawned:false, bossDefeated:false, scroll:0 };

class Player {
  constructor(kind, x, controls, sprite) {
    this.kind=kind; this.name=kind==='fibi'?'菲比':'弗洛洛'; this.x=x; this.y=GROUND; this.vy=0; this.facing=kind==='fibi'?1:-1; this.grounded=true; this.hp=100; this.maxHp=100; this.invuln=0; this.cooldowns={basic:0,s1:0,s2:0,ult:0}; this.controls=controls; this.sprite=sprite; this.flash=0; this.dead=false; this.revive=0;
  }
  update(dt) {
    if (this.dead) { this.revive -= dt; return; }
    for (const k of Object.keys(this.cooldowns)) this.cooldowns[k]=Math.max(0,this.cooldowns[k]-dt);
    this.invuln=Math.max(0,this.invuln-dt); this.flash=Math.max(0,this.flash-dt);
    const left=keys.has(this.controls.left), right=keys.has(this.controls.right); let axis=(right?1:0)-(left?1:0);
    if (axis) this.facing=axis;
    this.x += axis * 275 * dt; this.x=Math.max(34,Math.min(W-34,this.x));
    if (pressed.has(this.controls.jump) && this.grounded) { this.vy=-590; this.grounded=false; burst(this.x,this.y-15,this.kind==='fibi'?'#a994ff':'#ff7b8d',5); }
    this.vy += 1450*dt; this.y += this.vy*dt;
    if (this.y>=GROUND) { this.y=GROUND; this.vy=0; this.grounded=true; }
    if (pressed.has(this.controls.basic)) this.basic();
    if (pressed.has(this.controls.s1)) this.skill1();
    if (pressed.has(this.controls.s2)) this.skill2();
    if (pressed.has(this.controls.ult)) this.ultimate();
  }
  basic() {
    if (this.cooldowns.basic>0) return; this.cooldowns.basic=this.kind==='fibi'?.28:.45;
    if (this.kind==='fibi') projectile(this.x+this.facing*30,this.y-72,this.facing*700,0,16,'#b79cff',false,18,'basic');
    else effect({x:this.x+this.facing*52,y:this.y-60,r:75,dmg:22,dur:.18,color:'#ff7993',air:false,owner:this});
  }
  skill1() {
    if (this.cooldowns.s1>0) return; this.cooldowns.s1=2.3;
    if (this.kind==='fibi') { [-.24,0,.24].forEach(a=>projectile(this.x+this.facing*28,this.y-76,this.facing*620*Math.cos(a),-620*Math.sin(a),21,'#78e3ff',true,22,'s1')); }
    else projectile(this.x+this.facing*26,this.y-75,this.facing*520,0,28,'#ffb07a',true,30,'s1');
    burst(this.x+this.facing*35,this.y-70,this.kind==='fibi'?'#7deaff':'#ff9868',12);
  }
  skill2() {
    if (this.cooldowns.s2>0) return; this.cooldowns.s2=4.6;
    if (this.kind==='fibi') effect({x:this.x,y:this.y-65,r:132,dmg:30,dur:.22,color:'#79caff',air:true,owner:this});
    else { this.x=Math.max(38,Math.min(W-38,this.x+this.facing*145)); effect({x:this.x,y:this.y-58,r:115,dmg:36,dur:.25,color:'#ff5f9a',air:true,owner:this}); }
    state.shake=.18; burst(this.x,this.y-55,this.kind==='fibi'?'#a5f0ff':'#ff648f',18);
  }
  ultimate() {
    if (this.cooldowns.ult>0) return; this.cooldowns.ult=10;
    if (this.kind==='fibi') { for(let i=0;i<9;i++) projectile(this.x-190+i*48,80+(i%3)*18,this.facing*(180+i*16),230+i*18,38,'#efe4ff',true,25,'ult'); effect({x:this.x,y:this.y-70,r:170,dmg:50,dur:.32,color:'#b27cff',air:true,owner:this}); }
    else { effect({x:this.x,y:this.y-75,r:205,dmg:58,dur:.35,color:'#ff607a',air:true,owner:this}); for(let i=0;i<6;i++) projectile(this.x+this.facing*30,this.y-100-i*12,this.facing*(420+i*35),-160+i*60,32,'#ffb17f',true,25,'ult'); }
    state.shake=.35; burst(this.x,this.y-90,this.kind==='fibi'?'#e5d7ff':'#ff7b91',35);
  }
  hurt(dmg) { if(this.invuln>0||this.dead) return; this.hp-=dmg; this.invuln=1; this.flash=.2; state.shake=.12; burst(this.x,this.y-55,'#ff5f77',10); if(this.hp<=0){this.hp=0;this.dead=true;this.revive=4;} }
  draw() {
    if(this.dead){ drawText('倒地 · 队友靠近即可救援',this.x,this.y-90,'#ffd1d8',13,'center'); return; }
    ctx.save(); if(this.invuln>0 && Math.floor(this.invuln*12)%2===0) ctx.globalAlpha=.42;
    const h=142, w=this.sprite? h*(this.sprite.width/this.sprite.height):78;
    if(this.sprite){ ctx.translate(this.x,this.y); const sourceFacesRight=assets[this.kind].faceRight; const flip=(this.facing===1)!==sourceFacesRight; ctx.scale(flip?-1:1,1); ctx.drawImage(this.sprite,-w/2,-h,w,h); }
    else drawFallback(this.x,this.y,this.kind,this.facing);
    ctx.restore();
    // health bar and nameplate
    roundRect(this.x-34,this.y-164,68,6,3,'rgba(14,18,42,.7)'); roundRect(this.x-34,this.y-164,68*(this.hp/this.maxHp),6,3,this.kind==='fibi'?'#8bd8ff':'#ff829c');
    drawText(this.name,this.x,this.y-174,this.kind==='fibi'?'#cdbaff':'#ffb5c0',11,'center');
  }
}

function enemySpawn() {
  const flyer=Math.random()<.34; const boss=state.kills>=20&&!state.bossSpawned; const e={x:boss?W+90:W-80,y:boss?GROUND:(flyer?270+Math.random()*120:GROUND),flyer,boss,hp:boss?360:(flyer?38:52),maxHp:boss?360:(flyer?38:52),speed:boss?38:(flyer?125+Math.random()*35:155+Math.random()*35),phase:Math.random()*6.2,hitFlash:0,dead:false};
  if(boss){e.flyer=false;e.y=GROUND;e.speed=32;state.bossSpawned=true;}
  state.enemies.push(e);
}
function projectile(x,y,vx,vy,dmg,color,air,radius,kind){state.projectiles.push({x,y,vx,vy,dmg,color,air,radius,kind,life:2.4,trail:[]});}
function effect(o){state.effects.push({...o,life:o.dur,hit:new Set()});}
function burst(x,y,color,n=8){for(let i=0;i<n;i++){const a=Math.random()*Math.PI*2,s=30+Math.random()*150;state.particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:.35+Math.random()*.45,color,size:2+Math.random()*4});}}

function update(dt){
  if(!state.running) return;
  state.elapsed+=dt; state.scroll=(state.scroll+dt*55)%W; state.spawn-=dt; state.shake=Math.max(0,state.shake-dt);
  state.players.forEach(p=>p.update(dt));
  if(state.spawn<=0 && !state.bossDefeated){ enemySpawn(); state.spawn=1.15+Math.random()*.8; }
  state.enemies.forEach(e=>{e.hitFlash=Math.max(0,e.hitFlash-dt); if(!e.dead){ if(e.boss && e.x<930)e.x-=e.speed*dt; else e.x-=e.speed*dt; if(e.flyer)e.y+=Math.sin(state.elapsed*3+e.phase)*.7; for(const p of state.players){if(p.dead)continue; if(Math.abs(e.x-p.x)<(e.boss?75:33) && Math.abs(e.y-p.y)<(e.flyer?70:44)){p.hurt(e.boss?18:9);}} }});
  state.projectiles.forEach(p=>{p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=p.kind==='ult'?200:0;p.life-=dt;p.trail.push({x:p.x,y:p.y});if(p.trail.length>5)p.trail.shift();});
  state.effects.forEach(a=>{a.life-=dt; state.enemies.forEach((e,idx)=>{if(e.dead||a.hit.has(idx))return; const dx=e.x-a.x,dy=e.y-a.y; if(dx*dx+dy*dy<(a.r+(e.boss?60:26))**2 && (a.air||!e.flyer)){e.hp-=a.dmg;a.hit.add(idx);e.hitFlash=.12;burst(e.x,e.y-30,a.color,4);}});});
  state.projectiles.forEach(p=>state.enemies.forEach((e,idx)=>{if(e.dead||p.life<=0)return; if(e.flyer&&!p.air)return; if(Math.abs(p.x-e.x)<p.radius+(e.boss?58:24)&&Math.abs(p.y-e.y)<p.radius+(e.boss?80:35)){e.hp-=p.dmg;p.life=0;e.hitFlash=.12;burst(e.x,e.y-35,p.color,6);}}));
  state.enemies.forEach(e=>{if(!e.dead&&e.hp<=0){e.dead=true;state.kills++;state.score+=e.boss?1000:100;burst(e.x,e.y-45,e.boss?'#fff0a4':(e.flyer?'#87e7ff':'#a996ff'),e.boss?35:14);if(e.boss)state.bossDefeated=true;}});
  state.enemies=state.enemies.filter(e=>!e.dead && e.x>-130); state.projectiles=state.projectiles.filter(p=>p.life>0&&p.x>-100&&p.x<W+160&&p.y>-80&&p.y<H+80); state.effects=state.effects.filter(a=>a.life>0);
  state.particles.forEach(p=>{p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=260*dt;p.life-=dt;}); state.particles=state.particles.filter(p=>p.life>0);
  const down=state.players.filter(p=>p.dead).length; if(state.bossDefeated) finish(true); else if(down===state.players.length) finish(false);
  // Revive a fallen partner by standing nearby and pressing jump/action.
  state.players.forEach(p=>{if(!p.dead)return;const ally=state.players.find(a=>a!==p&&!a.dead&&Math.abs(a.x-p.x)<90);if(ally&&(keys.has(ally.controls.jump)||keys.has(ally.controls.basic))){p.dead=false;p.hp=45;p.invuln=1.5;burst(p.x,p.y-50,'#fff0b0',18);}});
}

function finish(win){if(!state.running)return;state.running=false;virtualControls.classList.add('hidden');result.classList.remove('hidden');resultTitle.textContent=win?'试炼完成':'队伍失去回应';resultCopy.textContent=win?`击败潮核，累计消灭 ${state.kills} 个残响。`:'两名共鸣者都倒下了，重新整备后再试一次。';}
function draw(){
  ctx.save(); if(state.shake>0)ctx.translate((Math.random()-.5)*state.shake*22,(Math.random()-.5)*state.shake*14);
  const sky=ctx.createLinearGradient(0,0,0,H); sky.addColorStop(0,'#111a44');sky.addColorStop(.62,'#171a39');sky.addColorStop(1,'#0b0d20');ctx.fillStyle=sky;ctx.fillRect(0,0,W,H);
  drawStars(); drawCity(); drawPlatforms();
  state.enemies.forEach(drawEnemy); state.projectiles.forEach(drawProjectile); state.effects.forEach(drawEffect); state.players.forEach(p=>p.draw()); state.particles.forEach(p=>{ctx.globalAlpha=Math.max(0,p.life*2);ctx.fillStyle=p.color;ctx.fillRect(p.x,p.y,p.size,p.size);ctx.globalAlpha=1;});
  drawHud(); ctx.restore();
}
function drawStars(){ctx.fillStyle='rgba(214,221,255,.55)';for(let i=0;i<32;i++){const x=(i*197+state.scroll*.09)%W,y=48+(i*73)%270;ctx.globalAlpha=.25+(i%3)*.2;ctx.fillRect(x,y,2+(i%2),2+(i%2));}ctx.globalAlpha=1;}
function drawCity(){for(let layer=0;layer<3;layer++){const base=470+layer*42;ctx.fillStyle=layer===0?'#11162f':layer===1?'#0e132a':'#0a1022';for(let i=-1;i<14;i++){const x=i*125-(state.scroll*(.1+layer*.06)%125);const h=55+((i*53+layer*19)%80);ctx.fillRect(x,base-h,95,h);for(let r=0;r<3;r++)for(let c=0;c<3;c++){ctx.fillStyle='rgba(133,161,230,.12)';ctx.fillRect(x+15+c*24,base-h+14+r*18,7,5);}ctx.fillStyle=layer===0?'#11162f':layer===1?'#0e132a':'#0a1022';}}}
function drawPlatforms(){ctx.fillStyle='#0a0e20';ctx.fillRect(0,GROUND,W,H-GROUND);ctx.fillStyle='#25325b';ctx.fillRect(0,GROUND-7,W,7);ctx.fillStyle='#384876';for(let x=-40-(state.scroll%80);x<W;x+=80)ctx.fillRect(x,GROUND-7,45,3);for(let x=160-(state.scroll*.4%560);x<W;x+=560){ctx.fillStyle='rgba(58,77,135,.7)';ctx.fillRect(x,465,150,10);ctx.fillStyle='rgba(127,157,222,.32)';ctx.fillRect(x,462,150,3);}}
function drawEnemy(e){ctx.save();ctx.translate(e.x,e.y);if(e.hitFlash>0)ctx.globalAlpha=.55;const s=e.boss?1.7:1;if(e.flyer){ctx.fillStyle='#273d83';ctx.beginPath();ctx.moveTo(-26*s,0);ctx.quadraticCurveTo(0,-40*s,26*s,0);ctx.quadraticCurveTo(0,28*s,-26*s,0);ctx.fill();ctx.strokeStyle='#83e4ff';ctx.lineWidth=3;ctx.stroke();ctx.fillStyle='#d5b7ff';ctx.beginPath();ctx.arc(0,-7*s,7*s,0,Math.PI*2);ctx.fill();}else{ctx.fillStyle=e.boss?'#5b254b':'#34215b';ctx.beginPath();ctx.roundRect(-30*s,-55*s,60*s,55*s,18*s);ctx.fill();ctx.fillStyle=e.boss?'#ffbb73':'#d279ff';ctx.beginPath();ctx.arc(-12*s,-29*s,5*s,0,Math.PI*2);ctx.arc(12*s,-29*s,5*s,0,Math.PI*2);ctx.fill();ctx.fillStyle='#17152c';ctx.fillRect(-16*s,-12*s,32*s,5*s);ctx.strokeStyle=e.boss?'#ff6d9f':'#866cff';ctx.lineWidth=3;ctx.strokeRect(-30*s,-55*s,60*s,55*s);for(let i=-1;i<=1;i++)ctx.fillRect(i*22*s,0,8*s,13*s);} if(e.boss){roundRect(-70,-90,140,7,3,'rgba(15,14,35,.8)');roundRect(-70,-90,140*(e.hp/e.maxHp),7,3,'#ff7796');drawText('潮 核',0,-102,'#ffd1a8',12,'center');}ctx.restore();}
function drawProjectile(p){ctx.save();ctx.strokeStyle=p.color;ctx.lineWidth=p.radius*.55;ctx.globalAlpha=.25;ctx.beginPath();p.trail.forEach((q,i)=>i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y));ctx.stroke();ctx.globalAlpha=1;ctx.fillStyle=p.color;ctx.shadowColor=p.color;ctx.shadowBlur=16;ctx.beginPath();ctx.arc(p.x,p.y,Math.max(5,p.radius*.35),0,Math.PI*2);ctx.fill();ctx.restore();}
function drawEffect(a){ctx.save();const alpha=Math.min(1,a.life/.18);ctx.globalAlpha=alpha;ctx.strokeStyle=a.color;ctx.lineWidth=6;ctx.shadowColor=a.color;ctx.shadowBlur=20;ctx.beginPath();ctx.arc(a.x,a.y,a.r*(1.08-alpha*.18),0,Math.PI*2);ctx.stroke();ctx.globalAlpha=alpha*.25;ctx.fillStyle=a.color;ctx.beginPath();ctx.arc(a.x,a.y,a.r,0,Math.PI*2);ctx.fill();ctx.restore();}
function drawHud(){ctx.fillStyle='rgba(7,10,26,.73)';ctx.fillRect(0,0,W,58);drawText(`残响 ${state.kills}${state.bossSpawned?' / 潮核已出现':' / 20'}`,24,24,'#e7eaff',14,'left');drawText(`分数 ${state.score}`,24,44,'#919bc9',12,'left');drawText(state.mode==='coop'?'LOCAL CO-OP':'SOLO',W-24,26,'#8e9de8',12,'right');state.players.forEach((p,i)=>{const x=W-265+i*130;drawText(p.name,x,18,p.kind==='fibi'?'#c9b4ff':'#ffabbc',11,'left');roundRect(x,26,100,7,4,'rgba(255,255,255,.12)');roundRect(x,26,100*(p.hp/p.maxHp),7,4,p.kind==='fibi'?'#9e8cff':'#ff718e');});}
function drawFallback(x,y,kind,face){ctx.save();ctx.translate(x,y);ctx.fillStyle=kind==='fibi'?'#e9d3a0':'#c7eaf0';ctx.beginPath();ctx.arc(0,-110,35,0,Math.PI*2);ctx.fill();ctx.fillStyle=kind==='fibi'?'#fff':'#f15a67';ctx.fillRect(-30,-78,60,64);ctx.fillStyle='#201937';ctx.fillRect(-24,-14,18,14);ctx.fillRect(7,-14,18,14);ctx.restore();}
function roundRect(x,y,w,h,r,fill){ctx.fillStyle=fill;ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fill();}
function drawText(t,x,y,color,size,align='left'){ctx.fillStyle=color;ctx.font=`700 ${size}px Inter, sans-serif`;ctx.textAlign=align;ctx.fillText(t,x,y);}

async function start(mode){
  if (starting) return;
  starting = true;
  document.querySelectorAll('[data-mode]').forEach(b => { b.disabled = true; b.textContent = '载入中…'; });
  state.mode=mode; state.running=true; state.players=[];state.enemies=[];state.projectiles=[];state.effects=[];state.particles=[];state.score=0;state.kills=0;state.spawn=.7;state.elapsed=0;state.bossSpawned=false;state.bossDefeated=false;
  const fibi=await prepareSprite(assets.fibi), floro=await prepareSprite(assets.floro); state.players.push(new Player('fibi',mode==='coop'?360:560,{left:'a',right:'d',jump:'w',basic:'j',s1:'k',s2:'l',ult:'i'},fibi)); if(mode==='coop')state.players.push(new Player('floro',700,{left:'ArrowLeft',right:'ArrowRight',jump:'ArrowUp',basic:'1',s1:'2',s2:'3',ult:'4'},floro));
  menu.classList.add('hidden'); result.classList.add('hidden'); virtualControls.classList.remove('hidden'); loadStatus.textContent='素材已就绪 · 战斗中'; starting = false;
  canvas.focus();
}
document.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>start(b.dataset.mode)));
document.querySelector('#restart').addEventListener('click',()=>{
  result.classList.add('hidden');
  menu.classList.remove('hidden');
  virtualControls.classList.add('hidden');
  document.querySelectorAll('[data-mode]').forEach((b, i) => { b.disabled = false; b.textContent = i === 0 ? '单人开始' : '双人合作'; });
});
let previous=performance.now(); function frame(now){const dt=Math.min(.034,(now-previous)/1000);previous=now;update(dt);draw();pressed.clear();requestAnimationFrame(frame);} requestAnimationFrame(frame);
Promise.all([prepareSprite(assets.fibi),prepareSprite(assets.floro)]).then(([a,b])=>{loadStatus.textContent=a&&b?'素材已就绪 · 等待开始':'部分素材未载入 · 使用占位角色';});
