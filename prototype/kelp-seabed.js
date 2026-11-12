'use strict';

// All geometry is expressed in CSS pixels so it can share the scene's world transform.
const KelpSeabed = (() => {
  const TAU = Math.PI * 2;
  const shape = commands => {
    const path = new Path2D();
    commands(path);
    return path;
  };

  const hull = shape(p => {
    p.moveTo(-.49, -.16); p.lineTo(-.35, -.13); p.lineTo(-.23, -.14);
    p.lineTo(-.12, -.12); p.lineTo(.03, -.14); p.lineTo(.2, -.13);
    p.lineTo(.28, -.17); p.lineTo(.48, -.2); p.lineTo(.43, -.09);
    p.quadraticCurveTo(.36, -.025, .24, -.018); p.lineTo(-.29, -.025);
    p.quadraticCurveTo(-.43, -.045, -.49, -.16); p.closePath();
  });
  const cabin = shape(p => {
    p.moveTo(-.16, -.132); p.lineTo(-.15, -.255); p.lineTo(-.11, -.27);
    p.lineTo(-.105, -.31); p.lineTo(.075, -.31); p.lineTo(.09, -.28);
    p.lineTo(.13, -.26); p.lineTo(.145, -.137); p.closePath();
  });
  const mast = shape(p => {
    p.moveTo(.015, -.3); p.lineTo(.025, -.46); p.lineTo(.04, -.48);
    p.lineTo(.04, -.3); p.closePath();
    p.moveTo(-.025, -.41); p.lineTo(.095, -.4); p.lineTo(.1, -.389);
    p.lineTo(-.025, -.398); p.closePath();
  });
  const wreckLocal = new Path2D();
  wreckLocal.addPath(hull); wreckLocal.addPath(cabin); wreckLocal.addPath(mast);

  function buildWreck(x, floorY, width) {
    const angle = -.075;
    const c = Math.cos(angle), s = Math.sin(angle);
    // Keep the lowest point just below the sand, including the tilted end.
    const y = floorY - width * .016;
    const matrix = new DOMMatrix([width * c, width * s, -width * s, width * c, x, y]);
    const path = new Path2D();
    path.addPath(wreckLocal, matrix);
    const left = x - width * .53, right = x + width * .53;
    const top = y - width * .51, bottom = floorY + width * .035;

    function draw(ctx, lit) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.scale(width, width);
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.fillStyle = lit ? '#52645d' : '#102f38';
      ctx.fill(hull);
      ctx.fillStyle = lit ? '#61756a' : '#153943';
      ctx.fill(cabin); ctx.fill(mast);
      ctx.strokeStyle = lit ? '#9ca992' : '#34525a';
      ctx.lineWidth = .006;
      ctx.stroke(hull); ctx.stroke(cabin);

      // Broken deck railing and beams remain visible in silhouette.
      ctx.strokeStyle = lit ? '#a3ad94' : '#294a51';
      ctx.lineWidth = .007;
      ctx.beginPath();
      ctx.moveTo(-.38, -.145); ctx.lineTo(-.38, -.19); ctx.lineTo(-.32, -.185);
      ctx.moveTo(-.29, -.14); ctx.lineTo(-.29, -.185); ctx.lineTo(-.21, -.18);
      ctx.moveTo(.17, -.14); ctx.lineTo(.17, -.19); ctx.lineTo(.25, -.19);
      ctx.moveTo(.29, -.165); ctx.lineTo(.3, -.205); ctx.lineTo(.4, -.22);
      ctx.stroke();
      ctx.fillStyle = lit ? '#213d40' : '#0b2932';
      ctx.fillRect(-.125, -.268, .075, .054);
      ctx.fillRect(-.03, -.268, .073, .054);
      ctx.fillRect(.06, -.26, .045, .046);
      ctx.strokeStyle = lit ? '#96a995' : '#30525a';
      ctx.lineWidth = .0035;
      ctx.strokeRect(-.125, -.268, .075, .054);
      ctx.strokeRect(-.03, -.268, .073, .054);
      ctx.strokeRect(.06, -.26, .045, .046);
      if (lit) {
        // Sparse planking, corrosion and sand deposits make the light pass legible.
        ctx.strokeStyle = '#b3b49a88'; ctx.lineWidth = .003;
        ctx.beginPath();
        ctx.moveTo(-.42, -.112); ctx.lineTo(.39, -.118);
        ctx.moveTo(-.38, -.08); ctx.lineTo(.35, -.085);
        ctx.moveTo(-.3, -.05); ctx.lineTo(.25, -.054);
        ctx.moveTo(-.2, -.13); ctx.lineTo(-.19, -.06);
        ctx.moveTo(.03, -.135); ctx.lineTo(.02, -.055);
        ctx.moveTo(.25, -.145); ctx.lineTo(.24, -.07);
        ctx.stroke();
        ctx.fillStyle = '#a47d5b99';
        for (const [px, py, rx, ry] of [[-.34,-.12,.018,.006],[-.16,-.09,.013,.008],
          [.11,-.115,.023,.006],[.31,-.1,.014,.007],[-.04,-.3,.016,.004]]) {
          ctx.beginPath(); ctx.ellipse(px, py, rx, ry, .18, 0, TAU); ctx.fill();
        }
        ctx.fillStyle = '#9da98c88';
        ctx.beginPath(); ctx.ellipse(-.26, -.025, .08, .01, 0, 0, TAU);
        ctx.ellipse(.2, -.022, .11, .009, 0, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }
    return { left, right, top, bottom, path, draw };
  }

  function drawCrab(ctx, x, floorY, direction, time, size, opacity) {
    if (!(size > 0) || !(opacity > 0)) return;
    const stride = time * 7;
    ctx.save();
    ctx.globalAlpha *= Math.max(0, Math.min(1, opacity));
    ctx.translate(x, floorY);
    ctx.scale(size * (direction < 0 ? -1 : 1), size);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // Eight jointed legs alternate their stride and lift their feet.
    ctx.strokeStyle = '#704f43'; ctx.lineWidth = .035;
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < 4; i++) {
        const phase = stride + i * Math.PI * .7 + (side > 0 ? Math.PI : 0);
        const swing = Math.sin(phase) * .045;
        const lift = Math.max(0, Math.cos(phase)) * .045;
        const rootX = side * (.12 + i * .035);
        const kneeX = side * (.25 + i * .035) + swing;
        const footX = side * (.31 + i * .035) + swing * 1.5;
        ctx.beginPath(); ctx.moveTo(rootX, -.2); ctx.lineTo(kneeX, -.14 - lift);
        ctx.lineTo(footX, -.015 - lift); ctx.stroke();
      }
    }
    // The pincers move independently of the walking legs.
    for (let side = -1; side <= 1; side += 2) {
      const wave = Math.sin(stride * .55 + side) * .025;
      ctx.strokeStyle = '#805947'; ctx.lineWidth = .05;
      ctx.beginPath(); ctx.moveTo(side * .2, -.22);
      ctx.lineTo(side * .32, -.3 + wave); ctx.lineTo(side * .39, -.31 + wave); ctx.stroke();
      ctx.fillStyle = '#966451';
      ctx.beginPath(); ctx.ellipse(side * .4, -.31 + wave, .08, .055, side * -.3, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#503e38'; ctx.lineWidth = .012;
      ctx.beginPath(); ctx.moveTo(side * .4, -.31 + wave);
      ctx.lineTo(side * .47, -.33 + wave + Math.sin(stride + side) * .01); ctx.stroke();
    }
    ctx.fillStyle = '#895d4b';
    ctx.beginPath(); ctx.ellipse(0, -.22, .25, .12, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ae8065';
    ctx.beginPath(); ctx.ellipse(-.035, -.255, .15, .035, -.08, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#765042'; ctx.lineWidth = .016;
    ctx.beginPath(); ctx.moveTo(-.1, -.3); ctx.lineTo(-.1, -.35);
    ctx.moveTo(.1, -.3); ctx.lineTo(.1, -.35); ctx.stroke();
    ctx.fillStyle = '#d0b59a';
    ctx.beginPath(); ctx.arc(-.1, -.35, .019, 0, TAU); ctx.arc(.1, -.35, .019, 0, TAU); ctx.fill();
    ctx.restore();
  }

  function buildDetails(W, H, seabed, exclusions, random) {
    const details = [];
    const blocked = exclusions || [];
    const count = Math.max(3, Math.min(10, Math.floor(W / 220)));
    for (let i = 0; i < count * 4 && details.length < count; i++) {
      const x = 10 + random(i, 201) * Math.max(0, W - 20);
      const kind = details.length % 3;
      const size = kind === 0 ? 19 + random(i, 202) * 8 : 4 + random(i, 202) * 7;
      if (blocked.some(area => x + size * 2 >= area.left && x - size * 2 <= area.right)) continue;
      if (details.some(detail => Math.abs(detail.x - x) < detail.size + size + 14)) continue;
      const y = seabed(x);
      const p = new Path2D();
      if (kind === 0) {
        p.moveTo(x - size, y + 2); p.lineTo(x - size * .78, y - size * .35);
        p.quadraticCurveTo(x - size * .65, y - size * .53, x - size * .26, y - size * .67);
        p.lineTo(x + size * .21, y - size * .71); p.lineTo(x + size * .68, y - size * .47);
        p.lineTo(x + size, y + 2); p.closePath();
      } else if (kind === 1) {
        p.moveTo(x - size * .8, y); p.quadraticCurveTo(x, y - size * 1.1, x + size * .8, y);
        p.quadraticCurveTo(x, y + size * .16, x - size * .8, y); p.closePath();
      } else {
        p.moveTo(x, y); p.quadraticCurveTo(x - size * .5, y - size * .5, x - size * .45, y - size);
        p.moveTo(x, y); p.quadraticCurveTo(x + size * .12, y - size * .5, x + size * .08, y - size * 1.3);
        p.moveTo(x, y); p.quadraticCurveTo(x + size * .5, y - size * .45, x + size * .6, y - size * .8);
      }
      const detail = new Path2D();
      if (kind === 0) {
        detail.moveTo(x - size * .75, y - size * .31);
        detail.lineTo(x - size * .22, y - size * .45);
        detail.lineTo(x + size * .37, y - size * .48);
      } else if (kind === 1) {
        for (const angle of [-1, 0, 1]) {
          detail.moveTo(x + angle * size * .09, y);
          detail.quadraticCurveTo(x + angle * size * .30, y - size * .22, x + angle * size * .44, y - size * .34);
        }
      }
      details.push({ path: p, detail, kind, size, x });
    }
    const shelters = details.filter(detail => detail.kind === 0);
    return { shelters, draw(ctx, nightAmount) {
      ctx.save();
      const opacity = ctx.globalAlpha;
      ctx.lineCap = 'round';
      for (const detail of details) {
        ctx.globalAlpha = opacity * (detail.kind === 0 ? 1 : .72 - nightAmount * .3);
        if (detail.kind === 2) {
          ctx.strokeStyle = '#648576'; ctx.lineWidth = Math.max(.8, detail.size * .13); ctx.stroke(detail.path);
        } else {
          ctx.fillStyle = detail.kind === 0
            ? `color-mix(in srgb, #405b56, #102c38 ${nightAmount * 100}%)` : '#9a9d84';
          ctx.fill(detail.path);
          ctx.strokeStyle = detail.kind === 0 ? '#638478' : '#716f5c';
          ctx.lineWidth = detail.kind === 0 ? 1.1 : .65; ctx.stroke(detail.detail);
        }
      }
      ctx.restore();
    } };
  }

  return { buildWreck, drawCrab, buildDetails };
})();
