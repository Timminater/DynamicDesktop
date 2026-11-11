'use strict';

const query = new URLSearchParams(location.search);
const WALL = query.has('wallpaper');
const PREVIEW = query.has('preview');
const cv = document.getElementById('art');
const ctx = cv.getContext('2d', { alpha: false });
const TASKBAR = 48, GRID_X0 = 4, GRID_Y0 = 6, CELL_W = 76, CELL_H = 100;
const scenes = {
  'beach-turquoise': { kind: 'reef', background: ['#135a75', '#3bb5aa'], water: '#80ded0', shore: '#f8e4b9', detail: '#427e70' },
  lake: { kind: 'lake', background: ['#c5d693', '#78a16d'], water: '#679aaa', shore: '#a6c7ae', detail: '#deebcf' },
  sky: { kind: 'cloud', background: ['#306db5', '#a4d9ee'], water: '#26538c50', shore: '#fcf8e8', detail: '#c4dcea' },
  ocean: { kind: 'cloud', background: ['#164376', '#307ca7'], water: '#11345c84', shore: '#f5f6ea', detail: '#b0c9d6' },
  forest: { kind: 'trees', background: ['#7d9a53', '#adc07b'], shore: '#d4d792', detail: '#426744', crown: ['#537a52', '#759654', '#396647'] },
  pinkforest: { kind: 'trees', background: ['#f5e8d9', '#ead1cd'], shore: '#f7ead5', detail: '#86645b', crown: ['#d888a4', '#e9b2b9', '#ba7291'] },
  map: { kind: 'city', background: ['#e5d2a7', '#f7e9cd'], shore: '#e9d6a8', detail: '#695441', crown: ['#ac8b68', '#c29f7b', '#927356'] },
  citymap: { kind: 'city', background: ['#cfdfb2', '#a5c092'], shore: '#e0cc9d', detail: '#795949', crown: ['#d5634c', '#b3696e', '#668b9d', '#d6a448'] },
  worldmap: { kind: 'chart', background: ['#d9bf8b', '#eddaad'], water: '#85aaa7', shore: '#c2cdb0', detail: '#705647' },
  nauticalmap: { kind: 'chart', background: ['#a8c8c3', '#c7d4be'], water: '#e2ce9f', shore: '#827658', detail: '#4f645c' },
  lotus: { kind: 'pond', background: ['#234d46', '#427d65'], water: '#569980', shore: '#789f64', detail: '#e4a8b4' }
};
const requestedScene = query.get('theme');
const baseScene = requestedScene === 'pinkforest' ? 'forest' : requestedScene === 'citymap' ? 'map' : requestedScene;
const cloudScene = baseScene === 'sky' || baseScene === 'ocean';
let sceneId = Object.hasOwn(scenes, requestedScene) ? requestedScene : 'lake';
let style = scenes[sceneId];
const DEFAULTS = { adaptive: 1, spread: cloudScene ? 95 : 80, detail: cloudScene ? .65 : .68, speed: 1, lighting: 0, seed: 42,
  palette: requestedScene === 'pinkforest' ? 1 : 0, variant: requestedScene === 'citymap' ? 1 : 0 };
const P = { ...DEFAULTS };
let W = innerWidth, H = innerHeight, icons = [];
let terrain, previous, movers = [], routes = [], anchors = [];
let paused = false, previewMotion = !PREVIEW, hostDragging = false;
let animationTime = 0, lastFrame = 0, morphStart = -Infinity, frameN = 0;
const TAU = 2 * Math.PI, MORPH_MS = 700;

function random(index, salt = 0) {
  const value = Math.sin(index * 127.1 + salt * 17.23 + (P.seed % 65521) * 0.017) * 43758.5453;
  return value - Math.floor(value);
}

function oval(c, x, y, rx, ry, color, angle = 0) {
  c.fillStyle = color;
  c.beginPath();
  c.ellipse(x, y, rx, ry, angle, 0, TAU);
  c.fill();
}

