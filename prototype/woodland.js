// Canvas implementation of the woodland clearings from the native DynamicDesktop macOS port.
'use strict';

const query = new URLSearchParams(location.search);
const WALL = query.has('wallpaper');
const PREVIEW = query.has('preview');
const cv = document.getElementById('art');
const ctx = cv.getContext('2d', { alpha: false });
const TASKBAR = 48, GRID_X0 = 4, GRID_Y0 = 6, CELL_W = 76, CELL_H = 100;
const DEFAULTS = { seed: 42, sigma: 80, density: 0.7, speed: 1, adaptive: 1, lighting: 0 };
const P = { ...DEFAULTS };
const MORPH_MS = 850;
const canopyColors = ['#527642', '#568255', '#3d6b4d', '#6c8c50', '#4e755d', '#648047'];
let W = innerWidth, H = innerHeight, icons = [];
let paused = false, previewMotion = !PREVIEW, lastFrame = 0, animationTime = 0, frameN = 0;
let hostDragging = false;
let previous, terrain, morphStart = -Infinity, birds = [], fireflies = [];

function random(x, y, salt = 0) {
  const n = Math.sin(x * 124.7 + y * 311.7 + (P.seed % 65521) * 0.87 + salt * 23.73) * 43758.5453;
  return n - Math.floor(n);
}

function canopy(color) {
  const sprite = document.createElement('canvas');
  sprite.width = 128;
  sprite.height = 128;
  const c = sprite.getContext('2d');
  c.translate(64, 64);
  const lobes = [[0, 0, 33], [-22, 2, 23], [-9, -20, 23], [15, -17, 26], [24, 7, 24], [-7, 21, 25]];
  for (const [x, y, radius] of lobes) {
    const shade = c.createRadialGradient(x - 8, y - 8, 1, x, y, radius);
    shade.addColorStop(0, '#a0ac65');
    shade.addColorStop(0.52, color);
    shade.addColorStop(1, '#294939');
    c.fillStyle = shade;
    c.beginPath();
    c.arc(x, y, radius, 0, Math.PI * 2);
    c.fill();
  }
  return sprite;
}
const canopies = canopyColors.map(canopy);

function clearance(x, y) {
  let distance = Infinity;
  if (!P.adaptive) return distance;
  for (const icon of icons) {
    const dx = Math.max(0, icon.x - x, x - icon.x - icon.w);
    const dy = Math.max(0, icon.y - y, y - icon.y - icon.h);
    distance = Math.min(distance, Math.hypot(dx, dy));
  }
  return distance;
}

function mix(now) {
  const t = Math.max(0, Math.min(1, (now - morphStart) / MORPH_MS));
  return t * t * (3 - 2 * t);
}

function makeTerrain() {
  const image = document.createElement('canvas');
  image.width = cv.width;
  image.height = cv.height;
  const c = image.getContext('2d', { alpha: false });
  c.scale(image.width / W, image.height / H);
  const ground = c.createLinearGradient(0, 0, W, H);
  ground.addColorStop(0, '#a3ac63');
  ground.addColorStop(0.55, '#7b984e');
  ground.addColorStop(1, '#628442');
  c.fillStyle = ground;
  c.fillRect(0, 0, W, H);
  for (let row = 0; row * 18 < H; row++) {
    for (let col = 0; col * 19 < W; col++) {
      const x = (col + random(col, row, 1)) * 19, y = (row + random(col, row, 2)) * 18;
      const shape = random(col, row, 3);
      c.fillStyle = shape < 0.05 ? '#eacfb1' : shape < 0.35 ? '#d1d08155' : '#34563836';
      c.fillRect(x, y, shape < 0.05 ? 2 : 1, 1 + shape * 5);
    }
  }

  const trees = [];
  for (let row = -1; row * 42 < H + 42; row++) {
    for (let col = -1; col * 46 < W + 46; col++) {
      if (random(col, row) > P.density) continue;
      const x = (col + random(col, row, 4)) * 46, y = (row + random(col, row, 5)) * 42;
      const size = 68 + random(col, row, 6) * 68;
      if (clearance(x, y) < P.sigma * (0.62 + 0.5 * random(col, row, 7)) + size * 0.24) continue;
      trees.push({ x, y, size, sprite: canopies[Math.floor(random(col, row, 8) * canopies.length)] });
    }
  }
  trees.sort((a, b) => a.y - b.y);
  c.fillStyle = '#284c326b';
  for (const tree of trees) {
    c.beginPath();
    c.ellipse(tree.x + tree.size * 0.13, tree.y + tree.size * 0.13, tree.size * 0.37, tree.size * 0.28, 0, 0, 2 * Math.PI);
    c.fill();
  }
  for (const tree of trees) c.drawImage(tree.sprite, tree.x - tree.size / 2, tree.y - tree.size / 2, tree.size, tree.size);
  return image;
}

