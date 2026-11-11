// Procedural designs adapted from Living Desktop under GPL-3.0. See NOTICE.
'use strict';

const query = new URLSearchParams(location.search);
const WALL = query.has('wallpaper');
const PREVIEW = query.has('preview');
const STYLE = { lagoon: 0, sky: 1, colors: 2, openSky: 3 }[document.body.dataset.design] ?? 0;
const cv = document.getElementById('art');
const gl = cv.getContext('webgl2', { antialias: false, alpha: false });
const TASKBAR = 48, GRID_X0 = 4, GRID_Y0 = 6, CELL_W = 76, CELL_H = 100;
const DEFAULTS = {
  sigma: STYLE === 3 ? 72 : 95, speed: 1, detail: STYLE === 3 ? 0.3 : 0.65,
  palette: 0, adaptive: 1, seed: 42, lighting: 0
};
const P = { ...DEFAULTS };
const MORPH_MS = 1500;
const STEP = 10;
let W = innerWidth, H = innerHeight, icons = [];
let paused = false, previewMotion = !PREVIEW, lastFrame = 0, animationTime = 0, frameN = 0;
let hostDragging = false;
let fieldFrom, fieldTo, gridW, gridH, morphStart = -Infinity;
let program, textures;
const uniforms = {};

const VS=`#version 300 es
void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.-1.,0.,1.);}`;
const FS=`#version 300 es
precision highp float;
uniform sampler2D uA,uB;
uniform vec2 uRes;
uniform float uScale,uTime,uMix,uDetail,uSeed;
uniform int uStyle,uPalette;
uniform vec3 uSunShadow,uSunLight;
out vec4 o;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7))+uSeed*.17)*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1)),f.x),f.y);}
float fbm(vec2 p){return noise(p)*.57+noise(p*2.03)*.28+noise(p*4.11)*.15;}
float field(vec2 p){vec2 uv=clamp(p/uRes,vec2(0),vec2(1));return mix(texture(uA,uv).r,texture(uB,uv).r,uMix);}
float shape(vec2 p){vec2 warp=vec2(fbm(p*.006),fbm(p*.006+47.))*2.-1.;return field(p+warp*28.);}
void main(){
 vec2 p=vec2(gl_FragCoord.x,uRes.y*uScale-gl_FragCoord.y)/uScale;
 vec2 uv=p/uRes;float t=uTime;
 float grain=(hash(p)-.5)*.009;
 float f=shape(p);
 vec3 col;
 if(uStyle==0){
   // Lagoon: shallow luminous water, slowly traveling caustics and soft sand.
   float island=smoothstep(.29,.43,f);
   float shoal=smoothstep(.03,.33,f);
   vec3 deep=uPalette==1?vec3(.05,.22,.38):vec3(.018,.31,.39);
   vec3 shallow=uPalette==1?vec3(.22,.64,.78):vec3(.20,.76,.70);
   col=mix(deep,shallow,shoal);
   vec2 q=p*.018+vec2(t*.025,-t*.016);
   float caustic=pow(max(0.,1.-abs(sin(q.x+sin(q.y*1.4+t*.15))*cos(q.y+sin(q.x*.7-t*.12)))),13.);
   float glimmer=pow(max(0.,sin(p.x*.042+p.y*.027+t*.8+fbm(p*.008)*5.)),18.);
   col+=vec3(.22,.30,.23)*(caustic*.15+glimmer*.045)*uDetail;
   float shore=sin(f*65.-t*1.1+noise(p*.009)*2.);
   float foam=pow(max(0.,shore),16.)*smoothstep(.15,.28,f)*(1.-smoothstep(.31,.43,f));
   col=mix(col,vec3(.88,.97,.89),foam*.48);
   vec3 sand=mix(vec3(.80,.72,.53),vec3(.96,.90,.73),smoothstep(.35,.55,f));
   sand+=(fbm(p*.025)-.5)*.035;
   col=mix(col,sand,island);
   float wet=smoothstep(.28,.33,f)*(1.-smoothstep(.37,.46,f));
   col=mix(col,col*vec3(.83,.90,.85),wet*.22);
 }else if(uStyle==1){
   // Cloud banks follow icons. Smaller independent wisps cross the open sky.
   vec3 top=uPalette==1?vec3(.27,.26,.56):vec3(.12,.40,.73);
   vec3 bottom=uPalette==1?vec3(.93,.59,.52):vec3(.45,.73,.91);
   col=mix(top,bottom,uv.y*.75);
   float wisps=fbm(vec2(p.x*.002-t*.012,p.y*.004));
   float drift=smoothstep(.64,.86,wisps)*uDetail*.46;
   float edge=(fbm(p*.018+vec2(t*.015,0))-.5)*.13;
   float clouds=smoothstep(.21,.37,f+edge);
   float shadow=smoothstep(.21,.40,shape(p-uSunShadow.xy*38.)+edge);
   col*=1.-shadow*.18*uSunShadow.z;
   col=mix(col,vec3(.87,.94,.98),drift);
   float billow=fbm(p*.014+vec2(t*.007,0));
   float rim=clamp((shape(p-uSunShadow.xy*10.)-f)*3.,0.,1.);
   vec3 cloud=mix(vec3(.76,.85,.93),vec3(.99,.99,.97),billow*.65+.3-rim*.25);
   col=mix(col,cloud,clouds);
 }else if(uStyle==3){
   // Open sky with bright cloud banks and independent drifting clouds.
   vec3 top=vec3(.09,.39,.72),bottom=vec3(.48,.75,.96);
   if(uPalette==1){top=vec3(.26,.27,.58);bottom=vec3(.96,.55,.38);}
   if(uPalette==2){top=vec3(.04,.09,.22);bottom=vec3(.17,.28,.46);}
   col=mix(top,bottom,uv.y);
   float drift=fbm(p*vec2(.003,.007)+vec2(-t*.022,0.));
   float edges=(fbm(p*.025+vec2(t*.008,0.))-.5)*.14;
   float cover=max(smoothstep(.23,.37,f+edges),smoothstep(.62,.83,drift)*uDetail);
   vec3 cloud=mix(vec3(.71,.83,.95),vec3(.99,1.,1.),fbm(p*.023));
   if(uPalette==2)cloud*=vec3(.44,.54,.68);
   col=mix(col,cloud,cover);
 }else{
   // Liquid colour: two organic surfaces; four deliberately different palettes.
   vec3 a=vec3(.045,.24,.29),b=vec3(.65,.81,.70);
   if(uPalette==1){a=vec3(.21,.15,.40);b=vec3(.88,.65,.70);}
   if(uPalette==2){a=vec3(.64,.21,.15);b=vec3(.97,.77,.46);}
   if(uPalette==3){a=vec3(.11,.17,.28);b=vec3(.54,.69,.88);}
   vec2 flow=p*.003+vec2(t*.015,-t*.011);
   float n=fbm(flow+vec2(fbm(flow+9.),fbm(flow+38.))*2.);
   float boundary=clamp(f+(n-.5)*.18,0.,1.);
   float pool=smoothstep(.14,.47,boundary);
   col=mix(a,b,pool);
   float ribbon=pow(max(0.,1.-abs(sin((n+f*.7)*19.+t*.10))),20.);
   col+=ribbon*.045*uDetail;
   float bevel=smoothstep(.22,.32,boundary)*(1.-smoothstep(.32,.39,boundary));
   col+=bevel*vec3(.06,.06,.04);
   col*=.94+.06*fbm(p*.008+vec2(t*.02,0));
 }
 float vignette=1.-.10*dot(uv-.5,uv-.5);
 o=vec4((col*vignette+grain)*uSunLight,1.);
}`;