function line(c, x1, y1, x2, y2) {
  c.beginPath();
  c.moveTo(x1, y1);
  c.lineTo(x2, y2);
  c.stroke();
}

function blob(c, spot, scale, color) {
  c.fillStyle = color;
  c.beginPath();
  for (let i = 0; i <= 48; i++) {
    const angle = i / 48 * TAU;
    const edge = scale * (1 + .10 * Math.sin(angle * 3 + spot.phase) + .07 * Math.sin(angle * 5 - spot.phase));
    const x = spot.x + Math.cos(angle) * spot.rx * edge;
    const y = spot.y + Math.sin(angle) * spot.ry * edge;
    if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
  }
  c.fill();
}

function findAnchors() {
  const result = [];
  for (const icon of P.adaptive ? icons : []) {
    const x = icon.x + icon.w / 2, y = icon.y + icon.h / 2;
    const group = result.find(item => Math.hypot(item.x - x, item.y - y) < P.spread * 1.45);
    if (group) {
      group.rx = Math.max(group.rx, Math.abs(group.x - x) + P.spread);
      group.ry = Math.max(group.ry, Math.abs(group.y - y) + P.spread * .68);
    } else result.push({ x, y, rx: P.spread + icon.w * .25, ry: P.spread * .72 + icon.h * .23, phase: random(result.length, 9) * TAU });
  }
  if (result.length) return result;
  return Array.from({ length: 4 }, (_, i) => ({
    x: W * (.18 + i * .21), y: H * (.22 + random(i, 2) * .56),
    rx: P.spread * 1.3, ry: P.spread * .83, phase: random(i, 9) * TAU
  }));
}

function inAnchor(x, y, padding = 1) {
  return anchors.some(spot => Math.hypot((x - spot.x) / spot.rx, (y - spot.y) / spot.ry) < padding);
}

function cloud(c, x, y, size, reflection = false) {
  c.save();
  c.translate(x, y);
  c.scale(size, size * (reflection ? .5 : 1));
  const color = reflection ? '#f7f5e464' : style.shore || '#fbf9e9';
  const shade = reflection ? '#f7f5e440' : style.detail || '#b9d8e0';
  oval(c, 0, 3, 42, 17, shade);
  for (const [dx, dy, rx, ry] of [[-29, 0, 18, 12], [-13, -7, 20, 17], [7, -13, 19, 20], [25, -2, 19, 14], [4, 2, 28, 15]]) {
    oval(c, dx, dy, rx, ry, color);
  }
  c.restore();
}

function waterTexture(c) {
  const count = Math.min(2500, Math.ceil(W * H / 2000));
  c.lineWidth = 1;
  for (let i = 0; i < count; i++) {
    const x = random(i, 8) * W, y = random(i, 3) * H;
    const length = 3 + random(i, 4) * 27;
    c.strokeStyle = random(i, 5) < .6 ? '#ffffff20' : '#163d5223';
    line(c, x, y, x + length, y + random(i, 2) * 2);
  }
}

