(() => {
'use strict';
const canvas=document.getElementById('game'),ctx=canvas.getContext('2d',{alpha:false});
const W=640,H=360,FOV=Math.PI/3, TAU=Math.PI*2;
let cw=innerWidth,ch=innerHeight;
function resize(){cw=innerWidth;ch=innerHeight;canvas.width=cw;canvas.height=ch;}
addEventListener('resize',resize);resize();
const gridW=23,gridH=17;
let world;
function makeWorld(){
  world=Array.from({length:gridH},(_,y)=>Array.from({length:gridW},(_,x)=>(x===0||y===0||x===gridW-1||y===gridH-1)?1:0));
  // Deliberately broken bulkheads form a readable, interlocking maze.
  const walls=[
    [5,1,1,6],[10,1,1,4],[16,1,1,6],[20,1,1,5],
    [3,4,1,5],[7,4,1,5],[12,4,1,5],[18,4,1,5],
    [1,7,5,1],[8,7,5,1],[15,7,6,1],
    [5,9,1,6],[10,9,1,5],[16,9,1,6],[20,9,1,5],
    [1,12,4,1],[7,12,5,1],[14,12,5,1],
    [3,14,1,2],[9,14,1,2],[18,14,1,2]
  ];
  // Leave doors in otherwise long barriers so every wing can be reached.
  for(const [x,y,w,h] of walls) for(let yy=y;yy<Math.min(gridH-1,y+h);yy++) for(let xx=x;xx<Math.min(gridW-1,x+w);xx++) world[yy][xx]=1;
  const doors=[[5,3],[10,2],[16,4],[20,2],[3,9],[7,6],[12,7],[18,6],[3,12],[10,11],[16,11],[20,12],[5,11],[12,14],[18,12],[9,14]];
  // Ensure short gaps in walls; openings create turns rather than dead ends.
  for(const [x,y] of doors)if(x>0&&y>0&&x<gridW-1&&y<gridH-1)world[y][x]=0;
  return world;
}
const spawnEnemies=[{x:8.5,y:2.5},{x:13.5,y:3.5},{x:19.2,y:6.5},{x:5.5,y:8.5},{x:13.5,y:8.5},{x:3.5,y:11},{x:18.5,y:13.5},{x:11.5,y:15}];
const spawnLoot=[{x:6.5,y:3.5,type:'ammo'},{x:14.5,y:5.5,type:'health'},{x:8.5,y:10.5,type:'ammo'},{x:15.5,y:14.5,type:'health'},{x:4.5,y:14.5,type:'ammo'}];
let player,enemies,loot,exit,started=false,paused=false,ended=false,keys={},last=0,clock=0,shot=0,reload=0,damageFlash=0,hitFlash=0,walk=0,toastTimer=0,triggerHeld=false,audioOn=true,audioCtx=null,master=null;
const mapDef=makeWorld();
const $=id=>document.getElementById(id);
function reset(){player={x:2.5,y:2.5,a:.18,hp:100,ammo:12,reserve:48,kills:0,walk:0};enemies=spawnEnemies.map((e,i)=>({...e,hp:100,alive:true,alert:false,attack:Math.random()*1.5,phase:Math.random()*6,kind:i%3}));loot=spawnLoot.map(x=>({...x,taken:false,phase:Math.random()*6}));exit={x:21.1,y:15.1};clock=0;shot=0;reload=0;damageFlash=0;hitFlash=0;ended=false;paused=false;}
reset();
function isWall(x,y){const ix=Math.floor(x),iy=Math.floor(y);return !world[iy]||world[iy][ix]!==0;}
function canStand(x,y,r=.2){return !isWall(x-r,y-r)&&!isWall(x+r,y-r)&&!isWall(x-r,y+r)&&!isWall(x+r,y+r);}
function initAudio(){if(!audioOn)return;if(!audioCtx){audioCtx=new (window.AudioContext||window.webkitAudioContext)();master=audioCtx.createGain();master.gain.value=.35;master.connect(audioCtx.destination);}if(audioCtx.state==='suspended')audioCtx.resume();}
function tone(freq,dur,type='square',vol=.12,endFreq){if(!audioOn)return;initAudio();const o=audioCtx.createOscillator(),g=audioCtx.createGain();o.type=type;o.frequency.setValueAtTime(freq,audioCtx.currentTime);if(endFreq)o.frequency.exponentialRampToValueAtTime(Math.max(20,endFreq),audioCtx.currentTime+dur);g.gain.setValueAtTime(vol,audioCtx.currentTime);g.gain.exponentialRampToValueAtTime(.001,audioCtx.currentTime+dur);o.connect(g);g.connect(master);o.start();o.stop(audioCtx.currentTime+dur+.02);}
function noise(dur=.12,vol=.16,filter=1200){if(!audioOn)return;initAudio();const n=Math.floor(audioCtx.sampleRate*dur),b=audioCtx.createBuffer(1,n,audioCtx.sampleRate),d=b.getChannelData(0);for(let i=0;i<n;i++)d[i]=(Math.random()*2-1)*(1-i/n);const s=audioCtx.createBufferSource(),f=audioCtx.createBiquadFilter(),g=audioCtx.createGain();s.buffer=b;f.type='lowpass';f.frequency.value=filter;g.gain.value=vol;s.connect(f);f.connect(g);g.connect(master);s.start();}
function soundShot(){noise(.13,.25,2100);tone(115,.17,'sawtooth',.09,45);tone(780,.045,'square',.045,240);}
function soundHit(){tone(180,.09,'square',.07,70);}
function soundPickup(type){tone(type==='health'?660:480,.12,'sine',.1,900);setTimeout(()=>tone(type==='health'?880:720,.15,'sine',.075),75);}
function soundHurt(){noise(.2,.22,500);tone(95,.25,'sawtooth',.08,48);}
function showToast(t){const el=$('toast');el.textContent=t;el.classList.add('show');toastTimer=1.5;}
function begin(){initAudio();if(started&&!ended){paused=false;$('pause-screen').classList.remove('show');canvas.requestPointerLock?.();return;}reset();started=true;$('overlay').classList.add('hidden');$('end-screen').classList.remove('show');$('pause-screen').classList.remove('show');canvas.requestPointerLock?.();last=performance.now();}
function end(win){ended=true;paused=true;document.exitPointerLock?.();$('end-eyebrow').textContent=win?'// EXTRACTION CONFIRMED':'// VITALS CRITICAL';$('end-title').textContent=win?'SECTOR CLEAR':'SIGNAL LOST';$('end-copy').textContent=win?`HOSTILES NEUTRALIZED: ${String(player.kills).padStart(2,'0')} // YOU MADE IT OUT.`:'THE DARK TOOK THE REST. RESET AND TRY AGAIN.';$('end-screen').classList.add('show');}
function pause(){if(!started||ended)return;paused=!paused;$('pause-screen').classList.toggle('show',paused);if(paused)document.exitPointerLock?.();else{canvas.requestPointerLock?.();last=performance.now();}}
function rayDistance(ox,oy,angle,max=30){const dx=Math.cos(angle),dy=Math.sin(angle);let mx=Math.floor(ox),my=Math.floor(oy),ddx=Math.abs(1/(dx||1e-9)),ddy=Math.abs(1/(dy||1e-9)),sx=dx<0?-1:1,sy=dy<0?-1:1,sdx=(dx<0?ox-mx:mx+1-ox)*ddx,sdy=(dy<0?oy-my:my+1-oy)*ddy,side=0;for(let i=0;i<80;i++){if(sdx<sdy){sdx+=ddx;mx+=sx;side=0;}else{sdy+=ddy;my+=sy;side=1;}if(!world[my]||world[my][mx]){const d=side?sdy-ddy:sdx-ddx;let wallX=side?ox+d*dx:oy+d*dy;wallX-=Math.floor(wallX);return{d:Math.max(.001,d),side,wallX,mx,my};}if(Math.min(sdx,sdy)>max)break;}return{d:max,side:0,wallX:0,mx:0,my:0};}
function clearShot(ax,ay,bx,by){const d=Math.hypot(bx-ax,by-ay),a=Math.atan2(by-ay,bx-ax);return rayDistance(ax,ay,a,d+.05).d>=d-.15;}
function fire(){if(!started||paused||ended||reload>0||shot>0)return;if(player.ammo<=0){tone(190,.08,'square',.04,130);showToast('MAGAZINE EMPTY // PRESS R');return;}player.ammo--;shot=.24;soundShot();let target=null,best=.14;for(const e of enemies){if(!e.alive)continue;const dx=e.x-player.x,dy=e.y-player.y,d=Math.hypot(dx,dy),diff=Math.atan2(Math.sin(Math.atan2(dy,dx)-player.a),Math.cos(Math.atan2(dy,dx)-player.a));const aimRadius=Math.max(.075,.22/d);if(d<12&&Math.abs(diff)<aimRadius&&d<best||d<12&&Math.abs(diff)<aimRadius&&!target){if(clearShot(player.x,player.y,e.x,e.y)){target=e;best=d;}}}if(target){target.hp-=50;target.alert=true;target.hit=.16;hitFlash=.12;soundHit();$('crosshair').classList.add('hit');setTimeout(()=>$('crosshair').classList.remove('hit'),100);if(target.hp<=0){target.alive=false;player.kills++;showToast('HOSTILE DOWN');}updateHud();}}
function startReload(){if(!started||paused||reload>0||player.ammo===12||player.reserve<=0)return;reload=1.05;tone(370,.07,'square',.04,240);setTimeout(()=>tone(510,.08,'square',.04,350),330);setTimeout(()=>tone(720,.09,'square',.04,510),720);}
function updateHud(){$('health').textContent=Math.max(0,Math.ceil(player.hp));$('health-bar').style.width=Math.max(0,player.hp)+'%';$('ammo').textContent=player.ammo;$('reserve').textContent=player.reserve;$('kills').innerHTML=`HOSTILES NEUTRALIZED &nbsp; ${String(player.kills).padStart(2,'0')} / 08`;}
function move(dt){let f=0,s=0;if(keys.w||keys.arrowup)f++;if(keys.s||keys.arrowdown)f--;if(keys.d)s++;if(keys.a)s--;let mag=Math.hypot(f,s);if(mag){f/=mag;s/=mag;const speed=3.15*dt,dx=(Math.cos(player.a)*f-Math.sin(player.a)*s)*speed,dy=(Math.sin(player.a)*f+Math.cos(player.a)*s)*speed;if(canStand(player.x+dx,player.y,.22))player.x+=dx;if(canStand(player.x,player.y+dy,.22))player.y+=dy;walk+=dt*9*mag;}}
function update(dt){if(!started||paused||ended)return;clock+=dt;shot=Math.max(0,shot-dt);if(reload>0){reload-=dt;if(reload<=0){const n=Math.min(12-player.ammo,player.reserve);player.ammo+=n;player.reserve-=n;updateHud();}}damageFlash=Math.max(0,damageFlash-dt*1.6);hitFlash=Math.max(0,hitFlash-dt);toastTimer-=dt;if(toastTimer<=0)$('toast').classList.remove('show');move(dt);
  for(const e of enemies){if(!e.alive)continue;e.phase+=dt*4;e.hit=Math.max(0,(e.hit||0)-dt);const dx=player.x-e.x,dy=player.y-e.y,d=Math.hypot(dx,dy);if(d<7||e.alert)e.alert=true;if(e.alert&&d>0.63){const speed=(e.hit?0:1.04)*dt,nx=e.x+dx/d*speed,ny=e.y+dy/d*speed;if(canStand(nx,e.y,.22))e.x=nx;if(canStand(e.x,ny,.22))e.y=ny;}e.attack-=dt;if(d<.95&&e.attack<=0){player.hp-=9;damageFlash=.65;e.attack=1.25;soundHurt();updateHud();if(player.hp<=0){player.hp=0;updateHud();end(false);return;}}}
  for(const p of loot){if(p.taken)continue;p.phase+=dt*3;if(Math.hypot(player.x-p.x,player.y-p.y)<.58){if(p.type==='ammo'){player.reserve=Math.min(96,player.reserve+18);showToast('9MM AMMO +18');}else{player.hp=Math.min(100,player.hp+30);showToast('MEDKIT // VITALS RESTORED');}p.taken=true;soundPickup(p.type);updateHud();}}
  if(Math.hypot(player.x-exit.x,player.y-exit.y)<.85){if(player.kills>=8)end(true);else if(!exit.warned){exit.warned=true;showToast('ACCESS LOCKED // CLEAR HOSTILES');}}
  if(keys.space||triggerHeld){if(!triggerHeld||shot<=0)fire();}
}
function shadeColor(base,brightness){return `rgb(${Math.max(0,Math.min(255,base[0]*brightness))|0},${Math.max(0,Math.min(255,base[1]*brightness))|0},${Math.max(0,Math.min(255,base[2]*brightness))|0})`;}
const zBuffer=new Float32Array(W);
function renderWorld(){const horizon=H*.49+Math.sin(walk)*1.5;const sky=ctx.createLinearGradient(0,0,0,horizon);sky.addColorStop(0,'#090d10');sky.addColorStop(1,'#20211c');ctx.fillStyle=sky;ctx.fillRect(0,0,W,horizon);const floor=ctx.createLinearGradient(0,horizon,0,H);floor.addColorStop(0,'#29271f');floor.addColorStop(.4,'#171916');floor.addColorStop(1,'#080a09');ctx.fillStyle=floor;ctx.fillRect(0,horizon,W,H-horizon);
 // subtle receding floor seams
 for(let i=1;i<13;i++){const y=horizon+(H-horizon)*i*i/169;ctx.strokeStyle=`rgba(190,177,128,${.04+i*.002})`;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}
 const depth=player.a-FOV/2;for(let x=0;x<W;x++){const a=depth+x/W*FOV,hit=rayDistance(player.x,player.y,a),corrected=hit.d*Math.cos(a-player.a);zBuffer[x]=corrected;const wallH=Math.min(H*2,H/(corrected||.001)),top=horizon-wallH/2;const tex=hit.wallX,cell=(hit.mx*7+hit.my*13)%4;let lum=Math.max(.15,1-corrected/13)*(hit.side?.72:1);const bands=(Math.floor(tex*12)%2===0)?.83:1;lum*=bands;const base=cell===0?[112,108,88]:cell===1?[94,98,86]:cell===2?[103,91,75]:[85,95,88];ctx.fillStyle=shadeColor(base,lum);ctx.fillRect(x,top,1,wallH);if((Math.floor(tex*32)%16===0)&&wallH>15){ctx.fillStyle=`rgba(205,190,135,${lum*.11})`;ctx.fillRect(x,top,1,wallH);}if(wallH>60){const mortar=((Math.floor(top/(wallH/4))%4)===0);if(mortar){ctx.fillStyle=`rgba(9,11,10,${.14+(1-lum)*.1})`;ctx.fillRect(x,top+wallH*.24,1,1);ctx.fillRect(x,top+wallH*.74,1,1);}}if(top>0){ctx.fillStyle='rgba(0,0,0,.2)';ctx.fillRect(x,top,1,2);}}
 // Dust motes deepen the flashlight-dark space.
 for(let i=0;i<32;i++){const px=(i*173+clock*17)%W,py=(i*97+Math.sin(clock+i)*12)%H;ctx.fillStyle=`rgba(202,205,158,${.08+((i%3)*.035)})`;ctx.fillRect(px,py,1,1);}
 renderSprites(horizon);
}
function project(x,y,horizon){const dx=x-player.x,dy=y-player.y,d=Math.hypot(dx,dy),a=Math.atan2(dy,dx),rel=Math.atan2(Math.sin(a-player.a),Math.cos(a-player.a));if(Math.abs(rel)>FOV*.68||d<.1)return null;return{x:W*(.5+rel/FOV),d,horizon,scale:H/d};}
function renderSprites(horizon){const things=[];for(const e of enemies)if(e.alive)things.push({obj:e,type:'enemy',x:e.x,y:e.y});for(const p of loot)if(!p.taken)things.push({obj:p,type:p.type,x:p.x,y:p.y});things.push({obj:exit,type:'exit',x:exit.x,y:exit.y});things.sort((a,b)=>Math.hypot(b.x-player.x,b.y-player.y)-Math.hypot(a.x-player.x,a.y-player.y));for(const t of things){const p=project(t.x,t.y,horizon);if(!p)continue;const sx=p.x,dist=p.d;if(sx<0||sx>=W)continue;const col=Math.floor(sx);if(dist>zBuffer[col]+.25)continue;if(t.type==='enemy')drawEnemy(sx,dist,horizon,t.obj);else if(t.type==='ammo'||t.type==='health')drawPickup(sx,dist,horizon,t);else drawExit(sx,dist,horizon);}}
function drawEnemy(x,d,h,e){const scale=Math.min(1.7,H/d/105),hh=100,ww=56,bob=Math.sin(e.phase)*3,top=h-hh*scale*.48+bob;if(top>H||top+hh*scale<0)return;ctx.save();ctx.translate(x,top);ctx.scale(scale,scale);const tint=e.hit>0?'#ead9b5':e.kind===0?'#555b45':e.kind===1?'#5c4840':'#484e51';// ground shadow
 ctx.fillStyle='#050605aa';ctx.beginPath();ctx.ellipse(0,hh*.94,ww*.45,hh*.055,0,0,TAU);ctx.fill();
 // boots and legs
 ctx.fillStyle='#252a25';ctx.fillRect(-ww*.3,hh*.68,ww*.24,hh*.27);ctx.fillRect(ww*.06,hh*.68,ww*.24,hh*.27);ctx.fillStyle='#6b6857';ctx.fillRect(-ww*.35,hh*.88,ww*.34,hh*.08);ctx.fillRect(ww*.03,hh*.88,ww*.34,hh*.08);
 // torso, shoulder plates
 ctx.fillStyle=tint;ctx.fillRect(-ww*.43,hh*.34,ww*.86,hh*.4);ctx.fillStyle='#74725c';ctx.fillRect(-ww*.48,hh*.36,ww*.96,hh*.09);ctx.fillStyle='#242923';ctx.fillRect(-ww*.35,hh*.48,ww*.7,hh*.09);ctx.fillStyle='#ab9f78';ctx.fillRect(-ww*.07,hh*.52,ww*.14,hh*.17);
 // arm and weapon
 ctx.fillStyle='#363a32';ctx.fillRect(ww*.27,hh*.39,ww*.24,hh*.27);ctx.fillStyle='#191d1b';ctx.fillRect(ww*.37,hh*.51,ww*.4,hh*.08);ctx.fillStyle='#88806a';ctx.fillRect(ww*.67,hh*.52,ww*.12,hh*.06);
 // head
 ctx.fillStyle='#837b65';ctx.fillRect(-ww*.25,hh*.08,ww*.5,hh*.27);ctx.fillStyle='#c1a577';ctx.fillRect(-ww*.2,hh*.13,ww*.4,hh*.12);ctx.fillStyle='#292722';ctx.fillRect(-ww*.26,hh*.22,ww*.52,hh*.08);ctx.fillStyle='#f05236';ctx.fillRect(-ww*.17,hh*.18,ww*.1,hh*.035);ctx.fillRect(ww*.07,hh*.18,ww*.1,hh*.035);ctx.fillStyle='#201f1b';ctx.fillRect(-ww*.08,hh*.3,ww*.16,hh*.035);
 ctx.restore();}
function drawPickup(x,d,h,t){const bob=Math.sin(t.obj.phase)*4,sz=Math.min(40,H/d*.2),y=h+sz*.45+bob;if(d>zBuffer[Math.floor(x)]||y>H)return;ctx.save();ctx.translate(x,y);ctx.fillStyle='#030504aa';ctx.beginPath();ctx.ellipse(0,sz*.48,sz*.34,sz*.1,0,0,TAU);ctx.fill();if(t.type==='ammo'){ctx.fillStyle='#b59437';ctx.fillRect(-sz*.34,-sz*.32,sz*.68,sz*.7);ctx.fillStyle='#dfc56a';ctx.fillRect(-sz*.26,-sz*.44,sz*.52,sz*.15);ctx.fillStyle='#544723';ctx.fillRect(-sz*.23,-sz*.12,sz*.46,sz*.12);ctx.fillStyle='#f5df8d';ctx.fillRect(-sz*.05,-sz*.28,sz*.1,sz*.18);}else{ctx.fillStyle='#e7e4d4';ctx.fillRect(-sz*.35,-sz*.28,sz*.7,sz*.62);ctx.fillStyle='#c63e31';ctx.fillRect(-sz*.1,-sz*.18,sz*.2,sz*.42);ctx.fillRect(-sz*.27,-sz*.04,sz*.54,sz*.14);}ctx.restore();}
function drawExit(x,d,h){const w=H/d*.44,hh=H/d*.85,top=h-hh*.48,glow=.45+Math.sin(clock*4)*.16;if(d>zBuffer[Math.floor(x)])return;ctx.save();ctx.globalAlpha=.16;ctx.fillStyle='#d5ff3f';ctx.beginPath();ctx.ellipse(x,h+hh*.44,w*1.5,hh*.08,0,0,TAU);ctx.fill();ctx.globalAlpha=1;ctx.translate(x,top);ctx.fillStyle='#272d20';ctx.fillRect(-w*.5,0,w,hh);ctx.fillStyle='#69713d';ctx.fillRect(-w*.42,hh*.05,w*.84,hh*.85);ctx.fillStyle=`rgba(213,255,63,${glow})`;ctx.fillRect(-w*.31,hh*.12,w*.62,hh*.7);ctx.fillStyle='#d9ff7c';ctx.fillRect(-w*.08,hh*.17,w*.16,hh*.58);ctx.fillStyle='#25291f';ctx.fillRect(-w*.52,hh*.91,w*1.04,hh*.06);ctx.restore();}
function drawWeapon(){const bobX=Math.sin(walk*1.1)*7, bobY=Math.abs(Math.cos(walk*1.1))*5;let recoil=shot>0?Math.sin((shot/.24)*Math.PI)*18:0;const x=W*.52+bobX,y=H+22+bobY+recoil;ctx.save();ctx.translate(x,y); // glove/forearm
 ctx.fillStyle='#282921';ctx.beginPath();ctx.moveTo(-44,-56);ctx.lineTo(9,-58);ctx.lineTo(25,11);ctx.lineTo(-53,16);ctx.closePath();ctx.fill();ctx.fillStyle='#5e5946';ctx.fillRect(-43,-45,60,15);ctx.fillStyle='#121615';ctx.beginPath();ctx.moveTo(-26,-137);ctx.lineTo(26,-137);ctx.lineTo(33,-82);ctx.lineTo(18,-45);ctx.lineTo(-26,-45);ctx.closePath();ctx.fill();ctx.fillStyle='#434b46';ctx.fillRect(-17,-139,36,13);ctx.fillStyle='#77745c';ctx.fillRect(-12,-130,24,4);ctx.fillStyle='#222522';ctx.fillRect(-23,-108,45,47);ctx.fillStyle='#69705d';ctx.fillRect(-20,-103,40,9);ctx.fillStyle='#151918';ctx.fillRect(-11,-92,22,12);ctx.fillStyle='#676d5a';ctx.fillRect(-5,-89,10,5);ctx.fillStyle='#272923';ctx.fillRect(-17,-62,32,31);ctx.fillStyle='#44483a';ctx.fillRect(-14,-57,27,6);ctx.fillStyle='#111513';ctx.fillRect(-9,-42,19,25);ctx.fillStyle='#9b7651';ctx.fillRect(-34,-49,19,14);ctx.fillRect(17,-49,19,14);
 if(shot>.12){ctx.fillStyle='#e8f4a1';ctx.beginPath();ctx.moveTo(-9,-139);ctx.lineTo(0,-190-Math.random()*12);ctx.lineTo(9,-139);ctx.lineTo(23,-155);ctx.lineTo(13,-132);ctx.lineTo(-15,-132);ctx.lineTo(-24,-155);ctx.closePath();ctx.fill();ctx.fillStyle='#ff9d38';ctx.fillRect(-5,-145,10,15);}ctx.restore();}
function drawMinimap(){const size=106,cell=size/gridW,ox=W-size-17,oy=62;ctx.fillStyle='rgba(4,7,7,.72)';ctx.fillRect(ox-6,oy-6,size+12,size+12);ctx.strokeStyle='#747962';ctx.strokeRect(ox-6,oy-6,size+12,size+12);for(let y=0;y<gridH;y++)for(let x=0;x<gridW;x++)if(world[y][x]){ctx.fillStyle='#53584c';ctx.fillRect(ox+x*cell,oy+y*cell,cell+.3,cell+.3);}for(const e of enemies)if(e.alive){ctx.fillStyle='#f0503a';ctx.fillRect(ox+e.x*cell-1,oy+e.y*cell-1,3,3);}for(const p of loot)if(!p.taken){ctx.fillStyle=p.type==='health'?'#d5ff3f':'#e0bd54';ctx.fillRect(ox+p.x*cell,oy+p.y*cell,2,2);}ctx.fillStyle='#d5ff3f';ctx.beginPath();ctx.arc(ox+player.x*cell,oy+player.y*cell,2.4,0,TAU);ctx.fill();ctx.strokeStyle='#d5ff3f';ctx.beginPath();ctx.moveTo(ox+player.x*cell,oy+player.y*cell);ctx.lineTo(ox+(player.x+Math.cos(player.a)*1.2)*cell,oy+(player.y+Math.sin(player.a)*1.2)*cell);ctx.stroke();ctx.fillStyle='#858a78';ctx.font='7px monospace';ctx.fillText('SECTOR MAP',ox,oy+size+14);}
function render(){ctx.save();ctx.scale(cw/W,ch/H);renderWorld();drawWeapon();drawMinimap();if(damageFlash>0){ctx.fillStyle=`rgba(180,28,21,${damageFlash*.33})`;ctx.fillRect(0,0,W,H);}if(hitFlash>0){ctx.fillStyle=`rgba(230,40,25,${hitFlash*.2})`;ctx.fillRect(0,0,W,H);}if(reload>0){ctx.fillStyle='#d5ff3f';ctx.font='10px monospace';ctx.textAlign='center';ctx.fillText('RELOADING',W/2,H*.63);}if(player.hp<30&&started&&!ended){ctx.fillStyle=`rgba(130,20,12,${.1+Math.sin(clock*7)*.07})`;ctx.fillRect(0,0,W,H);}ctx.restore();}
function loop(ts){const dt=Math.min(.05,(ts-last)/1000||0);last=ts;update(dt);render();requestAnimationFrame(loop);}
requestAnimationFrame(loop);
addEventListener('keydown',e=>{const k=e.key.toLowerCase();keys[k]=true;if([' ','arrowup','arrowdown','arrowleft','arrowright'].includes(k))e.preventDefault();if(k==='escape')pause();if(k==='r')startReload();if(k===' '&&!e.repeat)fire();});addEventListener('keyup',e=>keys[e.key.toLowerCase()]=false);
canvas.addEventListener('click',()=>{if(started&&!paused&&!ended){if(document.pointerLockElement!==canvas)canvas.requestPointerLock?.();else fire();}});
addEventListener('mousemove',e=>{if(document.pointerLockElement===canvas&&!paused){player.a+=e.movementX*.0025;}});
addEventListener('contextmenu',e=>e.preventDefault());
$('start-btn').addEventListener('click',begin);$('resume-btn').addEventListener('click',pause);$('pause-btn').addEventListener('click',pause);$('restart-btn').addEventListener('click',()=>{started=true;begin();});
$('sound-toggle').addEventListener('click',()=>{audioOn=!audioOn;$('sound-toggle').textContent=audioOn?'♫':'×';if(master)master.gain.value=audioOn?.35:0;if(audioOn)initAudio();});
$('touch-fire').addEventListener('pointerdown',e=>{e.preventDefault();triggerHeld=true;fire();});$('touch-fire').addEventListener('pointerup',()=>triggerHeld=false);$('touch-fire').addEventListener('pointercancel',()=>triggerHeld=false);
$('touch-turn').addEventListener('pointerdown',e=>{e.preventDefault();$('touch-turn').setPointerCapture(e.pointerId);$('touch-turn').dataset.x=e.clientX;});$('touch-turn').addEventListener('pointermove',e=>{if(e.buttons||e.pressure){const old=Number($('touch-turn').dataset.x||e.clientX);player.a+=(e.clientX-old)*.012;$('touch-turn').dataset.x=e.clientX;}});
document.querySelectorAll('.pad button').forEach(b=>{const k=b.dataset.key;b.addEventListener('pointerdown',e=>{e.preventDefault();keys[k]=true;b.setPointerCapture(e.pointerId);});for(const ev of ['pointerup','pointercancel','lostpointercapture'])b.addEventListener(ev,()=>keys[k]=false);});
})();
