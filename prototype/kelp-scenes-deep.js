// Procedural deep-water encounters. Coordinates are in the canvas's logical pixels.
function drawKelpDeepScene(scene, view, layer) {
  const { ctx, W, H, night, seabed, light } = view;
  const { id, t, p, direction = 1, alpha = 1 } = scene;
  const unit = Math.min(W, H);
  const site = (scene.site == null ? .48 : scene.site) * W;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const smooth = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
  const ellipse = (x, y, rx, ry) => { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); };
  if (id === 'jellyParade' && layer === 'water') {
    // Each animal has its own path and bell rhythm, with the oral arms lagging behind.
    const animals = [
      [-.30, .12, .86, .90], [-.13, -.10, 1.08, 1.12], [.06, .05, .94, .82],
      [.23, -.15, 1.15, 1.02], [.33, .12, .80, .73], [-.02, .21, 1.03, .67]
    ];
    ctx.save();
    animals.forEach(([ox, oy, speed, size], i) => {
      const phase = i * 2.37 + (scene.seed || 0) * .013;
      const beat = t * (1.5 + i * .11) + phase;
      const contraction = Math.pow(.5 + .5 * Math.sin(beat), 2);
      const progress = p * speed + .013 * (Math.sin(beat) - Math.sin(phase));
      const x = site + direction * unit * (ox + (progress - .5) * .47 + Math.sin(t * .25 + phase) * .029);
      const y = H * .58 + unit * (oy - (progress - .5) * .55 + Math.sin(t * .32 + phase) * .012);
      const s = unit * .037 * size;
      const glow = night * (.35 + .25 * (.5 + .5 * Math.sin(t * 1.4 + phase)));
      ctx.save(); ctx.translate(x, y); ctx.rotate(direction * (.49 + .19 * Math.cos(t * .25 + phase)));
      ctx.globalAlpha = alpha * (.62 + glow * .3);
      ctx.lineWidth = Math.max(.6, s * .035); ctx.strokeStyle = '#b7ece5a8';
      for (let j = 0; j < 7; j++) {
        const q = (j - 3) * s * .23;
        const sway = Math.sin(t * .9 + phase + j * .63);
        const trail = s * (1.38 + .13 * (j % 4) + .10 * Math.sin(beat - .9 + j));
        ctx.beginPath(); ctx.moveTo(q, s * .05);
        ctx.bezierCurveTo(q + sway * s * .23, trail * .26, q - sway * s * .17, trail * .52,
          q + sway * s * .15, trail * .67);
        ctx.quadraticCurveTo(q + sway * s * .41, trail * .86, q + sway * s * .18, trail);
        ctx.stroke();
      }
      if (glow > .08) { ctx.shadowColor = '#78f9ef'; ctx.shadowBlur = s * glow; }
      const width = 1 - contraction * .16;
      const bell = ctx.createLinearGradient(0, -s, 0, s * .2);
      bell.addColorStop(0, night > .5 ? '#a7fff098' : '#d8f0e89e');
      bell.addColorStop(.72, '#8dd3d494');
      bell.addColorStop(1, '#6cb4c473');
      ctx.fillStyle = bell;
      ctx.beginPath(); ctx.moveTo(-s * width, 0);
      ctx.bezierCurveTo(-s * width, -s * (1.02 + contraction * .18), s * width, -s * (1.02 + contraction * .18), s * width, 0);
      for (let j = 3; j >= -3; j--) ctx.quadraticCurveTo(s * (j + .5) * width / 3.5, s * (.16 + contraction * .09), s * j * width / 3.5, s * .04);
      ctx.closePath(); ctx.fill(); ctx.shadowBlur = 0;
      ctx.strokeStyle = '#e1fff2a0'; ctx.beginPath(); ctx.moveTo(-s * width * .8, -s * .22);
      ctx.quadraticCurveTo(0, -s * (.48 + contraction * .1), s * width * .8, -s * .22); ctx.stroke();
      ctx.restore();
    });
    ctx.restore();
  } else if (id === 'whaleEye' && layer === 'distant') {
    const x = W * (.5 + direction * (p - .5) * .71), y = H * (.49 + .035 * p);
    const s = unit * .235, turn = smooth((p - .25) / .24) * (1 - smooth((p - .55) / .25));
    const beat = Math.sin(t * 1.06);
    const tail = -.025 + beat * .115;
    ctx.save(); ctx.translate(x, y); ctx.scale(direction * s * (1 - turn * .15), s);
    ctx.rotate(-.042 + turn * .08); ctx.globalAlpha = alpha * (night > .5 ? .56 : .66);
    const hide = ctx.createLinearGradient(0, -.44, 0, .45);
    hide.addColorStop(0, '#3f7182');
    hide.addColorStop(.52, '#265265');
    hide.addColorStop(1, '#5f7d80');
    ctx.fillStyle = hide;
    ctx.beginPath();
    ctx.moveTo(-1.53, tail);
    ctx.bezierCurveTo(-1.14, -.08 + tail * .6, -.91, -.31, -.53, -.37);
    ctx.bezierCurveTo(-.10, -.48, .45, -.43, .82, -.29);
    ctx.bezierCurveTo(1.02, -.23, 1.28, -.15, 1.39, -.07);
    ctx.bezierCurveTo(1.47, .02, 1.36, .14, 1.22, .20);
    ctx.bezierCurveTo(.91, .36, .40, .41, -.19, .28);
    ctx.bezierCurveTo(-.85, .12, -1.05, .08, -1.53, tail + .047);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#31596d';
    ctx.beginPath(); ctx.moveTo(-.88, -.25); ctx.quadraticCurveTo(-.78, -.41, -.72, -.42);
    ctx.quadraticCurveTo(-.73, -.34, -.63, -.34); ctx.closePath(); ctx.fill();
    ctx.save(); ctx.translate(-1.52, tail + .022); ctx.rotate(-beat * .26);
    ctx.beginPath(); ctx.moveTo(.04, 0);
    ctx.bezierCurveTo(-.19, -.055, -.29, -.19, -.61, -.20);
    ctx.bezierCurveTo(-.56, -.105, -.44, -.028, -.37, 0);
    ctx.bezierCurveTo(-.43, .045, -.57, .07, -.69, .12);
    ctx.bezierCurveTo(-.47, .21, -.21, .11, .04, .025); ctx.fill();
    ctx.restore();
    const fin = ctx.createLinearGradient(0, .18, 0, .72);
    fin.addColorStop(0, '#315d6b'); fin.addColorStop(1, '#6c9191');
    ctx.fillStyle = fin;
    ctx.beginPath(); ctx.moveTo(.20, .12);
    ctx.bezierCurveTo(.17, .30, -.10, .57 + turn * .11, -.52, .62 + turn * .10);
    ctx.bezierCurveTo(-.61, .60 + turn * .1, -.46, .52, -.34, .41);
    ctx.quadraticCurveTo(-.16, .26, -.10, .13); ctx.fill();
    ctx.strokeStyle = '#163c4f8c'; ctx.lineWidth = .013;
    ctx.beginPath(); ctx.moveTo(.60, .04); ctx.bezierCurveTo(.83, .085, 1.15, .075, 1.39, .025); ctx.stroke();
    ctx.strokeStyle = '#88a3a077'; ctx.lineWidth = .009;
    for (let j = 0; j < 4; j++) {
      ctx.beginPath(); ctx.moveTo(1.18 - j * .075, .14 + j * .015);
      ctx.bezierCurveTo(.95 - j * .075, .25 + j * .015, .58, .27 + j * .012, .29 + j * .045, .24 + j * .013);
      ctx.stroke();
    }
    const eyeX = .68 + turn * .065;
    ellipse(eyeX, -.016, .026, .020); ctx.fillStyle = '#122f40'; ctx.fill();
    ctx.globalAlpha *= .28 + turn * .65;
    ellipse(eyeX + .008, -.023, .009, .007); ctx.fillStyle = '#cce9df'; ctx.fill();
    ctx.restore();
  } else if (id === 'deepLure' && layer === 'water') {
    const x = site, y = Math.min(H * (scene.depth == null ? .72 : scene.depth), seabed(site) - unit * .07), s = unit * .075;
    const fish = illuminated => {
      ctx.save(); ctx.translate(x, y); ctx.scale(direction, 1);
      const flick = Math.sin(t * 2.2) * .10;
      const skin = ctx.createLinearGradient(-s * .7, -s * .55, s * .28, s * .55);
      skin.addColorStop(0, illuminated ? '#647269' : '#142932');
      skin.addColorStop(.55, illuminated ? '#424f49' : '#101f29');
      skin.addColorStop(1, illuminated ? '#252d2c' : '#0b1822');
      ctx.fillStyle = skin;
      ctx.beginPath(); ctx.moveTo(-s * .82, -s * .13);
      ctx.bezierCurveTo(-s * 1.12, -s * .13, -s * 1.32, -s * (.41 + flick), -s * 1.54, -s * (.36 + flick));
      ctx.quadraticCurveTo(-s * 1.40, -s * .06, -s * 1.56, s * (.24 + flick));
      ctx.bezierCurveTo(-s * 1.35, s * (.29 + flick), -s * 1.13, s * .10, -s * .82, s * .15); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-s * .75, -s * .25);
      ctx.quadraticCurveTo(-s * .58, -s * .59, -s * .37, -s * .47);
      ctx.bezierCurveTo(-s * .20, -s * .67, s * .09, -s * .60, s * .22, -s * .49);
      ctx.bezierCurveTo(s * .62, -s * .55, s * .99, -s * .41, s * 1.07, -s * .16);
      ctx.quadraticCurveTo(s * .89, -.05 * s, s * .53, .035 * s);
      ctx.quadraticCurveTo(s * .75, .15 * s, s * 1.13, s * .05);
      ctx.bezierCurveTo(s * 1.09, s * .44, s * .48, s * .61, -s * .20, s * .44);
      ctx.bezierCurveTo(-s * .67, s * .38, -s * .91, s * .15, -s * .92, -s * .02); ctx.closePath(); ctx.fill();
      ctx.fillStyle = illuminated ? '#364a40' : '#10242a';
      ctx.beginPath(); ctx.moveTo(-s * .31, s * .18); ctx.quadraticCurveTo(-s * .48, s * .57, -s * .77, s * .54);
      ctx.lineTo(-s * .57, s * .16); ctx.fill();
      ctx.strokeStyle = illuminated ? '#a9aaa0' : '#33494a'; ctx.lineWidth = Math.max(.8, s * .025);
      ctx.beginPath(); ctx.moveTo(s * .24, -s * .43); ctx.bezierCurveTo(s * .27, -s * 1.02, s * .65, -s * 1.30, s * 1.05, -s * 1.02); ctx.stroke();
      if (illuminated) {
        ellipse(s * .59, -s * .23, s * .073, s * .061); ctx.fillStyle = '#aaa995'; ctx.fill();
        ellipse(s * .61, -s * .23, s * .041, s * .045); ctx.fillStyle = '#1c2526'; ctx.fill();
        ctx.fillStyle = '#161e23';
        ctx.beginPath(); ctx.moveTo(s * .43, s * .038); ctx.quadraticCurveTo(s * .77, -s * .09, s * 1.07, -s * .16);
        ctx.lineTo(s * 1.13, s * .05); ctx.quadraticCurveTo(s * .79, s * .19, s * .43, s * .038); ctx.fill();
        ctx.fillStyle = '#c4c3af';
        for (let j = 0; j < 8; j++) {
          const q = .54 + j * .069, jaw = .018 - j * .021;
          const fang = .045 + .095 * Math.abs(Math.sin(j * 1.8));
          ctx.beginPath(); ctx.moveTo(s * q, s * jaw); ctx.lineTo(s * (q + .03), s * (jaw - .012));
          ctx.quadraticCurveTo(s * (q + .032), s * (jaw + fang * .68), s * (q - .012), s * (jaw + fang)); ctx.fill();
          if (j > 0 && j < 7) {
            ctx.beginPath(); ctx.moveTo(s * q, s * .12); ctx.lineTo(s * (q + .033), s * .112);
            ctx.lineTo(s * (q + .027), s * (.105 - fang * .68)); ctx.fill();
          }
        }
        ctx.strokeStyle = '#84958178'; ctx.lineWidth = s * .019;
        for (let j = 0; j < 3; j++) { ctx.beginPath(); ctx.moveTo(-s * (.30 + j * .11), -s * .12); ctx.quadraticCurveTo(-s * (.20 + j * .11), s * .08, -s * (.32 + j * .11), s * .25); ctx.stroke(); }
        ctx.fillStyle = '#a0aa9166';
        for (let j = 0; j < 14; j++) {
          ellipse(s * (-.69 + j * .103), s * (-.22 + .11 * Math.cos(j * 2.16)), s * (.012 + .008 * (j % 3)), s * .009);
          ctx.fill();
        }
      }
      ctx.restore();
    };
    ctx.save(); ctx.globalAlpha = alpha * .22; fish(false); ctx.restore();
    if (light && light.visible) { ctx.save(); ctx.clip(light.visible); ctx.globalAlpha = alpha * clamp(light.strength * 1.8, 0, 1); fish(true); ctx.restore(); }
    ctx.save(); ctx.globalAlpha = alpha * (.55 + .25 * Math.sin(t * 1.8)); ctx.fillStyle = '#bdf3bf'; ctx.shadowColor = '#a5f9c3'; ctx.shadowBlur = s * .55;
    ellipse(x + direction * s * 1.05, y - s * 1.02, s * .075, s * .075); ctx.fill(); ctx.restore();
  } else if (id === 'flatfish' && layer === 'bottom') {
    const travel = smooth((p - .20) / .48);
    const dive = smooth((p - .68) / .18);
    const x = site + direction * unit * .28 * travel;
    const floor = seabed(x), lift = unit * .025 * Math.sin(Math.PI * travel), s = unit * .045;
    ctx.save(); ctx.globalAlpha = alpha;
    if (travel > .02 && dive < .99) {
      ctx.fillStyle = '#b5ac8b';
      for (let i = 0; i < 7; i++) {
        const q = (i + 1) / 8;
        ctx.globalAlpha = alpha * .19 * Math.max(Math.sin(Math.PI * travel), Math.sin(Math.PI * dive)) * (1 - q);
        ellipse(x - direction * s * (1 + q * 2), floor - s * (.2 + q * .6), s * (.18 + q * .3), s * (.09 + q * .12));
        ctx.fill();
      }
    }
    ctx.globalAlpha = alpha * (1 - dive);
    ctx.translate(x, floor - lift - s * .10 + dive * s * .34); ctx.scale(direction, 1);
    if (travel > .01 && dive < .99) {
      const wave = Math.sin(t * 7) * .07;
      ctx.fillStyle = '#777862';
      ctx.beginPath(); ctx.moveTo(-s * .92, -s * .03);
      ctx.quadraticCurveTo(-s * 1.32, -s * (.17 + wave), -s * 1.57, -s * .31);
      ctx.quadraticCurveTo(-s * 1.49, 0, -s * 1.57, s * .23);
      ctx.quadraticCurveTo(-s * 1.28, s * (.14 - wave), -s * .92, s * .08); ctx.fill();
      const mottled = ctx.createLinearGradient(0, -s * .43, 0, s * .38);
      mottled.addColorStop(0, '#777460'); mottled.addColorStop(.52, '#a19a77'); mottled.addColorStop(1, '#746e54');
      ctx.fillStyle = mottled; ctx.beginPath(); ctx.moveTo(-s * 1.08, 0);
      ctx.bezierCurveTo(-s * .79, -s * (.35 + wave), -s * .24, -s * (.47 - wave), s * .45, -s * .32);
      ctx.quadraticCurveTo(s * .87, -s * .27, s * 1.04, -s * .08);
      ctx.quadraticCurveTo(s * .79, s * .15, s * .47, s * .20);
      ctx.bezierCurveTo(-s * .16, s * (.35 + wave), -s * .75, s * (.25 - wave), -s * 1.08, 0); ctx.fill();
      ctx.strokeStyle = '#d0c7a1a0'; ctx.lineWidth = Math.max(.6, s * .025);
      ctx.beginPath(); ctx.moveTo(-s * .93, -s * .05); ctx.quadraticCurveTo(-s * .2, -s * .42, s * .65, -s * .23); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-s * .93, s * .05); ctx.quadraticCurveTo(-s * .2, s * .32, s * .67, s * .13); ctx.stroke();
      ctx.strokeStyle = '#574f3f70'; ctx.lineWidth = Math.max(.45, s * .016);
      for (let j = 0; j < 15; j++) {
        const q = j / 14, fx = -.91 + q * 1.53;
        const fin = Math.sin(q * Math.PI) * (.94 + .06 * Math.sin(t * 10 - j * .62));
        ctx.beginPath(); ctx.moveTo(s * fx, -s * (.04 + fin * .24));
        ctx.lineTo(s * (fx - .06), -s * (.05 + fin * .32));
        ctx.moveTo(s * fx, s * (.03 + fin * .16)); ctx.lineTo(s * (fx - .07), s * (.03 + fin * .23));
        ctx.stroke();
      }
      ctx.fillStyle = '#696f5c';
      [[-.55,-.05,.10],[-.20,-.19,.08],[.02,.06,.11],[.35,-.08,.07],[-.40,.12,.06]].forEach(([px,py,r]) => { ellipse(s * px, s * py, s * r, s * r * .55); ctx.fill(); });
      ctx.strokeStyle = '#555e50'; ctx.beginPath(); ctx.moveTo(s * .78, -s * .05); ctx.lineTo(s * 1.01, -s * .06); ctx.stroke();
    }
    ctx.fillStyle = '#c2b99a'; ellipse(s * .44, -s * .16, s * .12, s * .09); ctx.fill(); ellipse(s * .18, -s * .19, s * .11, s * .085); ctx.fill();
    ctx.fillStyle = '#172e2d'; ellipse(s * .47, -s * .17, s * .037, s * .04); ctx.fill(); ellipse(s * .21, -s * .20, s * .037, s * .04); ctx.fill(); ctx.restore();
  }
}