function paintWater(c) {
  waterTexture(c);
  for (const spot of anchors) {
    if (style.kind === 'pond') {
      blob(c, spot, 1.18, '#345d47');
      blob(c, spot, .94, style.water);
      continue;
    }
    blob(c, spot, 1.22, style.shore);
    blob(c, spot, 1.08, style.water);
    blob(c, spot, .88, style.kind === 'lake' ? '#4f899e' : style.shore);
    for (let i = 0; i < 20 * P.detail; i++) {
      const theta = random(i, spot.phase) * TAU;
      const x = spot.x + Math.cos(theta) * spot.rx * (1.05 + random(i, 3) * .24);
      const y = spot.y + Math.sin(theta) * spot.ry * (1.05 + random(i, 6) * .24);
      oval(c, x, y, 4 + random(i, 4) * 8, 2 + random(i, 7) * 3, style.detail, theta);
    }
  }
  if (style.kind !== 'pond') return;
  for (let i = 0; i < 145 * P.detail; i++) {
    const x = random(i, 2) * W, y = random(i, 3) * H;
    if (inAnchor(x, y, .68)) continue;
    const radius = 7 + random(i, 4) * 15;
    c.fillStyle = random(i, 8) < .5 ? '#7da963' : '#619a68';
    c.beginPath();
    c.moveTo(x, y);
    c.arc(x, y, radius, .22, TAU - .22);
    c.fill();
    if (random(i, 7) < .32) {
      for (let j = 0; j < 5; j++) {
        const a = j / 5 * TAU;
        oval(c, x + Math.cos(a) * 5, y + Math.sin(a) * 4, 7, 3, j % 2 ? '#f4cfcb' : style.detail, a);
      }
      oval(c, x, y, 3, 3, '#f7e5a1');
    }
  }
}

function paintForest(c) {
  for (const spot of anchors) blob(c, spot, 1.13, style.shore);
  for (let row = -1; row * 44 < H + 44; row++) {
    for (let col = -1; col * 46 < W + 46; col++) {
      const i = row * 193 + col;
      const x = (col + random(i, 2)) * 46, y = (row + random(i, 3)) * 44;
      if (inAnchor(x, y, .93) || random(i, 9) > .38 + P.detail * .55) continue;
      const size = 11 + random(i, 4) * 27;
      c.strokeStyle = style.detail;
      c.lineWidth = 1.6;
      line(c, x, y, x + 2, y + size * .65);
      oval(c, x + size * .35, y + size * .35, size * .92, size * .53, '#42353829', -.3);
      c.globalAlpha = sceneId === 'pinkforest' ? .68 : 1;
      for (let j = 0; j < 4; j++) {
        const a = j / 4 * TAU;
        oval(c, x + Math.cos(a) * size * .33, y + Math.sin(a) * size * .29, size * .66, size * .56,
          style.crown[(i * i + j) % style.crown.length], a);
      }
      c.globalAlpha = 1;
    }
  }
}

function paintCity(c) {
  for (const spot of anchors) blob(c, spot, 1.09, style.shore);
  const block = 106;
  c.strokeStyle = sceneId === 'map' ? '#765c4559' : '#f1e2b5';
  c.lineWidth = 8;
  for (let x = 12; x < W; x += block) line(c, x, 0, x, H);
  for (let y = 12; y < H; y += block) line(c, 0, y, W, y);
  for (let row = 0; row * block < H; row++) {
    for (let col = 0; col * block < W; col++) {
      for (let j = 0; j < 4 + P.detail * 6; j++) {
        const i = row * 193 + col * 11 + j;
        const x = col * block + 22 + (j % 3) * 24, y = row * block + 23 + Math.floor(j / 3) * 21;
        if (inAnchor(x, y)) continue;
        const w = 11 + random(i, 3) * 10, h = 10 + random(i, 4) * 7;
        c.fillStyle = '#6d523131';
        c.fillRect(x + 4, y + 4, w, h);
        c.fillStyle = style.crown[i % style.crown.length];
        c.fillRect(x, y, w, h);
        c.strokeStyle = style.detail;
        c.lineWidth = .8;
        c.strokeRect(x, y, w, h);
        line(c, x, y + h * .48, x + w, y + h * .48);
      }
    }
  }
}

