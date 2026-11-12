// Light and shade are overlays. The fishing line passes behind foreground scenery.
function kelpFishingPose(scene, W, H) {
  const { p, t, direction, site } = scene;
  const arrive = smooth(p / .2);
  const depart = smooth((p - .78) / .22);
  const entry = direction > 0 ? -W * .16 : W * 1.16;
  const exit = direction > 0 ? W * 1.16 : -W * .16;
  const x = lerp(lerp(entry, W * site, arrive), exit, depart);
  const scale = clamp(W / 930, .65, 1.7);
  const lineX = x - direction * 76 * scale;
  const lineAmount = smooth((p - .2) / .18) * (1 - smooth((p - .64) / .14));
  return {
    x, scale, lineX, lineAmount,
    bob: Math.sin(t * 1.1) * 1.6 * scale,
    hookX: lineX + Math.sin(t * .9) * 5 * lineAmount,
    hookY: lineAmount * H * .51,
    interest: smooth((p - .38) / .04) * (1 - smooth((p - .59) / .05))
  };
}

function drawKelpSurfaceScene(scene, view, layer) {
  if (layer !== (scene.id === 'fishingBoat' ? 'water' : 'overlay')) return;
  const { ctx, W, H, seabed } = view;
  const p = Math.max(0, Math.min(1, scene.p));
  const alpha = Math.max(0, Math.min(1, scene.alpha));
  const t = scene.t;
  const direction = scene.direction < 0 ? -1 : 1;
  const smooth = v => { v = Math.max(0, Math.min(1, v)); return v * v * (3 - 2 * v); };
  const mix = (a, b, v) => a + (b - a) * v;
  const seed = Number.isFinite(scene.seed) ? scene.seed : 0;
  const site = Number.isFinite(scene.site) ? Math.max(.2, Math.min(.8, scene.site)) : .5;
  const night = Math.max(0, Math.min(1, Number(view.night) || 0));
  ctx.save();

  if (scene.id === 'sunBreak') {
    const daylight = (1 - night) * alpha;
    const drift = direction * (p - .5) * W * .51 + Math.sin(t * .13 + seed) * W * .022;
    const center = W * site + drift;
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = daylight;
    ctx.transform(W * .105, 0, W * .15, H, center, 0);
    const beam = ctx.createRadialGradient(0, -.15, 0, 0, -.03, 1.06);
    beam.addColorStop(0, '#f3f4b865');
    beam.addColorStop(.30, '#d7edb140');
    beam.addColorStop(.64, '#bfe4b11f');
    beam.addColorStop(1, '#bfe4b100');
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(-.49, 0);
    ctx.lineTo(.49, 0);
    ctx.lineTo(1.44, 1);
    ctx.lineTo(-1.44, 1);
    ctx.closePath();
    ctx.fill();
  } else if (scene.id === 'boatShadow') {
    const travel = direction > 0 ? p : 1 - p;
    const x = mix(-W * .25, W * 1.25, travel);
    const bottomX = x - direction * W * .14;
    const floor = seabed(bottomX);
    ctx.globalAlpha = alpha * (1 - night * .6);
    ctx.save();
    ctx.translate(bottomX, floor);
    ctx.scale(W * .22, H * .095);
    const shadow = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    shadow.addColorStop(0, '#041b2780');
    shadow.addColorStop(1, '#041b2700');
    ctx.fillStyle = shadow;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
    ctx.save();
    ctx.transform(W * .19, 0, bottomX - x, H, x, 0);
    const water = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    water.addColorStop(0, '#041e2a69');
    water.addColorStop(.55, '#041e2a33');
    water.addColorStop(1, '#041e2a00');
    ctx.fillStyle = water;
    ctx.fillRect(-1, 0, 2, 1);
    ctx.restore();
  } else {
    const { x, scale, bob, lineX, lineAmount, hookX, hookY } = scene.fishing;
    ctx.globalAlpha = alpha * (1 - night * .35);
    // The upper canvas edge is the waterline. The topsides stay above it.
    ctx.save();
    ctx.translate(x, bob - 16 * scale);
    ctx.scale(direction * scale, scale);
    const paint = ctx.createLinearGradient(0, 15, 0, 40);
    paint.addColorStop(0, '#44686d');
    paint.addColorStop(.12, '#a36b51');
    paint.addColorStop(1, '#4f3933');
    ctx.fillStyle = paint;
    ctx.beginPath();
    ctx.moveTo(-69, 5); ctx.lineTo(68, 4);
    ctx.quadraticCurveTo(62, 20, 43, 31);
    ctx.quadraticCurveTo(8, 43, -44, 33);
    ctx.quadraticCurveTo(-67, 25, -69, 5);
    ctx.closePath(); ctx.fill();
    ctx.restore();
    if (lineAmount > .001) {
      ctx.strokeStyle = 'rgba(218,230,211,0.72)';
      ctx.lineWidth = Math.max(1, scale);
      ctx.beginPath(); ctx.moveTo(lineX, 0);
      ctx.quadraticCurveTo(lineX + Math.sin(t * .7) * 8 * lineAmount, hookY * .55, hookX, hookY);
      ctx.stroke();
      ctx.beginPath(); ctx.arc(hookX + 2 * scale, hookY, 2 * scale, .08, Math.PI); ctx.stroke();
    }
  }
  ctx.restore();
}