function commit(instant = false) {
  const now = performance.now();
  if (terrain && !instant && !paused && previewMotion && terrain.width === cv.width && terrain.height === cv.height) {
    if (previous) {
      const blend = previous.getContext('2d');
      blend.globalAlpha = mix(now);
      blend.drawImage(terrain, 0, 0);
      blend.globalAlpha = 1;
    } else previous = terrain;
    morphStart = now;
  } else {
    previous = null;
    morphStart = -Infinity;
  }
  terrain = makeTerrain();
  if (paused || !previewMotion) draw(now);
}

function draw(now) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  if (previous && mix(now) < 1) {
    ctx.drawImage(previous, 0, 0, cv.width, cv.height);
    ctx.globalAlpha = mix(now);
  } else previous = null;
  ctx.drawImage(terrain, 0, 0, cv.width, cv.height);
  ctx.globalAlpha = 1;
  ctx.setTransform(cv.width / W, 0, 0, cv.height / H, 0, 0);
  const { night } = DynamicDesktopEnvironment.light(P.lighting);
  if (night > 0) {
    ctx.fillStyle = `rgba(17,30,54,${0.68 * night})`;
    ctx.fillRect(0, 0, W, H);
  }
  for (const bird of birds) {
    const x = ((bird.x + animationTime * bird.speed) % 1.2 - 0.1) * W;
    const y = (bird.y + Math.sin(animationTime * 0.24 + bird.x * 6) * 0.025) * H;
    const wing = Math.sin(animationTime * 7 + bird.x * 9) * 3.5;
    ctx.strokeStyle = night < 0.5 ? '#e0e5b9' : '#7d90aa';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x - 5, y - wing);
    ctx.quadraticCurveTo(x - 3, y - 2, x, y);
    ctx.quadraticCurveTo(x + 3, y - 2, x + 5, y - wing);
    ctx.stroke();
  }
  if (night > 0.1) {
    for (const fly of fireflies) {
      const glow = Math.pow(0.5 + 0.5 * Math.sin(animationTime * 2 + fly.phase), 3) * night;
      ctx.fillStyle = `rgba(247,230,124,${glow})`;
      ctx.beginPath();
      ctx.arc(fly.x * W + Math.sin(animationTime + fly.phase) * 14, fly.y * H + Math.cos(animationTime * 0.7 + fly.phase) * 12, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  if (!window.dynamicDesktopRecording && (paused || !previewMotion)) { lastFrame = 0; return; }
  const fps = hostDragging ? 10 : !PREVIEW && mix(now) < 1 ? 60 : 30;
  if (lastFrame && now - lastFrame < 1000 / fps - 2) return;
  animationTime += (lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 0) * P.speed;
  lastFrame = now;
  draw(now);
  frameN++;
}

function resize() {
  const box = cv.getBoundingClientRect();
  W = box.width || innerWidth;
  H = box.height || innerHeight;
  cv._scale = PREVIEW ? 0.45 : devicePixelRatio || 1;
  cv.width = Math.max(1, Math.round(W * cv._scale));
  cv.height = Math.max(1, Math.round(H * cv._scale));
  commit(true);
  draw(performance.now());
}

function applySettings(values) {
  const limits = { seed: [0, Number.MAX_SAFE_INTEGER], sigma: [40, 180], density: [0, 1], speed: [0, 3], adaptive: [0, 1], lighting: [0, 2] };
  let rebuild = false;
  for (const [key, [low, high]] of Object.entries(limits)) {
    if (!Number.isFinite(values[key])) continue;
    const value = Math.max(low, Math.min(high, values[key]));
    if (value === P[key]) continue;
    P[key] = value;
    rebuild ||= key !== 'lighting' && key !== 'speed';
  }
  if (rebuild) commit();
}

function updateIcons(message) {
  const ratio = devicePixelRatio || 1;
  icons = message.vis ? message.r.map(([left, top, right, bottom]) => ({
    x: left / ratio, y: top / ratio, w: (right - left) / ratio, h: (bottom - top) / ratio
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
    case 'icons': updateIcons(message); return;
    default: return;
  }
  if (paused || !previewMotion) {
    previous = null;
    draw(performance.now());
  }
}

birds = Array.from({ length: 5 }, (_, i) => ({
  x: random(i, 9), y: 0.13 + random(i, 7) * 0.72, speed: 0.009 + random(i, 5) * 0.018
}));
fireflies = Array.from({ length: 28 }, (_, i) => ({
  x: random(i, 11), y: random(i, 19), phase: random(i, 27) * Math.PI * 2
}));
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