function paintChart(c) {
  c.strokeStyle = '#533d282c';
  c.lineWidth = 1;
  for (let x = 8; x < W; x += 62) line(c, x, 0, x, H);
  for (let y = 8; y < H; y += 62) line(c, 0, y, W, y);
  for (const spot of anchors) {
    blob(c, spot, 1.09, style.shore);
    blob(c, spot, .98, style.water);
    if (sceneId !== 'nauticalmap') continue;
    const x = spot.x + spot.rx * .85, y = spot.y - spot.ry * .28;
    c.fillStyle = '#f6e9ba';
    c.fillRect(x - 3, y - 11, 6, 14);
    c.fillStyle = '#9c5240';
    c.fillRect(x - 4, y - 11, 8, 4);
  }
  const towns = anchors.map(spot => ({ x: spot.x + spot.rx * .6, y: spot.y + spot.ry * (sceneId === 'worldmap' ? 1.16 : .65) }));
  c.strokeStyle = style.detail;
  c.lineWidth = 1.5;
  c.setLineDash([4, 6]);
  for (let i = 1; i < towns.length; i++) {
    const from = towns[i - 1], to = towns[i];
    line(c, from.x, from.y, to.x, to.y);
    routes.push([from, to]);
  }
  c.setLineDash([]);
  for (const town of towns) oval(c, town.x, town.y, 3.5, 3.5, style.detail);
  const compass = { x: W - 63, y: H - 69 };
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * TAU;
    line(c, compass.x, compass.y, compass.x + Math.sin(a) * 25, compass.y + Math.cos(a) * 25);
  }
  c.fillStyle = style.detail;
  c.font = '15px Georgia';
  c.fillText('N', compass.x - 5, compass.y - 32);
}

function makeTerrain() {
  const image = document.createElement('canvas');
  image.width = cv.width;
  image.height = cv.height;
  const c = image.getContext('2d', { alpha: false });
  c.scale(image.width / W, image.height / H);
  const gradient = c.createLinearGradient(0, 0, W * .26, H);
  gradient.addColorStop(0, style.background[0]);
  gradient.addColorStop(1, style.background[1]);
  c.fillStyle = gradient;
  c.fillRect(0, 0, W, H);
  anchors = findAnchors();
  routes = [];
  if (style.kind === 'cloud') {
    if (sceneId === 'ocean') waterTexture(c);
    for (const spot of anchors) {
      oval(c, spot.x + 20, spot.y + 28, spot.rx * .83, spot.ry * .54, style.water);
      cloud(c, spot.x, spot.y, Math.max(spot.rx / 42, spot.ry / 23));
    }
  } else if (style.kind === 'trees') paintForest(c);
  else if (style.kind === 'city') paintCity(c);
  else if (style.kind === 'chart') paintChart(c);
  else paintWater(c);

  movers = Array.from({ length: Math.round(4 + 19 * P.detail) }, (_, i) => ({
    x: random(i, 2), y: random(i, 3), rate: .018 + random(i, 4) * .027,
    size: .65 + random(i, 8) * .68, phase: random(i, 7) * TAU
  }));
  return image;
}

function mix(now) {
  const t = Math.max(0, Math.min(1, (now - morphStart) / MORPH_MS));
  return t * t * (3 - 2 * t);
}

function commit(instant = false) {
  const now = performance.now();
  if (terrain && !instant && !paused && previewMotion && terrain.width === cv.width && terrain.height === cv.height) {
    if (!previous) previous = terrain;
    else {
      const c = previous.getContext('2d');
      c.save();
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.globalAlpha = mix(now);
      c.drawImage(terrain, 0, 0);
      c.restore();
    }
    morphStart = now;
  } else {
    previous = null;
    morphStart = -Infinity;
  }
  terrain = makeTerrain();
  if (paused || !previewMotion) draw(now);
}

function drawFish(x, y, size, color, phase) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size, size);
  ctx.rotate(Math.sin(phase) * .44);
  oval(ctx, 0, 0, 8, 3.2, color);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-4, 0);
  ctx.lineTo(-13, -4 + Math.sin(phase * 2));
  ctx.lineTo(-11, 4);
  ctx.fill();
  ctx.restore();
}

