'use strict';

// Wildlife is drawn in local coordinates in the host's CSS-pixel space.
function drawKelpWildlifeScene(scene, view, layer) {
  const { ctx, W, H } = view;
  const { id, t, p, seed, direction, alpha } = scene;
  if (!alpha || !W || !H || layer !== 'water' || !['dolphins', 'silverHunt'].includes(id)) return;
  const unit = Math.min(W, H), dir = direction < 0 ? -1 : 1;
  const phase = (seed || 0) * .017;
  const clamp = x => Math.max(0, Math.min(1, x));
  const smooth = x => { x = clamp(x); return x * x * (3 - 2 * x); };

  function fish(x, y, size, angle, tail, shine) {
    ctx.save(); ctx.translate(x, y); ctx.scale(dir * size, size); ctx.rotate(angle);
    ctx.fillStyle = '#92b9bf';
    ctx.beginPath(); ctx.moveTo(-.38, 0); ctx.lineTo(-.65, -.16 - .035 * tail);
    ctx.quadraticCurveTo(-.55, 0, -.65, .16 + .035 * tail); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-.42, 0); ctx.bezierCurveTo(-.22, -.19, .18, -.22, .48, 0);
    ctx.bezierCurveTo(.18, .22, -.22, .19, -.42, 0); ctx.fill();
    ctx.fillStyle = `rgba(235,255,252,${shine})`; ctx.beginPath();
    ctx.ellipse(.04, -.05, .27, .035, -.08, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#173b49'; ctx.beginPath(); ctx.arc(.3, -.035, .026, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function dolphin(x, y, size, pitch, beat) {
    ctx.save(); ctx.translate(x, y); ctx.scale(dir * size, size); ctx.rotate(pitch);
    // The tail stock flexes vertically; the flukes retain their shape throughout the stroke.
    const skin = ctx.createLinearGradient(0, -.23, 0, .18);
    skin.addColorStop(0, '#577e8f');
    skin.addColorStop(.53, '#789eaa');
    skin.addColorStop(1, '#9bb8bc');
    ctx.fillStyle = skin;
    ctx.beginPath(); ctx.moveTo(-.39, -.035);
    ctx.bezierCurveTo(-.53, -.06, -.62, -.035 + beat * .07, -.72, beat * .11);
    ctx.bezierCurveTo(-.62, .045 + beat * .07, -.52, .055, -.39, .045); ctx.closePath(); ctx.fill();
    ctx.save(); ctx.translate(-.7, beat * .11); ctx.rotate(beat * .32);
    ctx.scale(1, .68 + .23 * Math.abs(beat));
    ctx.fillStyle = '#648997';
    ctx.beginPath(); ctx.moveTo(.03, 0);
    ctx.bezierCurveTo(-.05, -.052, -.16, -.13, -.30, -.092);
    ctx.bezierCurveTo(-.26, -.046, -.20, -.015, -.145, .005);
    ctx.bezierCurveTo(-.19, .030, -.24, .074, -.33, .103);
    ctx.bezierCurveTo(-.19, .135, -.04, .059, .03, 0); ctx.fill();
    ctx.restore();
    ctx.fillStyle = skin; ctx.beginPath(); ctx.moveTo(-.48, 0);
    ctx.bezierCurveTo(-.34, -.15, -.06, -.23, .22, -.16);
    ctx.bezierCurveTo(.34, -.14, .4, -.08, .46, -.055);
    ctx.quadraticCurveTo(.57, -.045, .67, -.015); ctx.quadraticCurveTo(.6, .025, .48, .02);
    ctx.bezierCurveTo(.31, .15, -.12, .19, -.48, 0); ctx.fill();
    ctx.fillStyle = '#b5cdd0aa'; ctx.beginPath(); ctx.moveTo(-.38, .04);
    ctx.bezierCurveTo(-.08, .09, .22, .1, .48, .02); ctx.bezierCurveTo(.26, .17, -.12, .18, -.38, .04); ctx.fill();
    ctx.fillStyle = '#527b89'; ctx.beginPath(); ctx.moveTo(-.15, -.17);
    ctx.bezierCurveTo(-.08, -.25, -.05, -.34, .01, -.33); ctx.quadraticCurveTo(-.01, -.23, .07, -.17); ctx.fill();
    ctx.beginPath(); ctx.moveTo(.11, .07); ctx.bezierCurveTo(.08, .17, -.01, .26, -.14, .26);
    ctx.quadraticCurveTo(-.08, .16, -.06, .08); ctx.fill();
    ctx.strokeStyle = 'rgba(225,243,242,.35)'; ctx.lineWidth = .015; ctx.beginPath();
    ctx.moveTo(-.31, -.075); ctx.bezierCurveTo(-.08, -.17, .2, -.16, .36, -.085); ctx.stroke();
    ctx.fillStyle = '#183d4a'; ctx.beginPath(); ctx.arc(.35, -.062, .018, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#426c79'; ctx.lineWidth = .012; ctx.beginPath(); ctx.moveTo(.49, .004); ctx.quadraticCurveTo(.56, .017, .62, .006); ctx.stroke();
    ctx.restore();
  }

  function predator(x, y, size, pitch, beat) {
    ctx.save(); ctx.translate(x, y); ctx.scale(dir * size, size); ctx.rotate(pitch);
    ctx.fillStyle = '#416d79';
    ctx.beginPath(); ctx.moveTo(-.43, 0); ctx.lineTo(-.7, -.21 - beat * .025);
    ctx.quadraticCurveTo(-.63, 0, -.7, .2 - beat * .025); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-.48, 0); ctx.bezierCurveTo(-.28, -.17, .18, -.2, .5, -.07);
    ctx.lineTo(.68, 0); ctx.lineTo(.48, .055); ctx.bezierCurveTo(.14, .16, -.28, .15, -.48, 0); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-.12, -.15); ctx.lineTo(.02, -.35); ctx.quadraticCurveTo(.03, -.22, .12, -.16); ctx.fill();
    ctx.beginPath(); ctx.moveTo(.1, .1); ctx.lineTo(-.08, .25); ctx.lineTo(-.04, .1); ctx.fill();
    ctx.fillStyle = '#bed2d1'; ctx.beginPath(); ctx.moveTo(-.35, .05); ctx.quadraticCurveTo(.08, .11, .51, .035);
    ctx.quadraticCurveTo(.15, .17, -.35, .05); ctx.fill();
    ctx.fillStyle = '#142f39'; ctx.beginPath(); ctx.arc(.42, -.046, .018, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  ctx.save(); ctx.globalAlpha *= clamp(alpha);
  if (id === 'dolphins') {
    const wave = t * 2.1 + phase;
    const x = (dir > 0 ? -.2 + p * 1.4 : 1.2 - p * 1.4) * W;
    const y = H * .3 + Math.sin(wave) * unit * .045;
    dolphin(x, y, unit * .2, Math.cos(wave) * .15, Math.sin(wave - .64));
  } else {
    // A looping school travels together while each fish moves on its own orbit.
    const travel = -.2 + p * 1.4;
    const cx = (dir > 0 ? travel : 1 - travel) * W + Math.sin(t * .42 + phase) * unit * .055;
    const bank = t * .61 + phase;
    const cy = H * .43 + Math.sin(bank) * unit * .07;
    const attack = smooth((p - .19) / .1) * (1 - smooth((p - .73) / .12));
    const passage = smooth((p - .28) / .42);
    const px = cx + dir * unit * (-.37 + passage * .76);
    const py = cy + unit * (.076 * Math.cos(passage * Math.PI * 2) + Math.sin(t * 1.15 + phase) * .014);
    for (let i = 0; i < 38; i++) {
      const a = i * 2.399963 + phase, radius = Math.sqrt((i + .5) / 38);
      const swim = t * (1.05 + (i % 5) * .08) + i * 1.7;
      let ox = Math.cos(a) * radius * unit * .18 + Math.sin(swim) * unit * .012;
      let oy = Math.sin(a) * radius * unit * .105 + Math.cos(swim * .85) * unit * .01;
      const dx = cx + dir * ox - px, dy = cy + oy - py;
      const distance = Math.hypot(dx, dy), influence = attack * Math.exp(-distance * distance / (unit * unit * .026));
      const side = Math.sin(a) >= 0 ? 1 : -1;
      ox += dir * (dx / (distance + unit * .02)) * influence * unit * .035;
      oy += side * influence * unit * .09;
      const angle = Math.cos(bank) * .18 + Math.sin(swim) * .17 + side * influence * .45;
      const glint = .12 + Math.max(0, Math.sin(swim * 1.5)) ** 5 * .68;
      fish(cx + dir * ox, cy + oy, unit * (.025 + (i % 4) * .002), angle, Math.sin(swim * 4), glint);
    }
    if (attack > 0) {
      ctx.save(); ctx.globalAlpha *= attack;
      predator(px, py, unit * .15, Math.cos(bank) * .13 - Math.sin(passage * Math.PI * 2) * .21, Math.sin(t * 5));
      ctx.restore();
    }
  }
  ctx.restore();
}