function compileShader(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
  return shader;
}

function mixAmount(now) {
  const t = Math.min(1, Math.max(0, (now - morphStart) / MORPH_MS));
  return t * t * (3 - 2 * t);
}

function uploadField(index, data) {
  gl.activeTexture(gl.TEXTURE0 + index);
  gl.bindTexture(gl.TEXTURE_2D, textures[index]);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, gridW, gridH, 0, gl.RED, gl.UNSIGNED_BYTE, data);
}

function buildField() {
  const sums = new Float32Array(gridW * gridH);
  const spread = P.sigma;
  const radius = spread * 3.5;
  if (!P.adaptive) return new Uint8Array(sums.length);
  for (const icon of icons) {
    const cx = icon.x + icon.w * 0.5, cy = icon.y + icon.h * 0.5;
    const halfWidth = icon.w * 0.36, halfHeight = icon.h * 0.36;
    const left = Math.max(0, Math.floor((cx - radius - halfWidth) / STEP));
    const right = Math.min(gridW - 1, Math.ceil((cx + radius + halfWidth) / STEP));
    const top = Math.max(0, Math.floor((cy - radius - halfHeight) / STEP));
    const bottom = Math.min(gridH - 1, Math.ceil((cy + radius + halfHeight) / STEP));
    for (let y = top; y <= bottom; y++) {
      for (let x = left; x <= right; x++) {
        const dx = Math.max(0, Math.abs(x * STEP - cx) - halfWidth);
        const dy = Math.max(0, Math.abs(y * STEP - cy) - halfHeight);
        sums[y * gridW + x] += Math.exp(-(dx * dx + dy * dy) / (spread * spread));
      }
    }
  }
  return Uint8Array.from(sums, value => Math.round((1 - Math.exp(-value)) * 255));
}

function commit(instant = false) {
  const next = buildField(), now = performance.now();
  if (!fieldTo || instant || paused || !previewMotion) {
    fieldFrom = next;
    morphStart = -Infinity;
  } else {
    const t = mixAmount(now);
    fieldFrom = Uint8Array.from(fieldTo, (value, i) => Math.round(fieldFrom[i] * (1 - t) + value * t));
    morphStart = now;
  }
  fieldTo = next;
  uploadField(0, fieldFrom);
  uploadField(1, fieldTo);
  if (paused || !previewMotion) draw(now);
}

