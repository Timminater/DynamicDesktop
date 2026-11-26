// Fourth-wall events: the screen is the aquarium glass and a mantis shrimp strikes it.
// 'glassCrack' ends when a diver tapes over the crack; 'glassBreak' ends with the glass shattering.
// The crack network is built once per run and cached at the canvas's physical size. Drips, spray,
// splinters, shards and foam are small moving objects drawn over it. Coordinates are logical pixels.
const KelpGlass = (() => {
  'use strict';
  const TAU = Math.PI * 2;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const smooth = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOut = x => 1 - (1 - clamp(x, 0, 1)) ** 3;
  const hash = (i, k) => { const v = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return v - Math.floor(v); };

  // Timeline in seconds after the scene starts.
  const STRIKES = [2.9, 4.5];
  const RAMP = .14;                       // A burst of cracking runs out over this time.
  const BREAK = 18.8;
  const JETS = [12.6, 14.1, 15.3, 16.3, 17.2, 17.9];
  const TAPE = [[12, 13], [13.35, 14.35], [14.7, 15.35]];
  const LEAK_STOP = TAPE[2][1];
  const DIVER_IN = 9.4, DIVER_OUT = [15.65, 19.9];
  const LAST_TICK = 21.6;
  const FADE = [25.4, 27.8];
  let state = null;

  // Peacock mantis shrimp colors; night mixes them toward deep water.
  const PALETTE = {
    bodyLight: '#86e0a2', body: '#2f9d6d', bodyDark: '#1b5f4a', seam: '#15463a', rim: '#2f77d0',
    spot: '#f3d34e', spotRing: '#1d5d45', spot2: '#f08b3c', shine: '#c6f7d4', outline: '#0a2a25',
    uropod: '#2c6fd2', uropodEdge: '#f2873c', leg: '#ef5b3d', legDark: '#a23a2c', pleopod: '#f27b47',
    arm: '#f0603e', armLight: '#ffb682', armDark: '#b33f2d', club: '#ff7646', clubTip: '#ffe3b6',
    stalk: '#3f9f74', eye: '#47c9bb', eyeTop: '#a2f5e4', eyeBottom: '#24828a', band: '#173846', bandLight: '#7ae6d8',
    antenna: '#f6a46c', scale: '#f28245', scaleEdge: '#3c82d6',
    tapeLight: '#cdd5d8', tape: '#adb8bc', tapeDark: '#8a979d', roll: '#76848b', rollCore: '#b59b6b', rollHole: '#1d2c35'
  };
  const DEPTH = [10, 32, 52];
  const parsed = new Map();
  function color(hex, night = 0, alpha = 1) {
    let rgb = parsed.get(hex);
    if (!rgb) {
      const n = parseInt(hex.slice(1), 16);
      rgb = [n >> 16, n >> 8 & 255, n & 255];
      parsed.set(hex, rgb);
    }
    const k = night * .58;
    return `rgba(${Math.round(lerp(rgb[0], DEPTH[0], k))},${Math.round(lerp(rgb[1], DEPTH[1], k))},` +
      `${Math.round(lerp(rgb[2], DEPTH[2], k))},${alpha})`;
  }

  function generator(seed) {
    let a = Math.imul(seed | 0, 2654435761) >>> 0 || 1;
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Crack bursts: each sets a new crack extent and shakes the glass.
  const timelines = new Map();
  function timeline(id) {
    let events = timelines.get(id);
    if (events) return events;
    events = [{ at: STRIKES[0], level: .2, jolt: 3.4 }, { at: STRIKES[1], level: .34, jolt: 3.9 }];
    if (id === 'glassBreak') {
      for (let at = 6.3, gap = 1.35; at < BREAK - .25; at += gap, gap = Math.max(.27, gap * .85)) {
        const progress = (at - 6.3) / (BREAK - 6.55);
        events.push({ at, level: .37 + .58 * progress ** 1.45, jolt: .7 + 1.9 * progress });
      }
      events.push({ at: BREAK, level: 1, jolt: 9 });
    } else {
      for (const [at, level] of [[6.3, .38], [7.7, .42], [9.2, .45], [10.7, .48], [11.5, .5], [LAST_TICK, .545]])
        events.push({ at, level, jolt: at === LAST_TICK ? 1.4 : .9 });
    }
    timelines.set(id, events);
    return events;
  }

  function levelAt(events, t) {
    let level = 0;
    for (const event of events) {
      if (t < event.at) break;
      level = lerp(level, event.level, smooth((t - event.at) / RAMP));
    }
    return level;
  }

  const calm = matchMedia('(prefers-reduced-motion: reduce)');
  function jolt(frame) {
    if (!frame || (frame.id !== 'glassCrack' && frame.id !== 'glassBreak') || calm.matches) return null;
    const { t } = frame;
    let x = 0, y = 0;
    for (const event of timeline(frame.id)) {
      const age = t - event.at;
      if (age < 0) break;
      if (age > .6) continue;
      const amount = event.jolt * Math.exp(-age * 10);
      x += amount * Math.sin(age * 92 + event.at * 7);
      y += amount * Math.cos(age * 77 + event.at * 3) * .75;
    }
    if (frame.id === 'glassBreak' && t > 15.6 && t < BREAK) {
      // The glass groans under the load just before it fails.
      const rumble = smooth((t - 15.6) / 3) * .9;
      x += rumble * Math.sin(t * 71);
      y += rumble * Math.cos(t * 59) * .7;
    }
    return x || y ? { x, y } : null;
  }

  function impactSite(view, random) {
    const { W, H, icons = [] } = view;
    const candidates = [[.5, .45], [.43, .4], [.57, .52], [.37, .5], [.63, .42], [.5, .58], [.31, .42], [.69, .55]];
    const clearance = Math.min(W, H) * .2;
    let best = candidates[0], bestScore = -Infinity;
    for (const [fx, fy] of candidates) {
      const x = W * fx, y = H * fy;
      let nearest = Infinity;
      for (const icon of icons) {
        const dx = Math.max(icon.x - x, 0, x - icon.x - icon.w);
        const dy = Math.max(icon.y - y, 0, y - icon.y - icon.h);
        nearest = Math.min(nearest, Math.hypot(dx, dy));
      }
      const score = Math.min(nearest, clearance) - Math.hypot(fx - .5, fy - .47) * W * .3 + random() * 12;
      if (score > bestScore) {
        bestScore = score;
        best = [fx, fy];
      }
    }
    return { x: W * best[0], y: H * best[1] };
  }

  // Radial cracks run from the impact and partial concentric cracks join some of them.
  // The full set of edges bounds the cells that become shards when the glass fails.
  function buildCracks(W, H, impact, random) {
    const corners = [[0, 0], [W, 0], [0, H], [W, H]];
    const reach = Math.max(...corners.map(([x, y]) => Math.hypot(x - impact.x, y - impact.y))) * 1.08;
    const unit = clamp(Math.min(W, H) / 1080, .6, 2.2);
    const radii = [0];
    for (let r = Math.hypot(W, H) * .03; ; r *= 1.5 + random() * .18) {
      if (r >= reach * .93) { radii.push(reach); break; }
      radii.push(r);
    }
    const rings = radii.length - 1;
    const count = 8 + Math.floor(random() * 4);
    const step = TAU / count, turn = random() * TAU;
    const spokes = [], speeds = [], bands = [], sides = [];
    for (let i = 0; i < count; i++) {
      const base = turn + (i + (random() - .5) * .7) * step;
      const points = [impact];
      let wander = 0;
      for (let k = 1; k <= rings; k++) {
        wander = clamp(wander + (random() - .5) * .1, -.1 * step, .1 * step);
        const r = k < rings ? radii[k] * (1 + (random() - .5) * .36) : radii[k];
        points.push({ x: impact.x + Math.cos(base + wander) * r, y: impact.y + Math.sin(base + wander) * r });
      }
      spokes.push(points);
      // Some cracks hold back and only run once the glass is close to failing.
      speeds.push(random() < .3 ? 1.25 + random() * .5 : .72 + random() * .38);
      bands.push(.45 + random() * .75);
      sides.push(random() < .5 ? -1 : 1);
    }
    function jagged(a, b, pieces, roughness, sag = 0, kink = 0) {
      const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy) || 1;
      const nx = -dy / length, ny = dx / length;
      const bent = kink && random() < .45 ? 1 + Math.floor(random() * (pieces - 1)) : -1;
      const points = [a];
      for (let j = 1; j < pieces; j++) {
        const f = (j + (random() - .5) * .45) / pieces;
        const offset = ((random() - .5) * roughness + (j === bent ? (random() - .5) * kink : 0)) * length;
        let x = a.x + dx * f + nx * offset, y = a.y + dy * f + ny * offset;
        if (sag) {
          const bow = Math.sin(f * Math.PI) * sag * length;
          const ix = impact.x - x, iy = impact.y - y, d = Math.hypot(ix, iy) || 1;
          x += ix / d * bow;
          y += iy / d * bow;
        }
        points.push({ x, y });
      }
      points.push(b);
      return points;
    }
    const level = d => clamp(d / reach, 0, 1) ** .78;
    const distance = p => Math.hypot(p.x - impact.x, p.y - impact.y);
    const pieces = (a, b, size) => clamp(Math.round(Math.hypot(b.x - a.x, b.y - a.y) / size), 2, 9);
    // The fracture face shows as a ribbon that narrows away from the impact.
    const ribbon = d => 4.8 * unit * (1 - smooth(d / (reach * .5)));
    const segments = [], marks = [], cells = [];
    const radial = spokes.map(() => []), ring = [];
    function crack(a, b, side, props) {
      const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy) || 1;
      segments.push({ a, b, nx: -dy / length * side, ny: dx / length * side, bandA: 0, bandB: 0, glow: 0, bright: .7, ...props });
    }

    for (let i = 0; i < count; i++) {
      for (let k = 0; k < rings; k++) {
        const a = spokes[i][k], b = spokes[i][k + 1];
        const points = jagged(a, b, pieces(a, b, 52), .03, 0, .1);
        radial[i].push(points);
        const side = random() < .22 ? -sides[i] : sides[i];
        for (let j = 1; j < points.length; j++) {
          const da = distance(points[j - 1]), db = distance(points[j]);
          crack(points[j - 1], points[j], side, { threshold: level(db) * speeds[i], width: lerp(1.4, .55, smooth(db / reach * 1.5)),
            bandA: ribbon(da) * bands[i], bandB: ribbon(db) * bands[i], glow: .1 + random() * .22, bright: .55 + random() * .4 });
        }
        // Cracks fork now and then into a long, shallow branch.
        for (let branch = 0; k > 0 && branch < 2 && random() < (branch ? .15 : .38); branch++) {
          const from = points[1 + Math.floor(random() * (points.length - 2))];
          const angle = Math.atan2(b.y - a.y, b.x - a.x) + (random() < .5 ? -1 : 1) * (.2 + random() * .25);
          const length = (radii[k + 1] - radii[k]) * (.35 + random() * .45);
          const end = { x: from.x + Math.cos(angle) * length, y: from.y + Math.sin(angle) * length };
          const twig = jagged(from, end, 2 + Math.floor(random() * 2), .05);
          const start = level(distance(from)) * speeds[i] + .02 + random() * .05;
          for (let j = 1; j < twig.length; j++)
            crack(twig[j - 1], twig[j], 1, { threshold: start + j * .02, width: .5, bright: .4 + random() * .3, branch: true });
        }
      }
    }
    const visible = [0, .9, .75, .5, .32, .2, .12, .08, .05];
    for (let k = 1; k <= rings; k++) {
      ring[k] = [];
      for (let i = 0; i < count; i++) {
        const a = spokes[i][k], b = spokes[(i + 1) % count][k];
        const sag = (random() < .75 ? 1 : -1) * (.02 + random() * .06);
        const points = jagged(a, b, pieces(a, b, 34), .06, sag);
        ring[k].push(points);
        // Concentric cracks rarely close; the rest only appears when the glass gives way.
        const shown = random() < (visible[k] ?? .04);
        let from = random() < .5 ? 0 : random() * .3, to = random() < .5 ? 1 : .65 + random() * .35;
        if (from > 0 && to < 1) {
          if (random() < .5) from = 0; else to = 1;
        }
        // Each arc grows out of a radial crack, so it can only start once that crack has arrived.
        const startA = from === 0, reachA = level(distance(a)) * speeds[i], reachB = level(distance(b)) * speeds[(i + 1) % count];
        const base = Math.max(level(radii[k]) * 1.05, startA ? reachA : reachB) + .035 + random() * .09;
        const side = random() < .5 ? -1 : 1, band = k <= 2 ? 1.8 * unit * random() * (1 - k / 4) : 0;
        for (let j = 1; j < points.length; j++) {
          const middle = (j - .5) / (points.length - 1);
          const early = shown && middle >= from && middle <= to;
          const order = startA ? j : points.length - j;
          crack(points[j - 1], points[j], side, { threshold: early ? base + order * .006 : 1.02 + random() * .04,
            width: lerp(1, .55, k / rings), bandA: band, bandB: band, glow: .06 + random() * .12, bright: .5 + random() * .35 });
        }
      }
    }
    // A Hertzian cone crack rings the crushed point of impact.
    const cone = radii[1] * (.3 + random() * .08);
    const loop = Array.from({ length: 18 }, (_, n) => {
      const angle = n / 18 * TAU, r = cone * (1 + (random() - .5) * .25);
      return { x: impact.x + Math.cos(angle) * r, y: impact.y + Math.sin(angle) * r };
    });
    loop.forEach((point, n) => crack(point, loop[(n + 1) % loop.length], -1, { threshold: .006 + random() * .01,
      width: .85, bandA: 1.4 * unit, bandB: 1.4 * unit, glow: .18, bright: .8, branch: true }));
    for (let n = 0; n < 30; n++) {
      const angle = random() * TAU, length = cone * (.3 + random() * 1.4);
      const twig = jagged(impact, { x: impact.x + Math.cos(angle) * length, y: impact.y + Math.sin(angle) * length }, 2, .25);
      const start = n < 16 ? .005 + random() * .02 : .215 + random() * .04;
      for (let j = 1; j < twig.length; j++)
        crack(twig[j - 1], twig[j], 1, { threshold: start, width: .45 + random() * .35, bright: .6 + random() * .35, branch: true });
    }
    marks.push({ threshold: .004, frost: cone * 1.15 });
    marks.push({ threshold: .004, specks: Array.from({ length: 46 }, () => {
      const angle = random() * TAU, r = cone * Math.sqrt(random()) * 1.05;
      return [impact.x + Math.cos(angle) * r, impact.y + Math.sin(angle) * r, (.35 + random() * .8) * unit, .45 + random() * .5];
    }) });

    for (let k = 0; k < rings; k++) {
      for (let i = 0; i < count; i++) {
        const next = (i + 1) % count;
        const points = radial[i][k].slice();
        points.push(...ring[k + 1][i].slice(1));
        points.push(...radial[next][k].slice().reverse().slice(1));
        if (k > 0) points.push(...ring[k][i].slice().reverse().slice(1, -1));
        cells.push(points);
        // Broken facets near the impact catch the light at slightly different angles.
        if (k === 0) marks.push({ threshold: random() < .5 ? .01 + random() * .02 : .2 + random() * .15,
          points, alpha: .02 + random() * .07 });
        else if (k === 1 && random() < .4) marks.push({ threshold: .3 + random() * .12, points, alpha: .012 + random() * .035 });
      }
    }
    segments.sort((a, b) => a.threshold - b.threshold);
    marks.sort((a, b) => a.threshold - b.threshold);
    return { reach, radii, segments, marks, cells };
  }

  function buildTape(state, random) {
    const { impact, reach, H } = state;
    const width = clamp(H * .048, 30, 60);
    const long = clamp(reach * .52, 230, 560);
    const direction = -state.facing;
    const specs = [[-.62 + random() * .22, long], [.58 + random() * .22, long * .94], [(random() - .5) * .18, long * .62]];
    const torn = () => Array.from({ length: 8 }, (_, n) => [(n % 2 ? 1 : -1) * width * (.03 + random() * .06), n / 7]);
    return specs.map(([angle, length], j) => {
      let cos = Math.cos(angle), sin = Math.sin(angle);
      // The diver swims forward while unrolling each strip.
      if (cos * direction < 0) { cos = -cos; sin = -sin; }
      const cx = impact.x + (random() - .5) * width * .6;
      const cy = impact.y + (j === 2 ? width * (.35 + random() * .5) : (random() - .5) * width * .5);
      return {
        ax: cx - cos * length / 2, ay: cy - sin * length / 2, bx: cx + cos * length / 2, by: cy + sin * length / 2,
        angle: Math.atan2(sin, cos), length, width, start: TAPE[j][0], end: TAPE[j][1], head: torn(), tail: torn(),
        wrinkles: Array.from({ length: 6 }, () => [.08 + random() * .84, random() - .5, random()])
      };
    });
  }

  function build(frame, view) {
    const { W, H } = view;
    const seed = (frame.seed | 0) + (frame.id === 'glassBreak' ? 7919 : 0);
    const random = generator(seed);
    const impact = impactSite(view, random);
    const events = timeline(frame.id);
    const state = {
      key: frame.id + ':' + frame.seed, id: frame.id, taped: frame.id === 'glassCrack', W, H, seed, impact,
      facing: frame.direction < 0 ? -1 : 1, events, ...buildCracks(W, H, impact, random),
      unit: clamp(Math.min(W, H) / 1080, .6, 2.2),
      shrimpSize: clamp(Math.min(W, H) * .36, 170, 430), diverSize: clamp(Math.min(W, H) * .44, 200, 470),
      revealed: 0, marksRevealed: 0, drawn: 0, marksDrawn: 0, cache: null, nodes: [], fresh: [],
      drips: [], spray: [], chips: [], splashes: [], jets: [], pool: 0, leak: 0,
      eventIndex: events.findIndex(event => event.at > frame.t), jetIndex: JETS.findIndex(at => at > frame.t),
      lastDripAt: Infinity, coverJet: false, shards: null, lastT: frame.t
    };
    if (state.eventIndex < 0) state.eventIndex = events.length;
    if (state.jetIndex < 0) state.jetIndex = JETS.length;
    if (state.taped) state.tape = buildTape(state, random);
    return state;
  }

  // ---- Mantis shrimp ----------------------------------------------------------------------
  const SHOULDER = { x: .28, y: .045 }, MERUS = .13, CLUB = .19;
  const FOLD = [1.95, -.5], EXTEND = [.36, -.12];
  function clubJoint(club) {
    const merus = lerp(FOLD[0], EXTEND[0], club), arm = lerp(FOLD[1], EXTEND[1], club);
    const ex = SHOULDER.x + Math.cos(merus) * MERUS, ey = SHOULDER.y + Math.sin(merus) * MERUS;
    return { ex, ey, arm, tx: ex + Math.cos(arm) * CLUB, ty: ey + Math.sin(arm) * CLUB };
  }

  // The club cocks back, snaps out in a few hundredths of a second and folds away again.
  function strikeMotion(t) {
    let club = 0, back = .07, streak = 0;
    for (const at of STRIKES) {
      const u = t - at;
      if (u < -.55 || u > .75) continue;
      if (u < -.05) {
        const k = smooth((u + .55) / .45);
        club = -.25 * k;
        back = .07 + .03 * k;
      } else if (u < 0) {
        const k = (u + .05) / .05;
        club = lerp(-.25, 1, k * k);
        back = lerp(.1, 0, k);
        streak = 1;
      } else if (u < .13) {
        club = 1;
        back = 0;
        streak = 1 - u / .13;
      } else {
        const k = (u - .13) / .62;
        club = 1 - smooth(k / .7);
        back = lerp(0, .07, easeOut(k)) + .06 * Math.sin(Math.PI * clamp(k * 1.4, 0, 1));
      }
    }
    return { club, back, streak };
  }

  function shrimpPose(state, view, t) {
    if (t > 8.9) return null;
    const { impact, facing } = state;
    const { W, H } = view;
    const arrive = 2.55;
    let s = state.shrimpSize * lerp(.5, 1, easeOut(t / 2.75));
    const { club, back, streak } = strikeMotion(t);
    const reach = clubJoint(1);
    // Hover where the fully extended club just reaches the glass at the impact point.
    const anchorX = impact.x - facing * (reach.tx + back) * s, anchorY = impact.y - reach.ty * s;
    const startX = facing > 0 ? -s * .55 : W + s * .55, startY = impact.y + H * .16;
    const k = smooth(t / arrive);
    const hover = smooth((t - arrive + .3) / .6);
    let x = lerp(startX, anchorX, k);
    let y = lerp(startY, anchorY, k) + Math.sin(t * 3.4) * s * .012 * (1 - hover) + Math.sin(t * 1.9) * s * .004 * hover;
    let turn = 1, alpha = 1, flutter = lerp(1, .45, hover), pitch = (1 - k) * -.12;
    if (t > 4.95) {
      const flip = smooth((t - 4.95) / .42);
      const leave = smooth((t - 5.2) / 3.5);
      turn = Math.cos(flip * Math.PI);
      x -= facing * s * 2.2 * leave ** 1.25;
      y += H * .2 * leave;
      s *= lerp(1, .4, leave);
      pitch = leave * .18 * (1 - leave);
      alpha = 1 - smooth((t - 7.6) / 1.2);
      flutter = 1;
    }
    return { x, y, s, facing: facing * turn, club, streak, alpha, flutter, pitch };
  }

  function drawShrimp(ctx, pose, t, night) {
    const { x, y, s, facing, club, streak, alpha, flutter, pitch } = pose;
    if (alpha <= 0 || Math.abs(facing) < .015) return;
    const c = (name, a = 1) => color(PALETTE[name], night, a);
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.translate(x, y);
    ctx.scale(facing * s, s);
    ctx.rotate(pitch);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const body = ctx.createLinearGradient(0, -.12, 0, .09);
    body.addColorStop(0, c('bodyLight'));
    body.addColorStop(.42, c('body'));
    body.addColorStop(1, c('bodyDark'));
    const segmentX = i => -.03 - i * .078;
    const segmentHeight = i => .158 - i * .01;
    const bend = i => i * i * .0022 + Math.sin(t * 4 - i * .7) * .006 * flutter;

    // Slender walking legs with a knee joint and a small claw at the tip.
    function leg(x0, phase, tint, width) {
      const swing = Math.sin(t * 6 + phase) * .016 * flutter;
      const kneeX = x0 - .014 + swing, kneeY = .104, footX = x0 + .018 + swing * 1.5, footY = .156;
      ctx.strokeStyle = tint;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(x0, .048);
      ctx.quadraticCurveTo(x0 - .012 + swing * .5, .078, kneeX, kneeY);
      ctx.quadraticCurveTo(kneeX + .02, .128, footX, footY);
      ctx.stroke();
      ctx.lineWidth = width * .6;
      ctx.beginPath();
      ctx.moveTo(footX, footY);
      ctx.lineTo(footX + .012, footY + .006);
      ctx.stroke();
      ctx.fillStyle = tint;
      ctx.beginPath();
      ctx.arc(kneeX, kneeY, width * .62, 0, TAU);
      ctx.fill();
    }

    function pleopods(tint, width, offset) {
      ctx.strokeStyle = tint;
      ctx.lineWidth = width;
      for (let i = 0; i < 5; i++) {
        const sx = segmentX(i) + offset, bottom = segmentHeight(i) * .42 + bend(i);
        const beat = Math.sin(t * 15 * flutter - i * .9) * .022 * flutter;
        ctx.beginPath();
        ctx.moveTo(sx, bottom);
        ctx.quadraticCurveTo(sx - .015, bottom + .03, sx - .04 + beat, bottom + .052);
        ctx.stroke();
      }
    }
    function uropod(side) {
      const tail = segmentX(5) - .05, lift = bend(5) + .005;
      ctx.save();
      ctx.translate(tail, lift);
      ctx.rotate(side * (.55 + Math.sin(t * 5) * .1 * flutter));
      ctx.fillStyle = c('uropod');
      ctx.strokeStyle = c('uropodEdge');
      ctx.lineWidth = .009;
      ctx.beginPath();
      ctx.ellipse(-.075, 0, .085, .028, 0, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = c('spot2');
      ctx.beginPath();
      ctx.arc(-.1, 0, .011, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    // A smasher's raptorial limb: the merus, then the propodus with the dactyl folded beneath
    // it. The swollen heel of the dactyl is the hammer that hits the glass.
    function raptorial(amount, near) {
      const joint = clubJoint(amount);
      const tint = near ? c('arm') : c('armDark');
      const dx = joint.ex - SHOULDER.x, dy = joint.ey - SHOULDER.y, length = Math.hypot(dx, dy);
      ctx.save();
      ctx.translate(SHOULDER.x, SHOULDER.y);
      ctx.rotate(Math.atan2(dy, dx));
      ctx.fillStyle = tint;
      ctx.beginPath();
      ctx.moveTo(0, -.018);
      ctx.quadraticCurveTo(length * .5, -.036, length, -.026);
      ctx.lineTo(length, .026);
      ctx.quadraticCurveTo(length * .5, .03, 0, .018);
      ctx.closePath();
      ctx.fill();
      if (near) {
        ctx.strokeStyle = c('armLight', .8);
        ctx.lineWidth = .009;
        ctx.beginPath();
        ctx.moveTo(.012, -.012);
        ctx.quadraticCurveTo(length * .5, -.026, length - .012, -.018);
        ctx.stroke();
      }
      ctx.restore();

      ctx.save();
      ctx.translate(joint.ex, joint.ey);
      ctx.rotate(joint.arm);
      ctx.strokeStyle = near ? c('armLight') : c('legDark');
      ctx.lineWidth = .015;
      ctx.beginPath();
      ctx.moveTo(CLUB * .96, .022);
      ctx.quadraticCurveTo(CLUB * .55, .052, CLUB * .1, .032);
      ctx.stroke();
      ctx.fillStyle = tint;
      ctx.beginPath();
      ctx.ellipse(CLUB * .47, -.004, CLUB * .5, .033, 0, 0, TAU);
      ctx.fill();
      if (near) {
        ctx.strokeStyle = c('outline', .4);
        ctx.lineWidth = .006;
        ctx.stroke();
        ctx.strokeStyle = c('armLight', .85);
        ctx.lineWidth = .008;
        ctx.beginPath();
        ctx.moveTo(.025, -.022);
        ctx.quadraticCurveTo(CLUB * .5, -.038, CLUB * .86, -.022);
        ctx.stroke();
        ctx.fillStyle = c('spot', .9);
        ctx.beginPath();
        for (const [px, r] of [[.05, .0065], [.085, .0058], [.118, .005]]) {
          ctx.moveTo(px + r, -.011);
          ctx.arc(px, -.011, r, 0, TAU);
        }
        ctx.fill();
      }
      const hammer = ctx.createRadialGradient(CLUB - .012, -.01, .003, CLUB, .004, .04);
      hammer.addColorStop(0, near ? c('clubTip') : c('armDark'));
      hammer.addColorStop(.55, near ? c('clubTip', .92) : c('armDark'));
      hammer.addColorStop(1, near ? c('club') : c('legDark'));
      ctx.fillStyle = hammer;
      ctx.beginPath();
      ctx.ellipse(CLUB, .004, .036, .033, 0, 0, TAU);
      ctx.fill();
      if (near) {
        ctx.strokeStyle = c('outline', .45);
        ctx.lineWidth = .006;
        ctx.stroke();
      }
      ctx.restore();
      ctx.fillStyle = near ? c('armDark') : c('legDark');
      ctx.beginPath();
      ctx.arc(joint.ex, joint.ey, .024, 0, TAU);
      ctx.fill();
    }

    function eye(baseX, baseY, topX, topY, angle, scale, dim) {
      ctx.strokeStyle = c('stalk');
      ctx.lineWidth = .026 * scale;
      ctx.beginPath();
      ctx.moveTo(baseX, baseY);
      ctx.quadraticCurveTo(baseX + .016, (baseY + topY) / 2, topX, topY);
      ctx.stroke();
      ctx.save();
      ctx.translate(topX, topY - .012 * scale);
      ctx.rotate(angle);
      ctx.scale(scale, scale);
      const iris = ctx.createLinearGradient(0, -.036, 0, .036);
      iris.addColorStop(0, c('eyeTop'));
      iris.addColorStop(.5, c('eye'));
      iris.addColorStop(1, c('eyeBottom'));
      ctx.fillStyle = iris;
      ctx.beginPath();
      ctx.ellipse(0, 0, .05, .036, 0, 0, TAU);
      ctx.fill();
      // The midband splits each eye in two, with a dark pseudopupil in each half.
      ctx.fillStyle = c('band');
      ctx.beginPath();
      ctx.ellipse(0, 0, .05, .0095, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = c('bandLight', .8);
      ctx.lineWidth = .003;
      ctx.beginPath();
      ctx.moveTo(-.043, -.0035);
      ctx.lineTo(.043, -.0035);
      ctx.moveTo(-.043, .0035);
      ctx.lineTo(.043, .0035);
      ctx.stroke();
      ctx.fillStyle = 'rgba(5, 20, 26, .85)';
      ctx.beginPath();
      ctx.arc(.013, -.018, .0085, 0, TAU);
      ctx.arc(.013, .018, .0085, 0, TAU);
      ctx.fill();
      ctx.fillStyle = `rgba(255, 255, 255, ${.8 * dim})`;
      ctx.beginPath();
      ctx.arc(-.02, -.019, .007, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = c('outline', .4);
      ctx.lineWidth = .005;
      ctx.beginPath();
      ctx.ellipse(0, 0, .05, .036, 0, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }

    // Far-side limbs sit behind the body.
    for (const [x0, phase] of [[.075, 1.3], [.135, 2.6], [.195, 3.9]]) leg(x0 + .014, phase, c('legDark'), .012);
    pleopods(c('legDark'), .016, .014);
    raptorial(club * .92 - .04, false);
    uropod(-1);

    // Abdomen segments, from the tail forward so each overlaps the one behind it.
    const tail = segmentX(5) - .05, tailLift = bend(5);
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(tail + .012, tailLift - .052);
    ctx.quadraticCurveTo(tail - .09, tailLift - .04, tail - .125, tailLift + .006);
    ctx.quadraticCurveTo(tail - .09, tailLift + .05, tail + .012, tailLift + .054);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = c('outline', .45);
    ctx.lineWidth = .008;
    ctx.stroke();
    ctx.strokeStyle = c('seam');
    ctx.lineWidth = .006;
    ctx.beginPath();
    ctx.moveTo(tail - .01, tailLift + .004);
    ctx.lineTo(tail - .1, tailLift + .005);
    ctx.stroke();
    for (let i = 5; i >= 0; i--) {
      const sx = segmentX(i), h = segmentHeight(i), lift = bend(i);
      const top = -h * .55 + lift, bottom = h * .45 + lift;
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.roundRect(sx - .05, top, .098, bottom - top, [.03, .045, .02, .02]);
      ctx.fill();
      ctx.strokeStyle = c('outline', .38);
      ctx.lineWidth = .007;
      ctx.stroke();
      ctx.strokeStyle = c('seam');
      ctx.lineWidth = .007;
      ctx.beginPath();
      ctx.moveTo(sx - .046, top + .012);
      ctx.quadraticCurveTo(sx - .038, (top + bottom) / 2, sx - .046, bottom - .012);
      ctx.stroke();
      ctx.strokeStyle = c('rim');
      ctx.lineWidth = .011;
      ctx.beginPath();
      ctx.moveTo(sx - .042, bottom - .007);
      ctx.lineTo(sx + .042, bottom - .007);
      ctx.stroke();
      ctx.strokeStyle = c('shine', .55);
      ctx.lineWidth = .009;
      ctx.beginPath();
      ctx.moveTo(sx - .03, top + .012);
      ctx.lineTo(sx + .03, top + .009);
      ctx.stroke();
      ctx.fillStyle = c('spot');
      ctx.beginPath();
      ctx.arc(sx + .006, top + .036, .008, 0, TAU);
      ctx.arc(sx - .02, top + .058, .0055, 0, TAU);
      ctx.fill();
    }
    pleopods(c('pleopod'), .018, 0);
    uropod(1);

    // Carapace with its groove, leopard spots and a pointed rostrum.
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(-.005, -.08);
    ctx.bezierCurveTo(.08, -.122, .2, -.128, .3, -.092);
    ctx.lineTo(.385, -.066);
    ctx.lineTo(.318, -.042);
    ctx.quadraticCurveTo(.338, .012, .305, .052);
    ctx.bezierCurveTo(.21, .078, .09, .08, -.005, .07);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = c('outline', .5);
    ctx.lineWidth = .009;
    ctx.stroke();
    ctx.strokeStyle = c('seam');
    ctx.lineWidth = .006;
    ctx.beginPath();
    ctx.moveTo(.12, -.114);
    ctx.quadraticCurveTo(.148, -.02, .118, .07);
    ctx.stroke();
    for (const [sx, sy, r] of [[.05, -.07, .012], [.09, -.042, .009], [.185, -.088, .011], [.228, -.052, .008], [.27, -.079, .0075], [.155, -.062, .008], [.06, .02, .009]]) {
      ctx.fillStyle = c('spotRing');
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, TAU);
      ctx.fill();
      ctx.fillStyle = c('spot');
      ctx.beginPath();
      ctx.arc(sx, sy, r * .55, 0, TAU);
      ctx.fill();
    }
    ctx.strokeStyle = c('shine', .6);
    ctx.lineWidth = .012;
    ctx.beginPath();
    ctx.moveTo(.03, -.094);
    ctx.bezierCurveTo(.1, -.116, .2, -.12, .29, -.09);
    ctx.stroke();

    // Near-side walking legs, mouthparts and the raptorial club.
    for (const [x0, phase] of [[.075, 0], [.135, 1.3], [.195, 2.6]]) leg(x0, phase, c('leg'), .015);
    ctx.strokeStyle = c('leg');
    ctx.lineWidth = .013;
    ctx.beginPath();
    ctx.moveTo(.3, .045);
    ctx.quadraticCurveTo(.33, .07, .325, .095);
    ctx.moveTo(.315, .04);
    ctx.quadraticCurveTo(.35, .058, .352, .082);
    ctx.stroke();
    if (streak > 0) {
      // Speed lines trace the arc of the strike.
      ctx.strokeStyle = `rgba(255, 255, 255, ${.55 * streak})`;
      ctx.lineWidth = .028;
      ctx.beginPath();
      for (let n = 0; n <= 10; n++) {
        const joint = clubJoint(lerp(-.25, club, n / 10));
        if (n) ctx.lineTo(joint.tx, joint.ty); else ctx.moveTo(joint.tx, joint.ty);
      }
      ctx.stroke();
    }
    raptorial(club, true);

    // Stalked eyes roll independently; antennae and their orange scales sway.
    const sway = Math.sin(t * 2.1) * .03;
    ctx.strokeStyle = c('antenna');
    ctx.lineWidth = .008;
    ctx.beginPath();
    ctx.moveTo(.37, -.085);
    ctx.bezierCurveTo(.46, -.17, .52 + sway, -.3, .66 + sway, -.335);
    ctx.moveTo(.365, -.08);
    ctx.bezierCurveTo(.47, -.12, .58 + sway * .7, -.2, .71 + sway, -.205);
    ctx.moveTo(.38, -.075);
    ctx.quadraticCurveTo(.46, -.1, .53 + sway, -.145);
    ctx.stroke();
    ctx.save();
    ctx.translate(.4, -.098);
    ctx.rotate(-.45 + sway);
    ctx.fillStyle = c('scale');
    ctx.strokeStyle = c('scaleEdge');
    ctx.lineWidth = .007;
    ctx.beginPath();
    ctx.ellipse(.042, 0, .05, .019, 0, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    eye(.31, -.07, .312 + Math.sin(t * .9) * .008, -.178, Math.sin(t * 1.3 + 2) * .5, .9, .6);
    eye(.335, -.072, .357 + Math.sin(t * 1.1) * .01, -.198, Math.sin(t * 1.7) * .5 + Math.sin(t * .63) * .3, 1, 1);
    ctx.restore();
  }

  // A vapor bubble balloons in front of the club and collapses with a flash of light.
  function drawCavitation(ctx, state, t, night) {
    const s = state.shrimpSize;
    const { x, y } = state.impact;
    for (const at of STRIKES) {
      const u = t - at;
      if (u < 0 || u > .55) continue;
      if (u < .09) {
        const r = s * .075 * Math.sin(u / .09 * Math.PI);
        ctx.fillStyle = 'rgba(235, 251, 255, .16)';
        ctx.strokeStyle = 'rgba(240, 252, 255, .85)';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(.5, r), 0, TAU);
        ctx.fill();
        ctx.stroke();
      }
      const flash = u > .075 ? Math.exp(-(u - .075) * 13) : 0;
      if (flash > .01) {
        const radius = s * (.16 + night * .1);
        const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
        glow.addColorStop(0, `rgba(255, 251, 226, ${.95 * flash})`);
        glow.addColorStop(.25, `rgba(214, 245, 255, ${.45 * flash})`);
        glow.addColorStop(1, 'rgba(190, 236, 255, 0)');
        ctx.fillStyle = glow;
        ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
      }
      ctx.strokeStyle = `rgba(225, 248, 255, ${.7 * (1 - u / .55)})`;
      ctx.lineWidth = 1;
      for (let i = 0; i < 9; i++) {
        const angle = i * 2.4 + at, d = s * (.03 + u * .42);
        ctx.beginPath();
        ctx.arc(x + Math.cos(angle) * d, y + Math.sin(angle) * d * .8 - u * s * .14, 1 + i % 3, 0, TAU);
        ctx.stroke();
      }
    }
  }

  // A short starburst glint where the glass is hit.
  function drawImpactGlint(ctx, state, t) {
    for (const event of state.events) {
      const u = t - event.at;
      if (u < 0 || u > .24 || event.at === BREAK) continue;
      const strength = (1 - u / .24) * clamp(event.jolt / 3.5, .3, 1);
      const { x, y } = state.impact;
      const length = state.radii[1] * (1.1 + event.jolt * .25) * (1 - u * 2);
      ctx.strokeStyle = `rgba(255, 255, 255, ${.8 * strength})`;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const angle = i * Math.PI / 3 + event.at;
        const l = length * (i % 2 ? .55 : 1);
        ctx.moveTo(x + Math.cos(angle) * 3, y + Math.sin(angle) * 3);
        ctx.lineTo(x + Math.cos(angle) * l, y + Math.sin(angle) * l);
      }
      ctx.stroke();
    }
  }

  // ---- Cracks ------------------------------------------------------------------------------
  function reveal(state, view, level, t) {
    const { segments, marks } = state;
    const start = state.revealed;
    while (state.revealed < segments.length && segments[state.revealed].threshold <= level) {
      const { b, branch } = segments[state.revealed++];
      if (!branch && b.x > 6 && b.x < view.W - 6 && b.y > 6 && b.y < view.floor - 28) state.nodes.push(b);
    }
    if (state.revealed - start < 160)
      for (let n = start; n < state.revealed; n++) state.fresh.push({ segment: segments[n], at: t });
    while (state.marksRevealed < marks.length && marks[state.marksRevealed].threshold <= level) state.marksRevealed++;
  }

  function paintMarks(paint, list, impact, night) {
    const light = 1 - night * .4;
    for (const mark of list) {
      if (mark.frost) {
        const frost = paint.createRadialGradient(impact.x, impact.y, 0, impact.x, impact.y, mark.frost);
        frost.addColorStop(0, `rgba(242, 252, 255, ${.7 * light})`);
        frost.addColorStop(.35, `rgba(225, 248, 255, ${.34 * light})`);
        frost.addColorStop(.8, `rgba(222, 247, 255, ${.1 * light})`);
        frost.addColorStop(1, 'rgba(222, 247, 255, 0)');
        paint.fillStyle = frost;
        paint.beginPath();
        paint.arc(impact.x, impact.y, mark.frost, 0, TAU);
        paint.fill();
      } else if (mark.specks) {
        // Pulverized glass sparkles in the crushed zone.
        for (const [x, y, r, alpha] of mark.specks) {
          paint.fillStyle = `rgba(255, 255, 255, ${alpha * light})`;
          paint.beginPath();
          paint.arc(x, y, r, 0, TAU);
          paint.fill();
        }
      } else {
        paint.fillStyle = `rgba(228, 248, 255, ${mark.alpha * light})`;
        paint.beginPath();
        mark.points.forEach((p, j) => j ? paint.lineTo(p.x, p.y) : paint.moveTo(p.x, p.y));
        paint.closePath();
        paint.fill();
      }
    }
  }

  // A crack is a bright hairline with a thin shadow beside it. Near the impact the fracture
  // face also shows as a narrow ribbon with a darker far edge.
  function paintCracks(paint, list, night) {
    if (!list.length) return;
    const light = 1 - night * .42;
    paint.lineJoin = 'round';
    paint.lineCap = 'butt';
    for (const s of list) {
      if (s.bandA < .25 && s.bandB < .25) continue;
      const ax = s.a.x + s.nx * s.bandA, ay = s.a.y + s.ny * s.bandA;
      const bx = s.b.x + s.nx * s.bandB, by = s.b.y + s.ny * s.bandB;
      paint.fillStyle = `rgba(222, 247, 255, ${s.glow * light})`;
      paint.beginPath();
      paint.moveTo(s.a.x, s.a.y);
      paint.lineTo(s.b.x, s.b.y);
      paint.lineTo(bx, by);
      paint.lineTo(ax, ay);
      paint.closePath();
      paint.fill();
      paint.strokeStyle = 'rgba(0, 22, 34, .3)';
      paint.lineWidth = .7;
      paint.beginPath();
      paint.moveTo(ax, ay);
      paint.lineTo(bx, by);
      paint.stroke();
    }
    paint.lineCap = 'round';
    paint.strokeStyle = 'rgba(0, 16, 26, .32)';
    for (const s of list) {
      const offset = s.width * .5 + .55;
      paint.lineWidth = .75;
      paint.beginPath();
      paint.moveTo(s.a.x - s.nx * offset, s.a.y - s.ny * offset);
      paint.lineTo(s.b.x - s.nx * offset, s.b.y - s.ny * offset);
      paint.stroke();
    }
    for (const s of list) {
      paint.strokeStyle = color('#f2fdff', night * .55, s.bright * light);
      paint.lineWidth = s.width;
      paint.beginPath();
      paint.moveTo(s.a.x, s.a.y);
      paint.lineTo(s.b.x, s.b.y);
      paint.stroke();
    }
  }

  function crackLayer(state, ctx, view, night) {
    const target = ctx.canvas;
    let cache = state.cache;
    if (!cache || cache.width !== target.width || cache.height !== target.height) {
      // Sharing renders at another size; repaint everything revealed so far at that size.
      cache = state.cache || document.createElement('canvas');
      cache.width = target.width;
      cache.height = target.height;
      state.cache = cache;
      state.drawn = 0;
      state.marksDrawn = 0;
    }
    if (state.drawn < state.revealed || state.marksDrawn < state.marksRevealed) {
      const paint = cache.getContext('2d');
      paint.setTransform(cache.width / view.W, 0, 0, cache.height / view.H, 0, 0);
      paintMarks(paint, state.marks.slice(state.marksDrawn, state.marksRevealed), state.impact, night);
      paintCracks(paint, state.segments.slice(state.drawn, state.revealed), night);
      state.drawn = state.revealed;
      state.marksDrawn = state.marksRevealed;
    }
    return cache;
  }

  function drawFreshCracks(ctx, state, t) {
    ctx.lineCap = 'round';
    for (const { segment, at } of state.fresh) {
      const age = t - at;
      ctx.strokeStyle = `rgba(255, 255, 255, ${.85 * (1 - age / .32)})`;
      ctx.lineWidth = segment.width + 1.5;
      ctx.beginPath();
      ctx.moveTo(segment.a.x, segment.a.y);
      ctx.lineTo(segment.b.x, segment.b.y);
      ctx.stroke();
    }
  }

  // ---- Leaks -------------------------------------------------------------------------------
  const insideIcon = (icons, x, y, margin) => icons.some(icon =>
    x > icon.x - margin && x < icon.x + icon.w + margin && y > icon.y - margin && y < icon.y + icon.h + margin);

  function leakNode(state, view, filter) {
    const { nodes } = state;
    let best = null;
    // Water pressure is higher lower down, so lower cracks leak more often.
    for (let tries = 0, picks = 0; tries < 14 && picks < 2 && nodes.length; tries++) {
      const node = nodes[Math.floor(Math.random() * nodes.length)];
      if (insideIcon(view.icons || [], node.x, node.y, 6) || (filter && !filter(node))) continue;
      picks++;
      if (!best || node.y > best.y) best = node;
    }
    return best;
  }

  function spawnDrip(state, t, node, scale = 1) {
    if (!node || state.drips.length > 90) return;
    const size = (1.9 + Math.random() * 2.7) * state.unit * scale;
    state.drips.push({ x: node.x, y: node.y, size, born: t, phase: Math.random() * TAU, speed: (38 + size * 16) * state.unit,
      mode: 'run', target: 0, vy: 0, trail: [{ x: node.x, y: node.y, at: t }], ended: null });
  }

  function leakRate(state, t) {
    if (t < STRIKES[1] + .25) return 0;
    if (state.taped) return t < LEAK_STOP ? .9 + (t - 4.75) * .1 : 0;
    return Math.min(7.5, 1 + (t - 4.75) * .46);
  }

  function addJet(state, view, t, until) {
    const { impact, reach } = state;
    const node = leakNode(state, view, node => {
      const d = Math.hypot(node.x - impact.x, node.y - impact.y);
      return d > reach * .07 && d < reach * .45 && node.y < view.floor - 60;
    });
    if (!node) return null;
    const jet = { x: node.x, y: node.y, angle: Math.atan2(node.y - impact.y, node.x - impact.x), from: t,
      until, carry: 0, rate: 30 + Math.random() * 22 };
    state.jets.push(jet);
    return jet;
  }

  // The tape-variant jet sits under the first strip and stops when the tape passes over it.
  function addCoveredJet(state, view, t) {
    const strip = state.tape[0];
    const dx = strip.bx - strip.ax, dy = strip.by - strip.ay, length2 = dx * dx + dy * dy;
    let best = null, bestScore = Infinity;
    for (const node of state.nodes) {
      const q = clamp(((node.x - strip.ax) * dx + (node.y - strip.ay) * dy) / length2, 0, 1);
      const off = Math.hypot(strip.ax + dx * q - node.x, strip.ay + dy * q - node.y);
      const centre = Math.hypot(node.x - state.impact.x, node.y - state.impact.y);
      if (off > strip.width * .35 || centre < state.radii[1] * .8 || q < .12 || q > .88) continue;
      const score = off + Math.abs(q - .3) * 40;
      if (score < bestScore) {
        bestScore = score;
        best = { node, q };
      }
    }
    if (!best) return;
    // Invert the tape's easing to find when the roll passes this point.
    let lo = 0, hi = 1;
    for (let n = 0; n < 20; n++) {
      const mid = (lo + hi) / 2;
      if (smooth(mid) < best.q) lo = mid; else hi = mid;
    }
    const covered = strip.start + lo * (strip.end - strip.start);
    state.jets.push({ x: best.node.x, y: best.node.y, angle: Math.atan2(best.node.y - state.impact.y, best.node.x - state.impact.x),
      from: t, until: covered, carry: 0, rate: 34, covered: true });
  }

  function spawnChips(state, t, count) {
    const { impact, radii, unit } = state;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * TAU, d = Math.random() * radii[1] * .6;
      state.chips.push({ x: impact.x + Math.cos(angle) * d, y: impact.y + Math.sin(angle) * d,
        vx: (Math.random() - .5) * 80 * unit, vy: (-25 - Math.random() * 70) * unit, rotation: Math.random() * TAU,
        spin: (Math.random() - .5) * 16, size: (1.3 + Math.random() * 2.8) * unit, born: t });
    }
  }

  function update(state, view, t, dt) {
    const { unit } = state;
    const icons = view.icons || [];
    const floor = view.floor;
    while (state.eventIndex < state.events.length && t >= state.events[state.eventIndex].at) {
      const event = state.events[state.eventIndex++];
      if (event.at === STRIKES[1]) spawnChips(state, t, 5);
      else if (!state.taped && event.at > 12.5 && event.at < BREAK) spawnChips(state, t, 2 + Math.floor(Math.random() * 3));
      if (state.taped && event.at === LAST_TICK) state.lastDripAt = t + .45;
    }
    // Remember which crack ends the final tick adds, so the last drop comes from new damage.
    if (state.taped && state.nodeMark == null && t >= LAST_TICK - .1) state.nodeMark = state.nodes.length;
    if (t >= state.lastDripAt) {
      // One last, fat drop squeezes out just past the tape.
      state.lastDripAt = Infinity;
      const { impact } = state;
      const usable = node => !insideIcon(icons, node.x, node.y, 6) && node.y < floor - 80;
      const fresh = state.nodes.slice(state.nodeMark ?? state.nodes.length).filter(usable);
      const pool = fresh.length ? fresh : state.nodes.slice(-12).filter(usable);
      pool.sort((a, b) => Math.hypot(a.x - impact.x, a.y - impact.y) - Math.hypot(b.x - impact.x, b.y - impact.y));
      spawnDrip(state, t, pool[0], 1.8);
    }
    state.leak += leakRate(state, t) * dt;
    for (; state.leak >= 1; state.leak--) spawnDrip(state, t, leakNode(state, view));
    if (state.taped) {
      if (!state.coverJet && t >= 10.1) {
        state.coverJet = true;
        addCoveredJet(state, view, t);
      }
    } else {
      while (state.jetIndex < JETS.length && t >= JETS[state.jetIndex]) {
        state.jetIndex++;
        addJet(state, view, t, BREAK);
      }
    }

    for (const jet of state.jets) {
      if (t < jet.from || t > jet.until) continue;
      const strength = smooth((t - jet.from) / .4) * (1 - smooth((t - jet.until + .2) / .2));
      jet.carry += jet.rate * strength * dt;
      for (; jet.carry >= 1; jet.carry--) {
        const spread = (Math.random() - .5) * .9, speed = (60 + Math.random() * 120) * unit;
        state.spray.push({ x: jet.x, y: jet.y, vx: Math.cos(jet.angle + spread) * speed,
          vy: Math.sin(jet.angle + spread) * speed - (80 + Math.random() * 80) * unit,
          born: t, life: .5 + Math.random() * .55, size: (.75 + Math.random() * 1.15) * unit });
      }
    }
    const gravity = 620 * unit;
    state.spray = state.spray.filter(p => {
      p.vy += gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      return t - p.born < p.life && p.y < floor;
    });
    state.chips = state.chips.filter(chip => {
      chip.vy += 900 * unit * dt;
      chip.x += chip.vx * dt;
      chip.y += chip.vy * dt;
      chip.rotation += chip.spin * dt;
      return chip.y < view.H + 10;
    });

    for (const drip of state.drips) {
      if (drip.ended != null) continue;
      const age = t - drip.born;
      // A bead swells at the crack before it runs.
      if (age < .55) continue;
      if (drip.mode === 'slide') {
        const step = 46 * unit * dt * Math.sign(drip.target - drip.x);
        if (Math.abs(drip.target - drip.x) <= Math.abs(step)) {
          drip.x = drip.target;
          drip.mode = 'run';
        } else drip.x += step;
        drip.vy = 0;
      } else {
        // Drops run in surges as they pick up and lose water along the way.
        const surge = .3 + .7 * (.5 + .5 * Math.sin(t * 2.1 + drip.phase)) ** 2;
        drip.vy = drip.speed * surge * smooth((age - .55) / .6);
        const next = drip.y + drip.vy * dt;
        drip.x += Math.sin(t * 1.7 + drip.phase * 3) * 2.5 * dt * unit;
        const icon = icons.find(icon => drip.x > icon.x - 1 && drip.x < icon.x + icon.w + 1 &&
          drip.y <= icon.y - 1 && next >= icon.y - 1.5);
        if (icon) {
          // Water flows around desktop icons instead of under them.
          drip.y = icon.y - 1.5;
          drip.mode = 'slide';
          drip.target = drip.x < icon.x + icon.w / 2 ? icon.x - 2.5 : icon.x + icon.w + 2.5;
        } else drip.y = next;
        if (drip.y >= floor - state.pool) {
          drip.y = floor - state.pool;
          drip.ended = t;
          state.pool = Math.min(9 * unit, state.pool + drip.size * .16);
          state.splashes.push({ x: drip.x, at: t, size: drip.size });
        }
      }
      const last = drip.trail[drip.trail.length - 1];
      if (Math.hypot(drip.x - last.x, drip.y - last.y) > 4) drip.trail.push({ x: drip.x, y: drip.y, at: t });
    }
    // Wet streaks dry from the top down.
    for (const drip of state.drips) while (drip.trail.length > 1 && t - drip.trail[0].at > 7.5) drip.trail.shift();
    state.drips = state.drips.filter(drip => drip.ended == null || t - drip.ended < 7.5);
    state.splashes = state.splashes.filter(splash => t - splash.at < .6);
    state.fresh = state.fresh.filter(fresh => t - fresh.at < .32);
  }

  function drawLeaks(ctx, state, view, t, night, fade) {
    const { unit } = state;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const drip of state.drips) {
      if (drip.trail.length < 2 && drip.ended == null) continue;
      ctx.strokeStyle = color('#d9f5ff', night * .6, .2 * fade);
      ctx.lineWidth = drip.size * 1.05;
      ctx.beginPath();
      drip.trail.forEach((p, j) => j ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
      if (drip.ended == null) ctx.lineTo(drip.x, drip.y);
      ctx.stroke();
    }
    for (const drip of state.drips) {
      if (drip.ended != null) continue;
      const r = drip.size * smooth((t - drip.born) / .55);
      if (r < .2) continue;
      const stretch = 1 + clamp(drip.vy / (90 * unit), 0, .55);
      ctx.fillStyle = color('#cfeefa', night * .6, .5 * fade);
      ctx.beginPath();
      ctx.ellipse(drip.x, drip.y, r * .9, r * stretch, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = `rgba(3, 30, 44, ${.42 * fade})`;
      ctx.lineWidth = .9;
      ctx.beginPath();
      ctx.ellipse(drip.x, drip.y + r * .08, r * .84, r * stretch * .95, 0, Math.PI * .12, Math.PI * .88);
      ctx.stroke();
      ctx.fillStyle = `rgba(255, 255, 255, ${.88 * fade})`;
      ctx.beginPath();
      ctx.arc(drip.x - r * .32, drip.y - r * stretch * .38, r * .3, 0, TAU);
      ctx.fill();
    }
    for (const jet of state.jets) {
      if (t < jet.from || t > jet.until) continue;
      const strength = smooth((t - jet.from) / .4) * (1 - smooth((t - jet.until + .2) / .2));
      // The pressurized stream arcs out of the crack and pulses with the water behind it.
      const pulse = 1 + Math.sin(t * 13 + jet.x) * .08 + Math.sin(t * 5.3 + jet.y) * .06;
      const speed = 150 * unit * strength * pulse;
      const vx = Math.cos(jet.angle) * speed * .75, vy = Math.sin(jet.angle) * speed * .5 - 115 * unit * strength * pulse;
      const gravity = 620 * unit;
      ctx.lineCap = 'round';
      for (const [width, alpha] of [[4.6, .2], [2.1, .72]]) {
        ctx.strokeStyle = color('#eefbff', night * .5, alpha * strength * fade);
        ctx.beginPath();
        for (let n = 0; n <= 14; n++) {
          const time = n / 14 * .58;
          const px = jet.x + vx * time, py = jet.y + vy * time + .5 * gravity * time * time;
          if (n) ctx.lineTo(px, py); else ctx.moveTo(px, py);
        }
        ctx.lineWidth = width * unit;
        ctx.stroke();
      }
      ctx.fillStyle = `rgba(240, 252, 255, ${.7 * strength * fade})`;
      ctx.beginPath();
      ctx.arc(jet.x, jet.y, 2.4 * unit, 0, TAU);
      ctx.fill();
    }
    for (const p of state.spray) {
      const k = (t - p.born) / p.life;
      ctx.fillStyle = color('#e9f9ff', night * .5, .75 * (1 - k) * fade);
      ctx.beginPath();
      // Spray flies toward the viewer, so drops grow as they travel.
      ctx.arc(p.x, p.y, p.size * (1 + k * 2.6), 0, TAU);
      ctx.fill();
    }
    for (const chip of state.chips) {
      ctx.save();
      ctx.translate(chip.x, chip.y);
      ctx.rotate(chip.rotation);
      ctx.fillStyle = `rgba(242, 253, 255, ${.92 * fade})`;
      ctx.strokeStyle = `rgba(0, 32, 44, ${.45 * fade})`;
      ctx.lineWidth = .6;
      ctx.beginPath();
      ctx.moveTo(-chip.size, -chip.size * .5);
      ctx.lineTo(chip.size, -chip.size * .2);
      ctx.lineTo(chip.size * .1, chip.size * .85);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    const floor = view.floor;
    if (state.pool > .3) {
      const top = floor - state.pool;
      const wave = x => top + Math.sin(x * .045 + t * 2.4) * .7 * unit + Math.sin(x * .013 - t * 1.3) * .9 * unit;
      ctx.fillStyle = color('#bfe9f6', night * .6, .3 * fade);
      ctx.beginPath();
      ctx.moveTo(0, floor + 2);
      for (let x = 0; x <= view.W + 24; x += 24) ctx.lineTo(x, wave(x));
      ctx.lineTo(view.W, floor + 2);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = `rgba(240, 252, 255, ${.6 * fade})`;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      for (let x = 0; x <= view.W + 24; x += 24) x ? ctx.lineTo(x, wave(x)) : ctx.moveTo(x, wave(x));
      ctx.stroke();
    }
    for (const splash of state.splashes) {
      const age = t - splash.at, k = age / .6;
      const top = floor - state.pool;
      ctx.strokeStyle = `rgba(235, 250, 255, ${.6 * (1 - k) * fade})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(splash.x, top, (3 + age * 36) * unit, (1 + age * 5) * unit, 0, Math.PI, TAU);
      ctx.stroke();
      ctx.fillStyle = `rgba(235, 250, 255, ${.7 * (1 - k) * fade})`;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(splash.x + side * age * 28 * unit, top - Math.sin(k * Math.PI) * splash.size * 3, splash.size * .4, 0, TAU);
        ctx.fill();
      }
    }
  }

  // ---- Diver and tape ----------------------------------------------------------------------
  function tapeProgress(strip, t) {
    return smooth((t - strip.start) / (strip.end - strip.start));
  }

  function handAt(state, view, t) {
    const strips = state.tape, direction = -state.facing, size = state.diverSize;
    const first = strips[0], last = strips[strips.length - 1];
    if (t < first.start) {
      const k = smooth((t - DIVER_IN) / (first.start - DIVER_IN));
      const entryX = direction > 0 ? -size * .32 : view.W + size * .32, entryY = first.ay - view.H * .17;
      return { x: lerp(entryX, first.ax, k), y: lerp(entryY, first.ay, k) + Math.sin(t * 1.7) * size * .015 * (1 - k), strip: first };
    }
    for (let j = 0; j < strips.length; j++) {
      const strip = strips[j];
      if (t > strip.end) continue;
      if (t >= strip.start) {
        const q = tapeProgress(strip, t);
        return { x: lerp(strip.ax, strip.bx, q), y: lerp(strip.ay, strip.by, q), strip, taping: true };
      }
      const previous = strips[j - 1];
      const k = smooth((t - previous.end) / (strip.start - previous.end));
      return { x: lerp(previous.bx, strip.ax, k), y: lerp(previous.by, strip.ay, k), strip: k < .5 ? previous : strip };
    }
    const k = smooth((t - DIVER_OUT[0]) / (DIVER_OUT[1] - DIVER_OUT[0]));
    const exitX = direction > 0 ? view.W + size * .95 : -size * .95, exitY = last.by - view.H * .22;
    return { x: lerp(last.bx, exitX, k ** 1.2), y: lerp(last.by, exitY, k) + Math.sin(t * 1.7) * size * .015 * k, strip: last };
  }

  function drawRoll(ctx, x, y, angle, width, night, fade) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.globalAlpha *= fade;
    ctx.fillStyle = color(PALETTE.roll, night);
    ctx.beginPath();
    ctx.ellipse(0, 0, width * .21, width * .64, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = color(PALETTE.tapeLight, night, .55);
    ctx.beginPath();
    ctx.ellipse(-width * .04, -width * .12, width * .09, width * .34, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = color(PALETTE.rollCore, night);
    ctx.beginPath();
    ctx.ellipse(0, 0, width * .12, width * .37, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = color(PALETTE.rollHole, night);
    ctx.beginPath();
    ctx.ellipse(0, 0, width * .075, width * .25, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawTapeStrip(ctx, strip, q, night, fade) {
    if (q <= 0) return;
    const w = strip.width, length = strip.length * q, done = q >= 1;
    ctx.save();
    ctx.translate(strip.ax, strip.ay);
    ctx.rotate(strip.angle);
    ctx.globalAlpha *= fade;
    const outline = new Path2D();
    outline.moveTo(strip.head[0][0], -w / 2);
    for (const [dx, f] of strip.head) outline.lineTo(dx, lerp(-w / 2, w / 2, f));
    if (done) for (let n = strip.tail.length - 1; n >= 0; n--) outline.lineTo(length + strip.tail[n][0], lerp(-w / 2, w / 2, strip.tail[n][1]));
    else {
      outline.lineTo(length, w / 2);
      outline.lineTo(length, -w / 2);
    }
    outline.closePath();
    // The tape is stuck to the water side of the glass, so it stays a little blue.
    ctx.fillStyle = 'rgba(0, 18, 30, .18)';
    ctx.save();
    ctx.translate(2, 3);
    ctx.fill(outline);
    ctx.restore();
    const face = ctx.createLinearGradient(0, -w / 2, 0, w / 2);
    face.addColorStop(0, color(PALETTE.tapeLight, night));
    face.addColorStop(.45, color(PALETTE.tape, night));
    face.addColorStop(1, color(PALETTE.tapeDark, night));
    ctx.fillStyle = face;
    ctx.fill(outline);
    ctx.save();
    ctx.clip(outline);
    ctx.strokeStyle = 'rgba(50, 62, 68, .09)';
    ctx.lineWidth = .7;
    ctx.beginPath();
    for (let x = -w * .3; x < length; x += 5) {
      ctx.moveTo(x, -w / 2);
      ctx.lineTo(x + w * .3, w / 2);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 255, 255, .1)';
    ctx.beginPath();
    for (let m = 1; m < 6; m++) {
      ctx.moveTo(0, -w / 2 + w * m / 6);
      ctx.lineTo(length, -w / 2 + w * m / 6);
    }
    ctx.stroke();
    for (const [u, lean, strength] of strip.wrinkles) {
      const x = u * strip.length;
      if (x > length - 4) continue;
      ctx.strokeStyle = `rgba(40, 52, 58, ${.14 + strength * .16})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x, -w * .42);
      ctx.quadraticCurveTo(x + lean * w * .3, 0, x + lean * w * .5, w * .42);
      ctx.stroke();
      ctx.strokeStyle = `rgba(255, 255, 255, ${.12 + strength * .14})`;
      ctx.beginPath();
      ctx.moveTo(x + 1.3, -w * .42);
      ctx.quadraticCurveTo(x + 1.3 + lean * w * .3, 0, x + 1.3 + lean * w * .5, w * .42);
      ctx.stroke();
    }
    ctx.fillStyle = color('#1e6a86', night * .5, .16 + night * .2);
    ctx.fillRect(-w, -w, length + w * 2, w * 2);
    ctx.restore();
    ctx.strokeStyle = 'rgba(240, 248, 250, .45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(strip.head[0][0], -w / 2);
    ctx.lineTo(length, -w / 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawDiverAndTape(ctx, state, view, t, night, fade) {
    const strips = state.tape;
    const diverVisible = t >= DIVER_IN && t <= DIVER_OUT[1] && view.drawDiver;
    let hand = null;
    if (diverVisible) {
      const size = state.diverSize, direction = -state.facing;
      hand = handAt(state, view, t);
      const before = handAt(state, view, t - .1);
      const pitch = clamp(Math.atan2(hand.y - before.y, Math.abs(hand.x - before.x) + size * .02) * .7, -.38, .38);
      ctx.save();
      view.drawDiver(hand.x - direction * .33 * size, hand.y - .025 * size, direction, pitch, size, t, 1);
      ctx.restore();
    }
    for (const strip of strips) drawTapeStrip(ctx, strip, tapeProgress(strip, t), night, fade);
    // The diver holds the roll; while taping it sits at the end that is still being unrolled.
    if (hand) drawRoll(ctx, hand.x, hand.y, hand.strip.angle, hand.strip.width, night, 1);
  }

  // ---- Shattering --------------------------------------------------------------------------
  // Sutherland–Hodgman clipping of a polygon against an axis-aligned rectangle.
  function clipToRect(points, left, top, right, bottom) {
    const edges = [
      [p => p.x >= left, (a, b) => (left - a.x) / (b.x - a.x)],
      [p => p.x <= right, (a, b) => (right - a.x) / (b.x - a.x)],
      [p => p.y >= top, (a, b) => (top - a.y) / (b.y - a.y)],
      [p => p.y <= bottom, (a, b) => (bottom - a.y) / (b.y - a.y)]
    ];
    let output = points;
    for (const [inside, cross] of edges) {
      const input = output;
      output = [];
      for (let i = 0; i < input.length; i++) {
        const a = input[(i + input.length - 1) % input.length], b = input[i];
        if (inside(b)) {
          if (!inside(a)) {
            const f = cross(a, b);
            output.push({ x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f) });
          }
          output.push(b);
        } else if (inside(a)) {
          const f = cross(a, b);
          output.push({ x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f) });
        }
      }
      if (!output.length) break;
    }
    return output;
  }

  // Each crack cell becomes a shard carrying the picture it covered at the moment of failure.
  function buildShards(state, view, ctx) {
    const { W, H } = view;
    const source = ctx.canvas;
    const sx = source.width / W, sy = source.height / H;
    const random = generator(state.seed + 31);
    const scale = Math.hypot(W, H) / 2200;
    const shards = [];
    for (const cell of state.cells) {
      // Outer cells reach past the screen; keep only the visible part of each piece.
      const points = clipToRect(cell, -1, -1, W + 1, H + 1);
      if (points.length < 3) continue;
      let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity, cx = 0, cy = 0;
      for (const p of points) {
        left = Math.min(left, p.x);
        top = Math.min(top, p.y);
        right = Math.max(right, p.x);
        bottom = Math.max(bottom, p.y);
        cx += p.x;
        cy += p.y;
      }
      left = Math.floor(left) - 1;
      top = Math.floor(top) - 1;
      right = Math.ceil(right) + 1;
      bottom = Math.ceil(bottom) + 1;
      if (right - left < 2 || bottom - top < 2) continue;
      cx /= points.length;
      cy /= points.length;
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.ceil((right - left) * sx));
      canvas.height = Math.max(1, Math.ceil((bottom - top) * sy));
      const paint = canvas.getContext('2d');
      paint.setTransform(sx, 0, 0, sy, -left * sx, -top * sy);
      const outline = new Path2D();
      points.forEach((p, j) => j ? outline.lineTo(p.x, p.y) : outline.moveTo(p.x, p.y));
      outline.closePath();
      paint.clip(outline);
      paint.drawImage(source, 0, 0, W, H);
      // A faint sheen tells the glass apart from the water behind it.
      const sheen = paint.createLinearGradient(left, top, right, bottom);
      sheen.addColorStop(0, 'rgba(255, 255, 255, 0)');
      sheen.addColorStop(.5, 'rgba(225, 248, 255, .12)');
      sheen.addColorStop(1, 'rgba(255, 255, 255, 0)');
      paint.fillStyle = sheen;
      paint.fillRect(left, top, right - left, bottom - top);
      const shape = new Path2D();
      points.forEach((p, j) => j ? shape.lineTo(p.x - cx, p.y - cy) : shape.moveTo(p.x - cx, p.y - cy));
      shape.closePath();
      const dx = cx - state.impact.x, dy = cy - state.impact.y, distance = Math.hypot(dx, dy) || 1;
      const near = 1 - clamp(distance / state.reach, 0, 1);
      // Pieces near the hole are blown outward; the outer pieces mostly drop.
      const speed = (50 + 460 * near * near + random() * 120) * scale;
      shards.push({
        canvas, shape, left, top, width: right - left, height: bottom - top, cx, cy,
        delay: .02 + (1 - near) * .3 + random() * .06,
        vx: dx / distance * speed, vy: dy / distance * speed - (40 + random() * 90) * scale,
        spin: (random() - .5) * (1.2 + near * 3.6), grow: .1 + random() * .5 * (.3 + near), glint: random() * TAU,
        tilt: random() * TAU
      });
    }
    state.shards = shards;
  }

  function drawShards(ctx, state, view, t) {
    const gravity = view.H * 2.5;
    const lift = Math.hypot(view.W, view.H) / 2200;
    for (const shard of state.shards) {
      if (!shard.canvas) continue;
      const age = Math.max(0, t - BREAK - shard.delay);
      const ox = shard.vx * age, oy = shard.vy * age + .5 * gravity * age * age;
      const scale = 1 + shard.grow * age;
      const rotation = shard.spin * age;
      if (shard.cy + oy - Math.max(shard.width, shard.height) * scale > view.H + 40 || age > 2.6) {
        shard.canvas = null;
        continue;
      }
      const loose = Math.min(1, age * 7);
      if (loose > 0) {
        // Shards falling toward the viewer cast a shadow on the water behind them.
        const offset = (4 + age * 26) * lift;
        ctx.save();
        ctx.translate(shard.cx + ox + offset, shard.cy + oy + offset * 1.3);
        ctx.rotate(rotation);
        ctx.scale(scale, scale);
        ctx.fillStyle = `rgba(0, 14, 24, ${.2 * loose})`;
        ctx.fill(shard.shape);
        ctx.restore();
      }
      ctx.save();
      ctx.translate(shard.cx + ox, shard.cy + oy);
      ctx.rotate(rotation);
      ctx.scale(scale, scale);
      if (loose > 0) {
        // The broken edge of thick glass shows as a green-tinted side face.
        const thick = 3.2 * lift / scale;
        ctx.save();
        ctx.translate(Math.cos(shard.tilt + rotation) * thick, Math.sin(shard.tilt + rotation) * thick + thick * .6);
        ctx.fillStyle = `rgba(150, 214, 200, ${.75 * loose})`;
        ctx.fill(shard.shape);
        ctx.restore();
      }
      ctx.drawImage(shard.canvas, shard.left - shard.cx, shard.top - shard.cy, shard.width, shard.height);
      if (loose > 0) {
        const glint = Math.max(0, Math.sin(rotation * 2.2 + shard.glint)) ** 3 * .2;
        if (glint > .01) {
          ctx.fillStyle = `rgba(255, 255, 255, ${glint})`;
          ctx.fill(shard.shape);
        }
        ctx.strokeStyle = `rgba(236, 251, 255, ${.8 * loose})`;
        ctx.lineWidth = 1.5 / scale;
        ctx.lineJoin = 'round';
        ctx.stroke(shard.shape);
      }
      ctx.restore();
    }
  }

  // Water rushes out through the hole and floods toward the viewer: a foaming core, streaks
  // of water racing outward and spray that grows as it flies past.
  function drawTorrent(ctx, state, view, t, night) {
    const u = t - BREAK;
    const amount = smooth(u / .15) * (1 - smooth((u - 2.7) / 3.3));
    if (amount <= 0) return;
    const { W, H } = view;
    const { x, y } = state.impact, reach = state.reach, unit = state.unit;
    const surge = 1 - smooth((u - .4) / 2.6) * .55;
    ctx.save();
    ctx.globalAlpha = amount;
    const body = ctx.createRadialGradient(x, y, 0, x, y, reach * .95);
    body.addColorStop(0, color('#effcff', night * .4));
    body.addColorStop(.1 * surge + .04, color('#a6e6f0', night * .6));
    body.addColorStop(.42, color('#3ea6c4', night * .9));
    body.addColorStop(1, color('#1a6890', night));
    ctx.fillStyle = body;
    ctx.fillRect(-20, -20, W + 40, H + 40);

    // Streaks curve slightly as the jet swirls.
    ctx.lineCap = 'round';
    for (let i = 0; i < 64; i++) {
      const angle = i * 2.39996 + state.seed * .1;
      const cycle = .42 + (i % 7) * .07;
      const k = (u / cycle + hash(i, 9)) % 1;
      const d0 = reach * (.03 + k ** 1.7 * 1.05), length = reach * (.05 + k * .28) * surge;
      const bend = Math.sin(i * 1.3 + u * 1.7) * .12;
      const a1 = angle + bend * .5, a2 = angle + bend;
      ctx.strokeStyle = `rgba(255, 255, 255, ${(.25 + hash(i, 8) * .4) * (1 - k) * surge})`;
      ctx.lineWidth = (1 + k * 7 * hash(i, 7)) * unit;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(angle) * d0, y + Math.sin(angle) * d0);
      ctx.quadraticCurveTo(x + Math.cos(a1) * (d0 + length * .5), y + Math.sin(a1) * (d0 + length * .5),
        x + Math.cos(a2) * (d0 + length), y + Math.sin(a2) * (d0 + length));
      ctx.stroke();
    }

    // Spray drops are stretched along their path by their speed.
    for (let i = 0; i < 110; i++) {
      const angle = hash(i, 3) * TAU;
      const cycle = .7 + hash(i, 4) * .6;
      const k = (u / cycle + hash(i, 5)) % 1;
      const d = reach * (.02 + 1.1 * k * k);
      const r = (1.4 + hash(i, 6) * 2.4) * (1 + k * 3.6) * unit;
      const stretch = 1 + k * 5 * surge;
      ctx.save();
      ctx.translate(x + Math.cos(angle) * d, y + Math.sin(angle) * d + k * k * H * .06);
      ctx.rotate(angle);
      ctx.fillStyle = `rgba(240, 252, 255, ${.62 * Math.min(1, (1 - k) * 2.2)})`;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * stretch, r, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    // The churning foam where the water breaks through.
    const foam = reach * (.05 + .03 * surge) * smooth(u / .35);
    for (let i = 0; i < 16; i++) {
      const angle = i * 2.1 + u * (1.4 + hash(i, 1)), wobble = Math.sin(u * 5 + i * 1.7);
      const d = foam * (.25 + hash(i, 2) * .9);
      const r = foam * (.35 + hash(i, 3) * .5) * (1 + wobble * .12);
      ctx.fillStyle = `rgba(255, 255, 255, ${.45 * surge})`;
      ctx.beginPath();
      ctx.arc(x + Math.cos(angle) * d, y + Math.sin(angle) * d, r, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawRisingBubbles(ctx, state, view, t, night) {
    const u = t - BREAK - .5;
    if (u < 0 || u > 10) return;
    const amount = smooth(u / .4) * (1 - smooth((u - 6.2) / 3.2));
    if (amount <= 0) return;
    const { W, H } = view, unit = state.unit;
    ctx.save();
    for (let i = 0; i < 84; i++) {
      const r = (3 + hash(i, 1) ** 2.2 * 30) * unit;
      const speed = (150 + hash(i, 2) * 260 + r * 6) * unit;
      const y = H + r + hash(i, 3) * H * 1.25 - u * speed;
      if (y < -r || y > H + r) continue;
      const x = W * hash(i, 4) + Math.sin(u * (1.5 + hash(i, 5) * 2) + i) * r * 1.2;
      const wobble = 1 + Math.sin(u * 9 + i) * .06;
      ctx.fillStyle = color('#d2f3ff', night * .5, .09 * amount);
      ctx.strokeStyle = color('#e6faff', night * .5, .62 * amount);
      ctx.lineWidth = Math.max(1, r * .08);
      ctx.beginPath();
      ctx.ellipse(x, y, r * wobble, r / wobble, 0, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = `rgba(255, 255, 255, ${.75 * amount})`;
      ctx.lineWidth = Math.max(1, r * .12);
      ctx.beginPath();
      ctx.arc(x, y, r * .68, Math.PI * 1.08, Math.PI * 1.45);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---- Frame -------------------------------------------------------------------------------
  function draw(frame, view, layer) {
    if (layer !== 'overlay') return;
    const { ctx, W, H } = view;
    const t = frame.t;
    const key = frame.id + ':' + frame.seed;
    if (!state || state.key !== key || state.W !== W || state.H !== H || t < state.lastT - .5) state = build(frame, view);
    view = { ...view, floor: view.floor ?? H, icons: view.icons || [] };
    const dt = clamp(t - state.lastT, 0, .1);
    state.lastT = t;
    const night = clamp(view.night || 0, 0, 1);
    const broken = state.id === 'glassBreak' && t >= BREAK;
    const fade = state.taped ? 1 - smooth((t - FADE[0]) / (FADE[1] - FADE[0])) : 1;
    reveal(state, view, broken && !state.shards ? 1 : levelAt(state.events, t), t);
    if (!broken) update(state, view, t, dt);
    ctx.save();
    if (!broken || !state.shards) {
      const pose = shrimpPose(state, view, t);
      if (pose) drawShrimp(ctx, pose, t, night);
      if (state.taped) drawDiverAndTape(ctx, state, view, t, night, fade);
      drawCavitation(ctx, state, t, night);
      if (state.revealed) {
        ctx.globalAlpha = fade;
        ctx.drawImage(crackLayer(state, ctx, view, night), 0, 0, W, H);
        ctx.globalAlpha = 1;
        drawFreshCracks(ctx, state, t);
      }
      drawImpactGlint(ctx, state, t);
      drawLeaks(ctx, state, view, t, night, fade);
    }
    if (broken) {
      if (!state.shards) {
        buildShards(state, view, ctx);
        state.drips = [];
        state.spray = [];
        state.jets = [];
        state.pool = 0;
        state.cache = null;
      }
      drawTorrent(ctx, state, view, t, night);
      drawShards(ctx, state, view, t);
      drawRisingBubbles(ctx, state, view, t, night);
      const flash = 1 - (t - BREAK) / .32;
      if (flash > 0) {
        ctx.fillStyle = `rgba(255, 255, 255, ${.7 * flash * flash})`;
        ctx.fillRect(-20, -20, W + 40, H + 40);
      }
    }
    ctx.restore();
  }

  function release() {
    state = null;
  }

  return { draw, jolt, release };
})();

function drawKelpGlassScene(scene, view, layer) {
  KelpGlass.draw(scene, view, layer);
}
