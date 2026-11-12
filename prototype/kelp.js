'use strict';

const query = new URLSearchParams(location.search);
const WALL = query.has('wallpaper');
const PREVIEW = query.has('preview');
const DEMO = !WALL && !PREVIEW && query.has('demo');
const cv = document.getElementById('art');
const ctx = cv.getContext('2d', { alpha: false });
const iconLayer = document.getElementById('icons');
const TASKBAR = 48, GRID_X0 = 4, GRID_Y0 = 6, CELL_W = 76, CELL_H = 100;
const KELP = 0, REEF = 1, SILT = 2;
const DEFAULTS = { adaptive: 1, seed: 42, landscape: KELP, lighting: 0, kelpDensity: 0.64,
  current: 0.8, submersible: 0, interval: 55, fish: 1, wildlife: 1, bubbles: 5 };
const P = { ...DEFAULTS };
const models = [
  { id: 'super-sub', name: 'Super Sub', scale: 1 },
  { id: 'nemo', name: 'NEMO', scale: .74 },
  { id: 'c-explorer', name: 'C-Explorer', scale: .81 },
  { id: 'c-researcher', name: 'C-Researcher', scale: .89 },
  { id: 'greyshark', name: 'GREYSHARK', scale: 1.08 }
];
const palette = ['#427d80', '#3f7478', '#598c8c', '#346469', '#518487'];
const MORPH_MS = 920;
const TAU = Math.PI * 2;
let W = innerWidth, H = innerHeight, icons = [];
let clusters = [], clearings = [], iconOccluders = [], plants = [], morphStart = -Infinity;
let formations = [];
let backdrop, floor, paused = false, previewMotion = !PREVIEW, hostDragging = false;
let nightAmount = 0, nightTarget = 0, nextLightCheck = 0;
let animationTime = 0, lastFrame = 0, frameN = 0, nextModel = 0;
let pass, previousWake, nextPassAt = 2 + Math.random() * 4;
let nextSceneAt = 95 + Math.random() * 55;
let bottomDetails, crabPass, nextCrabAt = 18 + Math.random() * 18;
let requestedScene, diverPass;
const emptyClickTimes = [];
const SCENE_FADE = 2.3;
let wildlifePointer = null, wildlifeClick = null, nextSteeringCleanup = 0;
const animalSteering = new Map();
const noSteering = { x: 0, y: 0, vx: 0, vy: 0 };

function random(index, salt = 0) {
  const value = Math.sin(index * 127.1 + salt * 67.3 + (P.seed % 65521) * .021) * 43758.5453;
  return value - Math.floor(value);
}

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

function pointWildlife(x, y, clicked = false) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    wildlifePointer = null;
    return;
  }
  wildlifePointer = { x, y };
  if (clicked && !paused && previewMotion) wildlifeClick = { x, y, at: animationTime };
}

function countDesktopClick(x, y, now = performance.now()) {
  if (requestedScene || paused || !previewMotion) return;
  const overIcon = icons.some(icon => x >= icon.x && x <= icon.x + icon.w && y >= icon.y && y <= icon.y + icon.h);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x >= W || y < 0 || y >= H || overIcon) {
    emptyClickTimes.length = 0;
    return;
  }
  while (emptyClickTimes.length && now - emptyClickTimes[0] > 2500) emptyClickTimes.shift();
  emptyClickTimes.push(now);
  if (emptyClickTimes.length === 5) {
    emptyClickTimes.length = 0;
    queueDesktopScene(desktopScenes[Math.floor(Math.random() * desktopScenes.length)]);
  }
}

const turtleSteering = { speed: 19, acceleration: 24 };
const jellySteering = { speed: 11, acceleration: 13 };

function cursorAvoidance(id, x, y, radius, bias, swimming) {
  const pointer = window.dynamicDesktopRecording ? null : wildlifePointer;
  const click = window.dynamicDesktopRecording ? null : wildlifeClick;
  let state = animalSteering.get(id);
  if (!state) {
    const near = pointer && Math.hypot(x - pointer.x, y - pointer.y) < radius;
    const startled = click && animationTime - click.at < .22 && Math.hypot(x - click.x, y - click.y) < radius * 1.38;
    if (!near && !startled) return noSteering;
    state = { x: 0, y: 0, vx: 0, vy: 0, at: animationTime, fleeAt: -Infinity, fleeX: 0, fleeY: 0 };
    animalSteering.set(id, state);
  }
  if (click && click !== state.click && animationTime - click.at < .22) {
    state.click = click;
    const dx = x + state.x - click.x, dy = y + state.y - click.y;
    const distance = Math.hypot(dx, dy);
    if (distance < radius * 1.38) {
      const amount = .65 + .35 * (1 - smooth(distance / (radius * 1.38)));
      state.fleeAt = animationTime;
      state.fleeX = (distance > 2 ? dx / distance : 0) * amount;
      state.fleeY = (distance > 2 ? dy / distance : bias) * amount;
    }
  }
  const dt = Math.min(animationTime - state.at, .12);
  if (dt <= 0) return state;
  const age = animationTime - state.fleeAt;
  const flee = swimming ? (1 - smooth(age / 5)) * radius * .62
    : age < 3.1 ? (1 - smooth(age / 3.1)) * radius * 1.46 : 0;
  let targetX = state.fleeX * flee, targetY = state.fleeY * flee;
  if (pointer) {
    const dx = x + state.x - pointer.x, dy = y + state.y - pointer.y;
    const distance = Math.hypot(dx, dy);
    const amount = (1 - smooth(distance / radius)) * radius * (swimming ? .46 : .76);
    targetX += (distance > 2 ? dx / distance : 0) * amount;
    targetY += (distance > 2 ? dy / distance : bias) * amount;
  }
  if (swimming) {
    const vx = (targetX - state.x) * .85, vy = (targetY - state.y) * .85;
    const speed = Math.max(1, Math.hypot(vx, vy) / swimming.speed);
    const dx = vx / speed - state.vx, dy = vy / speed - state.vy;
    const acceleration = Math.max(1, Math.hypot(dx, dy) / (swimming.acceleration * dt));
    state.vx += dx / acceleration;
    state.vy += dy / acceleration;
    state.x += state.vx * dt;
    state.y += state.vy * dt;
    state.at = animationTime;
    return state;
  }
  const follow = 1 - Math.exp(-dt * (age < .55 ? 5.9 : 2.8));
  const nextX = lerp(state.x, targetX, follow), nextY = lerp(state.y, targetY, follow);
  state.vx = (nextX - state.x) / dt;
  state.vy = (nextY - state.y) / dt;
  state.x = nextX;
  state.y = nextY;
  state.at = animationTime;
  return state;
}

function shade(day, night) {
  if (nightAmount === 0) return day;
  if (nightAmount === 1) return night;
  return `color-mix(in srgb, ${day}, ${night} ${nightAmount * 100}%)`;
}

function updateLighting(now, snap = false) {
  if (snap || now >= nextLightCheck) {
    nightTarget = DynamicDesktopEnvironment.light(P.lighting).night;
    nextLightCheck = now + 1000;
  }
  const previous = nightAmount;
  if (requestedScene?.scene.lighting != null) {
    const { restoreAt, from, queuedAt, startAt } = requestedScene;
    const target = requestedScene.scene.lighting;
    nightAmount = restoreAt == null ? lerp(from, target, smooth((animationTime - queuedAt) / (startAt - queuedAt)))
      : lerp(target, nightTarget, smooth((animationTime - restoreAt) / SCENE_FADE));
    return nightAmount !== previous;
  }
  const step = Math.min(now - lastFrame, 100) / 6000;
  nightAmount = snap || !lastFrame || Math.abs(nightTarget - nightAmount) <= step
    ? nightTarget : nightAmount + Math.sign(nightTarget - nightAmount) * step;
  return nightAmount !== previous;
}

function seabed(x) {
  const fraction = x / W;
  return H * (.95 + .004 * Math.sin(fraction * 36) + .003 * Math.sin(fraction * 67 + 1.7));
}

function distantRidges(paint, night) {
  const layers = [
    { level: .83, height: .22, phase: 1.3, color: night ? '#12334b55' : '#448c9e55' },
    { level: .91, height: .19, phase: 3.9, color: night ? '#071d31af' : '#20596d86' }
  ];
  for (const { level, height, phase, color } of layers) {
    paint.fillStyle = color;
    paint.beginPath();
    paint.moveTo(0, H);
    for (let i = 0; i <= 78; i++) {
      const t = i / 78;
      const mass = (.42 + .32 * Math.cos(t * TAU - .5) + .18 * Math.sin(t * 15 + phase));
      const erosion = .035 * Math.sin(t * 68 + phase) + .027 * (random(i, phase) - .5);
      paint.lineTo(t * W, (level - height * mass + erosion) * H);
    }
    paint.lineTo(W, H);
    paint.fill();
  }
}

function cacheBackdrop() {
  const scale = Math.min(cv.width / W, cv.height / H, 960 / Math.max(W, H));
  backdrop = [false, true].map(night => {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(W * scale));
    canvas.height = Math.max(1, Math.round(H * scale));
    const paint = canvas.getContext('2d', { alpha: false });
    paint.scale(canvas.width / W, canvas.height / H);
    const water = paint.createLinearGradient(0, 0, W * .45, H);
    water.addColorStop(0, night ? '#0b263e' : '#3689ab');
    water.addColorStop(.55, night ? '#071c32' : '#277493');
    water.addColorStop(1, night ? '#030f20' : '#18516d');
    paint.fillStyle = water;
    paint.fillRect(0, 0, W, H);
    const glow = paint.createRadialGradient(W * .18, H * .19, 0, W * .18, H * .19, Math.max(W, H) * .66);
    glow.addColorStop(0, night ? '#385f9c22' : '#8ce3e651');
    glow.addColorStop(1, '#297c9300');
    paint.fillStyle = glow;
    paint.fillRect(0, 0, W, H);
    distantRidges(paint, night);
    return canvas;
  });
  floor = new Path2D();
  floor.moveTo(0, seabed(0));
  for (let i = 1; i <= 80; i++) floor.lineTo(W * i / 80, seabed(W * i / 80));
  floor.lineTo(W, H);
  floor.lineTo(0, H);
  floor.closePath();
}

function iconClusters() {
  const groups = [];
  for (const icon of icons) {
    const box = { left: icon.x, right: icon.x + icon.w, top: icon.y, bottom: icon.y + icon.h, members: [icon] };
    for (let i = 0; i < groups.length;) {
      const group = groups[i];
      if (box.left - group.right > 43 || group.left - box.right > 43 ||
          box.top - group.bottom > 54 || group.top - box.bottom > 54) {
        i++;
        continue;
      }
      box.left = Math.min(box.left, group.left);
      box.right = Math.max(box.right, group.right);
      box.top = Math.min(box.top, group.top);
      box.bottom = Math.max(box.bottom, group.bottom);
      box.members.push(...group.members);
      groups.splice(i, 1);
      i = 0; // The combined bounds may touch an earlier group.
    }
    groups.push(box);
  }
  return groups.sort((a, b) => b.members.length - a.members.length || a.left - b.left);
}

function landscapeGroups() {
  return P.adaptive && clusters.length ? clusters.slice(0, 7) : [
    { left: W * .07, right: W * .18, top: H * .28, bottom: H * .49 },
    { left: W * .82, right: W * .93, top: H * .61, bottom: H * .82 }
  ];
}

function targetPlants(groups) {
  const targets = [];
  const stems = 1 + Math.round(P.kelpDensity * 3);
  for (const [index, group] of groups.entries()) {
    for (const side of [-1, 1]) {
      const edge = side < 0 ? group.left : group.right;
      for (let j = 0; j < stems; j++) {
        const x = edge + side * (24 + j * 14);
        if (x < 6 || x > W - 6) continue;
        const key = index * 20 + (side > 0 ? 10 : 0) + j;
        const root = seabed(x) + 1;
        const tip = lerp(group.top - H * .08, group.bottom, j / Math.max(1, stems) * .7 + random(key, 2) * .15);
        const height = clamp(root - tip, H * .12, H * .9);
        targets.push({
          x, height, side, lean: side * (16 + random(key, 3) * 35),
          width: 8 + random(key, 5) * 8 + height * .019,
          phase: random(key, 8) * TAU, color: palette[Math.floor(random(key, 4) * palette.length)],
          alpha: .58 + random(key, 6) * .28
        });
      }
    }
  }
  return targets;
}

function blendAt(now) {
  const t = clamp((now - morphStart) / MORPH_MS, 0, 1);
  return t * t * (3 - 2 * t);
}

function plantAt({ from, to }, t) {
  return {
    ...to,
    x: lerp(from.x, to.x, t), height: lerp(from.height, to.height, t),
    lean: lerp(from.lean, to.lean, t), width: lerp(from.width, to.width, t),
    alpha: lerp(from.alpha, to.alpha, t)
  };
}