function drawMotion() {
  for (const [i, mover] of movers.entries()) {
    const x = ((mover.x + animationTime * mover.rate) % 1.15 - .075) * W;
    const y = mover.y * H + Math.sin(animationTime * .7 + mover.phase) * 14;
    if (style.kind === 'cloud') {
      if (i < 6) cloud(ctx, x, y, mover.size * .65);
    } else if (style.kind === 'trees') {
      oval(ctx, x, y, mover.size * 2.5, 1.3, sceneId === 'pinkforest' ? '#f5d0d3a0' : '#dce89d9c', mover.phase);
    } else if (style.kind === 'city') {
      oval(ctx, x, 12 + Math.round(mover.y * H / 106) * 106, 4, 2, i % 2 ? '#faf1cb' : style.crown[0]);
    } else if (style.kind === 'chart') {
      if (i >= routes.length) continue;
      const [a, b] = routes[i];
      const t = (mover.x + animationTime * mover.rate) % 1;
      const bx = a.x + (b.x - a.x) * t, by = a.y + (b.y - a.y) * t;
      if (sceneId === 'worldmap') {
        ctx.fillStyle = '#5f4c38';
        ctx.fillRect(bx - 5, by - 2, 10, 5);
        oval(ctx, bx + 7, by, 3, 2, '#896247');
        oval(ctx, bx - 3, by + 3, 1.4, 1.4, '#372a21');
        oval(ctx, bx + 3, by + 3, 1.4, 1.4, '#372a21');
      } else {
        ctx.fillStyle = '#f4eed1';
        ctx.beginPath();
        ctx.moveTo(bx, by - 11);
        ctx.lineTo(bx + 7, by + 2);
        ctx.lineTo(bx - 6, by + 2);
        ctx.fill();
        oval(ctx, bx, by + 4, 8, 2, style.detail);
      }
    } else if (style.kind === 'lake') {
      if (i < 8 && inAnchor(x, y, .82)) cloud(ctx, x, y, mover.size * .7, true);
    } else if (style.kind === 'pond' || !inAnchor(x, y, .85)) {
      drawFish(x, y, mover.size * (style.kind === 'pond' ? 1.16 : .58),
        style.kind === 'pond' ? ['#f3af82', '#f9e7c5', '#df725d'][i % 3] : '#e4efd896', mover.phase + animationTime);
      if (style.kind === 'pond' && i % 3 === 0) {
        ctx.strokeStyle = '#d2eee952';
        ctx.beginPath();
        ctx.ellipse(x - 10, y, 9 + 5 * Math.sin(animationTime + mover.phase), 4, 0, 0, TAU);
        ctx.stroke();
      }
    }
  }
  if (sceneId === 'nauticalmap') {
    const x = W * (.68 + .14 * Math.sin(animationTime * .17));
    const y = H * .72 + 9 * Math.cos(animationTime * .6);
    ctx.strokeStyle = '#536954';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(x - 22, y);
    ctx.bezierCurveTo(x - 18, y - 13, x - 10, y - 13, x - 4, y);
    ctx.bezierCurveTo(x + 2, y - 17, x + 13, y - 19, x + 19, y - 7);
    ctx.stroke();
    oval(ctx, x + 20, y - 8, 3.5, 2.5, '#536954');
  }
}

function draw(now) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  const blend = mix(now);
  if (previous && blend < 1) {
    ctx.drawImage(previous, 0, 0, cv.width, cv.height);
    ctx.globalAlpha = blend;
  } else previous = null;
  ctx.drawImage(terrain, 0, 0, cv.width, cv.height);
  ctx.globalAlpha = 1;
  ctx.setTransform(cv.width / W, 0, 0, cv.height / H, 0, 0);
  drawMotion();
  const { night } = DynamicDesktopEnvironment.light(P.lighting);
  if (night > 0) {
    ctx.fillStyle = `rgba(17,29,62,${night * .7})`;
    ctx.fillRect(0, 0, W, H);
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  if (!window.dynamicDesktopRecording && (paused || !previewMotion)) { lastFrame = 0; return; }
  const fps = hostDragging ? 10 : !PREVIEW && mix(now) < 1 ? 60 : 30;
  if (lastFrame && now - lastFrame < 1000 / fps - 2) return;
  animationTime += (lastFrame ? Math.min(.1, (now - lastFrame) / 1000) : 0) * P.speed;
  lastFrame = now;
  draw(now);
  frameN++;
}

