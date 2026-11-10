(() => {
  'use strict';
  const canvas = document.getElementById('view');
  const ctx = canvas.getContext('2d', { alpha: false });
  const mapCanvas = document.getElementById('map');
  const mapCtx = mapCanvas.getContext('2d');
  const $ = (id) => document.getElementById(id);
  const TAU = Math.PI * 2;
  const GRID = 21;
  const FOV = Math.PI / 3;
  let world, player, enemies, pickups, exit, gameState = 'title';
  let lastTime = 0, gameTime = 0, kills = 0, damageFlash = 0, muzzle = 0, toastTimer = 0;
  let audio = null, audioMuted = false, ambientGain = null;
  let zBuffer = new Float32Array(960);
  let fireHeld = false, mobile = false;
  const keys = new Set();
  const touch = { forward: false, back: false, left: false, right: false };
  const weapons = [
    { name: 'SERVICE PISTOL', type: '9MM BALL · SEMI-AUTO', magSize: 12, ammo: 12, reserve: 48, damage: 38, fireRate: .29, reload: 1.05, spread: .012, range: 13, sound: 'pistol' },
    { name: 'BREACHER 12G', type: '12 GAUGE · 8 PELLET', magSize: 6, ammo: 6, reserve: 18, damage: 12, fireRate: .72, reload: 1.35, spread: .09, range: 8, sound: 'shotgun' },
    { name: 'ARC CARBINE', type: 'PLASMA CELL · FULL AUTO', magSize: 24, ammo: 24, reserve: 72, damage: 18, fireRate: .105, reload: 1.45, spread: .025, range: 12, sound: 'rifle' }
  ];
  let weaponIndex = 0, fireCooldown = 0, reloadTimer = 0, hurtCooldown = 0;
  const sprites = {};

  function randomGenerator(seed) {
    let state = seed >>> 0;
    return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
  }
  const rand = randomGenerator(93417);
  function makeWorld() {
    const grid = Array.from({ length: GRID }, () => Array(GRID).fill(1));
    const visited = new Set(['1,1']);
    const stack = [[1, 1]];
    grid[1][1] = 0;
    while (stack.length) {
      const [x, y] = stack[stack.length - 1];
      const choices = [[0,-2],[2,0],[0,2],[-2,0]].filter(([dx,dy]) => {
        const nx=x+dx, ny=y+dy; return nx>0&&ny>0&&nx<GRID-1&&ny<GRID-1&&!visited.has(`${nx},${ny}`);
      });
      if (!choices.length) { stack.pop(); continue; }
      const [dx,dy] = choices[Math.floor(rand()*choices.length)];
      grid[y+dy/2][x+dx/2] = 0; grid[y+dy][x+dx] = 0;
      visited.add(`${x+dx},${y+dy}`); stack.push([x+dx,y+dy]);
    }
    // Break selected walls into wider intersections and short loops.
    for (let y=2;y<GRID-2;y++) for(let x=2;x<GRID-2;x++) {
      if (grid[y][x] && rand()<.065 && ((grid[y-1][x]===0&&grid[y+1][x]===0)||(grid[y][x-1]===0&&grid[y][x+1]===0))) grid[y][x]=0;
    }
    // A few open chambers make landmarks and give fights room to breathe.
    [[5,5],[15,5],[5,15],[15,15],[10,10]].forEach(([cx,cy]) => {
      for(let y=cy-1;y<=cy+1;y++) for(let x=cx-1;x<=cx+1;x++) if(x>0&&y>0&&x<GRID-1&&y<GRID-1) grid[y][x]=0;
    });
    return grid;
  }
  function isWall(x,y) { return x<0||y<0||x>=GRID||y>=GRID||world[Math.floor(y)][Math.floor(x)]!==0; }
  function makeSprite(type, variant=0) {
    const c=document.createElement('canvas'); c.width=96; c.height=112; const g=c.getContext('2d');
    if(type==='enemy') {
      const hue=[0,12,110,280][variant%4];
      g.shadowColor=`hsla(${hue},90%,45%,.45)`;g.shadowBlur=14;
      const body=g.createRadialGradient(44,55,5,49,66,45);body.addColorStop(0,`hsl(${hue},24%,43%)`);body.addColorStop(.58,`hsl(${hue},35%,21%)`);body.addColorStop(1,'#111512');
      g.fillStyle=body;g.beginPath();g.moveTo(20,97);g.lineTo(15,76);g.lineTo(22,51);g.lineTo(30,34);g.lineTo(45,28);g.lineTo(62,34);g.lineTo(75,54);g.lineTo(82,81);g.lineTo(72,98);g.lineTo(58,104);g.lineTo(35,103);g.closePath();g.fill();g.shadowBlur=0;
      g.fillStyle='#19201c';g.beginPath();g.ellipse(48,50,27,24,0,0,TAU);g.fill();
      g.fillStyle='#69736b';g.beginPath();g.moveTo(24,43);g.lineTo(12,21);g.lineTo(34,34);g.moveTo(61,33);g.lineTo(78,17);g.lineTo(71,45);g.fill();
      const eyeGlow=g.createRadialGradient(37,49,1,37,49,9);eyeGlow.addColorStop(0,'#fff7d1');eyeGlow.addColorStop(.3,'#ff4539');eyeGlow.addColorStop(1,'#8e100b00');g.fillStyle=eyeGlow;g.beginPath();g.arc(37,49,9,0,TAU);g.fill();
      const eyeGlow2=g.createRadialGradient(60,48,1,60,48,9);eyeGlow2.addColorStop(0,'#fff7d1');eyeGlow2.addColorStop(.3,'#ff4539');eyeGlow2.addColorStop(1,'#8e100b00');g.fillStyle=eyeGlow2;g.beginPath();g.arc(60,48,9,0,TAU);g.fill();
      g.fillStyle='#1b0807';g.beginPath();g.ellipse(49,67,13,6,0,0,TAU);g.fill();g.strokeStyle='#d2c8a9';g.lineWidth=2;for(let i=0;i<5;i++){g.beginPath();g.moveTo(39+i*5,64);g.lineTo(40+i*5,71);g.stroke();}
      g.fillStyle='#788077';g.fillRect(23,83,49,7);g.fillStyle='#cf493b';g.fillRect(29,84,6,4);g.fillRect(58,84,7,4);
      g.fillStyle='#111712';g.fillRect(28,94,12,12);g.fillRect(57,94,12,12);
    } else if(type==='exit') {
      g.shadowColor='#d4ff67';g.shadowBlur=20;g.strokeStyle='#d4ff67';g.lineWidth=4;g.strokeRect(17,9,62,97);g.shadowBlur=0;g.fillStyle='#1b2c1a';g.fillRect(23,15,50,88);g.fillStyle='#b7ef68';g.globalAlpha=.18;g.fillRect(26,18,44,82);g.globalAlpha=1;
      g.fillStyle='#d4ff67';g.font='bold 14px monospace';g.textAlign='center';g.fillText('LIFT',48,42);g.font='bold 26px monospace';g.fillText('↓',48,76);g.fillStyle='#efffd0';g.fillRect(21,101,54,4);
    } else {
      g.shadowColor='#d4ff67';g.shadowBlur=13;g.translate(48,54);g.rotate(Math.PI/4);g.fillStyle=type==='ammo'?'#d4ff67':type==='health'?'#ef5c4d':type==='armor'?'#7dd4e0':'#b591ff';g.fillRect(-18,-18,36,36);g.fillStyle='#101611';g.fillRect(-12,-12,24,24);g.shadowBlur=0;g.fillStyle=type==='health'?'#fff':type==='ammo'?'#ecffad':type==='armor'?'#d5faff':'#ede0ff';
      if(type==='health'){g.fillRect(-3,-10,6,20);g.fillRect(-10,-3,20,6);}else if(type==='ammo'){g.fillRect(-7,-9,5,18);g.fillRect(2,-9,5,18);g.fillStyle='#7d9a42';g.fillRect(-7,-10,5,4);g.fillRect(2,-10,5,4);}else if(type==='armor'){g.beginPath();g.moveTo(0,-11);g.lineTo(9,-7);g.lineTo(8,3);g.lineTo(0,11);g.lineTo(-8,3);g.lineTo(-9,-7);g.closePath();g.fill();}else{g.font='bold 18px monospace';g.textAlign='center';g.textBaseline='middle';g.fillText('✦',0,1);}
    }
    return c;
  }
  sprites.enemy=[0,1,2,3].map((v)=>makeSprite('enemy',v));
  sprites.ammo=makeSprite('ammo');sprites.health=makeSprite('health');sprites.armor=makeSprite('armor');sprites.cell=makeSprite('cell');sprites.exit=makeSprite('exit');

  function initGame() {
    world=makeWorld(); player={x:1.5,y:1.5,angle:.12,health:100,armor:25,walk:0,damage:0};
    enemies=[];pickups=[];kills=0;gameTime=0;weaponIndex=0;fireCooldown=0;reloadTimer=0;hurtCooldown=0;
    weapons[0].ammo=12;weapons[0].reserve=48;weapons[1].ammo=6;weapons[1].reserve=18;weapons[2].ammo=24;weapons[2].reserve=72;
    const cells=[];
    for(let y=1;y<GRID-1;y+=2)for(let x=1;x<GRID-1;x+=2)if(!isWall(x+.5,y+.5)&&Math.hypot(x+.5-1.5,y+.5-1.5)>6&&Math.hypot(x+.5-19.5,y+.5-19.5)>2)cells.push({x:x+.5,y:y+.5});
    for(let i=cells.length-1;i>0;i--){const j=Math.floor(rand()*(i+1));[cells[i],cells[j]]=[cells[j],cells[i]];}
    for(let i=0;i<Math.min(11,cells.length);i++)enemies.push({x:cells[i].x,y:cells[i].y,hp:70+Math.floor(rand()*35),max:100,kind:i%4,alive:true,alert:false,attack:1.5+rand()*2,hit:0,phase:rand()*TAU,speed:.48+rand()*.16});
    const types=['ammo','ammo','health','armor','shells','cells','ammo','health','ammo','shells'];
    for(let i=0;i<types.length&&i<cells.length;i++){const c=cells[i+10];if(c)pickups.push({x:c.x,y:c.y,type:types[i],phase:rand()*TAU,taken:false});}
    exit={x:19.5,y:19.5};
    updateHud();
  }
  function resize() {
    const w=innerWidth,h=innerHeight; const scale=Math.min(1,960/w,540/h); canvas.width=Math.max(480,Math.floor(w*scale)); canvas.height=Math.max(270,Math.floor(h*scale));
    ctx.imageSmoothingEnabled=false; zBuffer=new Float32Array(canvas.width);
  }
  addEventListener('resize',resize); resize();

  function startAudio() {
    if(audio){if(audio.state==='suspended')audio.resume();return;}
    const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;
    audio=new AC();
    const master=audio.createGain();master.gain.value=audioMuted?0:.22;master.connect(audio.destination);
    const low=audio.createOscillator(),high=audio.createOscillator(),filter=audio.createBiquadFilter(),gain=audio.createGain();
    low.type='sawtooth';low.frequency.value=43;high.type='triangle';high.frequency.value=58;filter.type='lowpass';filter.frequency.value=155;gain.gain.value=.18;
    low.connect(filter);high.connect(filter);filter.connect(gain);gain.connect(master);low.start();high.start();ambientGain=gain;
    const lfo=audio.createOscillator(),lfoGain=audio.createGain();lfo.frequency.value=.11;lfoGain.gain.value=9;lfo.connect(lfoGain);lfoGain.connect(low.frequency);lfo.start();
    audio.master=master;
  }
  function tone(freq,duration,shape='square',volume=.12,slide=0) {
    if(!audio||audioMuted)return;const now=audio.currentTime,osc=audio.createOscillator(),gain=audio.createGain();osc.type=shape;osc.frequency.setValueAtTime(freq,now);if(slide)osc.frequency.exponentialRampToValueAtTime(Math.max(30,freq+slide),now+duration);
    gain.gain.setValueAtTime(volume,now);gain.gain.exponentialRampToValueAtTime(.001,now+duration);osc.connect(gain);gain.connect(audio.master);osc.start(now);osc.stop(now+duration+.02);
  }
  function noise(duration,volume=.12) {
    if(!audio||audioMuted)return;const len=Math.floor(audio.sampleRate*duration),buffer=audio.createBuffer(1,len,audio.sampleRate),data=buffer.getChannelData(0);for(let i=0;i<len;i++)data[i]=(Math.random()*2-1)*(1-i/len);
    const src=audio.createBufferSource(),gain=audio.createGain(),filter=audio.createBiquadFilter();filter.type='lowpass';filter.frequency.value=1600;gain.gain.value=volume;src.buffer=buffer;src.connect(filter);filter.connect(gain);gain.connect(audio.master);src.start();
  }
  function sfx(name) {
    if(name==='pistol'){tone(105,.14,'square',.18,-55);noise(.075,.1);}
    if(name==='shotgun'){tone(67,.24,'sawtooth',.22,-30);noise(.22,.2);}
    if(name==='rifle'){tone(190,.08,'sawtooth',.12,-100);noise(.04,.08);}
    if(name==='hit'){tone(440,.08,'triangle',.07,-180);}
    if(name==='death'){tone(115,.28,'sawtooth',.13,-80);tone(70,.4,'triangle',.08,-30);}
    if(name==='hurt'){tone(95,.25,'sawtooth',.13,-45);noise(.12,.08);}
    if(name==='pickup'){tone(550,.09,'sine',.09,130);tone(810,.16,'sine',.07,80);}
    if(name==='reload'){tone(260,.04,'square',.055,-100);setTimeout(()=>tone(390,.07,'square',.06,50),180);}
    if(name==='empty')tone(165,.06,'square',.045,-15);
    if(name==='enemyShot'){tone(80,.12,'square',.07,-35);noise(.08,.035);}
  }
  function showToast(message) {const el=$('toast');el.textContent=message;el.classList.add('show');toastTimer=1.5;}
  function showPickup(message){const el=$('pickup-banner');el.textContent=message;el.style.opacity='1';setTimeout(()=>el.style.opacity='0',1150);}
  function updateHud() {
    if(!player)return;const w=weapons[weaponIndex];$('health-value').textContent=String(Math.ceil(player.health)).padStart(3,'0');$('armor-value').textContent=String(Math.ceil(player.armor)).padStart(3,'0');$('health-meter').style.width=`${Math.max(0,player.health)}%`;$('armor-meter').style.width=`${Math.max(0,player.armor)*2}%`;
    $('health-state').textContent=player.health>65?'STABLE':player.health>30?'WOUNDED':'CRITICAL';$('health-state').style.color=player.health>65?'var(--acid)':'var(--red)';
    $('enemy-count').textContent=String(enemies.filter(e=>e.alive).length).padStart(2,'0');$('weapon-name').textContent=w.name;$('weapon-index').textContent=`0${weaponIndex+1} / 03`;$('ammo-current').textContent=String(w.ammo).padStart(2,'0');$('ammo-reserve').textContent=String(w.reserve).padStart(3,'0');$('ammo-type').textContent=w.type;
    $('objective').textContent=enemies.some(e=>e.alive)?'CLEAR THE SECTOR':'REACH THE SERVICE LIFT';
  }
  function normalizeAngle(a){while(a>Math.PI)a-=TAU;while(a< -Math.PI)a+=TAU;return a;}
  function castRay(angle) {
    const dx=Math.cos(angle),dy=Math.sin(angle);let mapX=Math.floor(player.x),mapY=Math.floor(player.y);
    const deltaX=Math.abs(1/dx),deltaY=Math.abs(1/dy);const stepX=dx<0?-1:1,stepY=dy<0?-1:1;
    let sideX=dx<0?(player.x-mapX)*deltaX:(mapX+1-player.x)*deltaX;
    let sideY=dy<0?(player.y-mapY)*deltaY:(mapY+1-player.y)*deltaY;let side=0,steps=0;
    while(steps++<64){if(sideX<sideY){sideX+=deltaX;mapX+=stepX;side=0;}else{sideY+=deltaY;mapY+=stepY;side=1;}if(mapX<0||mapY<0||mapX>=GRID||mapY>=GRID||world[mapY][mapX])break;}
    let dist=side===0?sideX-deltaX:sideY-deltaY;dist=Math.max(.04,dist);let wallX=side===0?player.y+dist*dy:player.x+dist*dx;wallX-=Math.floor(wallX);
    return {dist,side,wallX,mapX,mapY};
  }
  function shadeColor(r,g,b,shade){return `rgb(${Math.max(0,r*shade|0)},${Math.max(0,g*shade|0)},${Math.max(0,b*shade|0)})`;}
  function renderWorld() {
    const W=canvas.width,H=canvas.height,half=H/2;
    const ceil=ctx.createLinearGradient(0,0,0,half);ceil.addColorStop(0,'#090e0d');ceil.addColorStop(1,'#19201b');ctx.fillStyle=ceil;ctx.fillRect(0,0,W,half);
    const floor=ctx.createLinearGradient(0,half,0,H);floor.addColorStop(0,'#20241d');floor.addColorStop(1,'#070a09');ctx.fillStyle=floor;ctx.fillRect(0,half,W,half);
    ctx.fillStyle='#87916e08';for(let y=half+8;y<H;y+=Math.max(3,Math.floor((y-half)/10)))ctx.fillRect(0,y,W,1);
    const stride=W>720?2:1,plane=Math.tan(FOV/2),horizon=half+Math.sin(player.walk)*1.5;
    for(let x=0;x<W;x+=stride){const cam=2*x/W-1,rayAngle=player.angle+Math.atan(cam*plane),hit=castRay(rayAngle),dist=hit.dist*Math.cos(rayAngle-player.angle);zBuffer[x]=dist;if(stride===2)zBuffer[x+1]=dist;
      const wallH=Math.min(H*2,H/dist),top=Math.max(0,horizon-wallH/2),bottom=Math.min(H,horizon+wallH/2),frac=hit.wallX;
      const cell=(hit.mapX*7+hit.mapY*11)%4,base=[[108,119,96],[89,105,91],[115,101,78],[76,99,94]][cell];let shade=(hit.side===1?.76:1)*Math.max(.15,1-dist/13);shade*=.84+Math.sin(frac*38)*.06;
      ctx.fillStyle=shadeColor(...base,shade);ctx.fillRect(x,top,stride,bottom-top);
      // Industrial panel seams, rivets and chipped paint lend the walls a hand-built pixel texture.
      const seam=(frac>.965||frac<.025),stripe=(Math.floor(frac*8)%2===0);
      if(seam){ctx.fillStyle=`rgba(9,13,11,${Math.min(.8,.35+dist*.035)})`;ctx.fillRect(x,top,stride,Math.max(1,wallH*.025));ctx.fillRect(x,bottom-Math.max(1,wallH*.025),stride,Math.max(1,wallH*.025));}
      if(stripe&&wallH>15){ctx.fillStyle=`rgba(9,13,11,${.16*shade})`;ctx.fillRect(x,top+wallH*.12,stride,wallH*.018);ctx.fillRect(x,top+wallH*.83,stride,wallH*.013);}
      if((hit.mapX*3+hit.mapY*5)%9===0&&wallH>25){ctx.fillStyle=`rgba(212,255,103,${.055*shade})`;ctx.fillRect(x,top+wallH*.35,stride,Math.max(1,wallH*.08));}
      if(hit.side===1){ctx.fillStyle=`rgba(0,0,0,${.14})`;ctx.fillRect(x,top,stride,bottom-top);}
      if(bottom<H){ctx.fillStyle=`rgba(0,0,0,${Math.min(.55,dist*.035)})`;ctx.fillRect(x,bottom,stride,H-bottom);}
    }
    drawSprites(W,H,horizon,stride);
    drawWeapon(W,H);
    // Flashlight cone stays subtle: a soft, short-lived warm bloom rather than a full-screen wash.
    if(muzzle>0){const glow=ctx.createRadialGradient(W/2,H*.77,3,W/2,H*.74,H*.42);glow.addColorStop(0,`rgba(255,221,128,${muzzle*.27})`);glow.addColorStop(1,'rgba(255,180,60,0)');ctx.fillStyle=glow;ctx.fillRect(W*.25,H*.35,W*.5,H*.65);}
    drawMap();
  }
  function drawSprites(W,H,horizon,stride) {
    const list=[];
    for(const e of enemies)if(e.alive)list.push({obj:e,type:'enemy',x:e.x,y:e.y,dist:Math.hypot(e.x-player.x,e.y-player.y)});
    for(const p of pickups)if(!p.taken)list.push({obj:p,type:p.type==='shells'||p.type==='cells'?'ammo':p.type,x:p.x,y:p.y,dist:Math.hypot(p.x-player.x,p.y-player.y)});
    list.push({obj:exit,type:'exit',x:exit.x,y:exit.y,dist:Math.hypot(exit.x-player.x,exit.y-player.y)});
    list.sort((a,b)=>b.dist-a.dist);
    const plane=Math.tan(FOV/2);
    for(const item of list){const dx=item.x-player.x,dy=item.y-player.y,angle=normalizeAngle(Math.atan2(dy,dx)-player.angle),depth=item.dist*Math.cos(angle);if(depth<=.15||Math.abs(angle)>FOV*.72)continue;
      const sx=W/2+(Math.tan(angle)/plane)*(W/2),size=Math.min(H*1.5,H/depth*(item.type==='enemy'?1.04:item.type==='exit'?1.2:.43));const sw=item.type==='enemy'?size*.82:item.type==='exit'?size*.55:size;const sh=item.type==='enemy'?size:item.type==='exit'?size:size;const bob=item.type==='enemy'?Math.sin(gameTime*3+item.obj.phase)*size*.018:item.type==='exit'?0:Math.sin(gameTime*2+item.obj.phase)*size*.07;
      const left=sx-sw/2,top=horizon-sh*.54+bob,centerX=Math.floor(sx);
      if(centerX>=0&&centerX<W&&zBuffer[centerX]<depth-.12)continue;
      const texture=item.type==='enemy'?sprites.enemy[item.obj.kind]:item.type==='exit'?sprites.exit:item.type==='shells'?sprites.ammo:sprites[item.type]||sprites.ammo;
      ctx.save();if(item.type==='enemy'&&item.obj.hit>0){ctx.globalAlpha=.55+Math.sin(gameTime*30)*.3;ctx.filter='brightness(1.7) saturate(.6)';}
      if(item.type==='exit'){ctx.globalAlpha=enemies.some(e=>e.alive)?.35:.95;ctx.filter=enemies.some(e=>e.alive)?'saturate(.4) brightness(.65)':'';}
      if(item.type==='enemy'&&item.dist<3){ctx.globalAlpha*=Math.min(1,.7+Math.sin(gameTime*10+item.obj.phase)*.18);}
      if(left+sw>0&&left<W)ctx.drawImage(texture,left,top,sw,sh);
      // Health sliver when a wounded target is centered and close enough.
      if(item.type==='enemy'&&item.obj.hp<item.obj.max&&item.dist<6){const bw=sw*.58;ctx.fillStyle='#111';ctx.fillRect(sx-bw/2,top-5,bw,2);ctx.fillStyle='#fa5946';ctx.fillRect(sx-bw/2,top-5,bw*Math.max(0,item.obj.hp/item.obj.max),2);}
      ctx.restore();
    }
  }
  function drawWeapon(W,H) {
    const recoil=muzzle>0?muzzle*22:0, sway=Math.sin(player.walk)*4;
    ctx.save();ctx.translate(W*.72+sway,H+recoil);ctx.scale(W/800,H/450);
    // chunky, low-resolution sidearm silhouette
    ctx.fillStyle='#070a08';ctx.beginPath();ctx.moveTo(6,-2);ctx.lineTo(12,-100);ctx.lineTo(35,-122);ctx.lineTo(76,-119);ctx.lineTo(91,-93);ctx.lineTo(102,-20);ctx.lineTo(89,0);ctx.closePath();ctx.fill();
    ctx.fillStyle='#38413a';ctx.beginPath();ctx.moveTo(15,-9);ctx.lineTo(21,-95);ctx.lineTo(39,-112);ctx.lineTo(71,-109);ctx.lineTo(84,-89);ctx.lineTo(94,-18);ctx.lineTo(83,-9);ctx.closePath();ctx.fill();
    ctx.fillStyle='#111712';ctx.fillRect(30,-105,39,12);ctx.fillStyle='#91a085';ctx.fillRect(35,-104,28,4);ctx.fillStyle='#252c26';ctx.fillRect(38,-88,28,40);ctx.fillStyle='#778174';ctx.fillRect(45,-85,4,29);ctx.fillStyle='#d4ff67';ctx.fillRect(51,-94,8,2);
    ctx.fillStyle='#1b211b';ctx.beginPath();ctx.moveTo(35,-50);ctx.lineTo(72,-50);ctx.lineTo(78,-8);ctx.lineTo(24,-7);ctx.closePath();ctx.fill();ctx.fillStyle='#596254';for(let i=0;i<5;i++)ctx.fillRect(29+i*8,-41,3,26);
    if(muzzle>0){ctx.globalAlpha=Math.min(1,muzzle*2);ctx.fillStyle='#fff0a5';ctx.beginPath();ctx.moveTo(40,-119);ctx.lineTo(52,-154-muzzle*20);ctx.lineTo(63,-119);ctx.lineTo(87,-136);ctx.lineTo(75,-110);ctx.lineTo(99,-105);ctx.lineTo(70,-101);ctx.lineTo(49,-105);ctx.lineTo(22,-97);ctx.lineTo(37,-112);ctx.closePath();ctx.fill();ctx.globalAlpha=1;}
    ctx.restore();
  }
  function drawMap() {
    const w=mapCanvas.width,h=mapCanvas.height,cell=w/GRID;mapCtx.fillStyle='#0a100e';mapCtx.fillRect(0,0,w,h);
    for(let y=0;y<GRID;y++)for(let x=0;x<GRID;x++){const d=Math.hypot(x+.5-player.x,y+.5-player.y);if(d>11)continue;if(world[y][x]){mapCtx.fillStyle=d<7?'#354339':'#222c25';mapCtx.fillRect(x*cell,y*cell,Math.ceil(cell),Math.ceil(cell));}else if(d<5){mapCtx.fillStyle='#101a15';mapCtx.fillRect(x*cell,y*cell,cell,cell);}}
    const ex=exit.x*cell,ey=exit.y*cell;mapCtx.fillStyle='#d4ff67';mapCtx.globalAlpha=enemies.some(e=>e.alive)?.35:1;mapCtx.fillRect(ex-2,ey-2,4,4);mapCtx.globalAlpha=1;
    for(const e of enemies)if(e.alive&&Math.hypot(e.x-player.x,e.y-player.y)<8){mapCtx.fillStyle='#ff5948';mapCtx.fillRect(e.x*cell-1.6,e.y*cell-1.6,3.2,3.2);}
    mapCtx.save();mapCtx.translate(player.x*cell,player.y*cell);mapCtx.rotate(player.angle);mapCtx.fillStyle='#e6ffad';mapCtx.beginPath();mapCtx.moveTo(5,0);mapCtx.lineTo(-3,-3);mapCtx.lineTo(-2,3);mapCtx.closePath();mapCtx.fill();mapCtx.restore();
  }
  function collides(x,y,r=.2) {return isWall(x-r,y-r)||isWall(x+r,y-r)||isWall(x-r,y+r)||isWall(x+r,y+r);}
  function lineOfSight(x,y) {const dx=x-player.x,dy=y-player.y,d=Math.hypot(dx,dy),hit=castRay(Math.atan2(dy,dx));return hit.dist>d-.25;}
  function damageEnemy(e,amount) {if(!e.alive)return;e.hp-=amount;e.hit=.12;e.alert=true;if(e.hp<=0){e.alive=false;kills++;sfx('death');showToast('HOSTILE NEUTRALIZED');updateHud();if(!enemies.some(v=>v.alive))showToast('SECTOR CLEAR — FIND THE SERVICE LIFT');}else sfx('hit');}
  function shoot() {
    if(gameState!=='playing'||reloadTimer>0||fireCooldown>0)return;const w=weapons[weaponIndex];
    if(w.ammo<=0){sfx('empty');if(w.reserve>0)beginReload();else showToast('NO AMMO — SWITCH WEAPON');fireCooldown=.22;return;}
    w.ammo--;fireCooldown=w.fireRate;muzzle=.16;sfx(w.sound);
    const pellets=weaponIndex===1?8:1;let hitAny=false;
    for(let p=0;p<pellets;p++){
      const aim=player.angle+(Math.random()-.5)*w.spread;let best=null,bestDist=w.range;
      for(const e of enemies){if(!e.alive)continue;const dx=e.x-player.x,dy=e.y-player.y,d=Math.hypot(dx,dy);if(d>bestDist)continue;const rel=Math.abs(normalizeAngle(Math.atan2(dy,dx)-aim));if(rel>Math.atan2(.38,d))continue;if(!lineOfSight(e.x,e.y))continue;best=e;bestDist=d;}
      if(best){damageEnemy(best,weaponIndex===1?w.damage*(.8+Math.random()*.4):w.damage);hitAny=true;}
    }
    $('crosshair').classList.toggle('hit',hitAny);if(hitAny)setTimeout(()=>$('crosshair').classList.remove('hit'),100);updateHud();
  }
  function beginReload() {const w=weapons[weaponIndex];if(reloadTimer>0||w.ammo>=w.magSize||w.reserve<=0)return;reloadTimer=w.reload;sfx('reload');showToast('RELOADING');}
  function switchWeapon(i) {if(i<0||i>=weapons.length||i===weaponIndex)return;weaponIndex=i;reloadTimer=0;updateHud();sfx('pickup');}
  function collectPickups() {
    for(const p of pickups){if(p.taken||Math.hypot(player.x-p.x,player.y-p.y)>.48)continue;let message='';
      if(p.type==='ammo'){weapons[0].reserve=Math.min(120,weapons[0].reserve+16);message='9MM AMMO +16';}
      if(p.type==='shells'){weapons[1].reserve=Math.min(48,weapons[1].reserve+8);message='12G SHELLS +8';}
      if(p.type==='cells'){weapons[2].reserve=Math.min(180,weapons[2].reserve+24);message='PLASMA CELLS +24';}
      if(p.type==='health'){if(player.health>=100)continue;player.health=Math.min(100,player.health+35);message='MED PATCH +35';}
      if(p.type==='armor'){if(player.armor>=100)continue;player.armor=Math.min(100,player.armor+35);message='ARMOR PLATE +35';}
      p.taken=true;sfx('pickup');showPickup(message);updateHud();
    }
  }
  function hurtPlayer(amount) {
    if(hurtCooldown>0||gameState!=='playing')return;hurtCooldown=.48;const absorbed=Math.min(player.armor,amount*.65);player.armor-=absorbed;player.health=Math.max(0,player.health-(amount-absorbed));damageFlash=.65;sfx('hurt');$('damage-flash').style.opacity='.78';setTimeout(()=>$('damage-flash').style.opacity='0',140);updateHud();
    if(player.health<=0)endGame(false);
  }
  function updateEnemies(dt) {
    let nearest=99;
    for(const e of enemies){if(!e.alive)continue;e.hit=Math.max(0,e.hit-dt);const dx=player.x-e.x,dy=player.y-e.y,d=Math.hypot(dx,dy);nearest=Math.min(nearest,d);
      if(d<9)e.alert=true;if(!e.alert)continue;
      if(d>1.15){const vx=dx/d*e.speed*dt,vy=dy/d*e.speed*dt;let moved=false;if(!collides(e.x+vx,e.y,.24)){e.x+=vx;moved=true;}if(!collides(e.x,e.y+vy,.24)){e.y+=vy;moved=true;}if(!moved&&Math.random()<dt*1.6)e.phase+=Math.PI/2;}
      if(d<7&&e.attack<=0&&lineOfSight(e.x,e.y)){e.attack=1.5+Math.random()*1.3;sfx('enemyShot');if(d<5.4&&Math.random()<.58)hurtPlayer(8+Math.random()*8);}
      e.attack-=dt;
    }
    if(ambientGain&&audio){const target=nearest<7?.26:.14;ambientGain.gain.setTargetAtTime(target,audio.currentTime,.7);}
  }
  function update(dt) {
    if(gameState!=='playing')return;gameTime+=dt;fireCooldown=Math.max(0,fireCooldown-dt);muzzle=Math.max(0,muzzle-dt);hurtCooldown=Math.max(0,hurtCooldown-dt);damageFlash=Math.max(0,damageFlash-dt);
    if(toastTimer>0&&(toastTimer-=dt)<=0)$('toast').classList.remove('show');
    if(reloadTimer>0&&(reloadTimer-=dt)<=0){const w=weapons[weaponIndex],n=Math.min(w.magSize-w.ammo,w.reserve);w.ammo+=n;w.reserve-=n;updateHud();}
    let forward=(keys.has('KeyW')||keys.has('ArrowUp')||touch.forward?1:0)-(keys.has('KeyS')||keys.has('ArrowDown')||touch.back?1:0);
    let side=(keys.has('KeyD')?1:0)-(keys.has('KeyA')?1:0)+(touch.right?1:0)-(touch.left?1:0);
    const speed=(keys.has('ShiftLeft')||keys.has('ShiftRight')?3.15:2.35)*dt;const mag=Math.hypot(forward,side)||1;forward/=mag;side/=mag;
    const dx=(Math.cos(player.angle)*forward-Math.sin(player.angle)*side)*speed,dy=(Math.sin(player.angle)*forward+Math.cos(player.angle)*side)*speed;
    if(!collides(player.x+dx,player.y,.2))player.x+=dx;if(!collides(player.x,player.y+dy,.2))player.y+=dy;
    if(forward||side)player.walk+=dt*10;
    if(fireHeld||keys.has('Space'))shoot();updateEnemies(dt);collectPickups();
    if(!enemies.some(e=>e.alive)&&Math.hypot(player.x-exit.x,player.y-exit.y)<.8)endGame(true);
    updateHud();
  }
  function setScreen(name) {for(const id of ['title-screen','pause-screen','end-screen'])$(id).classList.toggle('visible',id===name);}
  function startGame() {
    if(gameState==='playing')return;initGame();gameState='playing';setScreen('');startAudio();$('touch-controls').style.opacity=mobile?'.78':'';
    if(!mobile&&canvas.requestPointerLock)canvas.requestPointerLock();showToast('STAY QUIET. STAY ALIVE.');
  }
  function pauseGame() {
    if(gameState!=='playing')return;gameState='paused';fireHeld=false;setScreen('pause-screen');if(document.pointerLockElement)document.exitPointerLock();
  }
  function resumeGame() {
    if(gameState!=='paused')return;gameState='playing';setScreen('');if(!mobile&&canvas.requestPointerLock)canvas.requestPointerLock();
  }
  function endGame(won) {
    if(gameState==='ended')return;gameState='ended';fireHeld=false;if(document.pointerLockElement)document.exitPointerLock();
    $('end-kicker').textContent=won?'EXTRACTION CONFIRMED':'SIGNAL LOST';$('end-title').innerHTML=won?'SECTOR CLEARED<span>.</span>':'OPERATOR DOWN<span>.</span>';$('end-copy').textContent=won?'The lift doors close. Something is still moving below.':'The facility goes quiet. Another team will be sent.';
    $('final-kills').textContent=String(kills).padStart(2,'0');$('final-time').textContent=`${String(Math.floor(gameTime/60)).padStart(2,'0')}:${String(Math.floor(gameTime%60)).padStart(2,'0')}`;setScreen('end-screen');
  }
  $('start-button').addEventListener('click',startGame);$('resume-button').addEventListener('click',resumeGame);$('restart-button').addEventListener('click',startGame);$('pause-button').addEventListener('click',pauseGame);
  $('audio-toggle').addEventListener('click',()=>{audioMuted=!audioMuted;startAudio();if(audio)audio.master.gain.setTargetAtTime(audioMuted?0:.22,audio.currentTime,.08);$('audio-toggle').innerHTML=audioMuted?'♫ <span>SOUND OFF</span>':'♫ <span>SOUND ON</span>';});
  function handleKeyDown(e) {
    if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code))e.preventDefault();
    if(e.code==='Enter'&&gameState==='title'){startGame();return;}
    if(e.code==='Escape'){if(gameState==='playing')pauseGame();else if(gameState==='paused')resumeGame();return;}
    if(gameState!=='playing')return;keys.add(e.code);
    if(e.code==='KeyR')beginReload();if(e.code==='Digit1')switchWeapon(0);if(e.code==='Digit2')switchWeapon(1);if(e.code==='Digit3')switchWeapon(2);
  }
  function handleKeyUp(e){keys.delete(e.code);}
  addEventListener('keydown',handleKeyDown);addEventListener('keyup',handleKeyUp);addEventListener('blur',()=>{keys.clear();fireHeld=false;});
  canvas.addEventListener('mousedown',(e)=>{if(gameState!=='playing'||e.button!==0)return;e.preventDefault();if(!mobile&&canvas.requestPointerLock&&!document.pointerLockElement)canvas.requestPointerLock();fireHeld=true;shoot();});
  addEventListener('mouseup',()=>fireHeld=false);canvas.addEventListener('contextmenu',e=>e.preventDefault());
  document.addEventListener('mousemove',(e)=>{if(gameState!=='playing'||mobile)return;if(document.pointerLockElement===canvas)player.angle=normalizeAngle(player.angle+e.movementX*.00235);else if(e.buttons===1)player.angle=normalizeAngle(player.angle+e.movementX*.004);});
  document.querySelectorAll('[data-move]').forEach(button=>{
    const name=button.dataset.move;const down=e=>{e.preventDefault();touch[name]=true;};const up=e=>{e.preventDefault();touch[name]=false;};
    button.addEventListener('pointerdown',down);button.addEventListener('pointerup',up);button.addEventListener('pointercancel',up);button.addEventListener('pointerleave',up);
  });
  const touchFire=$('touch-fire');touchFire.addEventListener('pointerdown',e=>{e.preventDefault();fireHeld=true;shoot();});['pointerup','pointercancel','pointerleave'].forEach(ev=>touchFire.addEventListener(ev,e=>{e.preventDefault();fireHeld=false;}));
  $('touch-reload').addEventListener('pointerdown',e=>{e.preventDefault();beginReload();});
  mobile=matchMedia('(pointer: coarse)').matches||innerWidth<700;
  addEventListener('resize',()=>{mobile=matchMedia('(pointer: coarse)').matches||innerWidth<700;});
  function frame(now) {const dt=Math.min(.04,(now-lastTime)/1000||0);lastTime=now;update(dt);renderWorld();requestAnimationFrame(frame);}
  initGame();requestAnimationFrame(frame);
})();