function cutout(x, y, width, height, radius) {
  const path = new Path2D();
  path.rect(0, 0, W, H);
  path.roundRect(x, y, width, height, radius);
  return path;
}

function commit(instant = false) {
  const now = performance.now();
  clusters = iconClusters();
  clearings = P.adaptive && P.landscape === KELP ? clusters.map(group =>
    cutout(group.left - 7, group.top - 7, group.right - group.left + 14, group.bottom - group.top + 14, 20)) : [];
  iconOccluders = icons.map(({ x, y, w, h }) => ({
    left: x - 2, right: x + w + 2, top: y - 2, bottom: y + h + 2,
    path: cutout(x - 2, y - 2, w + 4, h + 4, 7)
  }));
  const groups = landscapeGroups();
  const targets = P.landscape === KELP ? targetPlants(groups) : [];
  const bottomExclusions = groups.filter(group => group.bottom > H * .70)
    .map(group => ({ left: group.left - 24, right: group.right + 24 }));
  for (const plant of targets) bottomExclusions.push({ left: plant.x - 8, right: plant.x + 8 });
  const snap = instant || paused || !previewMotion;
  if (P.landscape !== KELP) {
    updateFormations(groups, now, snap);
    if (P.landscape === REEF) for (const { to: { reef } } of formations) {
      bottomExclusions.push({ left: reef.left - reef.thickness * 1.55, right: reef.left },
        { left: reef.right, right: reef.right + reef.thickness * 1.72 });
    }
    bottomDetails = KelpSeabed.buildDetails(W, H, seabed, bottomExclusions, random);
    plants = [];
    morphStart = snap ? -Infinity : now;
    if (snap && backdrop) draw(now);
    return;
  }
  bottomDetails = KelpSeabed.buildDetails(W, H, seabed, bottomExclusions, random);
  formations = [];
  if (snap) {
    plants = targets.map(to => ({ from: to, to }));
    morphStart = -Infinity;
    if (backdrop) draw(now);
    return;
  }
  const available = plants.map(plant => plantAt(plant, blendAt(now))).filter(plant => plant.alpha > .01);
  plants = targets.map(to => {
    let bestIndex = -1, bestDistance = Infinity;
    for (const [i, from] of available.entries()) {
      const distance = Math.abs(from.x - to.x) + Math.abs(from.height - to.height) * .12;
      if (from.side === to.side && distance < bestDistance) {
        bestIndex = i;
        bestDistance = distance;
      }
    }
    if (bestIndex >= 0) return { from: available.splice(bestIndex, 1)[0], to };
    return { from: { ...to, height: to.height * .7, alpha: 0 }, to };
  });
  plants.push(...available.slice(0, 24).map(from => ({ from, to: { ...from, height: from.height * .72, alpha: 0 } })));
  morphStart = now;
}

function plantSpine(plant, t, wake = []) {
  const sway = Math.sin(animationTime * .83 + plant.phase) * plant.width * P.current;
  const bend = plant.side * (plant.width * .65 + 8);
  const envelope = Math.sin(t * Math.PI);
  const x = plant.x + (plant.lean + sway * .75) * t * t + bend * (.46 + .54 * Math.sin(t * TAU + .7)) * envelope;
  const y = seabed(plant.x) + 1 - plant.height * t;
  const flow = wakeAt(x, y, wake);
  return {
    x: x + flow.x * t ** 1.25,
    y: y + flow.y * t * .34,
    halfWidth: 2 * (1 - t) + plant.width * .51 * envelope
  };
}

function plantOutline(plant, wake) {
  const path = new Path2D();
  const segments = 8;
  const spine = Array.from({ length: segments + 1 }, (_, step) => plantSpine(plant, step / segments, wake));
  const vein = new Path2D();
  vein.moveTo(spine[0].x, spine[0].y);
  for (const { x, y } of spine.slice(1)) vein.lineTo(x, y);
  function point(step, side) {
    const { x, y, halfWidth } = spine[step];
    return [x + side * halfWidth, y];
  }
  function edge(start, end, side) {
    const step = Math.sign(end - start);
    for (let i = start; i !== end; i += step) {
      const [x, y] = point(i, side);
      const [nextX, nextY] = point(i + step, side);
      path.quadraticCurveTo(x, y, (x + nextX) * .5, (y + nextY) * .5);
    }
    path.lineTo(...point(end, side));
  }
  path.moveTo(...point(0, -1));
  edge(0, segments, -1);
  edge(segments, 0, 1);
  path.closePath();
  return { path, vein };
}

function formationAt({ from, to }, blend) {
  if (blend === 1) return to;
  return {
    left: lerp(from.left, to.left, blend), right: lerp(from.right, to.right, blend),
    top: lerp(from.top, to.top, blend), bottom: lerp(from.bottom, to.bottom, blend)
  };
}

function updateFormations(groups, now, snap) {
  const available = formations.map(entry => formationAt(entry, blendAt(now)));
  formations = groups.map(({ left, right, top, bottom }) => {
    const to = { left, right, top, bottom };
    if (P.landscape === REEF) to.reef = reefPaths(to);
    if (snap || !available.length) return { from: to, to };
    let closest = 0, distance = Infinity;
    for (const [index, group] of available.entries()) {
      const gap = Math.hypot(group.left + group.right - left - right, group.top + group.bottom - top - bottom);
      if (gap < distance) { closest = index; distance = gap; }
    }
    return { from: available.splice(closest, 1)[0], to };
  });
}

function reefPaths(group) {
  const span = group.right - group.left;
  const thickness = clamp(30 + span * .16, 36, W * .093 + 30);
  const padding = clamp(thickness * .25, 11, 25);
  const left = group.left - padding, right = group.right + padding;
  const corner = Math.min(34, span * .22 + 10);
  const crown = group.top - corner - padding;
  const base = Math.max(seabed(left), seabed(right), group.bottom + padding) + 1;
  const middle = lerp(left, right, .45);

  function arch(rim) {
    const path = new Path2D();
    const shoulder = group.top - padding;
    path.moveTo(left - rim * 1.48, base);
    path.bezierCurveTo(left - rim * .82, lerp(base, shoulder, .38),
      left - rim * 1.14, lerp(base, shoulder, .76), left - rim * .94, shoulder);
    path.bezierCurveTo(left - rim * .88, crown - rim * .38,
      left + corner * .72, crown - rim * .65, middle - rim * .24, crown - rim * .65);
    path.bezierCurveTo(right - corner * .4, crown - rim * .94,
      right + rim * .96, crown - rim * .24, right + rim, shoulder);
    path.bezierCurveTo(right + rim * 1.12, lerp(shoulder, base, .24),
      right + rim * .76, lerp(shoulder, base, .7), right + rim * 1.65, base);
    path.lineTo(right, base);
    path.bezierCurveTo(right + padding * .52, lerp(base, group.top, .4), right + padding * .2, group.top + 3, right, group.top - padding);
    path.quadraticCurveTo(right, crown, right - corner, crown);
    path.bezierCurveTo(middle, crown - 7, middle, crown + 4, left + corner, crown);
    path.quadraticCurveTo(left, crown, left, group.top - padding);
    path.bezierCurveTo(left - padding * .2, group.top + 3, left - padding * .65, lerp(base, group.top, .55), left, base);
    path.closePath();
    return path;
  }

  const shape = arch(thickness), face = arch(thickness * .65);
  const strata = new Path2D(), fractures = new Path2D();
  const start = left - thickness * 2, extent = right - left + thickness * 4;
  const spacing = clamp(thickness * .62, 27, 57);
  for (let i = 0, y = crown - thickness; y < base; i++, y += spacing) {
    const slope = lerp(-.18, .18, random(i, 31));
    strata.moveTo(start, y);
    for (let segment = 1; segment <= 12; segment++) {
      const t = segment / 12;
      const offset = Math.sin(t * 11 + i * .7) * spacing * .43 + (random(i, segment + 32) - .5) * spacing * .52;
      strata.lineTo(start + extent * t, y + slope * spacing * segment + offset);
    }
    for (const side of [-1, 1]) {
      const edge = side < 0 ? left : right;
      const x = edge + side * thickness * lerp(.22, 1.3, random(i, side + 47));
      fractures.moveTo(x, y - spacing * .13);
      fractures.lineTo(x - thickness * .18, y + spacing * .19);
      fractures.lineTo(x + thickness * .04, y + spacing * .48);
    }
  }
  return { shape, face, strata, fractures, left, right, crown, base, thickness };
}

function drawReefRelief(reef, light) {
  ctx.save();
  ctx.clip(reef.shape);
  ctx.lineJoin = 'round';
  if (light) {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = '#071321';
    ctx.globalAlpha = light.strength * .68;
    ctx.lineWidth = 2.5;
    ctx.stroke(reef.strata);
    ctx.stroke(reef.fractures);
    ctx.translate(0, -2.3);
    ctx.strokeStyle = light.pigment;
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = light.strength * .83;
    ctx.lineWidth = 2.1;
    ctx.stroke(reef.strata);
  } else {
    ctx.strokeStyle = shade('#102d3e45', '#07172566');
    ctx.lineWidth = 1.8;
    ctx.stroke(reef.strata);
    ctx.stroke(reef.fractures);
  }
  ctx.restore();
}

const siltSamples = Array.from({ length: 40 }, (_, i) => {
  const angle = i * TAU / 40;
  const round = value => Math.sign(value) * Math.abs(value) ** .42;
  return { angle, x: round(Math.cos(angle)), y: round(Math.sin(angle)) };
});

function siltWindow(group, wake = []) {
  const x = (group.left + group.right) * .5, y = (group.top + group.bottom) * .5;
  const rx = (group.right - group.left) * .59 + 24, ry = (group.bottom - group.top) * .59 + 24;
  const phase = animationTime * .47 + random(0, 12) * TAU;
  const width = clamp(Math.min(rx, ry) * .23, 13, 32);
  const spread = 1.35;
  const localWake = wake.filter(sample => Math.abs(sample.x - x) <= rx + width + sample.rx * spread &&
    Math.abs(sample.y - y) <= ry + width + sample.ry * spread);
  const samples = siltSamples.map(sample => {
    const sweep = width * .25 * Math.sin(sample.angle * 2 + .5);
    const drift = 3 * Math.sin(sample.angle * 3) + P.current *
      (5 * Math.sin(phase + sample.angle * 3) + 2 * Math.cos(phase * .64 - sample.angle * 5));
    const flow = wakeAt(x + sample.x * (rx + drift) + sweep, y + sample.y * (ry + drift), localWake, spread);
    // Keep the wake on the outside of the window even when it flows toward the icons.
    const inward = Math.min(0, flow.x * sample.x + flow.y * sample.y);
    return { ...sample, drift, sweep,
      shiftX: (flow.x - inward * sample.x) * 1.24,
      shiftY: (flow.y - inward * sample.y) * 1.36,
      width: width * (.76 + .37 * Math.cos(sample.angle * 2 + phase * .6) + .12 * Math.sin(sample.angle * 3 - phase)) *
        (1 + flow.strength * .85),
      turbulence: flow.strength
    };
  });
  function point(sample, offset) {
    const extension = sample.drift + sample.width * offset;
    const drift = .73 + offset * .35;
    return { x: x + sample.x * (rx + extension) + sample.sweep + sample.shiftX * drift,
      y: y + sample.y * (ry + extension) + sample.shiftY * drift };
  }
  function ring(inner, outer) {
    const path = new Path2D();
    for (const offset of [inner, outer]) {
      const points = samples.map(sample => point(sample, offset));
      const first = points[0], last = points[points.length - 1];
      path.moveTo((first.x + last.x) * .5, (first.y + last.y) * .5);
      for (const [i, a] of points.entries()) {
        const b = points[(i + 1) % points.length];
        path.quadraticCurveTo(a.x, a.y, (a.x + b.x) * .5, (a.y + b.y) * .5);
      }
      path.closePath();
    }
    return path;
  }
  const reach = width * 1.5 + 16 + (localWake.length ? 94 : 0);
  const eddies = samples.filter(sample => sample.turbulence > .085).map(sample => ({
    ...point(sample, 1.25), strength: sample.turbulence, angle: sample.angle,
    driftX: sample.shiftX, driftY: sample.shiftY
  }));
  return { ring, spawn: () => point(samples[Math.floor(Math.random() * samples.length)], .25),
    outlet: direction => (direction > 0 ? [1, 0, 39] : [19, 20, 21]).map(i => point(samples[i], .25)),
    left: x - rx - reach, right: x + rx + reach, top: y - ry - reach, bottom: y + ry + reach, eddies };
}