function resize() {
  const rect = cv.getBoundingClientRect();
  W = rect.width || innerWidth;
  H = rect.height || innerHeight;
  const scale = PREVIEW ? 0.45 : devicePixelRatio || 1;
  cv.width = Math.max(1, Math.round(W * scale));
  cv.height = Math.max(1, Math.round(H * scale));
  cv._scale = scale;
  gridW = Math.ceil(W / STEP) + 1;
  gridH = Math.ceil(H / STEP) + 1;
  commit(true);
}

function applySettings(values) {
  const previousSigma = P.sigma, previousAdaptive = P.adaptive;
  const limits = {
    sigma: [35, 180], speed: [0, 3], detail: [0, 1],
    palette: [0, STYLE === 2 ? 3 : STYLE === 3 ? 2 : 1],
    adaptive: [0, 1], lighting: [0, 2], seed: [0, Number.MAX_SAFE_INTEGER]
  };
  for (const [key, [minimum, maximum]] of Object.entries(limits)) {
    if (!Number.isFinite(values[key])) continue;
    const value = Math.min(maximum, Math.max(minimum, values[key]));
    P[key] = ['palette', 'adaptive', 'lighting', 'seed'].includes(key) ? Math.round(value) : value;
  }
  if (previousSigma !== P.sigma || previousAdaptive !== P.adaptive) commit();
}

function draw(now) {
  gl.useProgram(program);
  gl.viewport(0, 0, cv.width, cv.height);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, textures[0]);
  gl.uniform1i(uniforms.uA, 0);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, textures[1]);
  gl.uniform1i(uniforms.uB, 1);
  gl.uniform2f(uniforms.uRes, cv.width / cv._scale, cv.height / cv._scale);
  gl.uniform1f(uniforms.uScale, cv._scale);
  gl.uniform1f(uniforms.uTime, animationTime);
  gl.uniform1f(uniforms.uMix, mixAmount(now));
  gl.uniform1f(uniforms.uDetail, P.detail);
  gl.uniform1f(uniforms.uSeed, P.seed);
  gl.uniform1i(uniforms.uStyle, STYLE);
  gl.uniform1i(uniforms.uPalette, P.palette);
  const sun = DynamicDesktopEnvironment.light(P.lighting);
  gl.uniform3f(uniforms.uSunShadow, sun.x, sun.y, 1 - sun.night);
  gl.uniform3f(uniforms.uSunLight, 1 - 0.72 * sun.night, 1 - 0.63 * sun.night, 1 - 0.48 * sun.night);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function frame(now) {
  requestAnimationFrame(frame);
  if (!window.dynamicDesktopRecording && (paused || !previewMotion)) { lastFrame = 0; return; }
  const fps = hostDragging ? 10 : !PREVIEW && mixAmount(now) < 1 ? 60 : 30;
  if (lastFrame && now - lastFrame < 1000 / fps - 2) return;
  animationTime += (lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 0) * P.speed;
  lastFrame = now;
  draw(now);
  frameN++;
}

function updateGhosts() {
  if (!PREVIEW) return;
  document.getElementById('ghosts').replaceChildren(...icons.map(icon => {
    const node = document.createElement('div');
    node.className = 'ghost';
    Object.assign(node.style, {
      left: icon.x + 'px', top: icon.y + 'px', width: icon.w + 'px', height: icon.h + 'px'
    });
    node.append(document.createElement('i'), document.createElement('b'));
    return node;
  }));
}

function handle(message) {
  if (!message || typeof message !== 'object') return;
  switch (message.t) {
    case 'settings': applySettings(message.v || {}); break;
    case 'reset': applySettings({ ...DEFAULTS, ...message.v }); break;
    case 'environment': DynamicDesktopEnvironment.environment(message.v); break;
    case 'previewMotion': if (PREVIEW) previewMotion = !!message.v; break;
    case 'dragging': hostDragging = !!message.v; break;
    case 'pause': if (WALL) paused = !!message.v; break;
    case 'icons': {
      const ratio = devicePixelRatio || 1;
      icons = message.vis ? message.r.map(([l, t, r, b]) => ({
        x: l / ratio, y: t / ratio, w: (r - l) / ratio, h: (b - t) / ratio
      })) : [];
      updateGhosts();
      commit();
      return;
    }
    default: return;
  }
  if (paused || !previewMotion) {
    morphStart = -Infinity;
    draw(performance.now());
  }
}

try {
  if (!gl) throw new Error('WebGL2 unavailable');
  program = gl.createProgram();
  gl.attachShader(program, compileShader(gl.VERTEX_SHADER, VS));
  gl.attachShader(program, compileShader(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  for (let i = 0; i < gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS); i++) {
    const name = gl.getActiveUniform(program, i).name;
    uniforms[name] = gl.getUniformLocation(program, name);
  }
  gl.bindVertexArray(gl.createVertexArray());
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  textures = [0, 1].map(() => {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  });
  if (!WALL && !PREVIEW) icons = [{ x: 60, y: 60, w: 76, h: 90 }, { x: 150, y: 60, w: 76, h: 90 }];
  resize();
  draw(performance.now());
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
} catch (error) {
  console.error(error);
  document.getElementById('nogl').hidden = false;
}
