// Use DOM effects so desktop click positions never appear in exported canvases.
(() => {
  'use strict';
  if (!new URLSearchParams(location.search).has('wallpaper')) return;
  const canvas = document.getElementById('art') || document.querySelector('canvas');
  const bridge = window.chrome?.webview;
  if (!bridge || !canvas) return;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let shown = false, paused = false;
  bridge.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.t === 'pause') paused = !!message.v;
    if (message.t === 'icons' && !shown) {
      shown = true;
      if (!reduceMotion.matches) canvas.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 360 });
    }
    if (message.t !== 'ripple' || paused || reduceMotion.matches) return;
    const ripple = document.createElement('div');
    const ratio = devicePixelRatio || 1;
    Object.assign(ripple.style, {
      position: 'fixed', pointerEvents: 'none', zIndex: '5',
      left: message.x / ratio + 'px', top: message.y / ratio + 'px',
      width: '32px', height: '32px', border: '2px solid rgba(255,255,255,.72)', borderRadius: '50%'
    });
    document.body.appendChild(ripple);
    ripple.animate([
      { transform: 'translate(-50%, -50%) scale(.15)', opacity: 0.9 },
      { transform: 'translate(-50%, -50%) scale(2.1)', opacity: 0 }
    ], { duration: 520, easing: 'ease-out' }).finished.then(() => ripple.remove(), () => ripple.remove());
  });
})();