function resize() {
  const rect = cv.getBoundingClientRect();
  W = rect.width || innerWidth;
  H = rect.height || innerHeight;
  cv._scale = PREVIEW ? .45 : devicePixelRatio || 1;
  cv.width = Math.max(1, Math.round(W * cv._scale));
  cv.height = Math.max(1, Math.round(H * cv._scale));
  commit(true);
  draw(performance.now());
}

function applySettings(values) {
  // The cloud scenes share the sigma control with the layered sky renderer.
  if (cloudScene && Number.isFinite(values.sigma)) {
    values = { ...values, spread: values.sigma };
  }
  const limits = { adaptive: [0, 1], spread: cloudScene ? [35, 180] : [40, 160], detail: [0, 1], speed: [0, 3], lighting: [0, 2], seed: [0, Number.MAX_SAFE_INTEGER], palette: [0, 1], variant: [0, 1] };
  let rebuild = false;
  for (const [key, [lo, hi]] of Object.entries(limits)) {
    if (!Number.isFinite(values[key])) continue;
    let value = Math.min(hi, Math.max(lo, values[key]));
    if (key === 'palette' || key === 'variant') value = Math.round(value);
    if (value === P[key]) continue;
    P[key] = value;
    rebuild ||= key !== 'speed' && key !== 'lighting';
  }
  if (baseScene === 'forest') sceneId = P.palette ? 'pinkforest' : 'forest';
  else if (baseScene === 'map') sceneId = P.variant ? 'citymap' : 'map';
  style = scenes[sceneId];
  if (rebuild) commit();
}

function setIcons(message) {
  const ratio = devicePixelRatio || 1;
  icons = message.vis ? message.r.map(([l, t, r, b]) => ({
    x: l / ratio, y: t / ratio, w: (r - l) / ratio, h: (b - t) / ratio
  })) : [];
  if (PREVIEW) {
    document.getElementById('ghosts').replaceChildren(...icons.map(icon => {
      const node = document.createElement('div');
      node.className = 'ghost';
      Object.assign(node.style, { left: icon.x + 'px', top: icon.y + 'px', width: icon.w + 'px', height: icon.h + 'px' });
      node.append(document.createElement('i'), document.createElement('b'));
      return node;
    }));
  }
  commit();
}

function handle(message) {
  switch (message.t) {
    case 'settings': applySettings(message.v || {}); break;
    case 'reset': applySettings({ ...DEFAULTS, ...message.v }); break;
    case 'environment': DynamicDesktopEnvironment.environment(message.v); break;
    case 'previewMotion': if (PREVIEW) previewMotion = !!message.v; break;
    case 'dragging': hostDragging = !!message.v; break;
    case 'pause': if (WALL) paused = !!message.v; break;
    case 'icons': setIcons(message); return;
    default: return;
  }
  if (paused || !previewMotion) {
    previous = null;
    draw(performance.now());
  }
}

resize();
addEventListener('resize', resize);
requestAnimationFrame(frame);
if (PREVIEW) {
  addEventListener('message', event => {
    if (event.source === parent) handle(typeof event.data === 'string' ? JSON.parse(event.data) : event.data);
  });
  parent.postMessage(JSON.stringify({ t: 'ready' }), '*');
} else if (WALL && window.chrome?.webview) {
  chrome.webview.addEventListener('message', event => handle(JSON.parse(event.data)));
  chrome.webview.postMessage('ready');
}
