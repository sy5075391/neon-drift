(() => {
  'use strict';

  const canvas = document.querySelector('#game');
  const ctx = canvas.getContext('2d', { alpha: false });
  const $ = (selector) => document.querySelector(selector);

  const ui = {
    hud: $('#hud'), controls: $('#controls'), score: $('#score'), combo: $('#combo'),
    comboWrap: $('#combo-wrap'), comboFill: $('#combo-fill'), status: $('#status-pill'),
    start: $('#start-screen'), pause: $('#pause-screen'), over: $('#gameover-screen'),
    bestStart: $('#best-start'), finalScore: $('#final-score'), finalCombo: $('#final-combo'),
    finalTime: $('#final-time'), newBest: $('#new-best'), resultTitle: $('#result-title'),
    joystickZone: $('#joystick-zone'), joystickKnob: $('#joystick-knob'),
    dashButton: $('#dash-btn'), dashRing: $('#dash-ring')
  };

  const TAU = Math.PI * 2;
  const DPR_LIMIT = 2;
  const BEST_KEY = 'neon-drift-best-v1';
  let width = 0, height = 0, dpr = 1, lastTime = 0, raf = 0;
  let state = 'menu';
  let score = 0, best = Number(localStorage.getItem(BEST_KEY) || 0), elapsed = 0;
  let combo = 1, comboCount = 0, comboTimer = 0, maxCombo = 0, collected = 0;
  let enemyTimer = 0, orbTimer = 0, powerTimer = 0, laserTimer = 0;
  let shake = 0, flash = 0, slowTimer = 0, shield = 0;
  let audio = null, statusTimeout = 0;
  let enemies = [], orbs = [], particles = [], ripples = [], lasers = [];

  const player = {
    x: 0, y: 0, r: 10, vx: 0, vy: 0, speed: 230,
    dash: 0, dashCooldown: 0, invincible: 0, trail: []
  };

  const input = { active: false, id: null, sx: 0, sy: 0, dx: 0, dy: 0 };

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, DPR_LIMIT);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (state !== 'playing') { player.x = width / 2; player.y = height * .44; }
    player.x = clamp(player.x, 24, width - 24);
    player.y = clamp(player.y, 90, height - 190);
  }

  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
  function rand(min, max) { return min + Math.random() * (max - min); }
  function dist2(a, b) { const x = a.x - b.x, y = a.y - b.y; return x * x + y * y; }
  function vibrate(pattern) { if ('vibrate' in navigator) navigator.vibrate(pattern); }

  function initAudio() {
    if (audio) return;
    try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) { audio = null; }
  }

  function tone(freq, duration = .07, type = 'sine', volume = .035, slide = 0) {
    if (!audio) return;
    const now = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), now + duration);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
    osc.connect(gain).connect(audio.destination);
    osc.start(now); osc.stop(now + duration);
  }

  function resetGame() {
    score = 0; elapsed = 0; combo = 1; comboCount = 0; comboTimer = 0; maxCombo = 0; collected = 0;
    enemyTimer = 1.4; orbTimer = 0; powerTimer = 0; laserTimer = 9;
    shake = 0; flash = 0; slowTimer = 0; shield = 1;
    enemies = []; orbs = []; particles = []; ripples = []; lasers = [];
    Object.assign(player, { x: width / 2, y: height * .42, vx: 0, vy: 0, dash: 0, dashCooldown: 0, invincible: 1.2, trail: [] });
    releaseInput();
    for (let i = 0; i < 3; i++) spawnOrb();
    updateUI();
  }

  function startGame() {
    initAudio();
    if (audio?.state === 'suspended') audio.resume();
    resetGame(); state = 'playing'; lastTime = performance.now();
    setScreen(null); ui.hud.classList.remove('hidden'); ui.controls.classList.remove('hidden');
    showStatus('护盾已就绪', '#63f3ff');
    tone(420, .12, 'sine', .04, 240);
    cancelAnimationFrame(raf); raf = requestAnimationFrame(loop);
  }

  function setScreen(name) {
    for (const [key, el] of [['start', ui.start], ['pause', ui.pause], ['over', ui.over]]) {
      const active = key === name;
      el.classList.toggle('active', active);
      el.setAttribute('aria-hidden', String(!active));
    }
  }

  function pauseGame() {
    if (state !== 'playing') return;
    state = 'paused'; releaseInput(); setScreen('pause');
  }

  function resumeGame() {
    if (state !== 'paused') return;
    state = 'playing'; setScreen(null); lastTime = performance.now(); raf = requestAnimationFrame(loop);
  }

  function endGame() {
    if (state !== 'playing') return;
    state = 'over'; releaseInput(); ui.controls.classList.add('hidden'); ui.hud.classList.add('hidden');
    const rounded = Math.floor(score);
    const isBest = rounded > best;
    if (isBest) { best = rounded; localStorage.setItem(BEST_KEY, String(best)); }
    ui.finalScore.textContent = rounded.toLocaleString('zh-CN');
    ui.finalCombo.textContent = `${maxCombo} 连`;
    ui.finalTime.textContent = formatTime(elapsed);
    ui.newBest.classList.toggle('hidden', !isBest);
    ui.resultTitle.textContent = isBest ? '打破纪录' : '漂移结束';
    ui.bestStart.textContent = best.toLocaleString('zh-CN');
    setScreen('over'); vibrate([40, 50, 90]);
    tone(220, .3, 'sawtooth', .045, -140);
  }

  function spawnOrb() {
    const margin = 44;
    let x, y, tries = 0;
    do {
      x = rand(margin, width - margin);
      y = rand(105, Math.max(130, height - 205));
      tries++;
    } while (tries < 16 && Math.hypot(x - player.x, y - player.y) < 100);
    orbs.push({ x, y, r: 7, phase: rand(0, TAU), life: 0 });
  }

  function spawnEnemy() {
    const side = Math.floor(Math.random() * 4);
    let x, y;
    if (side === 0) { x = rand(0, width); y = -30; }
    if (side === 1) { x = width + 30; y = rand(70, height - 160); }
    if (side === 2) { x = rand(0, width); y = height + 30; }
    if (side === 3) { x = -30; y = rand(70, height - 160); }
    const tier = Math.random() < Math.min(.4, elapsed / 130) ? 1 : 0;
    enemies.push({ x, y, r: tier ? 13 : 10, speed: rand(58, 78) + elapsed * .34 + tier * 14, phase: rand(0, TAU), tier, vx: 0, vy: 0 });
  }

  function spawnLaser() {
    const horizontal = Math.random() < .5;
    const pos = horizontal ? rand(125, height - 210) : rand(45, width - 45);
    lasers.push({ horizontal, pos, warning: 1.45, active: .55, life: 2, width: 8 });
    showStatus('激光预警', '#ffcf66');
    tone(180, .12, 'square', .025, 70);
  }

  function burst(x, y, color, count = 12, speed = 120) {
    for (let i = 0; i < count; i++) {
      const a = rand(0, TAU), s = rand(speed * .3, speed);
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(.28, .65), max: .65, size: rand(1.5, 4), color });
    }
  }

  function showStatus(text, color = '#63f3ff') {
    clearTimeout(statusTimeout); ui.status.textContent = text; ui.status.style.color = color;
    ui.status.classList.remove('hidden');
    statusTimeout = setTimeout(() => ui.status.classList.add('hidden'), 1300);
  }

  function collectOrb(orb, index) {
    orbs.splice(index, 1); collected++; comboCount++; comboTimer = 2.25;
    combo = Math.min(5, 1 + Math.floor(comboCount / 6)); maxCombo = Math.max(maxCombo, comboCount);
    score += 100 * combo; flash = .08;
    burst(orb.x, orb.y, combo >= 4 ? '#ff4fa3' : '#63f3ff', 14, 150);
    ripples.push({ x: orb.x, y: orb.y, r: 4, life: .45, color: '#63f3ff' });
    tone(330 + combo * 75, .07, 'sine', .03, 90); vibrate(8);
    if (collected % 10 === 0) grantPower();
    if (orbs.length < 3) spawnOrb();
    updateUI();
  }

  function grantPower() {
    if (!shield) {
      shield = 1; showStatus('能量护盾', '#63f3ff'); tone(420, .18, 'sine', .04, 420);
    } else {
      slowTimer = 5; showStatus('时间减速 5 秒', '#c58cff'); tone(560, .2, 'triangle', .04, -160);
    }
    ripples.push({ x: player.x, y: player.y, r: 10, life: .8, color: shield ? '#63f3ff' : '#ae6cff' });
  }

  function hitPlayer() {
    if (player.invincible > 0 || player.dash > 0) return;
    if (shield) {
      shield = 0; player.invincible = 1.1; shake = 10; comboCount = 0; combo = 1; comboTimer = 0;
      burst(player.x, player.y, '#63f3ff', 28, 220); ripples.push({ x: player.x, y: player.y, r: 10, life: .7, color: '#63f3ff' });
      showStatus('护盾破裂', '#ffcf66'); vibrate([20, 35, 25]); tone(150, .22, 'sawtooth', .05, 160); updateUI();
    } else {
      burst(player.x, player.y, '#ff4068', 36, 260); shake = 18; flash = .3; endGame();
    }
  }

  function dash() {
    if (state !== 'playing' || player.dashCooldown > 0) return;
    let dx = input.dx, dy = input.dy;
    if (Math.hypot(dx, dy) < .1) { dx = player.vx; dy = player.vy; }
    const length = Math.hypot(dx, dy) || 1; dx /= length; dy /= length;
    if (Math.abs(dx) + Math.abs(dy) < .1) dy = -1;
    player.vx = dx * 670; player.vy = dy * 670; player.dash = .22; player.dashCooldown = 1.75; player.invincible = .28;
    ripples.push({ x: player.x, y: player.y, r: 6, life: .5, color: '#ae6cff' });
    tone(170, .13, 'sawtooth', .035, 420); vibrate(18);
  }

  function update(dt) {
    elapsed += dt; slowTimer = Math.max(0, slowTimer - dt); flash = Math.max(0, flash - dt); shake = Math.max(0, shake - 38 * dt);
    player.invincible = Math.max(0, player.invincible - dt); player.dashCooldown = Math.max(0, player.dashCooldown - dt); player.dash = Math.max(0, player.dash - dt);

    const mag = Math.hypot(input.dx, input.dy);
    if (player.dash <= 0) {
      const targetVx = mag > .08 ? input.dx / Math.max(1, mag) * player.speed * Math.min(1, mag) : 0;
      const targetVy = mag > .08 ? input.dy / Math.max(1, mag) * player.speed * Math.min(1, mag) : 0;
      const ease = 1 - Math.exp(-13 * dt);
      player.vx += (targetVx - player.vx) * ease; player.vy += (targetVy - player.vy) * ease;
    }
    player.x = clamp(player.x + player.vx * dt, 16, width - 16);
    player.y = clamp(player.y + player.vy * dt, 82, height - 170);
    player.trail.unshift({ x: player.x, y: player.y, life: 1 });
    if (player.trail.length > (player.dash > 0 ? 20 : 9)) player.trail.pop();
    player.trail.forEach((p) => p.life -= dt * 2.8);

    comboTimer -= dt;
    if (comboTimer <= 0 && comboCount > 0) { comboCount = 0; combo = 1; updateUI(); }

    enemyTimer -= dt;
    const maxEnemies = Math.min(22, 4 + Math.floor(elapsed / 8));
    if (enemyTimer <= 0 && enemies.length < maxEnemies) {
      spawnEnemy(); enemyTimer = Math.max(.38, 1.35 - elapsed * .011);
    }
    orbTimer -= dt;
    if (orbTimer <= 0 && orbs.length < 4) { spawnOrb(); orbTimer = 3.2; }
    laserTimer -= dt;
    if (elapsed > 12 && laserTimer <= 0 && lasers.length < 2) { spawnLaser(); laserTimer = Math.max(5.5, 10 - elapsed * .03); }

    const timeScale = slowTimer > 0 ? .43 : 1;
    enemies.forEach((e) => {
      const angle = Math.atan2(player.y - e.y, player.x - e.x);
      const wobble = Math.sin(elapsed * 2.2 + e.phase) * .28;
      e.vx += (Math.cos(angle + wobble) * e.speed - e.vx) * Math.min(1, dt * 2.2);
      e.vy += (Math.sin(angle + wobble) * e.speed - e.vy) * Math.min(1, dt * 2.2);
      e.x += e.vx * dt * timeScale; e.y += e.vy * dt * timeScale;
      if (dist2(player, e) < (player.r + e.r + 2) ** 2) hitPlayer();
    });

    for (let i = orbs.length - 1; i >= 0; i--) {
      const orb = orbs[i]; orb.life += dt;
      if (dist2(player, orb) < (player.r + orb.r + 8) ** 2) collectOrb(orb, i);
    }

    for (let i = lasers.length - 1; i >= 0; i--) {
      const l = lasers[i]; l.life -= dt;
      if (l.life <= 0) { lasers.splice(i, 1); continue; }
      if (l.life <= l.active) {
        const distance = l.horizontal ? Math.abs(player.y - l.pos) : Math.abs(player.x - l.pos);
        if (distance < player.r + l.width * .5) hitPlayer();
      }
    }

    particles.forEach((p) => { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= .97; p.vy *= .97; });
    particles = particles.filter((p) => p.life > 0);
    ripples.forEach((r) => { r.life -= dt; r.r += 150 * dt; });
    ripples = ripples.filter((r) => r.life > 0);
    score += dt * (8 + combo * 2);
    updateUI();
  }

  function updateUI() {
    ui.score.textContent = Math.floor(score).toLocaleString('zh-CN');
    ui.combo.textContent = `×${combo}`;
    ui.comboFill.style.width = `${Math.max(0, Math.min(1, comboTimer / 2.25)) * 100}%`;
    ui.comboWrap.classList.toggle('hot', combo >= 3);
    const cooldown = clamp(player.dashCooldown / 1.75, 0, 1);
    ui.dashRing.style.clipPath = `inset(${cooldown * 100}% 0 0 0)`;
    ui.dashButton.classList.toggle('ready', player.dashCooldown <= 0);
  }

  function drawBackground() {
    const g = ctx.createRadialGradient(width * .5, height * .35, 10, width * .5, height * .45, height * .75);
    g.addColorStop(0, '#111d42'); g.addColorStop(.55, '#080b1c'); g.addColorStop(1, '#04050d');
    ctx.fillStyle = g; ctx.fillRect(0, 0, width, height);
    ctx.save(); ctx.globalAlpha = .13; ctx.strokeStyle = '#63f3ff'; ctx.lineWidth = 1;
    const grid = 42, offset = (elapsed * 13) % grid;
    for (let x = -grid + offset; x < width + grid; x += grid) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
    for (let y = -grid + offset; y < height + grid; y += grid) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
    ctx.restore();
    const vignette = ctx.createRadialGradient(width/2, height/2, height*.15, width/2, height/2, height*.8);
    vignette.addColorStop(0, 'rgba(0,0,0,0)'); vignette.addColorStop(1, 'rgba(0,0,10,.72)');
    ctx.fillStyle = vignette; ctx.fillRect(0,0,width,height);
  }

  function glowCircle(x, y, r, color, blur = 18) {
    ctx.save(); ctx.shadowColor = color; ctx.shadowBlur = blur; ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); ctx.restore();
  }

  function draw() {
    ctx.save();
    if (shake > 0) ctx.translate(rand(-shake, shake), rand(-shake, shake));
    drawBackground();

    lasers.forEach((l) => {
      const active = l.life <= l.active;
      const pulse = .45 + Math.sin(performance.now() / 55) * .25;
      ctx.save(); ctx.globalAlpha = active ? .95 : pulse; ctx.strokeStyle = active ? '#ff335f' : '#ffcf66';
      ctx.lineWidth = active ? l.width : 2; ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = active ? 25 : 9;
      ctx.setLineDash(active ? [] : [9, 12]); ctx.beginPath();
      if (l.horizontal) { ctx.moveTo(0, l.pos); ctx.lineTo(width, l.pos); } else { ctx.moveTo(l.pos, 0); ctx.lineTo(l.pos, height); }
      ctx.stroke(); ctx.restore();
    });

    ripples.forEach((r) => { ctx.save(); ctx.globalAlpha = Math.max(0, r.life * 1.8); ctx.strokeStyle = r.color; ctx.lineWidth = 2; ctx.shadowColor = r.color; ctx.shadowBlur = 12; ctx.beginPath(); ctx.arc(r.x,r.y,r.r,0,TAU); ctx.stroke(); ctx.restore(); });
    orbs.forEach((o) => {
      const pulse = 1 + Math.sin(o.life * 4 + o.phase) * .18;
      ctx.save(); ctx.translate(o.x,o.y); ctx.rotate(o.life * .8); ctx.strokeStyle = '#63f3ff'; ctx.lineWidth = 1.5; ctx.globalAlpha = .55;
      ctx.beginPath(); for (let i=0;i<4;i++) { const a=i*Math.PI/2; const x=Math.cos(a)*15*pulse, y=Math.sin(a)*15*pulse; i?ctx.lineTo(x,y):ctx.moveTo(x,y); } ctx.closePath(); ctx.stroke(); ctx.restore();
      glowCircle(o.x,o.y,o.r*pulse,'#bdfbff',20);
    });

    enemies.forEach((e) => {
      ctx.save(); ctx.translate(e.x,e.y); ctx.rotate(elapsed * (e.tier ? -1.5 : 1) + e.phase); ctx.shadowColor='#ff4068'; ctx.shadowBlur=18; ctx.fillStyle=e.tier?'#ff4fa3':'#ff4068';
      ctx.beginPath(); const points=e.tier?4:3; for(let i=0;i<points*2;i++){ const rr=i%2?e.r*.45:e.r; const a=i*Math.PI/points; const x=Math.cos(a)*rr,y=Math.sin(a)*rr; i?ctx.lineTo(x,y):ctx.moveTo(x,y); } ctx.closePath(); ctx.fill();
      ctx.fillStyle='#fff'; ctx.globalAlpha=.8; ctx.beginPath(); ctx.arc(0,0,2.3,0,TAU); ctx.fill(); ctx.restore();
    });

    player.trail.forEach((p,i) => { ctx.save(); ctx.globalAlpha=Math.max(0,p.life)*(.5-i*.025); glowCircle(p.x,p.y,Math.max(2,player.r-i*.55),'#5bdcff',12); ctx.restore(); });
    if (shield) { ctx.save(); ctx.globalAlpha=.45+Math.sin(elapsed*5)*.12; ctx.strokeStyle='#63f3ff'; ctx.lineWidth=2; ctx.shadowColor='#63f3ff'; ctx.shadowBlur=17; ctx.beginPath(); ctx.arc(player.x,player.y,player.r+9,0,TAU); ctx.stroke(); ctx.restore(); }
    if (!(player.invincible > 0 && Math.floor(player.invincible*12)%2===0)) {
      ctx.save(); ctx.translate(player.x,player.y); ctx.rotate(elapsed*2.2); ctx.shadowColor='#63f3ff'; ctx.shadowBlur=26; const pg=ctx.createLinearGradient(-10,-10,10,10); pg.addColorStop(0,'#ffffff');pg.addColorStop(.35,'#7ef8ff');pg.addColorStop(1,'#5d6dff');ctx.fillStyle=pg;
      ctx.beginPath(); ctx.moveTo(0,-player.r-3);ctx.lineTo(player.r,player.r);ctx.lineTo(0,player.r-3);ctx.lineTo(-player.r,player.r);ctx.closePath();ctx.fill();ctx.restore();
    }

    particles.forEach((p) => { ctx.save(); ctx.globalAlpha=Math.max(0,p.life/p.max); glowCircle(p.x,p.y,p.size,p.color,8); ctx.restore(); });
    if (slowTimer > 0) { ctx.fillStyle='rgba(136,86,255,.045)';ctx.fillRect(0,0,width,height); }
    if (flash > 0) { ctx.fillStyle=`rgba(150,245,255,${flash})`;ctx.fillRect(0,0,width,height); }
    ctx.restore();
  }

  function loop(now) {
    if (state !== 'playing') return;
    const dt = Math.min(.032, Math.max(0, (now - lastTime) / 1000)); lastTime = now;
    update(dt); draw();
    if (state === 'playing') raf = requestAnimationFrame(loop);
  }

  function formatTime(seconds) {
    const m = Math.floor(seconds / 60), s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2,'0')}`;
  }

  function handlePointerDown(event) {
    if (state !== 'playing' || input.active) return;
    input.active = true; input.id = event.pointerId; input.sx = event.clientX; input.sy = event.clientY; input.dx = 0; input.dy = 0;
    ui.joystickZone.setPointerCapture?.(event.pointerId);
  }

  function handlePointerMove(event) {
    if (!input.active || event.pointerId !== input.id) return;
    const max = 42, rawX = event.clientX-input.sx, rawY = event.clientY-input.sy, len = Math.hypot(rawX,rawY), scale = len>max?max/len:1;
    const x=rawX*scale,y=rawY*scale; input.dx=x/max;input.dy=y/max; ui.joystickKnob.style.transform=`translate(${x}px,${y}px)`;
  }

  function releaseInput(event) {
    if (event && event.pointerId !== input.id) return;
    input.active=false;input.id=null;input.dx=0;input.dy=0;ui.joystickKnob.style.transform='translate(0,0)';
  }

  ui.joystickZone.addEventListener('pointerdown', handlePointerDown);
  ui.joystickZone.addEventListener('pointermove', handlePointerMove);
  ui.joystickZone.addEventListener('pointerup', releaseInput);
  ui.joystickZone.addEventListener('pointercancel', releaseInput);
  ui.dashButton.addEventListener('pointerdown', (event) => { event.preventDefault(); dash(); });
  $('#start-btn').addEventListener('click', startGame);
  $('#restart-btn').addEventListener('click', startGame);
  $('#restart-pause-btn').addEventListener('click', startGame);
  $('#pause-btn').addEventListener('click', pauseGame);
  $('#resume-btn').addEventListener('click', resumeGame);
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'playing') pauseGame(); });
  window.addEventListener('resize', resize, { passive: true });
  window.addEventListener('contextmenu', (e) => e.preventDefault());

  ui.bestStart.textContent = best.toLocaleString('zh-CN');
  resize(); draw();
})();
