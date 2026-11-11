(function () {
  'use strict';
  const RAD = Math.PI / 180;
  let locationData = null, timeZone = null, cachedMinute = -1, cached = null;
  function environment(value) {
    const v = value || {};
    locationData = Number.isFinite(v.latitude) && Math.abs(v.latitude) <= 90 && Number.isFinite(v.longitude) && Math.abs(v.longitude) <= 180
      ? {latitude: v.latitude, longitude: v.longitude} : null;
    timeZone = null;
    if (typeof v.timeZone === 'string' && v.timeZone) {
      try { new Intl.DateTimeFormat('en', {timeZone:v.timeZone}).format(new Date()); timeZone = v.timeZone; } catch (_) {}
    }
    cachedMinute = -1;
  }
  function light(mode, date = new Date()) {
    const minute = Math.floor(date.getTime() / 60000);
    if (cached && minute === cachedMinute && mode === cached.mode) return cached;
    let elevation, azimuth;
    if (locationData) {
      const day = (date.getTime() - Date.UTC(date.getUTCFullYear(), 0, 0)) / 86400000;
      const gamma = 2 * Math.PI / 365 * (day - 1);
      const decl = .006918 - .399912*Math.cos(gamma) + .070257*Math.sin(gamma) - .006758*Math.cos(2*gamma) + .000907*Math.sin(2*gamma) - .002697*Math.cos(3*gamma) + .00148*Math.sin(3*gamma);
      const eq = 229.18 * (.000075 + .001868*Math.cos(gamma) - .032077*Math.sin(gamma) - .014615*Math.cos(2*gamma) - .040849*Math.sin(2*gamma));
      const hour = (date.getUTCHours()*60 + date.getUTCMinutes() + eq + 4*locationData.longitude) / 4 - 180;
      const h = hour * RAD, lat = locationData.latitude * RAD;
      elevation = Math.asin(Math.sin(lat)*Math.sin(decl) + Math.cos(lat)*Math.cos(decl)*Math.cos(h)) / RAD;
      azimuth = Math.atan2(Math.sin(h), Math.cos(h)*Math.sin(lat) - Math.tan(decl)*Math.cos(lat));
    } else {
      let hours = date.getHours(), minutes = date.getMinutes();
      if (timeZone) {
        const parts = new Intl.DateTimeFormat('en-GB', {timeZone, hour:'2-digit', minute:'2-digit', hourCycle:'h23'}).formatToParts(date);
        hours = Number(parts.find(p => p.type === 'hour').value);
        minutes = Number(parts.find(p => p.type === 'minute').value);
      }
      const h = (hours + minutes/60 - 12) * Math.PI / 12;
      elevation = 48 * Math.cos(h); azimuth = h;
    }
    const night = mode === 1 ? 1 : mode === 2 ? Math.max(0, Math.min(1, (3 - elevation) / 12)) : 0;
    const dx = mode === 0 ? .6 : Math.sin(azimuth), dy = mode === 0 ? .8 : .65 + .35*Math.cos(azimuth);
    const length = Math.hypot(dx, dy) || 1;
    const shadowLength = mode === 2 ? 0.55 + Math.max(0, 1 - Math.max(0, elevation) / 65) * 1.05 : 1;
    cachedMinute = minute;
    return cached = {mode, night, x:dx/length, y:dy/length, shadowLength};
  }
  function createMaskLayer() {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:1';
    document.body.appendChild(canvas);
    let images = [], enabled = false, size = 1, direction = {x:.6,y:.8,night:0}, generation = 0;
    let pendingPaint = 0;
    function schedulePaint() {
      if (pendingPaint) return;
      pendingPaint = requestAnimationFrame(() => {
        pendingPaint = 0;
        paint();
      });
    }
    function paint() {
      const box = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      const w = Math.round(box.width*dpr), h = Math.round(box.height*dpr);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      const ctx = canvas.getContext('2d'); ctx.clearRect(0,0,w,h);
      if (!enabled) return;
      ctx.save();ctx.filter = `blur(${Math.max(2, 4*size*dpr)}px)`;ctx.globalAlpha=.28 * (1 - direction.night * .8);
      for (const item of images) if (item.img.complete && item.img.naturalWidth) {
        ctx.drawImage(item.img,item.x+direction.x*7*size*dpr,item.y+direction.y*7*size*dpr,item.w,item.h);
      }
      ctx.globalCompositeOperation='source-in';ctx.fillStyle='#101b2c';ctx.fillRect(0,0,w,h);ctx.restore();
    }
    function masks(items) {
      const version = ++generation; images = [];
      for (const i of Array.isArray(items) ? items.slice(0, 1024) : []) {
        if (![i.x,i.y,i.w,i.h].every(Number.isFinite) || i.w <= 0 || i.h <= 0 || typeof i.src !== 'string' || !i.src.startsWith('data:image/png;base64,')) continue;
        const img = new Image(), item = {x:i.x,y:i.y,w:i.w,h:i.h,img}; images.push(item);
        img.onload = () => { if (version === generation) schedulePaint(); }; img.src = i.src;
      }
      schedulePaint();
    }
    addEventListener('resize', schedulePaint);
    return {
      masks,
      update(on, scale, sun) {
        if (enabled === on && size === scale && Math.abs(direction.x - sun.x) <= 0.02 &&
            Math.abs(direction.y - sun.y) <= 0.02 && Math.abs(direction.night - sun.night) <= 0.02) return;
        enabled = on;
        size = scale;
        direction = sun;
        schedulePaint();
      }
    };
  }
  window.DynamicDesktopEnvironment = {environment, light, createMaskLayer};
})();
