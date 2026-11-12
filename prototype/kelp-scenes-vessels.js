'use strict';

function drawKelpVesselScene(scene, view, layer) {
  const { id, t, p, site, direction, alpha } = scene;
  const { ctx, W, H, night, seabed, models, modelWidth, surfaces } = view;
  const unit = Math.min(W, H);
  const day = 1 - night * .49;

  function vessel(model, x, y, width, heading, pitch, opacity, lamp = 0) {
    if (!model?.sprite || opacity <= 0) return;
    const height = width * model.sprite.height / model.sprite.width;
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.translate(x, y);
    ctx.scale(heading, 1);
    ctx.rotate(pitch);
    ctx.drawImage(model.sprite, -width / 2, -height / 2, width, height);
    if (lamp > .005) {
      const nose = width * .44;
      const glow = ctx.createRadialGradient(nose, 0, 0, nose, 0, width * .13);
      glow.addColorStop(0, '#fff1cc');
      glow.addColorStop(.18, '#fff1ccbb');
      glow.addColorStop(1, '#c8e7dd00');
      ctx.globalAlpha *= lamp;
      ctx.fillStyle = glow;
      ctx.fillRect(nose - width * .13, -width * .13, width * .26, width * .26);
    }
    ctx.restore();
  }

  if (id === 'subMeeting' && layer === 'water') {
    const subs = [models[0], models[1]].map((sub, i) => {
      const heading = i === 0 ? direction : -direction;
      const width = modelWidth(sub) * (i === 0 ? 1.02 : .85);
      const x = W * .5 + heading * (p * 2 - 1) * (W * .5 + width);
      const y = H * (i === 0 ? .49 : .34) + Math.sin(p * Math.PI) * H * (i === 0 ? -.018 : .025);
      const pitch = (i === 0 ? -.05 : .065) * Math.cos(p * Math.PI);
      return { sub, heading, width, x, y, pitch, opacity: alpha * day * (i === 0 ? .94 : .71) };
    });
    const beams = [];
    for (let i = 0; i < subs.length; i++) {
      const { heading, width, x, y, pitch } = subs[i];
      const other = subs[1 - i];
      const nose = width * .44;
      const dx = (other.x - x) * heading - nose * Math.cos(pitch);
      const dy = other.y - y - nose * Math.sin(pitch);
      const lit = smooth((p - .23 - i * .038) / .085) * smooth((dx - width * .23) / (width * .64));
      const signal = .72 + .28 * smooth(1 - Math.abs(p - (.37 + i * .034)) / .024);
      const strength = alpha * lit * signal * lerp(.70, .98, night);
      subs[i].lamp = strength;
      if (strength <= .01) continue;
      const tilt = clamp(Math.atan2(dy, dx) - pitch, -.65, .65);
      const length = Math.min(clamp(W * .30, 145, 460), Math.hypot(dx, dy));
      const beam = surfaceBeam(x, y, heading, pitch, nose, length, strength, tilt);
      stopLightAtScenery(beam, surfaces);
      ctx.save();
      ctx.clip(beam.visible);
      ctx.globalAlpha = strength;
      ctx.translate(x, y);
      ctx.scale(heading, 1);
      ctx.rotate(pitch);
      ctx.translate(nose, 0);
      ctx.rotate(tilt);
      drawSpotlight(0, length, { cinematic: false }, t);
      ctx.restore();
      beams.push(beam);
    }
    for (let i = subs.length - 1; i >= 0; i--) {
      const { sub, x, y, width, heading, pitch, opacity, lamp } = subs[i];
      vessel(sub, x, y, width, heading, pitch, opacity, lamp);
    }
    return beams;
  } else if (id === 'research' && layer === 'bottom') {
    const sub = models.find(model => model.id === 'c-researcher');
    const width = modelWidth(sub) * .86;
    const target = site * W;
    const floorY = seabed(target);
    const arrival = smooth(p / .36), departure = smooth((p - .64) / .36);
    const holdX = target - direction * width * .36;
    const entry = direction > 0 ? -width : W + width;
    const exit = direction > 0 ? W + width : -width;
    const x = lerp(lerp(entry, holdX, arrival), exit, departure);
    const y = floorY - width * .41 - H * .12 * (1 - arrival + departure) + Math.sin(t * 1.4) * 1.5;
    const reach = smooth((p - .36) / .08) * (1 - smooth((p - .47) / .11));
    const armX = x + direction * width * .22, armY = y + width * .18;
    const endX = lerp(armX + direction * width * .15, target, reach);
    const endY = lerp(armY + width * .065, floorY - 6, reach);
    const elbowX = lerp(armX, endX, .58) + direction * width * .06;
    const elbowY = lerp(armY, endY, .32);
    const grip = lerp(5, 2, smooth((p - .438) / .021));
    const sampled = p >= .459;

    ctx.save();
    ctx.globalAlpha = alpha * day;
    if (p < .58) {
      const rockX = sampled ? endX : target;
      const rockY = sampled ? endY + 4 : floorY - 2;
      ctx.globalAlpha *= 1 - smooth((p - .55) / .03);
      ctx.fillStyle = '#77918e';
      ctx.beginPath();
      ctx.ellipse(rockX, rockY, Math.max(3, unit * .008), Math.max(2, unit * .0045), -.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = alpha * day;
    if (reach > .01) {
      ctx.strokeStyle = '#8fb1ad';
      ctx.lineWidth = Math.max(2, width * .025);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(armX, armY);
      ctx.lineTo(elbowX, elbowY);
      ctx.lineTo(endX, endY);
      ctx.stroke();
      ctx.fillStyle = '#365660';
      ctx.beginPath();
      ctx.arc(elbowX, elbowY, ctx.lineWidth * .84, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth *= .56;
      ctx.beginPath();
      ctx.moveTo(endX - grip, endY + 4);
      ctx.lineTo(endX, endY);
      ctx.lineTo(endX + grip, endY + 4);
      ctx.stroke();
    }
    const sediment = clamp((p - .445) / .22, 0, 1);
    if (sediment > 0 && sediment < 1) {
      ctx.fillStyle = '#c0ac81';
      for (let i = 0; i < 19; i++) {
        const angle = i * 2.4;
        const spread = width * .26 * smooth(sediment);
        ctx.globalAlpha = alpha * .38 * Math.sin(sediment * Math.PI) * (1 - night * .6);
        ctx.beginPath();
        ctx.arc(target + Math.cos(angle) * spread * (.35 + (i % 6) / 8),
          floorY - 3 - Math.abs(Math.sin(angle)) * spread * .49 * Math.sin(Math.PI * sediment),
          .6 + i % 3 * .55, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
    vessel(sub, x, y, width, direction, 0, alpha * day, .32 + night * .6);
  }
}