function drawSilt(silt, haze) {
  const pigment = ctx.createLinearGradient(silt.left, silt.top, silt.right, silt.bottom);
  pigment.addColorStop(0, shade('#5f92a321', '#557fa319'));
  pigment.addColorStop(.29, shade('#80bac44a', '#628fa73c'));
  pigment.addColorStop(.59, shade('#588fa525', '#51798f1e'));
  pigment.addColorStop(.82, shade('#86b3bd48', '#719ebc38'));
  pigment.addColorStop(1, shade('#5f92a321', '#557fa319'));
  const core = silt.ring(.05, .56);
  ctx.fillStyle = pigment;
  ctx.fill(haze, 'evenodd');
  ctx.fill(core, 'evenodd');
  if (silt.eddies.length) {
    ctx.save();
    ctx.fillStyle = shade('#a3cbd1', '#77a7c0');
    for (const { x, y, angle, strength, driftX, driftY } of silt.eddies) {
      ctx.globalAlpha = strength * .46;
      ctx.beginPath();
      ctx.ellipse(x + driftX * .13, y + driftY * .15, 2 + 9 * strength, 1 + strength, angle + Math.PI * .5, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }
  return haze;
}

function fishSteering(x, y, side, velocity, schoolAge, interaction) {
  let pressure = 0, reactionAge = 0, bodyWidth = 0;
  for (const sample of interaction.fish) {
    if (sample.age > schoolAge) continue;
    const dx = x - velocity * sample.age - sample.hullX;
    const dy = y - sample.y;
    const forward = dx * sample.direction;
    const rx = sample.width * (forward > 0 ? 1.35 : .88) + 38;
    const ry = sample.width * .53 + 33;
    const proximity = 1 - smooth(Math.hypot(dx / rx, dy / ry));
    const force = proximity * (1 - smooth(sample.age / 4.4));
    if (force <= pressure) continue;
    pressure = force;
    reactionAge = sample.age;
    bodyWidth = sample.width;
  }
  return {
    x: x + Math.sign(velocity) * pressure * 15,
    y: y + side * pressure * clamp(bodyWidth * .68 + 32, 58, 122),
    pitch: side * pressure * (.68 - 1.3 * smooth((reactionAge - .25) / 2.3)),
    pressure
  };
}

function fishingCuriosity(x, y, fishing) {
  const dx = fishing.hookX - x, dy = fishing.hookY - y;
  const distance = Math.hypot(dx, dy);
  const radius = clamp(Math.min(W, H) * .2, 65, 145);
  if (distance <= 23 || distance >= radius) return noSteering;
  const proximity = 1 - smooth((distance - radius * .45) / (radius * .55));
  const pull = Math.min(distance - 23, 42) * proximity * fishing.interest / distance;
  return { x: dx * pull, y: dy * pull };
}

function drawFish(interaction, fishing) {
  for (let school = 0; school < P.fish; school++) {
    const clock = animationTime / (50 + school * 9) + school * .37;
    const cycle = Math.floor(clock), phase = clock - cycle;
    const { route, elapsed, width } = interaction;
    const featured = school === 0 && (route?.cinematic || route?.showcase);
    const key = featured ? route.seed : school * 101 + cycle * 7;
    const direction = featured ? -route.direction : random(key, 11) < .5 ? -1 : 1;
    const meeting = featured ? routePosition(route, .33, width) : null;
    const depth = featured ? meeting.y : H * (.22 + random(key, 12) * .48);
    const count = featured ? 12 : 5 + Math.floor(random(key, 13) * 8);
    const margin = Math.max(W * .12, count * 10 + 36);
    const speed = featured ? clamp(W * .037, 28, 102) : (W + 2 * margin) / (50 + school * 9);
    const centre = featured ? meeting.x + direction * ((elapsed - route.duration * .33) * speed + count * 5)
      : lerp(-margin, W + margin, direction === 1 ? phase : 1 - phase);
    const visibility = featured ? smooth(elapsed / 1.2) * (1 - smooth((elapsed - route.duration + 2) / 2)) : 1;
    const schoolAge = featured ? elapsed : phase * (50 + school * 9);
    const species = Math.floor(random(key, 14) * 3);
    const colors = ['#99c9d2', '#c6b891', '#83b4bd'];
    ctx.save();
    ctx.fillStyle = colors[species];
    ctx.globalAlpha = visibility * (featured ? .78 - nightAmount * .15 : .55 - nightAmount * .17);
    for (let i = 0; i < count; i++) {
      const side = i % 2 ? -1 : 1;
      const x = centre - direction * (i * 10 + random(i, key + 15) * 19);
      const y = depth + side * (3 + random(i, key + 16) * 16) + Math.sin(animationTime * .8 + i * .7) * 3;
      const motion = fishSteering(x, y, side, direction * speed, schoolAge, interaction);
      const size = (featured ? 1.24 : 1) * (species === 1 ? 1.27 : 1) * (4.5 + random(i, key + 17) * 2);
      const curiosity = fishing?.interest > 0 && random(i, key + 18) < .62 ? fishingCuriosity(motion.x, motion.y, fishing) : noSteering;
      const fishX = motion.x + curiosity.x, fishY = motion.y + curiosity.y;
      const evasion = cursorAvoidance(`fish:${school}:${featured ? route.startsAt : cycle}:${i}`, fishX, fishY, 74, side);
      const swimmingX = direction * speed + evasion.vx;
      const facing = Math.abs(swimmingX) > 12 ? Math.sign(swimmingX) : direction;
      const turning = Math.atan2(evasion.vy, Math.abs(swimmingX) + 12) + curiosity.y * .012;
      const flick = Math.sin(animationTime * 5 + i) + motion.pressure * .5 * Math.sin(animationTime * 12 + i);
      const tail = -size * (1.55 + flick * .18);
      const bodyDepth = size * [.38, .65, .21][species];
      ctx.save();
      ctx.translate(fishX + evasion.x, fishY + evasion.y);
      ctx.scale(facing, 1);
      ctx.rotate(clamp(motion.pitch + turning, -1.25, 1.25));
      ctx.beginPath();
      ctx.ellipse(0, 0, size, bodyDepth, 0, 0, TAU);
      ctx.moveTo(-size * .65, 0);
      ctx.lineTo(tail, -size * (species === 1 ? .46 : .58));
      ctx.lineTo(lerp(tail, 0, species === 1 ? .07 : .29), 0);
      ctx.lineTo(tail, size * (species === 1 ? .46 : .58));
      ctx.closePath();
      ctx.fill();
      if (species === 1) {
        ctx.beginPath();
        ctx.moveTo(-size * .48, -bodyDepth * .65);
        ctx.lineTo(-size * .24, -bodyDepth * 1.48);
        ctx.lineTo(size * .57, -bodyDepth * .73);
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.restore();
  }
}

function drawMantaRay(x, y, size, direction, time, opacity) {
  const lift = Math.sin(time * 1.05);
  const farLift = Math.sin(time * 1.05 - .35);
  const tailWave = Math.sin(time * .8 - 1) * .025;
  ctx.save();
  ctx.translate(x, y + Math.sin(time * .48) * size * .015);
  ctx.scale(direction * size, size);
  ctx.rotate(Math.sin(time * .57) * .018);
  ctx.globalAlpha *= opacity;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // The thin tail emerges from the rear of the disc.
  ctx.beginPath();
  ctx.moveTo(-.22, .025);
  ctx.bezierCurveTo(-.42, .035, -.60, .045 + tailWave * .4, -.86, .07 + tailWave);
  ctx.strokeStyle = '#4c666d';
  ctx.lineWidth = .007;
  ctx.stroke();

  // The two wings and body form one flattened disc seen from above and to the side.
  const farTip = -.34 + farLift * .045, nearTip = .44 + lift * .055;
  const body = ctx.createLinearGradient(0, farTip, -.08, nearTip);
  body.addColorStop(0, '#2c4650');
  body.addColorStop(.42, '#56737b');
  body.addColorStop(.68, '#3c5962');
  body.addColorStop(1, '#29424c');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(.33, -.048);
  ctx.bezierCurveTo(.22, -.115, .09, -.09, -.02, -.18);
  ctx.bezierCurveTo(-.13, -.25, -.17, farTip * .91, -.27, farTip);
  ctx.quadraticCurveTo(-.303, farTip - .012, -.295, farTip + .028);
  ctx.bezierCurveTo(-.26, -.19, -.20, -.09, -.29, .022);
  ctx.quadraticCurveTo(-.31, .045, -.29, .067);
  ctx.bezierCurveTo(-.23, .19, -.28, nearTip * .76, -.34, nearTip - .025);
  ctx.quadraticCurveTo(-.35, nearTip + .018, -.31, nearTip);
  ctx.bezierCurveTo(-.13, nearTip * .84, .04, .20, .13, .12);
  ctx.bezierCurveTo(.24, .09, .30, .072, .34, .029);
  ctx.quadraticCurveTo(.36, -.014, .33, -.048);
  ctx.closePath();
  ctx.fill();

  // Short paired cephalic lobes frame the wide front of the mouth.
  ctx.fillStyle = '#415e67';
  ctx.beginPath();
  ctx.moveTo(.27, -.035);
  ctx.quadraticCurveTo(.34, -.085, .39, -.065);
  ctx.quadraticCurveTo(.40, -.045, .34, -.012);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(.28, .045);
  ctx.quadraticCurveTo(.35, .075, .39, .05);
  ctx.quadraticCurveTo(.39, .03, .34, .012);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(.33, -.012);
  ctx.quadraticCurveTo(.35, .002, .34, .012);
  ctx.strokeStyle = '#1d343c';
  ctx.lineWidth = .012;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(.17, -.065);
  ctx.bezierCurveTo(.03, -.085, -.14, -.045, -.22, .015);
  ctx.moveTo(.13, .10);
  ctx.bezierCurveTo(.02, .17, -.15, nearTip * .78, -.30, nearTip - .009);
  ctx.strokeStyle = 'rgba(170, 201, 201, .28)';
  ctx.lineWidth = .007;
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(.235, -.027, .007, .005, 0, 0, TAU);
  ctx.fillStyle = '#192f37';
  ctx.fill();
  ctx.restore();
}

function jellyRoute(cycle, elapsed) {
  // The bell pulse speeds up the animal along the same curve used to aim it.
  const progress = (elapsed - .31 * Math.sin(elapsed * 1.8)) / 44;
  const swing = TAU * 1.45;
  const phase = progress * swing + random(cycle, 93) * TAU;
  const amplitude = Math.min(W * .21, H * .18, 175);
  const drift = (random(cycle, 90) < .5 ? -1 : 1) * clamp(W * .045, 16, 92);
  const height = H + 120;
  const rate = (1 - .558 * Math.cos(elapsed * 1.8)) / 44;
  return {
    x: W * (.28 + random(cycle, 91) * .44) + amplitude * Math.sin(phase) + drift * (progress - .5),
    y: H + 60 - height * progress,
    vx: (amplitude * swing * Math.cos(phase) + drift) * rate, vy: -height * rate,
    trailing: clamp(amplitude * Math.sin(phase) * .037, -6, 6)
  };
}

function drawWildlife() {
  // A quiet interval between visits keeps larger animals occasional.
  const cycle = Math.floor(animationTime / 105);
  const elapsed = animationTime % 105;
  if (elapsed >= 44) return;
  const turtle = (cycle % 2 === 0) === (random(0, 92) < .5);
  const cadence = elapsed % 4.8;
  const pulse = Math.min(cadence, 2.4);
  const strokeAngle = pulse * TAU / 1.2;
  const surge = .24 * (pulse - cadence * .5) + .11 * (1 - Math.cos(strokeAngle));
  const progress = (elapsed + (turtle ? surge : 0)) / 44;
  const direction = random(cycle, 90) < .5 ? -1 : 1;
  const lane = .26 + random(cycle, 91) * .34;
  const jelly = turtle ? null : jellyRoute(cycle, elapsed);
  const x = turtle ? (direction === 1 ? progress * 1.2 - .1 : 1.1 - progress * 1.2) * W
    : jelly.x;
  const y = turtle ? H * lane + Math.sin(elapsed * .49) * 9 - 2 * Math.sin(strokeAngle)
    : jelly.y;
  const evasion = cursorAvoidance(`wildlife:${cycle}`, x, y, turtle ? 112 : 96, -1, turtle ? turtleSteering : jellySteering);
  ctx.save();
  ctx.translate(x + evasion.x, y + evasion.y);
  ctx.globalAlpha = turtle ? 1 : .58 - nightAmount * .18;
  if (turtle) {
    const swimmingX = direction * W * 1.2 / 44 + evasion.vx;
    ctx.scale(Math.abs(swimmingX) > 14 ? Math.sign(swimmingX) : direction, 1);
    // Two strokes followed by a glide, with each flipper moving independently.
    const stroke = Math.sin(strokeAngle);
    const rear = Math.sin(strokeAngle) * .7 - Math.sin(strokeAngle * 2) * .29;
    ctx.rotate(stroke * .055 + Math.sin(elapsed * .6) * .035 + clamp(Math.atan2(evasion.vy, Math.abs(swimmingX) + 20), -.62, .62));
    ctx.fillStyle = shade('#648a7d', '#304f50');
    ctx.save();
    ctx.translate(-13, 4);
    ctx.rotate(rear * .35 - .15);
    ctx.beginPath(); ctx.ellipse(-4, 4, 9, 3.2, -.55, 0, TAU); ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.translate(8, -5);
    ctx.rotate(-stroke * .42);
    ctx.beginPath(); ctx.ellipse(3, -5, 11, 3.8, -.8, 0, TAU); ctx.fill();
    ctx.restore();
    ctx.fillStyle = shade('#8daa91', '#496965');
    ctx.beginPath();
    ctx.ellipse(0, 0, 22, 11, 0, 0, TAU);
    ctx.moveTo(-19, 1); ctx.lineTo(-27, 4); ctx.lineTo(-20, 5);
    ctx.fill();
    ctx.save();
    ctx.translate(18, -1);
    ctx.rotate(-stroke * .045);
    ctx.beginPath(); ctx.ellipse(4, -1, 7, 4.5, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = shade('#233d39', '#172c30');
    ctx.beginPath(); ctx.arc(7, -2.3, 1, 0, TAU); ctx.fill();
    ctx.restore();
    ctx.fillStyle = shade('#779b86', '#3d605a');
    ctx.save();
    ctx.translate(3, 5);
    ctx.rotate(stroke * .83 + .18);
    ctx.beginPath();
    ctx.moveTo(-5, -2);
    ctx.bezierCurveTo(-9, 5, -9, 13, -4, 20);
    ctx.bezierCurveTo(1, 18, 7, 6, 5, 1);
    ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.translate(-16, 4);
    ctx.rotate(-rear * .3);
    ctx.beginPath(); ctx.ellipse(-3, 4, 7, 3, -.5, 0, TAU); ctx.fill();
    ctx.restore();
    // The domed shell sits above the limbs, with broad scutes visible in profile.
    ctx.fillStyle = shade('#607f6b', '#314e48');
    ctx.beginPath();
    ctx.ellipse(-1, -1.5, 17, 8, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = shade('#405f51', '#263f3b');
    ctx.lineWidth = .8;
    ctx.beginPath();
    ctx.ellipse(-1, -1.5, 17, 8, 0, 0, TAU);
    ctx.moveTo(-9, -8); ctx.lineTo(-6, -2); ctx.lineTo(-8, 5);
    ctx.moveTo(2, -9); ctx.lineTo(4, -2); ctx.lineTo(2, 6);
    ctx.moveTo(-16, -2); ctx.lineTo(15, -2);
    ctx.stroke();
  } else {
    ctx.rotate(Math.atan2(jelly.vx + evasion.vx, -(jelly.vy + evasion.vy)));
    const pulse = Math.sin(elapsed * 1.8);
    const delayed = Math.sin(elapsed * 1.8 - 1.2);
    ctx.fillStyle = '#a8c4d4';
    ctx.beginPath();
    ctx.moveTo(-13 - pulse * 2, 0);
    ctx.bezierCurveTo(-13 - pulse * 2, -20 + pulse * 3, 13 + pulse * 2, -20 + pulse * 3, 13 + pulse * 2, 0);
    ctx.quadraticCurveTo(6, 4, 0, 1);
    ctx.quadraticCurveTo(-7, 4, -13 - pulse * 2, 0);
    ctx.fill();
    ctx.strokeStyle = '#b9d4dc';
    ctx.lineWidth = 1;
    for (let i = -2; i <= 2; i++) {
      const tx = i * 4;
      ctx.beginPath();
      ctx.moveTo(tx, 1);
      ctx.bezierCurveTo(tx + 5 + pulse * 2, 10, tx - 4 + delayed * 3 + jelly.trailing * .45, 18,
        tx + 3 + delayed * 5 + jelly.trailing, 27 + Math.abs(i) * 3);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawScubaDiver(x, y, direction, pitch, size, elapsed, opacity) {
  ctx.save();
  const alpha = ctx.globalAlpha * opacity;

  // Exhaled bubbles drift upward and trail behind the swimmer in screen space.
  ctx.strokeStyle = shade('#b6e3e7', '#7caebf');
  ctx.lineWidth = Math.max(.6, size * .009);
  for (let i = 0; i < 7; i++) {
    const age = (elapsed * .38 + i / 7) % 1;
    const bx = x + direction * size * (.32 - age * .48 + .025 * Math.sin(i * 4 + age * 8));
    const by = y - size * (.03 + age * .58);
    ctx.globalAlpha = alpha * .48 * Math.min(1, age * 8, (1 - age) * 4);
    ctx.beginPath();
    ctx.arc(bx, by, size * (.012 + age * .009), 0, TAU);
    ctx.stroke();
  }

  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.scale(direction * size, size);
  ctx.rotate(pitch);
  const kick = Math.sin(elapsed * 4.2);

  // Legs and fins bend independently to suggest a relaxed flutter kick.
  function leg(offset, motion, color) {
    const kneeY = offset + motion * .035;
    const footY = offset + motion * .075;
    ctx.strokeStyle = color;
    ctx.lineWidth = .065;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(-.12, offset);
    ctx.lineTo(-.27, kneeY);
    ctx.lineTo(-.39, footY);
    ctx.stroke();
    ctx.fillStyle = shade('#172e38', '#10232e');
    ctx.beginPath();
    ctx.moveTo(-.38, footY - .025);
    ctx.quadraticCurveTo(-.48, footY - .025 + motion * .025, -.53, footY - .045 + motion * .04);
    ctx.lineTo(-.52, footY + .015 + motion * .04);
    ctx.quadraticCurveTo(-.46, footY + .035, -.38, footY + .025);
    ctx.fill();
  }
  leg(-.02, -kick, shade('#233e48', '#182e39'));
  leg(.035, kick, shade('#31515b', '#213a46'));

  // Tank and harness sit above the streamlined suit.
  ctx.fillStyle = shade('#a8c5bf', '#688b8d');
  ctx.beginPath();
  ctx.roundRect(-.16, -.13, .34, .09, .035);
  ctx.fill();
  ctx.fillStyle = shade('#2e535a', '#203b47');
  ctx.fillRect(-.09, -.13, .035, .09);
  ctx.fillRect(.08, -.13, .035, .09);
  ctx.fillStyle = shade('#254750', '#1a333e');
  ctx.beginPath();
  ctx.ellipse(.015, -.005, .21, .075, -.04, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = shade('#416975', '#294a58');
  ctx.lineWidth = .047;
  ctx.beginPath();
  ctx.moveTo(.07, .025);
  ctx.quadraticCurveTo(.15, .10, .25, .065);
  ctx.lineTo(.33, .025);
  ctx.stroke();

  ctx.fillStyle = shade('#294952', '#1b3540');
  ctx.beginPath();
  ctx.arc(.25, -.035, .067, 0, TAU);
  ctx.fill();
  ctx.fillStyle = shade('#a8d7d8', '#6a9fae');
  ctx.beginPath();
  ctx.roundRect(.265, -.065, .065, .039, .012);
  ctx.fill();
  ctx.strokeStyle = shade('#b4d3cd', '#73999c');
  ctx.lineWidth = .012;
  ctx.beginPath();
  ctx.moveTo(.17, -.10);
  ctx.quadraticCurveTo(.24, -.15, .31, -.025);
  ctx.stroke();
  ctx.restore();
}

function drawBubbles() {
  ctx.lineWidth = .8;
  for (let i = 0; i < P.bubbles; i++) {
    const phase = (animationTime * (.024 + random(i, 7) * .019) + random(i, 3)) % 1;
    const x = W * (.11 + random(i, 2) * .78) + 8 * Math.sin(phase * 10 + i);
    const y = H * (.94 - phase * .86);
    ctx.strokeStyle = '#a3d2da';
    ctx.globalAlpha = lerp(.27, .16, nightAmount) * Math.min(1, phase * 12, (1 - phase) * 9);
    ctx.beginPath();
    ctx.arc(x, y, 1.45 + random(i, 8) * 2.5 + phase, 0, TAU);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function modelWidth(model) {
  return clamp(W * .094, 132, 178) * model.scale;
}

function setVesselPass(route) {
  if (pass && !pass.still) previousWake = { route: pass, until: animationTime };
  pass = route;
}

function formationSpawn(group) {
  if (P.landscape === SILT) return siltWindow(group).spawn();
  const side = Math.random() < .5 ? -1 : 1;
  const reef = group.reef || reefPaths(group);
  const x = (side < 0 ? reef.left : reef.right) + side * reef.thickness * (.16 + Math.random() * .79);
  const y = lerp(reef.crown, reef.base, .22 + Math.random() * .57);
  return ctx.isPointInPath(reef.shape, x * cv.width / W, y * cv.height / H) ? { x, y } : null;
}

function spawnPoint(now) {
  const blend = blendAt(now);
  const candidates = P.landscape === KELP
    ? plants.map(plant => plantAt(plant, blend)).filter(plant => plant.alpha > .25)
    : formations.map(entry => formationAt(entry, blend));
  for (let i = 0; i < 24 && candidates.length; i++) {
    const candidate = candidates[Math.floor(Math.random() * candidates.length)];
    const point = P.landscape === KELP ? plantSpine(candidate, .27 + Math.random() * .46) : formationSpawn(candidate);
    if (!point || point.x < 5 || point.x > W - 5 || point.y < H * .14 || point.y > H * .9) continue;
    if (clusters.some(group => point.x >= group.left - 7 && point.x <= group.right + 7 &&
        point.y >= group.top - 7 && point.y <= group.bottom + 7)) continue;
    return { x: point.x / W, y: point.y / H };
  }
  return null;
}

function beginPass(still = false) {
  const start = spawnPoint(performance.now());
  if (!start) {
    if (!pass) nextPassAt = animationTime + 2 + Math.random() * 3;
    return;
  }
  const index = P.submersible ? P.submersible - 1 : nextModel;
  if (!still) nextModel = (index + 1) % models.length;
  const direction = start.x < .24 ? 1 : start.x > .76 ? -1 : Math.random() < .5 ? -1 : 1;
  const distance = direction === 1 ? 1 - start.x : start.x;
  const changeDepth = Math.random() < .72;
  const depth = changeDepth ? (Math.random() < .5 ? -1 : 1) * (.045 + Math.random() * .13) : 0;
  setVesselPass({
    index, start, direction, startsAt: animationTime, still, emergenceX: start.x,
    duration: (distance + .06) / (.031 + Math.random() * .014),
    endDepth: clamp(start.y + depth, .15, .88),
    drift: (Math.random() - .5) * (changeDepth ? .08 : .014),
    far: lerp(.61, .91, Math.random()), near: lerp(.92, 1.19, Math.random())
  });
  if (DEMO) document.getElementById('modelName').textContent = models[index].name;
}

function reefDiveEntries() {
  const candidates = [];
  for (const { to: group } of formations) {
    const reef = group.reef || reefPaths(group);
    const y = clamp(lerp(reef.crown, reef.base, .64), H * .34, H * .79);
    for (const direction of [-1, 1]) {
      const edge = direction < 0 ? reef.left : reef.right;
      const x = edge - direction * Math.min((reef.right - reef.left) * .42, Math.max(44, reef.thickness));
      candidates.push({ x, y, direction, edge, quality: 0 });
    }
  }
  return candidates;
}

function kelpDiveEntries(now) {
  const blend = blendAt(now);
  return plants.map(plant => plantAt(plant, blend)).filter(plant => plant.alpha > .25).flatMap(plant =>
    [.56, .43, .68].map((height, i) => {
      const point = plantSpine(plant, height);
      return { x: point.x - plant.side * point.halfWidth * .22, y: point.y, edge: point.x,
        direction: plant.side, quality: plant.width * .6 - i * 9 };
    }));
}

function siltDiveEntries(now) {
  const blend = blendAt(now);
  return formations.flatMap(entry => {
    const silt = siltWindow(formationAt(entry, blend));
    return [-1, 1].flatMap(direction => silt.outlet(direction).map((point, i) => ({
      x: point.x - direction * 12, y: point.y, edge: point.x, direction, quality: -i * 11
    })));
  });
}

function beginNightDive(onRequest = false) {
  const now = performance.now();
  const candidates = P.landscape === REEF ? reefDiveEntries()
    : P.landscape === KELP ? kelpDiveEntries(now) : siltDiveEntries(now);
  const openWater = (x, y) => !clusters.some(group => x >= group.left - 8 && x <= group.right + 8 &&
    y >= group.top - 8 && y <= group.bottom + 8);
  const room = entry => entry.direction < 0 ? entry.edge : W - entry.edge;
  const clear = candidates.filter(entry => {
    const { x, y, edge, direction } = entry;
    if (edge <= W * .025 || edge >= W * .975 || y < H * .17 || y > H * .84) return false;
    if (room(entry) <= W * .29) return false;
    if (P.landscape === REEF) return true;
    return openWater(x, y) && openWater(edge + direction * Math.min(W * .08, 94), y);
  });
  clear.sort((a, b) => room(b) + b.quality - room(a) - a.quality);
  const direction = Math.random() < .5 ? -1 : 1;
  const entry = clear[0] || (onRequest ? { x: W * (direction > 0 ? .06 : .94), y: H * .60, direction } : null);
  if (!entry) return false;
  const index = DEMO || !P.submersible ? 0 : P.submersible - 1;
  const startDepth = entry.y / H;
  const rise = P.landscape === KELP ? .28 : P.landscape === SILT ? .13 : .22;
  setVesselPass({
    index, start: { x: entry.x / W, y: startDepth }, direction: entry.direction, startsAt: animationTime,
    duration: 23, endDepth: P.landscape === REEF ? clamp(startDepth - rise, .22, .62) : Math.max(.14, startDepth - rise),
    drift: .045, cinematic: true, landscape: P.landscape,
    emergenceX: entry.edge === undefined ? undefined : entry.edge / W,
    far: .57, near: 1.31, seed: Math.floor(Math.random() * 10000)
  });
  if (DEMO) document.getElementById('modelName').textContent = models[index].name;
  return true;
}

function wreckWidth() {
  return Math.min(clamp(W * .23, 145, 450), H * .54);
}

function wreckAt(route) {
  if (!route?.wreck) return null;
  if (route.wreck.width !== W || route.wreck.height !== H) {
    const x = route.wreck.x * W;
    route.wreck.width = W;
    route.wreck.height = H;
    route.wreck.art = KelpSeabed.buildWreck(x, seabed(x), wreckWidth() * route.wreck.scale);
  }
  return route.wreck.art;
}

function beginWreckDive(onRequest = false) {
  const places = [.50, .61, .39, .70, .30];
  let scale = 1;
  function blocked(fraction) {
    const halfWidth = wreckWidth() * scale * .54;
    const x = fraction * W, top = seabed(x) - halfWidth;
    return clusters.some(group => group.bottom >= top && group.left < x + halfWidth && group.right > x - halfWidth);
  }
  let site = places.find(fraction => !blocked(fraction));
  if (site == null && onRequest) {
    scale = .68;
    site = [...places, .80, .20].find(fraction => !blocked(fraction)) ?? .50;
  }
  if (site == null) return false;
  const direction = site > .5 ? 1 : site < .5 ? -1 : Math.random() < .5 ? 1 : -1;
  const index = DEMO || !P.submersible ? 0 : P.submersible - 1;
  const floorDepth = seabed(site * W) / H;
  setVesselPass({ index, start: { x: site - direction * .34, y: floorDepth - .20 }, direction, startsAt: animationTime,
    duration: 23, endDepth: floorDepth - .12, drift: -.045, cinematic: true, landscape: P.landscape,
    far: .66, near: 1.21, seed: Math.floor(Math.random() * 10000), wreck: { x: site, scale } });
  if (DEMO) document.getElementById('modelName').textContent = models[index].name;
  return true;
}

function beginCrabPass() {
  const size = clamp(W * .036, 24, 35);
  const shelters = bottomDetails.shelters.filter(rock => rock.x > size && rock.x < W - size)
    .sort((a, b) => a.x - b.x);
  const first = shelters[0], last = shelters[shelters.length - 1];
  const direction = Math.random() < .5 ? -1 : 1;
  const sheltered = first && last.x - first.x > Math.max(size * 3, W * .25);
  const from = sheltered ? first.x / W : -size / W, to = sheltered ? last.x / W : 1 + size / W;
  crabPass = { from: direction > 0 ? from : to, to: direction > 0 ? to : from, direction, sheltered,
    size, startsAt: animationTime, duration: Math.max(6, (to - from) * W / 39) };
}

function advanceCrab() {
  if (crabPass && animationTime >= crabPass.startsAt + crabPass.duration) {
    crabPass = null;
    nextCrabAt = animationTime + 65 + Math.random() * 90;
  }
  if (P.wildlife && !crabPass && nightAmount < .23 && animationTime >= nextCrabAt) beginCrabPass();
}

function drawBottom() {
  if (!crabPass || !P.wildlife || nightAmount >= .34) { bottomDetails.draw(ctx, nightAmount); return; }
  const { from, to, direction, size, startsAt, duration, sheltered } = crabPass;
  const elapsed = animationTime - startsAt;
  const walking = clamp(elapsed / duration, 0, 1);
  const baseX = lerp(from, to, walking) * W;
  const evasion = cursorAvoidance('crab:' + startsAt, baseX, seabed(baseX), 63, 1, turtleSteering);
  const x = baseX + evasion.x;
  const nearShelter = sheltered && Math.min(Math.abs(x - from * W), Math.abs(x - to * W)) < size * 1.24;
  if (!nearShelter) bottomDetails.draw(ctx, nightAmount);
  const visibility = (1 - smooth((nightAmount - .19) / .15)) *
    (sheltered ? smooth(elapsed / .8) * smooth((duration - elapsed) / .85) : 1);
  KelpSeabed.drawCrab(ctx, x, seabed(x) + 2, direction, elapsed, size, visibility);
  if (nearShelter) bottomDetails.draw(ctx, nightAmount);
}

function beginWakePass() {
  const group = [...landscapeGroups()].sort((a, b) => a.left - b.left)[0];
  const direction = (group.left + group.right) * .5 < W * .5 ? 1 : -1;
  const edge = direction > 0 ? group.right : group.left;
  const x = clamp(edge - direction * 20, W * .035, W * .965);
  const y = clamp((group.top + group.bottom) * .5 / H, .22, .75);
  setVesselPass({
    index: DEMO || !P.submersible ? 0 : P.submersible - 1, start: { x: x / W, y }, direction, startsAt: animationTime, duration: 18,
    endDepth: clamp(y + .09, .25, .82), drift: -.015, showcase: true, far: .92, near: 1.16, seed: 91,
    emergenceX: edge / W
  });
  if (DEMO) document.getElementById('modelName').textContent = models[pass.index].name;
}

function beginDiverPass() {
  diverPass = { startsAt: animationTime, duration: 22, direction: Math.random() < .5 ? -1 : 1,
    lane: .45 + Math.random() * .17 };
}

const desktopScenes = [
  { id: 'night', en: 'Night dive', nl: 'Nachtduik', lighting: 1, start: () => beginNightDive(true) },
  { id: 'wreck', en: 'Wreck dive', nl: 'Wrakduik', lighting: 1, start: () => beginWreckDive(true) },
  { id: 'wake', en: 'Wake pass', nl: 'Kielzog', start: beginWakePass },
  { id: 'diver', en: 'Passing diver', nl: 'Langszwemmende duiker', start: beginDiverPass },
  { id: 'jellyParade', en: 'Jellyfish parade', nl: 'Kwallenparade', duration: 26, layer: 'water', draw: drawKelpDeepScene },
  { id: 'subMeeting', en: 'Meeting in the depths', nl: 'Ontmoeting in de diepte', duration: 23, layer: 'water', draw: drawKelpVesselScene },
  { id: 'whaleEye', en: 'Eye of the whale', nl: 'Het oog van de walvis', duration: 30, layer: 'distant', draw: drawKelpDeepScene },
  { id: 'deepLure', en: 'Light from the depths', nl: 'Licht uit de diepte', duration: 24, layer: 'water', draw: drawKelpDeepScene, lighting: 1, start: beginDeepLurePass },
  { id: 'research', en: 'Seabed research', nl: 'Onderzoek bij de bodem', duration: 34, layer: 'bottom', draw: drawKelpVesselScene },
  { id: 'sunBreak', en: 'Break in the clouds', nl: 'Zonnedoorbraak', duration: 28, layer: 'overlay', draw: drawKelpSurfaceScene, lighting: 0 },
  { id: 'flatfish', en: 'In the sand', nl: 'In het zand', duration: 16, layer: 'bottom', draw: drawKelpDeepScene },
  { id: 'dolphins', en: 'Dolphins in the shallows', nl: 'Dolfijnen in de bovenlaag', duration: 23, layer: 'water', draw: drawKelpWildlifeScene, lighting: 0 },
  { id: 'silverHunt', en: 'Silver hunt', nl: 'Jacht op zilver', duration: 23, layer: 'water', draw: drawKelpWildlifeScene, lighting: 0 },
  { id: 'boatShadow', en: 'Shadow at the surface', nl: 'Schaduw aan het oppervlak', duration: 20, layer: 'overlay', draw: drawKelpSurfaceScene, lighting: 0 },
  { id: 'fishingBoat', en: 'Fishing boat', nl: 'Vissersboot met vislijn', duration: 36, layer: 'water', draw: drawKelpSurfaceScene, lighting: 0 }
];

function queueDesktopScene(scene) {
  if (requestedScene) {
    setVesselPass(null);
    diverPass = null;
  }
  const delay = scene.lighting != null && Math.abs(scene.lighting - nightAmount) > .001 ? SCENE_FADE : .55;
  requestedScene = {
    scene, from: nightAmount, queuedAt: animationTime, startAt: animationTime + delay,
    seed: Math.floor(Math.random() * 10000), direction: Math.random() < .5 ? -1 : 1
  };
}

function sceneSite(scene) {
  const depth = scene.id === 'fishingBoat' ? .37 : .84;
  const candidates = scene.id === 'fishingBoat' ? [.28, .38, .5, .62, .71] : [.5, .62, .38, .71, .29];
  const margin = Math.min(W * .11, 130);
  return candidates.find(x => clusters.every(group =>
    group.top > H * (depth + .14) || group.bottom < H * (depth - .17) ||
    x * W + margin < group.left || x * W - margin > group.right)) ?? .5;
}

function deepLureSite(direction) {
  const surfaces = scenerySurfaces(performance.now(), []);
  const sx = cv.width / W, sy = cv.height / H;
  const approach = Math.min(W * .24, 220);
  let best = { site: .5, depth: .64, direction }, bestScore = -Infinity;
  ctx.save();
  ctx.setTransform(sx, 0, 0, sy, 0, 0);
  for (const site of [.5, .37, .63, .25, .75, .17, .83]) {
    for (const depth of [.64, .54, .72, .44]) {
      const x = site * W, y = depth * H;
      for (const side of [direction, -direction]) {
        let distance = 0;
        for (; distance <= approach; distance += 8) {
          const px = x - side * distance, py = y - distance / approach * H * .075;
          if (px < 5 || px > W - 5 || surfaces.some(surface =>
            px >= surface.left && px <= surface.right && py >= surface.top && py <= surface.bottom &&
            ctx.isPointInPath(surface.path, px * sx, py * sy, surface.rule || 'nonzero')) ||
            clusters.some(group => px >= group.left - 20 && px <= group.right + 20 &&
              py >= group.top - 15 && py <= group.bottom + 15)) break;
        }
        const score = distance - Math.abs(site - .5) * 26 - Math.abs(depth - .64) * 22 + (side === direction ? 3 : 0);
        if (score > bestScore) {
          bestScore = score;
          best = { site, depth, direction: side };
        }
      }
    }
  }
  ctx.restore();
  return best;
}

function beginDeepLurePass() {
  const { scene, site, depth, direction, seed } = requestedScene;
  const index = P.submersible ? P.submersible - 1 : 0;
  const lane = depth - .075;
  setVesselPass({
    index, start: { x: site - direction * .51, y: lane - .015 }, direction, startsAt: animationTime,
    duration: scene.duration, endDepth: lane, drift: .005, far: .79, near: .91, seed, lure: true
  });
  if (DEMO) document.getElementById('modelName').textContent = models[index].name;
}

function advanceRequestedScene() {
  if (!requestedScene) return false;
  if (requestedScene.restoreAt != null) {
    if (animationTime - requestedScene.restoreAt >= SCENE_FADE) requestedScene = null;
    return true;
  }
  if (requestedScene.endsAt == null) {
    if (animationTime < requestedScene.startAt) return true;
    setVesselPass(null);
    const { scene } = requestedScene;
    if (scene.id === 'deepLure') Object.assign(requestedScene, deepLureSite(requestedScene.direction));
    else requestedScene.site = sceneSite(scene);
    scene.start?.();
    requestedScene.endsAt = animationTime + (scene.duration ?? (diverPass || pass).duration);
    requestedScene.startedAt = animationTime;
    return true;
  }
  if (animationTime < requestedScene.endsAt) return true;
  setVesselPass(null);
  diverPass = null;
  nextPassAt = animationTime + P.interval * (.65 + Math.random() * .7);
  nextSceneAt = animationTime + 110 + Math.random() * 75;
  const lighting = requestedScene.scene.lighting;
  if (lighting != null && Math.abs(nightTarget - lighting) > .001) requestedScene.restoreAt = animationTime;
  else requestedScene = null;
  return true;
}

function drawRequestedDiver() {
  if (!diverPass) return;
  const { startsAt, duration, direction, lane } = diverPass;
  const elapsed = animationTime - startsAt;
  const t = clamp(elapsed / duration, 0, 1);
  const size = clamp(W * .089, 94, 184);
  const x = lerp(direction > 0 ? -size : W + size, direction > 0 ? W + size : -size, t);
  const y = H * (lane + .055 * Math.sin(t * TAU) - t * .11) + Math.sin(elapsed * 2) * 1.8;
  const pitch = Math.atan2(H * (.055 * TAU * Math.cos(t * TAU) - .11), W + size * 2);
  ctx.save();
  for (const icon of iconOccluders) {
    if (x + size > icon.left && x - size < icon.right && y + size > icon.top && y - size < icon.bottom) ctx.clip(icon.path, 'evenodd');
  }
  drawScubaDiver(x, y, direction, pitch, size, elapsed, smooth(t * 12) * smooth((1 - t) * 10));
  ctx.restore();
}

function currentShowcase() {
  if (requestedScene?.startedAt == null || !requestedScene.scene.draw || requestedScene.restoreAt != null) return null;
  const { scene, startedAt, site, depth, direction, seed } = requestedScene;
  const t = animationTime - startedAt;
  const p = clamp(t / scene.duration, 0, 1);
  const frame = { scene, id: scene.id, t, p, site, depth, direction, seed, alpha: smooth(p / .13) * smooth((1 - p) / .13) };
  if (scene.id === 'fishingBoat') frame.fishing = kelpFishingPose(frame, W, H);
  return frame;
}

function drawShowcase(showcase, layer, light = null, surfaces = []) {
  if (!showcase || showcase.scene.layer !== layer || showcase.alpha <= 0) return;
  ctx.save();
  if (layer !== 'overlay') {
    for (const icon of iconOccluders) ctx.clip(icon.path, 'evenodd');
  }
  const lights = showcase.scene.draw(showcase, { ctx, W, H, night: nightAmount, seabed, models, modelWidth, light, surfaces }, layer);
  ctx.restore();
  return lights;
}

function advanceVessels() {
  if (pass && animationTime >= pass.startsAt + pass.duration) {
    nextPassAt = pass.startsAt + pass.duration + P.interval * (.65 + Math.random() * .7);
    setVesselPass(null);
  }
  if (pass) return;
  if ((WALL || DEMO) && animationTime >= nextSceneAt) {
    const eligible = desktopScenes.filter(({ lighting }) =>
      lighting == null || (lighting === 1 ? nightAmount > .82 : nightAmount < .18));
    queueDesktopScene(eligible[Math.floor(Math.random() * eligible.length)]);
    return;
  }
  if (animationTime < nextPassAt) return;
  beginPass();
}

function routePosition(route, progress, width) {
  const endX = route.direction === 1 ? W + width * .9 : -width * .9;
  const blend = route.cinematic && route.landscape === SILT ? smooth((progress - .20) / .80) : smooth(progress);
  const travel = route.cinematic ? progress ** (route.landscape === KELP ? 1.55 : route.landscape === SILT ? 1.38 : 1.77)
    : route.showcase ? progress ** 1.48 : progress;
  const drift = route.cinematic && route.landscape === SILT ? Math.sin(TAU * progress) * .022 : Math.sin(Math.PI * progress) * route.drift;
  return {
    x: lerp(route.start.x * W, endX, travel),
    y: H * clamp(lerp(route.start.y, route.endDepth, blend) + drift, .12, .92),
    depth: lerp(route.far ?? 1, route.near ?? 1, smooth(progress * 1.42))
  };
}

function vesselInteraction() {
  const route = pass;
  const width = route ? modelWidth(models[route.index]) : 0;
  const elapsed = route ? animationTime - route.startsAt : 0;
  const wake = [], fish = [];
  function sampleRoute(sampled, until, baseWidth) {
    if (!sampled || sampled.still || animationTime - until >= 6.5) return;
    const endedAt = Math.min(until, sampled.startsAt + sampled.duration);
    // Anchor samples to the route timeline so their positions do not jump when a pass ends.
    const spacing = .34;
    const lastSample = Math.floor((endedAt - sampled.startsAt) / spacing);
    for (let index = lastSample; index >= 0; index--) {
      const age = animationTime - (sampled.startsAt + index * spacing);
      if (age >= 6.5) break;
      const progress = index * spacing / sampled.duration;
      const point = routePosition(sampled, clamp(progress, 0, 1), baseWidth);
      const widthAtPoint = baseWidth * point.depth;
      const hullX = point.x;
      const x = hullX - sampled.direction * (widthAtPoint * .46 + age * 5);
      const rx = widthAtPoint * .49 + 32 + age * 7, ry = widthAtPoint * .29 + 27 + age * 9;
      const strength = (1 - smooth(age / 6.5)) * smooth(age / .8);
      const sample = { x, y: point.y, hullX, width: widthAtPoint, direction: sampled.direction, age, rx, ry, strength };
      wake.push(sample);
      if (age < 4.4) fish.push(sample);
    }
  }
  sampleRoute(route, animationTime, width);
  if (previousWake) sampleRoute(previousWake.route, previousWake.until, modelWidth(models[previousWake.route.index]));
  return { route, width, elapsed, wake, fish };
}

const stillWater = { x: 0, y: 0, strength: 0 };

function wakeAt(x, y, wake, spread = 1) {
  let total = 0, flowX = 0, flowY = 0;
  let strengthWeight = 0, weightedStrength = 0;
  for (const sample of wake) {
    const offsetX = (x - sample.x) / (sample.rx * spread);
    const offsetY = (y - sample.y) / (sample.ry * spread);
    if (Math.abs(offsetX) >= 1 || Math.abs(offsetY) >= 1) continue;
    const influence = (1 - smooth(Math.hypot(offsetX, offsetY))) * sample.strength;
    if (influence <= 0) continue;
    const weight = influence * influence;
    strengthWeight += weight;
    weightedStrength += weight * influence;
    total += influence;
    const rebound = 1 - 1.55 * smooth((sample.age - 1.8) / 2.6);
    flowX += influence * sample.direction * rebound;
    flowY += influence * (offsetY * 62 + 13 * Math.sin(sample.age * 1.8));
  }
  if (!total) return stillWater;
  // Blend overlapping wake ages before applying their strength; selecting one
  // sample causes sudden reversals as the strongest sample changes.
  const strength = weightedStrength / strengthWeight;
  return {
    x: strength * flowX / total * 91,
    y: strength * flowY / total,
    strength
  };
}

function drawDiveManta(route, elapsed) {
  if (!route?.cinematic || elapsed < 3 || elapsed > 22) return;
  const t = (elapsed - 3) / 19;
  const across = lerp(.97, .12, t);
  const x = W * (route.direction > 0 ? across : 1 - across);
  const y = H * (.33 + Math.sin(t * Math.PI) * .08 - t * .15);
  const opacity = smooth(t * 6) * smooth((1 - t) * 5) * .93;
  const size = clamp(W * .235, 140, 530) * lerp(.72, 1, Math.sin(t * Math.PI));
  const evasion = cursorAvoidance(`manta:${route.startsAt}`, x, y, clamp(size * .38, 100, 157), -1);
  const swimmingX = -route.direction * W * .85 / 19 + evasion.vx;
  const facing = Math.abs(swimmingX) > 18 ? Math.sign(swimmingX) : -route.direction;
  ctx.save();
  ctx.translate(x + evasion.x, y + evasion.y);
  ctx.rotate(facing * clamp(Math.atan2(evasion.vy, Math.abs(swimmingX) + 30), -.48, .48));
  drawMantaRay(0, 0, size, facing, elapsed, opacity);
  ctx.restore();
}

function clipVesselEmergence(route) {
  if (route.emergenceX === undefined) return;
  // Hide gaps behind the launch point even when the foreground silhouette is narrow.
  const edge = clamp(route.emergenceX, 0, 1) * W;
  const visible = new Path2D();
  if (route.direction > 0) visible.rect(edge, 0, W - edge, H);
  else visible.rect(0, 0, edge, H);
  ctx.clip(visible);
}

function drawVesselTrail(route, until = animationTime) {
  if (!route || route.still || animationTime - until > 6.4) return;
  const special = route.cinematic || route.showcase;
  const elapsed = animationTime - route.startsAt;
  const end = Math.min(until - route.startsAt, route.duration);
  const width = modelWidth(models[route.index]);
  const first = special ? 2.4 : .9, spacing = special ? .198 : .38, lifetime = special ? 6.4 : 3.4;
  const firstParticle = Math.max(0, Math.ceil((elapsed - lifetime - first) / spacing));
  const lastParticle = Math.floor((Math.min(elapsed, end) - first) / spacing);
  ctx.save();
  clipVesselEmergence(route);
  if (special) ctx.globalCompositeOperation = 'screen';
  for (let i = firstParticle; i <= lastParticle; i++) {
    const born = first + i * spacing;
    const age = elapsed - born;
    const point = routePosition(route, clamp(born / route.duration, 0, 1), width);
    const spread = special ? 9 + age * 12 : 5 + age * 5;
    const salt = route.seed ?? route.index + Math.floor(route.startsAt);
    const x = point.x - route.direction * (width * point.depth * .46 + age * 10) + (random(i, salt + 1) - .5) * spread;
    const y = point.y + (random(i, salt + 2) - .5) * spread * 1.24 + Math.sin(i + age * .8) * age * 1.8 - (special ? 0 : age * 4);
    const alpha = smooth(age * 4) * (1 - smooth(age / lifetime)) * (.55 + random(i, salt + 3) * .45);
    if (!special) {
      ctx.strokeStyle = '#b7d7df';
      ctx.lineWidth = .8;
      ctx.globalAlpha = alpha * .47;
      ctx.beginPath(); ctx.arc(x, y, .8 + random(i, salt + 4) * 1.35, 0, TAU); ctx.stroke();
      continue;
    }
    const radius = .7 + random(i, salt + 4) * 1.8;
    ctx.fillStyle = '#24cffa';
    ctx.globalAlpha = alpha * .20;
    ctx.beginPath(); ctx.arc(x, y, radius * 3.8, 0, TAU); ctx.fill();
    ctx.fillStyle = i % 5 ? '#8ff5fc' : '#c4faff';
    ctx.globalAlpha = alpha * .86;
    ctx.beginPath(); ctx.arc(x, y, radius, 0, TAU); ctx.fill();
  }
  ctx.restore();
}

function beamShape(nose, length, spread) {
  const end = nose + length;
  const path = new Path2D();
  path.moveTo(nose, -2);
  path.quadraticCurveTo(nose + length * .44, -length * spread * .78, end, -length * spread);
  path.lineTo(end, length * spread);
  path.quadraticCurveTo(nose + length * .44, length * spread * .78, nose, 2);
  path.closePath();
  return path;
}

function drawSpotlight(nose, length, route, elapsed) {
  const end = nose + length;
  const beam = ctx.createLinearGradient(nose, 0, end, 0);
  beam.addColorStop(0, '#ffe7b94b');
  beam.addColorStop(.35, '#e0e8ca21');
  beam.addColorStop(1, '#b7dfed00');
  ctx.fillStyle = beam;
  for (const spread of [.24, .205, .17, .13, .09, .055]) ctx.fill(beamShape(nose, length, spread));
  if (!route.cinematic) return;
  const intensity = ctx.globalAlpha;
  ctx.fillStyle = '#c7f2f7';
  for (let i = 0; i < 34; i++) {
    const distance = (random(i, route.seed + 12) + elapsed * (.024 + random(i, 78) * .014)) % 1;
    const y = (random(i, route.seed + 13) - .5) * distance * length * .3 + Math.sin(elapsed * .43 + i) * 2;
    ctx.globalAlpha = intensity * Math.sin(distance * Math.PI) * (.10 + random(i, 73) * .25);
    ctx.beginPath();
    ctx.arc(nose + distance * length, y, .65 + random(i, 72) * 1.15, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = intensity;
}

function surfaceBeam(x, y, direction, pitch, nose, length, strength, tilt) {
  const transform = new DOMMatrix().translateSelf(x, y).rotateSelf(direction * pitch * 180 / Math.PI)
    .scaleSelf(direction, 1).translateSelf(nose, 0).rotateSelf(tilt * 180 / Math.PI);
  const start = transform.transformPoint({ x: 0, y: 0 });
  const end = transform.transformPoint({ x: length, y: 0 });
  const path = new Path2D();
  path.addPath(beamShape(0, length, .24), transform);
  const pigment = ctx.createLinearGradient(start.x, start.y, end.x, end.y);
  pigment.addColorStop(0, '#fff5cce8');
  pigment.addColorStop(.38, '#ecd99bb3');
  pigment.addColorStop(.72, '#c1dba95e');
  pigment.addColorStop(1, '#a4d0bb00');
  const padding = length * .25;
  return { path, pigment, strength, start, end, length, left: Math.min(start.x, end.x) - padding, right: Math.max(start.x, end.x) + padding,
    top: Math.min(start.y, end.y) - padding, bottom: Math.max(start.y, end.y) + padding };
}

function stopLightAtScenery(light, surfaces) {
  const nearby = surfaces.filter(s => light.right >= s.left && light.left <= s.right && light.bottom >= s.top && light.top <= s.bottom);
  light.visible = light.path;
  light.contacts = new Map();
  if (!nearby.length) return;
  const { start, end, length } = light;
  const dx = (end.x - start.x) / length, dy = (end.y - start.y) / length;
  const sx = cv.width / W, sy = cv.height / H;
  const visible = new Path2D();
  visible.moveTo(start.x, start.y);
  for (let ray = -10; ray <= 10; ray++) {
    const spread = ray * .024;
    const vx = dx - dy * spread, vy = dy + dx * spread;
    let distance = 0, hit;
    for (; distance <= length; distance += 4) {
      const x = start.x + vx * distance, y = start.y + vy * distance;
      hit = nearby.find(s => x >= s.left && x <= s.right && y >= s.top && y <= s.bottom &&
        (!s.plant || clearings.every(path => ctx.isPointInPath(path, x * sx, y * sy, 'evenodd'))) &&
        ctx.isPointInPath(s.path, x * sx, y * sy, s.rule || 'nonzero'));
      if (!hit) continue;
      let patch = light.contacts.get(hit);
      if (!patch) { patch = new Path2D(); light.contacts.set(hit, patch); }
      const radius = 9 + distance * .012;
      patch.moveTo(x + radius, y);
      patch.arc(x, y, radius, 0, TAU);
      break;
    }
    const limit = Math.min(distance, length);
    visible.lineTo(start.x + vx * limit, start.y + vy * limit);
  }
  visible.closePath();
  light.visible = visible;
}

function drawSurfaceLight(light, surfaces) {
  if (!light?.contacts.size) return;
  ctx.save();
  ctx.clip(light.path);
  ctx.globalCompositeOperation = 'screen';
  ctx.fillStyle = light.pigment;
  for (const surface of surfaces) {
    const contact = light.contacts.get(surface);
    if (!contact) continue;
    ctx.save();
    ctx.clip(contact);
    ctx.globalAlpha = light.strength * surface.reflectance * .67;
    ctx.fill(surface.path, surface.rule || 'nonzero');
    if (surface.reef) drawReefRelief(surface.reef, light);
    if (surface.vein) {
      ctx.strokeStyle = light.pigment;
      ctx.lineWidth = 1.1;
      ctx.stroke(surface.vein);
    }
    ctx.restore();
  }
  ctx.restore();
}

function drawVessel(surfaces, wreck) {
  if (!pass) return;
  const model = models[pass.index];
  if (!model.sprite) return;
  const elapsed = animationTime - pass.startsAt;
  const progress = pass.still ? .32 : clamp(elapsed / pass.duration, 0, 1);
  const baseWidth = modelWidth(model);
  const { x, y, depth } = routePosition(pass, progress, baseWidth);
  const width = baseWidth * depth;
  const height = width * model.sprite.height / model.sprite.width;
  const ahead = routePosition(pass, Math.min(1, progress + .015), baseWidth);
  const behind = routePosition(pass, Math.max(0, progress - .015), baseWidth);
  const pitch = clamp(Math.atan2(ahead.y - behind.y, Math.abs(ahead.x - behind.x)), -.32, .32);
  const beamLength = nightAmount <= .01 ? 0 : pass.cinematic ? clamp(baseWidth * 3.9, 190, 480)
    : pass.lure ? clamp(width * 2.8, 130, 330) : clamp(width * 2.25, 105, 250);
  const hullRadius = Math.hypot(width, height) / 2;
  const radius = hullRadius + beamLength;
  ctx.save();
  for (const icon of iconOccluders) {
    if (x + radius >= icon.left && x - radius <= icon.right &&
        y + radius >= icon.top && y - radius <= icon.bottom) ctx.clip(icon.path, 'evenodd');
  }
  for (const { path, left, right, top, bottom } of surfaces) {
    if (x + radius < left || x - radius > right || y + radius < top || y - radius > bottom) continue;
    const cutout = new Path2D();
    cutout.rect(0, 0, W, H);
    cutout.addPath(path);
    ctx.clip(cutout, 'evenodd');
  }
  const visibility = pass.still ? 1 : smooth(pass.cinematic ? (elapsed - .9) / 2.1 : elapsed / 1.8);
  const strength = nightAmount * (pass.cinematic ? smooth(elapsed / 1.25) : visibility);
  const nose = width * .46;
  let tilt = pass.cinematic ? -.08 * (1 - smooth(elapsed / 4)) + .29 * smooth((elapsed - 8) / 8) : 0;
  if (wreck) {
    const distance = ((wreck.left + wreck.right) * .5 - x) * pass.direction;
    const aim = Math.atan2(wreck.bottom - (wreck.bottom - wreck.top) * .27 - y, Math.max(22, distance));
    tilt = lerp(tilt, clamp(aim - pitch, -.15, .86), smooth((distance + 30) / 100));
  }
  if (pass.lure && requestedScene) {
    const distance = (requestedScene.site * W - x) * pass.direction - nose * Math.cos(pitch);
    const deltaY = requestedScene.depth * H - y - nose * Math.sin(pitch);
    const aim = Math.atan2(deltaY, Math.max(35, distance));
    tilt = clamp(aim - pitch, 0, .42);
  }
  const light = beamLength && strength > .01 ? surfaceBeam(x, y, pass.direction, pitch, nose, beamLength, strength, tilt) : null;
  if (light) stopLightAtScenery(light, surfaces);
  if (light) {
    ctx.save();
    ctx.clip(light.visible);
    ctx.globalAlpha = strength;
    ctx.translate(x, y);
    ctx.rotate(pass.direction * pitch);
    ctx.scale(pass.direction, 1);
    ctx.translate(nose, 0);
    ctx.rotate(tilt);
    drawSpotlight(0, beamLength, pass, elapsed);
    ctx.restore();
  }
  if (pass.emergenceX !== undefined && (x - pass.emergenceX * W) * pass.direction < hullRadius) {
    clipVesselEmergence(pass);
  }
  ctx.translate(x, y);
  ctx.rotate(pass.direction * pitch);
  ctx.scale(pass.direction, 1);
  const haze = clamp((1.16 - depth) * .87, 0, .64);
  ctx.globalAlpha = visibility * (1 - haze * .37);
  ctx.drawImage(model.sprite, -width / 2, -height / 2, width, height);
  if (haze > .01 && model.distantSprite) {
    ctx.globalAlpha = visibility * haze;
    ctx.drawImage(model.distantSprite, -width / 2, -height / 2, width, height);
  }
  if (light) {
    ctx.globalAlpha = strength;
    ctx.fillStyle = '#fff3cb';
    ctx.beginPath();
    ctx.arc(nose, 0, Math.max(1.2, width * .016), 0, TAU);
    ctx.fill();
  }
  ctx.restore();
  return light;
}

function drawWreckLight(wreck, light) {
  if (!wreck || !light || light.right < wreck.left || light.left > wreck.right ||
      light.bottom < wreck.top || light.top > wreck.bottom) return;
  ctx.save();
  ctx.clip(light.visible);
  ctx.clip(light.path);
  ctx.globalAlpha = light.strength * .92;
  wreck.draw(ctx, true);
  ctx.restore();
}

function scenerySurfaces(now, wake) {
  const blend = blendAt(now);
  const surfaces = [];
  for (const entry of plants) {
    const plant = blend === 1 ? entry.to : plantAt(entry, blend);
    if (plant.alpha <= .02) continue;
    const root = seabed(plant.x) + 1;
    const reach = Math.abs(plant.lean) + plant.width * (1 + P.current) + 20;
    const localWake = wake.filter(sample => Math.abs(sample.x - plant.x) < reach + sample.rx &&
      sample.y + sample.ry > root - plant.height && sample.y - sample.ry < root);
    const extent = reach + (localWake.length ? 94 : 0);
    surfaces.push({ plant, ...plantOutline(plant, localWake), left: plant.x - extent, right: plant.x + extent,
      top: root - plant.height - 15, bottom: root, reflectance: plant.alpha * .87 });
  }
  for (const entry of formations) {
    const group = formationAt(entry, blend);
    if (P.landscape === REEF) {
      const reef = group.reef || reefPaths(group);
      surfaces.push({ path: reef.shape, reef, left: reef.left - reef.thickness * 2,
        right: reef.right + reef.thickness * 2, top: reef.crown - reef.thickness, bottom: reef.base, reflectance: .73 });
    } else {
      const silt = siltWindow(group, wake);
      surfaces.push({ silt, path: silt.ring(-.25, 1), rule: 'evenodd', left: silt.left, right: silt.right,
        top: silt.top, bottom: silt.bottom, reflectance: .42 });
    }
  }
  return surfaces;
}

function draw(now) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  if (nightAmount < 1) ctx.drawImage(backdrop[0], 0, 0, cv.width, cv.height);
  if (nightAmount > 0) {
    ctx.globalAlpha = nightAmount;
    ctx.drawImage(backdrop[1], 0, 0, cv.width, cv.height);
    ctx.globalAlpha = 1;
  }
  ctx.setTransform(cv.width / W, 0, 0, cv.height / H, 0, 0);
  const showcase = currentShowcase();
  drawShowcase(showcase, 'distant');
  ctx.fillStyle = shade('#1d4650', '#040f1e');
  ctx.fill(floor);
  drawShowcase(showcase, 'bottom');
  const wreck = wreckAt(pass);
  if (wreck) {
    const elapsed = animationTime - pass.startsAt;
    ctx.save();
    ctx.globalAlpha = .32 * smooth(elapsed / 2) * smooth((pass.duration - elapsed) / 2);
    wreck.draw(ctx, false);
    ctx.restore();
  }
  drawBottom();
  if (pass?.cinematic && !pass.wreck) drawDiveManta(pass, animationTime - pass.startsAt);
  if (previousWake) drawVesselTrail(previousWake.route, previousWake.until);
  drawVesselTrail(pass);
  drawRequestedDiver();
  const interaction = vesselInteraction();
  const surfaces = scenerySurfaces(now, interaction.wake);
  drawFish(interaction, showcase?.fishing);
  if (P.wildlife) drawWildlife();
  const light = drawVessel(surfaces, wreck);
  const showcaseLights = drawShowcase(showcase, 'water', light, surfaces);
  drawWreckLight(wreck, light);
  drawBubbles();
  ctx.save();
  for (const path of clearings) ctx.clip(path, 'evenodd');
  for (const { plant, reef, silt, path } of surfaces) {
    if (plant) {
      ctx.globalAlpha = plant.alpha;
      ctx.fillStyle = shade(plant.color, '#284655');
      ctx.fill(path);
    } else if (reef) {
      ctx.fillStyle = shade('#35667d', '#223e56');
      ctx.fill(reef.shape);
      ctx.fillStyle = shade('#27536c', '#182f46');
      ctx.fill(reef.face);
      drawReefRelief(reef);
    } else drawSilt(silt, path);
  }
  drawSurfaceLight(light, surfaces);
  if (showcaseLights) {
    for (const beam of showcaseLights) drawSurfaceLight(beam, surfaces);
  }
  ctx.restore();
  drawShowcase(showcase, 'overlay');
}

function frame(now) {
  requestAnimationFrame(frame);
  if (!window.dynamicDesktopRecording && (paused || !previewMotion)) {
    lastFrame = 0;
    if (PREVIEW && P.lighting === 2 && now >= nextLightCheck && updateLighting(now)) draw(now);
    return;
  }
  const fps = hostDragging ? 10 : 30;
  if (lastFrame && now - lastFrame < 1000 / fps - 2) return;
  animationTime += lastFrame ? Math.min(.1, (now - lastFrame) / 1000) : 0;
  if (animationTime >= nextSteeringCleanup) {
    for (const [id, steering] of animalSteering) if (animationTime - steering.at > 4) animalSteering.delete(id);
    nextSteeringCleanup = animationTime + 3;
  }
  updateLighting(now);
  lastFrame = now;
  if (!advanceRequestedScene()) advanceVessels();
  advanceCrab();
  if (blendAt(now) === 1 && morphStart !== -Infinity) {
    plants = plants.filter(plant => plant.to.alpha > 0);
    morphStart = -Infinity;
  }
  draw(now);
  frameN++;
}

function resize() {
  const box = cv.getBoundingClientRect();
  W = box.width || innerWidth;
  H = box.height || innerHeight;
  cv._scale = PREVIEW ? .45 : devicePixelRatio || 1;
  cv.width = Math.max(1, Math.round(W * cv._scale));
  cv.height = Math.max(1, Math.round(H * cv._scale));
  cacheBackdrop();
  commit(true);
}

function drawIcons() {
  if (!PREVIEW && !DEMO) return;
  const dutch = document.documentElement.lang === 'nl';
  iconLayer.replaceChildren(...icons.map((icon, i) => {
    const node = document.createElement(DEMO ? 'button' : 'div');
    node.className = 'icon';
    node.dataset.index = i;
    if (DEMO) {
      node.type = 'button';
      node.setAttribute('aria-label', (dutch ? 'Voorbeeldicoon ' : 'Sample icon ') + (i + 1));
    }
    moveIconNode(node, icon);
    const glyph = document.createElement('i');
    if (DEMO) glyph.className = i % 2 ? 'file' : 'folder';
    node.append(glyph, document.createElement('b'));
    return node;
  }));
}

function moveIconNode(node, icon) {
  Object.assign(node.style, { left: icon.x + 'px', top: icon.y + 'px', width: icon.w + 'px', height: icon.h + 'px' });
}

function applySettings(values) {
  if (!Number.isFinite(values.submersible) && Number.isInteger(values.vessel)) {
    values = { ...values, submersible: Math.max(0, values.vessel - 1) };
  }
  const limits = { adaptive: [0, 1], seed: [0, Number.MAX_SAFE_INTEGER], landscape: [KELP, SILT], lighting: [0, 2], kelpDensity: [.25, 1],
    current: [0, 1.6], submersible: [0, models.length], interval: [30, 150], fish: [0, 3], wildlife: [0, 1], bubbles: [0, 12] };
  const previousSeed = P.seed;
  let regenerate = false, changeVessel = false, changeLandscape = false, changeLighting = false;
  for (const [key, [low, high]] of Object.entries(limits)) {
    if (!Number.isFinite(values[key])) continue;
    let value = clamp(values[key], low, high);
    if (!['kelpDensity', 'current'].includes(key)) value = Math.round(value);
    if (value === P[key]) continue;
    P[key] = value;
    regenerate ||= ['adaptive', 'seed', 'kelpDensity'].includes(key);
    changeVessel ||= key === 'submersible';
    changeLandscape ||= key === 'landscape';
    changeLighting ||= key === 'lighting';
  }
  if (P.seed !== previousSeed) cacheBackdrop();
  if (changeLighting) updateLighting(performance.now(), true);
  if (changeLandscape || regenerate) commit(changeLandscape);
  if (!requestedScene && pass?.cinematic && (changeLandscape || nightAmount < .4)) {
    setVesselPass(null);
    nextPassAt = animationTime + 2;
  }
  if (!requestedScene && (changeVessel || (changeLandscape && PREVIEW && !previewMotion))) beginPass(PREVIEW && !previewMotion);
}

function handle(message) {
  switch (message.t) {
    case 'settings': applySettings(message.v || {}); break;
    case 'reset': applySettings({ ...DEFAULTS, ...message.v }); break;
    case 'environment':
      DynamicDesktopEnvironment.environment(message.v);
      if (P.lighting === 2) updateLighting(performance.now(), true);
      break;
    case 'previewMotion':
      if (PREVIEW) {
        previewMotion = !!message.v;
        if (!previewMotion && !pass) beginPass(true);
        if (previewMotion && pass?.still) {
          setVesselPass(null);
          nextPassAt = animationTime + 2 + Math.random() * 4;
        }
      }
      break;
    case 'dragging': hostDragging = !!message.v; break;
    case 'pause':
      if (WALL) {
        paused = !!message.v;
        if (paused) { pointWildlife(null, null); wildlifeClick = null; emptyClickTimes.length = 0; }
      }
      break;
    case 'wildlifePointer':
    case 'ripple': {
      if (WALL) {
        const ratio = devicePixelRatio || 1;
        const valid = Number.isFinite(message.x) && Number.isFinite(message.y);
        const x = valid ? message.x / ratio : null, y = valid ? message.y / ratio : null;
        pointWildlife(x, y, message.t === 'ripple');
        if (message.t === 'ripple') countDesktopClick(x, y);
      }
      return;
    }
    case 'icons': {
      const ratio = devicePixelRatio || 1;
      icons = message.vis ? message.r.map(([l, t, r, b]) => ({
        x: l / ratio, y: t / ratio, w: (r - l) / ratio, h: (b - t) / ratio
      })) : [];
      drawIcons();
      commit();
      return;
    }
    default: return;
  }
  if (paused || !previewMotion) draw(performance.now());
}

function loadSprite(model) {
  const image = new Image();
  image.onload = () => {
    // Rasterize a small sprite once and trim transparent padding from its bounds.
    const sample = document.createElement('canvas');
    sample.width = 336;
    sample.height = Math.max(1, Math.round(sample.width * image.naturalHeight / image.naturalWidth));
    const sampleContext = sample.getContext('2d', { willReadFrequently: true });
    sampleContext.drawImage(image, 0, 0, sample.width, sample.height);
    const pixels = sampleContext.getImageData(0, 0, sample.width, sample.height).data;
    let left = sample.width, right = -1, top = sample.height, bottom = -1;
    for (let y = 0; y < sample.height; y++) {
      for (let x = 0; x < sample.width; x++) {
        if (pixels[(y * sample.width + x) * 4 + 3] < 32) continue;
        left = Math.min(left, x); right = Math.max(right, x);
        top = Math.min(top, y); bottom = Math.max(bottom, y);
      }
    }
    if (right < left || bottom < top) return;
    left = Math.max(0, left - 2); right = Math.min(sample.width - 1, right + 2);
    top = Math.max(0, top - 2); bottom = Math.min(sample.height - 1, bottom + 2);
    model.sprite = document.createElement('canvas');
    model.sprite.width = right - left + 1;
    model.sprite.height = bottom - top + 1;
    model.sprite.getContext('2d').drawImage(sample, left, top, model.sprite.width, model.sprite.height, 0, 0, model.sprite.width, model.sprite.height);
    model.distantSprite = document.createElement('canvas');
    model.distantSprite.width = model.sprite.width;
    model.distantSprite.height = model.sprite.height;
    const tint = model.distantSprite.getContext('2d');
    tint.drawImage(model.sprite, 0, 0);
    tint.globalCompositeOperation = 'source-atop';
    tint.fillStyle = '#397d9aba';
    tint.fillRect(0, 0, model.sprite.width, model.sprite.height);
    if (backdrop && (paused || !previewMotion)) draw(performance.now());
  };
  image.src = 'assets/kelp/' + model.id + '.png';
}

function resetDemoIcons() {
  const horizontal = clamp(W * .059, 57, 99), vertical = clamp(H * .112, 66, 109);
  const leftX = clamp(W * .07, 35, 108), rightX = Math.max(leftX + horizontal, W - horizontal * 2 - W * .085);
  icons = [];
  for (const [x, y, rows] of [[leftX, H * .16, 3], [rightX, H * .65, 2]]) {
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < 2; col++) icons.push({
        x: x + col * horizontal, y: y + row * vertical, w: 58, h: 59
      });
    }
  }
  drawIcons();
  commit();
}

function setupDemo() {
  const dutch = (query.get('lang') || navigator.language).toLowerCase().startsWith('nl');
  document.documentElement.lang = dutch ? 'nl' : 'en';
  document.body.classList.add('demo');
  const landscape = document.getElementById('demoLandscape');
  const lighting = document.getElementById('demoLighting');
  const scenePicker = document.getElementById('demoScene');
  const playScene = document.getElementById('playScene');
  if (dutch) {
    landscape.setAttribute('aria-label', 'Landschap');
    landscape.options[1].textContent = 'Rifbogen';
    landscape.options[2].textContent = 'Slibvensters';
    lighting.setAttribute('aria-label', 'Verlichting');
    lighting.options[0].textContent = 'Dag';
    lighting.options[1].textContent = 'Nacht';
    lighting.options[2].textContent = 'Automatisch';
  }
  landscape.addEventListener('change', () => applySettings({ landscape: Number(landscape.value) }));
  lighting.addEventListener('change', () => applySettings({ lighting: Number(lighting.value) }));
  scenePicker.setAttribute('aria-label', dutch ? 'Scène' : 'Scene');
  for (const scene of desktopScenes) scenePicker.add(new Option(dutch ? scene.nl : scene.en, scene.id));
  playScene.textContent = dutch ? 'Speel scène af' : 'Play scene';
  playScene.addEventListener('click', () => queueDesktopScene(desktopScenes[scenePicker.selectedIndex]));
  document.getElementById('nextVessel').textContent = dutch ? 'Volgend vaartuig' : 'Next vessel';
  document.getElementById('resetIcons').textContent = dutch ? 'Herstel iconen' : 'Reset icons';
  document.getElementById('openSettings').textContent = dutch ? 'Instellingen' : 'Settings';
  document.getElementById('demoHint').textContent = dutch
    ? 'Klik vijf keer op lege ruimte voor een verrassingsscène. Sleep iconen met Shift voor een groep.'
    : 'Click empty space five times for a surprise scene. Shift-drag icons to move a group.';
  document.getElementById('modelName').textContent = models[nextModel].name;
  document.getElementById('nextVessel').addEventListener('click', () => { if (!requestedScene) beginPass(); });
  document.getElementById('resetIcons').addEventListener('click', resetDemoIcons);
  document.getElementById('demo').hidden = false;
  resetDemoIcons();
  const scene = query.get('scene');
  const requestedLandscape = query.get('landscape');
  const initialLandscape = scene === 'reef' || requestedLandscape === 'reef' ? REEF : requestedLandscape === 'silt' ? SILT : KELP;
  applySettings({ landscape: initialLandscape });
  landscape.value = String(initialLandscape);
  const initialScene = desktopScenes.find(option => option.id === (scene === 'reef' ? 'night' : scene));
  if (initialScene) {
    scenePicker.value = initialScene.id;
    queueDesktopScene(initialScene);
  }
  switch (scene) {
    case 'crab': beginCrabPass(); break;
    case 'turtle':
    case 'jelly': {
      const showTurtle = scene === 'turtle';
      const firstIsTurtle = random(0, 92) < .5;
      animationTime = (showTurtle === firstIsTurtle ? 0 : 105) + (showTurtle ? 11 : 8);
      nextPassAt = animationTime + 5;
      break;
    }
  }

  let drag, pending = 0;
  iconLayer.addEventListener('pointerdown', event => {
    const node = event.target.closest('.icon');
    if (!node || event.button !== 0 || drag) return;
    const icon = icons[Number(node.dataset.index)];
    const group = event.shiftKey ? clusters.find(candidate => candidate.members.includes(icon)) : null;
    const selected = (group?.members || [icon]).map(item => ({
      icon: item, node: iconLayer.children[icons.indexOf(item)], x: item.x, y: item.y
    }));
    drag = { pointer: event.pointerId, x: event.clientX, y: event.clientY, selected };
    node.setPointerCapture(event.pointerId);
  });
  iconLayer.addEventListener('pointermove', event => {
    if (drag?.pointer !== event.pointerId) return;
    const dx = clamp(event.clientX - drag.x, -Math.min(...drag.selected.map(item => item.x)),
      W - Math.max(...drag.selected.map(item => item.x + item.icon.w)));
    const dy = clamp(event.clientY - drag.y, -Math.min(...drag.selected.map(item => item.y)),
      H - Math.max(...drag.selected.map(item => item.y + item.icon.h)));
    for (const item of drag.selected) {
      item.icon.x = item.x + dx;
      item.icon.y = item.y + dy;
      moveIconNode(item.node, item.icon);
    }
    if (!pending) pending = requestAnimationFrame(() => {
      pending = 0;
      commit();
    });
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    iconLayer.addEventListener(type, event => {
      if (drag?.pointer === event.pointerId) drag = null;
    });
  }
}

resize();
if (DEMO) setupDemo();
if (!WALL) {
  const pointer = (event, clicked) => {
    const controls = event.target.closest('#demo');
    if (controls) pointWildlife(null, null);
    else pointWildlife(event.clientX, event.clientY, clicked);
    if (DEMO && clicked) countDesktopClick(controls ? null : event.clientX, controls ? null : event.clientY);
  };
  addEventListener('pointermove', event => pointer(event, false));
  addEventListener('pointerdown', event => { if (event.button === 0) pointer(event, true); });
  document.documentElement.addEventListener('pointerleave', () => pointWildlife(null, null));
  addEventListener('blur', () => pointWildlife(null, null));
}
if (PREVIEW && !previewMotion) beginPass(true);
draw(performance.now());
models.forEach(loadSprite);
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
