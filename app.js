/* =========================================================
   OBSIDIANA — Claude Fable 5.1 · main.js
   GSAP 3.13 + ScrollTrigger + SplitText · Three r128 · Lenis
   ========================================================= */
(() => {
'use strict';
gsap.registerPlugin(ScrollTrigger, SplitText);

/* ---------- env & utils ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const qs = new URLSearchParams(location.search);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = matchMedia('(pointer: fine)').matches;
const vw = () => window.innerWidth;
const vh = () => window.innerHeight;
const M = vw() < 768;            // mobile
const T = vw() < 1024;           // tablet or smaller
const PI = Math.PI;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const mix = (a, b, t) => a + (b - a) * t;
const seg = (p, a, b) => clamp((p - a) / (b - a), 0, 1);
const smooth = t => t * t * (3 - 2 * t);
const wait = ms => new Promise(r => setTimeout(r, ms));
const html = document.documentElement, body = document.body;

history.scrollRestoration = 'manual';
window.scrollTo(0, 0);
ScrollTrigger.config({ ignoreMobileResize: true, limitCallbacks: true });
gsap.ticker.lagSmoothing(0);

/* ---------- number formatting (PT-BR, single source) ---------- */
const nfCache = {};
function fmt(v, o = {}) {
  const dec = o.dec ?? 0, group = o.group !== false;
  const key = dec + '|' + group;
  const nf = nfCache[key] || (nfCache[key] = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec, useGrouping: group }));
  return (o.prefix || '') + nf.format(v) + (o.unit || '');
}
const pad2 = n => String(n).padStart(2, '0');

/* ---------- grain (runtime) ---------- */
(function grain() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const ctx = c.getContext('2d'); const img = ctx.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) { img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = Math.random() < .12 ? 255 : 0; }
  ctx.putImageData(img, 0, 0);
  $('#grain').style.backgroundImage = `url(${c.toDataURL()})`;
  if (M) $('#grain').style.opacity = .025;
})();

/* ---------- preloader readiness ---------- */
const pre = { fonts: 0, geo: 0, frame: 0, start: performance.now() };
function preUpdate() {
  const r = .4 * pre.fonts + .4 * pre.geo + .2 * pre.frame;
  const bar = $('.pre__bar'); if (bar) bar.style.transform = `scaleX(${r})`;
  ['fonts', 'geo', 'frame'].forEach(k => { const el = $(`[data-step="${k}"]`); if (el) el.classList.toggle('done', pre[k] >= 1); });
}

/* ---------- SplitText helpers ---------- */
function splitLines(el) {
  if (!el) return [];
  if (el.__lines) return el.__lines;
  const s = SplitText.create(el, { type: 'lines', linesClass: 'line' });
  const inner = s.lines.map(l => {
    const sp = document.createElement('span'); sp.className = 'line__in'; sp.style.display = 'block';
    while (l.firstChild) sp.appendChild(l.firstChild);
    l.appendChild(sp); return sp;
  });
  el.__lines = inner; return inner;
}
function splitWords(el) { if (!el) return []; if (el.__words) return el.__words; const s = SplitText.create(el, { type: 'words', wordsClass: 'w' }); el.__words = s.words; return s.words; }
function splitChars(el) { if (!el) return []; const s = SplitText.create(el, { type: 'words,chars', charsClass: 'char' }); return s.chars; }

/* =========================================================
   THE MONOLITH (Three.js)
   ========================================================= */
const S = {
  from: 0, to: 1, mix: 0,
  rotX: .12, rotY: 0, rotZ: 0, posX: 0, posY: 0, scale: 1.3,
  solid: 0, glow: 1, density: 1, ember: .2, emberPulse: 0, flight: 1, light: .8,
  facet: -1, emberCol: -1, hoverBar: -1, bars: [0, 0, 0, 0], slab: [1, 1, 1, 1],
  ring: 2.2, ringSpeed: 1, bead: -1, beadPulse: 0, veil: 0, spin: 0,
};
const mouse = { x: 0, y: 0, tx: 0, ty: 0, nx: 0, ny: 0, active: false };
let gl = null;
const isCloud = s => (s === 0 || s === 6) ? 1 : 0;
const isBars = s => s === 2 ? 1 : 0;

const VS = `
uniform float uFrom, uTo, uMix, uTime, uFlight, uRotX, uRotY, uRotZ, uScale, uMirror, uDensity, uSize, uDpr;
uniform vec3 uOffset, uMouse; uniform float uMouseR;
uniform vec4 uBars, uSlab;
uniform float uRingRadius, uRingSpeed, uShowRing, uBead, uActiveFacet;
attribute vec3 aSeed, aCloud, aPrism, aNormal, aColor;
varying vec3 vColor; attribute float aFacet; attribute vec4 aBars, aLattice;
varying vec3 vN, vView, vSeed; varying float vAlpha, vFacetTint, vBar, vSlabA, vBead;
mat3 rotX(float a){ float c=cos(a), s=sin(a); return mat3(1.,0.,0., 0.,c,s, 0.,-s,c); }
mat3 rotY(float a){ float c=cos(a), s=sin(a); return mat3(c,0.,-s, 0.,1.,0., s,0.,c); }
mat3 rotZ(float a){ float c=cos(a), s=sin(a); return mat3(c,s,0., -s,c,0., 0.,0.,1.); }
float pick4(vec4 v, int k){ return k==0 ? v.x : (k==1 ? v.y : (k==2 ? v.z : v.w)); }
float slabShift(int k){ return -float(3-k)*0.45; }
vec3 target(int s, int k, int col){
  if (s == 0 || s >= 6) return aCloud;
  if (s == 1) return aPrism;
  if (s == 2) { float cx = aBars.w - 1.5; return vec3(cx + (aBars.x-.5)*.5, -1.3 + aBars.y * pick4(uBars, col) * 2.6, (aBars.z-.5)*.5); }
  if (s == 3) { float a = pick4(uSlab, k); return aPrism + vec3(0., slabShift(k) - (1.0-a)*0.35, 0.); }
  if (s == 4) return aLattice.xyz;
  if (aSeed.x < 0.02 && uShowRing > .5) { float a = aSeed.y*6.2832 + uTime*uRingSpeed*0.6; float R = uRingRadius*(1.0+(aSeed.z-.5)*.06); return vec3(R*cos(a), -R*sin(a)*0.4226, R*sin(a)*0.9063); }
  return aPrism;
}
vec3 arc(vec3 q){ return vec3(sin(q.y*2.1+uTime*.6), sin(q.z*1.7+uTime*.8), sin(q.x*1.9+uTime*.5)); }
void main(){
  float luminosity = dot(aColor, vec3(.2126,.7152,.0722));
  vec3 silver = pow(max(aColor, vec3(.001)), vec3(.48)) * 1.4;
  float sweep = pow(.5+.5*sin(aPrism.y*3.5-uTime*1.6),12.);
  vec3 energy = mix(vec3(.14,.8,1.),vec3(.65,.35,1.),.5+.5*sin(aPrism.x*2.+uTime*.35));
  vColor = silver + energy * (.13 + sweep*.8);
  int k = int(clamp(floor((aPrism.y + 1.6)/0.8), 0.0, 3.0));
  int col = int(aBars.w + 0.5);
  int a = int(uFrom + 0.5); int b = int(uTo + 0.5);
  float tw = clamp((uMix - aSeed.y*0.25)/0.75, 0.0, 1.0);
  float e = tw*tw*(3.0-2.0*tw);
  vec3 ta = target(a, k, col); vec3 tb = target(b, k, col);
  vec3 p = mix(ta, tb, e) + arc(ta) * sin(tw*3.14159) * uFlight * (0.4+0.6*aSeed.x) * 0.55;
  // Idle currents keep individual fragments moving even at scroll rest.
  p += vec3(sin(uTime*.85+aSeed.x*15.),cos(uTime*.7+aSeed.z*13.),sin(uTime*.6+aSeed.y*12.)) * .035;
  p.y += sin(uTime*.55)*.045;
  vec2 d = p.xy - uMouse.xy; float dl = length(d);
  float f = 1.0-smoothstep(0.0,uMouseR,dl);
  p.xy += (d/max(dl,.001))*f*.55;
  p.z += f*.18;
  mat3 R = rotZ(uRotZ) * rotX(uRotX) * rotY(uRotY);
  p = R * p; p.x *= uMirror; p = p*uScale + uOffset;
  vec3 n = R * aNormal; n.x *= uMirror; vN = n;
  vView = cameraPosition - p; vSeed = aSeed;
  vAlpha = step(aSeed.y, uDensity);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float sz = uSize * (0.6+0.8*aSeed.z) * uDpr * (4.0 / max(-mv.z, 0.1));
  gl_PointSize = (vAlpha < .5) ? 0.0 : clamp(sz, 1.0, 6.0*uDpr);
  float ft = (abs(aFacet - uActiveFacet) < .5) ? 1.0 : 0.0;
  vFacetTint = (a == 4 || b == 4) ? ft * aLattice.w : ft;
  vBar = aBars.w; vSlabA = pick4(uSlab, k);
  vBead = (uBead < 0.0) ? 0.0 : 1.0 - smoothstep(0.0, 0.12, abs(aPrism.y - (uBead*3.2-1.6)));
}`;

const FS = `
uniform vec3 uBase, uRimColor, uSpecColor;
varying vec3 vColor;
uniform float uEmberAmt, uLightAngle, uCloud, uBarsAmt, uVeil, uGlowPass, uGlow, uBeadPulse, uEmberColumn, uHoverBar;
uniform vec2 uResolution;
varying vec3 vN, vView, vSeed; varying float vAlpha, vFacetTint, vBar, vSlabA, vBead;
void main(){
  float dd = length(gl_PointCoord - 0.5); float disc = smoothstep(0.5, 0.12, dd); if (disc < 0.01) discard;
  vec3 N = normalize(vN); vec3 V = normalize(vView);
  float fres = pow(1.0 - abs(dot(N, V)), 3.0);
  vec3 L = normalize(vec3(cos(uLightAngle), 0.6, sin(uLightAngle)));
  float spec = pow(max(dot(reflect(-L, N), V), 0.0), 32.0);
  float veil = smoothstep(uVeil + 0.03, uVeil - 0.03, gl_FragCoord.y / uResolution.y);
  float colHi = (abs(vBar - uEmberColumn) < .5 ? 0.35 : 0.0) + (abs(vBar - uHoverBar) < .5 ? 0.2 : 0.0);
  if (uGlowPass > 0.5) {
    vec3 g = uRimColor * fres * 0.5 + uSpecColor * (spec * uEmberAmt * 0.8 + vFacetTint * 0.5 + vBead * 0.6 + colHi * uBarsAmt);
    g += vColor * .22;
    g += uRimColor * 0.35 * uCloud * (0.5 + 0.5 * vSeed.z);
    g += uSpecColor * 0.30 * uBarsAmt * (0.3 + 0.7 * vSeed.z);
    float a2 = disc * 0.55 * uGlow * vAlpha * veil * mix(0.3, 1.0, vSlabA);
    gl_FragColor = vec4(g, a2);
  } else {
    vec3 col = vColor * (1.0 + 0.25 * vSeed.z);
    col += uRimColor * fres * mix(0.9, 1.7, uCloud);
    col += uSpecColor * spec * uEmberAmt * (1.0 - uCloud);
    col += uSpecColor * 0.6 * vFacetTint;
    col += uSpecColor * colHi * uBarsAmt;
    col += uSpecColor * (0.8 + uBeadPulse) * vBead;
    col += uRimColor * 0.25 * uCloud;
    col += uSpecColor * 0.18 * uBarsAmt;
    float a1 = disc * vAlpha * mix(0.92, 0.5, uCloud) * mix(0.08, 1.0, vSlabA) * veil;
    gl_FragColor = vec4(col, a1);
  }
}`;

const CVS = `
varying vec3 vN, vV;
void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vV = cameraPosition - wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`;
const CFS = `
uniform float uSolid, uEmberAmt, uLightAngle, uVeil; uniform vec3 uDark, uLight, uSpec; uniform vec2 uResolution;
varying vec3 vN, vV;
void main(){
  vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N; vec3 V = normalize(vV);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 1.5);
  vec3 L = normalize(vec3(cos(uLightAngle), 0.6, sin(uLightAngle)));
  float spec = pow(max(dot(reflect(-L, N), V), 0.0), 24.0);
  float veil = smoothstep(uVeil + 0.03, uVeil - 0.03, gl_FragCoord.y / uResolution.y);
  vec3 col = mix(uDark, uLight, fres) + uSpec * spec * 0.35 * uEmberAmt;
  gl_FragColor = vec4(col, uSolid * veil);
}`;

async function buildGeometry(N,onProgress){
 const img=new Image(); img.src='media/nexus.webp'; await img.decode();
 const c=document.createElement('canvas'); c.width=c.height=420; const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0,420,420);
 const data=ctx.getImageData(0,0,420,420).data, pixels=[];
 for(let y=0;y<420;y++)for(let x=0;x<420;x++){const k=(y*420+x)*4;if(data[k+3]>100 && data[k]+data[k+1]+data[k+2]>45)pixels.push([x,y,data[k]/255,data[k+1]/255,data[k+2]/255]);}
 const seed=new Float32Array(N*3),cloud=new Float32Array(N*3),prism=new Float32Array(N*3),normal=new Float32Array(N*3),color=new Float32Array(N*3),facet=new Float32Array(N),bars=new Float32Array(N*4),lattice=new Float32Array(N*4);
 for(let i=0;i<N;i++){const p=pixels[Math.floor(Math.random()*pixels.length)],j=i*3,k=i*4;const lum=(p[2]+p[3]+p[4])/3;
 seed.set([Math.random(),Math.random(),Math.random()],j);
 const x=(p[0]/420-.5)*3.3,y=(.5-p[1]/420)*3.3,z=(lum-.5)*.22;
 prism.set([x,y,z],j);normal.set([0,0,1],j);color.set([p[2],p[3],p[4]],j);
 const angle=Math.random()*Math.PI*2,r=.3+Math.random()*2.6;
 cloud.set([Math.cos(angle)*r,Math.sin(angle)*r,(Math.random()-.5)*2],j);
 facet[i]=Math.floor(Math.random()*6);bars.set([Math.random(),Math.random(),Math.random(),Math.floor(Math.random()*4)],k);
 lattice.set([x*1.4,y*1.4,z+(Math.random()-.5)*1.2,1],k);
 }onProgress(1);return{seed,cloud,prism,normal,color,facet,bars,lattice};
}

function initGL() {
  if (qs.get('tier') === 'css') return null;
  const canvas = $('#gl');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'high-performance' });
  } catch (e) { return null; }
  const dpr = Math.min(window.devicePixelRatio || 1, M ? 1 : 1.5);
  const N = M ? 24000 : T ? 45000 : 65000;
  const uSize = M ? 2.6 : 2.25;
  renderer.setPixelRatio(dpr); renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, vw() / vh(), .1, 30); camera.position.set(0, 0, 7); camera.lookAt(0, 0, 0);
  const res = new THREE.Vector2(1, 1);

  const mkPart = (colors, glowPass) => new THREE.ShaderMaterial({
    vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, depthTest: !glowPass,
    blending: glowPass ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: {
      uFrom: { value: 0 }, uTo: { value: 1 }, uMix: { value: 0 }, uTime: { value: 0 }, uFlight: { value: 1 }, uRotX: { value: 0 }, uRotY: { value: 0 }, uRotZ: { value: 0 }, uScale: { value: 1 }, uMirror: { value: 1 }, uDensity: { value: 1 }, uSize: { value: uSize }, uDpr: { value: dpr },
      uOffset: { value: new THREE.Vector3() }, uMouse: { value: new THREE.Vector3(99, 99, 99) }, uMouseR: { value: .68 },
      uBars: { value: new THREE.Vector4() }, uSlab: { value: new THREE.Vector4(1, 1, 1, 1) },
      uRingRadius: { value: 2.2 }, uRingSpeed: { value: 1 }, uShowRing: { value: 1 }, uBead: { value: -1 }, uActiveFacet: { value: -1 },
      uBase: { value: new THREE.Color(colors.base) }, uRimColor: { value: new THREE.Color(colors.rim) }, uSpecColor: { value: new THREE.Color(colors.spec) },
      uEmberAmt: { value: .2 }, uLightAngle: { value: .8 }, uCloud: { value: 1 }, uBarsAmt: { value: 0 }, uVeil: { value: 2 }, uGlowPass: { value: glowPass ? 1 : 0 }, uGlow: { value: 1 }, uBeadPulse: { value: 0 }, uEmberColumn: { value: -1 }, uHoverBar: { value: -1 }, uResolution: { value: res },
    },
  });
  const mkCore = (colors) => {
    const rig = new THREE.Group(), spin = new THREE.Group(); spin.rotation.order = 'ZXY'; rig.add(spin);
    const r = .965, slabs = [];
    [[-1.3, -.8], [-.8, 0], [0, .8], [.8, 1.3]].forEach(([y0, y1], k) => {
      const mat = new THREE.ShaderMaterial({ vertexShader: CVS, fragmentShader: CFS, transparent: true, depthWrite: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1,
        uniforms: { uSolid: { value: 0 }, uEmberAmt: { value: .2 }, uLightAngle: { value: .8 }, uVeil: { value: 2 }, uDark: { value: new THREE.Color(colors.dark) }, uLight: { value: new THREE.Color(colors.light) }, uSpec: { value: new THREE.Color(colors.spec) }, uResolution: { value: res } } });
      const g = new THREE.Group();
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(r, r, y1 - y0, 6, 1, false), mat); cyl.position.y = (y0 + y1) / 2; g.add(cyl);
      if (k === 0) { const cone = new THREE.Mesh(new THREE.ConeGeometry(r, .29, 6, 1, false), mat); cone.rotation.x = PI; cone.position.y = -1.3 - .145; g.add(cone); }
      if (k === 3) { const cone = new THREE.Mesh(new THREE.ConeGeometry(r, .29, 6, 1, false), mat); cone.position.y = 1.3 + .145; g.add(cone); }
      g.userData = { k, mat }; g.renderOrder = 0; spin.add(g); slabs.push(g);
    });
    scene.add(rig); return { rig, spin, slabs };
  };

  const geometry = new THREE.BufferGeometry();
  const body = new THREE.Points(geometry, mkPart({ base: '#1A1512', rim: '#50DFFF', spec: '#AA88FF' }, false)); body.renderOrder = 1; body.frustumCulled = false;
  const glow = new THREE.Points(geometry, mkPart({ base: '#1A1512', rim: '#50DFFF', spec: '#AA88FF' }, true)); glow.renderOrder = 2; glow.frustumCulled = false;
  const twinBody = new THREE.Points(geometry, mkPart({ base: '#1A1512', rim: '#C9A96E', spec: '#E8CFA0' }, false)); twinBody.renderOrder = 1; twinBody.frustumCulled = false; twinBody.visible = false;
  twinBody.material.uniforms.uMirror.value = -1; twinBody.material.uniforms.uShowRing.value = 0;
  scene.add(body, glow, twinBody);
  const main = mkCore({ dark: '#0F0D0B', light: '#1F1A16', spec: '#D97757' });
  const twin = mkCore({ dark: '#100E0A', light: '#2A2318', spec: '#E8CFA0' }); twin.rig.visible = false;

  gl = { renderer, scene, camera, geometry, body, glow, twinBody, main, twin, res, dpr, N, ready: false };
  resizeGL();
  const geoP = buildGeometry(N, p => { pre.geo = p * .98; preUpdate(); }).then(A => {
    geometry.setAttribute('aColor', new THREE.BufferAttribute(A.color, 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(A.seed, 3));
    geometry.setAttribute('aCloud', new THREE.BufferAttribute(A.cloud, 3));
    geometry.setAttribute('aPrism', new THREE.BufferAttribute(A.prism, 3));
    geometry.setAttribute('aNormal', new THREE.BufferAttribute(A.normal, 3));
    geometry.setAttribute('aFacet', new THREE.BufferAttribute(A.facet, 1));
    geometry.setAttribute('aBars', new THREE.BufferAttribute(A.bars, 4));
    geometry.setAttribute('aLattice', new THREE.BufferAttribute(A.lattice, 4));
    geometry.setAttribute('position', new THREE.BufferAttribute(A.prism, 3));
    gl.ready = true;
    try { renderer.compile(scene, camera); } catch (e) { /* ignore */ }
  });
  return geoP;
}

function resizeGL() {
  if (!gl) return;
  gl.renderer.setSize(vw(), vh(), false);
  gl.camera.aspect = vw() / vh(); gl.camera.updateProjectionMatrix();
  const db = gl.renderer.getDrawingBufferSize(new THREE.Vector2()); gl.res.set(db.x, db.y);
}

/* pointer → object space */
const _v = new THREE.Vector3(), _dir = new THREE.Vector3(), _oc = new THREE.Vector3(), _c = new THREE.Vector3(), _e = new THREE.Euler(), _q = new THREE.Quaternion();
function mouseObj(rotX, rotY, sc) {
  if (!mouse.active || reduced || motionPaused) return _v.set(99, 99, 99);
  const cam = gl.camera;
  _v.set(mouse.nx, mouse.ny, .5).unproject(cam); _dir.copy(_v).sub(cam.position).normalize();
  _c.set(S.posX, S.posY, 0); _oc.copy(cam.position).sub(_c);
  // Intersect the image plane, not the front of a bounding sphere.
  const t = -cam.position.z / _dir.z;
  _v.copy(cam.position).addScaledVector(_dir, t).sub(_c).divideScalar(sc);
  _e.set(rotX, rotY, S.rotZ, 'ZXY'); _q.setFromEuler(_e).invert(); _v.applyQuaternion(_q);
  return _v;
}

const lampEl = $('#lamp');
const _p = new THREE.Vector3();
function sync(time) {
  if (!gl || !gl.ready) return;
  mouse.x += (mouse.tx - mouse.x) * .06; mouse.y += (mouse.ty - mouse.y) * .06;
  const rotY = S.rotY + S.spin + mouse.x * .16 + Math.sin(time*.35)*.09, rotX = S.rotX + mouse.y * .10 + Math.cos(time*.3)*.025;
  const emberAmt = S.ember + S.emberPulse;
  const sc = S.scale * (M ? .75 : 1);
  const cloud = mix(isCloud(S.from), isCloud(S.to), S.mix), barsAmt = mix(isBars(S.from), isBars(S.to), S.mix);
  const mo = mouseObj(rotX, rotY, sc);
  const slabMix = (S.from === 3 ? 1 - S.mix : 0) + (S.to === 3 ? S.mix : 0);
  const twinX = M ? -S.posX : -S.posX, twinVis = S.veil > .001;

  const setP = (m, mirror, ox, veil, ring) => {
    const u = m.uniforms;
    u.uFrom.value = S.from; u.uTo.value = S.to; u.uMix.value = S.mix; u.uTime.value = time; u.uFlight.value = S.flight;
    u.uRotX.value = rotX; u.uRotY.value = rotY; u.uRotZ.value = S.rotZ; u.uScale.value = sc; u.uMirror.value = mirror; u.uOffset.value.set(ox, S.posY, 0);
    u.uDensity.value = S.density; u.uBars.value.set(S.bars[0], S.bars[1], S.bars[2], S.bars[3]); u.uSlab.value.set(S.slab[0], S.slab[1], S.slab[2], S.slab[3]);
    u.uRingRadius.value = S.ring; u.uRingSpeed.value = S.ringSpeed; u.uShowRing.value = ring; u.uBead.value = S.bead; u.uActiveFacet.value = S.facet;
    u.uEmberAmt.value = emberAmt; u.uLightAngle.value = S.light; u.uCloud.value = cloud; u.uBarsAmt.value = barsAmt; u.uVeil.value = veil; u.uGlow.value = S.glow;
    u.uBeadPulse.value = S.beadPulse; u.uEmberColumn.value = S.emberCol; u.uHoverBar.value = S.hoverBar; u.uMouse.value.copy(mirror > 0 ? mo : _p.set(99, 99, 99));
  };
  setP(gl.body.material, 1, S.posX, 2, 1); setP(gl.glow.material, 1, S.posX, 2, 1);
  gl.glow.visible = S.glow > .02;
  gl.twinBody.visible = twinVis; if (twinVis) setP(gl.twinBody.material, -1, twinX, S.veil, 0);

  const applyCore = (core, px, mirror, veil) => {
    core.rig.position.set(px, S.posY, 0); core.rig.scale.set(sc * mirror, sc, sc); core.spin.rotation.set(rotX, rotY, S.rotZ);
    core.slabs.forEach(g => {
      const k = g.userData.k, a = S.slab[k], u = g.userData.mat.uniforms;
      g.position.y = (-(3 - k) * .45 - (1 - a) * .35) * slabMix;
      u.uSolid.value = S.solid * a; u.uEmberAmt.value = emberAmt; u.uLightAngle.value = S.light; u.uVeil.value = veil;
      g.visible = (S.solid * a) > .02;
    });
  };
  applyCore(gl.main, S.posX, 1, 2);
  gl.twin.rig.visible = twinVis; if (twinVis) applyCore(gl.twin, twinX, -1, S.veil);

  // ember lamp follows the object
  _p.set(S.posX, S.posY, 0).project(gl.camera);
  const lx = (_p.x + 1) / 2 * vw(), ly = (1 - _p.y) / 2 * vh();
  lampEl.style.transform = `translate3d(${lx.toFixed(1)}px, ${ly.toFixed(1)}px, 0)`;
  lampEl.style.setProperty('--ember-a', (.08 + .14 * emberAmt * (1 - cloud * .6)).toFixed(3));
  gl.renderer.render(gl.scene, gl.camera);
}

// CONNECT-UP choreography: same continuous particle engine, new image-derived geometry.
let motionPaused=reduced, lenis=null, fallbackDraw=null;
const canvas=$('#gl'), fallback=$('.nexus-fallback');
Object.assign(S,{from:0,to:1,mix:1,solid:0,glow:.65,rotX:0,rotY:0,scale:M?.65:1.04,posX:M?0:1.65,posY:M?-1.05:0,flight:1.2});
if(!reduced&&typeof Lenis!=='undefined'){lenis=new Lenis({lerp:.085,smoothWheel:true});lenis.on('scroll',ScrollTrigger.update);}
function scrollToEl(el){if(!el)return;if(lenis)lenis.scrollTo(el,{duration:1.5});else el.scrollIntoView({behavior:reduced?'instant':'smooth'});}
$$('a[href^="#"]').forEach(a=>a.addEventListener('click',e=>{const el=$(a.getAttribute('href'));if(el){e.preventDefault();scrollToEl(el);}}));
const chapters=$$('.chapter');let activeChapter=null,frameCount=0;
function setChapter(el){const i=chapters.indexOf(el);$('#chapterName').textContent=`${pad2(i+1)} / ${el.dataset.title.toUpperCase()}`;}
function fadeScene(show){gsap.to([canvas,fallback,$('.energy-halo')],{opacity:show?1:0,duration:.6,overwrite:true});}
function scenePose(p){S.posX=M?0:Math.min(2.1,(vw()/vh())*.94);S.posY=M?-1.04:0;S.scale=M?.67:Math.min(1.08,vw()/vh()*.59);S.rotY=0;S.rotX=0;S.rotZ=Math.sin(p*PI)*.045;S.from=0;S.to=1;S.mix=p;}
function buildExperience(){
 const brief=$('#siteBrief');
 brief.addEventListener('submit',()=>{const values=new FormData(brief);const message=[
 'Olá, CONNECT-UP! Quero pedir meu site.',
 '', 'Nome: '+values.get('clientName'),
 values.get('business')?'Empresa / projeto: '+values.get('business'):'',
 'Tipo de site: '+values.get('siteType'),
 values.get('timing')?'Prazo desejado: '+values.get('timing'):'',
 '', 'Minha ideia: '+values.get('project')
 ].filter((line,i,arr)=>line!==''||arr[i-1]!=='').join('\n');
 $('#whatsappBrief').value=message;
 // Only the prepared message is a successful control; the other fields remain editable.
 for(const control of brief.querySelectorAll('[name]:not([name="text"])'))control.disabled=true;
 setTimeout(()=>{for(const control of brief.querySelectorAll('[disabled]'))control.disabled=false;},0);
 });

 gsap.to('.page-progress',{scaleX:1,ease:'none',scrollTrigger:{trigger:document.documentElement,start:0,end:'max',scrub:true}});
 const heroChars=splitChars($('.hero-copy h1'));
 gsap.from(heroChars,{opacity:0,yPercent:55,rotateX:-35,stagger:.018,duration:1.1,ease:'power3.out',delay:.5});
 if(!reduced){
 gsap.fromTo(S,{mix:0},{mix:1,duration:2.4,ease:'power2.inOut',delay:.1});
 ScrollTrigger.create({trigger:'#hero',start:'top top',end:'bottom top',onUpdate:s=>{if(s.progress>0){scenePose(1-s.progress*.95);}}});
 const statements=$$('.statement');
 const st=gsap.timeline({scrollTrigger:{trigger:'#manifesto',start:'top top',end:()=>'+='+vh()*2.5,pin:true,scrub:.7,anticipatePin:1,onUpdate:s=>{const p=s.progress;scenePose(.08+.92*(.5+.5*Math.cos(p*PI*4)));S.rotZ=Math.sin(p*PI*2)*.12;$('#sceneNumber').textContent=pad2(Math.min(3,Math.floor(p*3)+1));}}});
 statements.forEach((el,i)=>{const lines=splitLines($('h2',el));if(i>0){st.set(el,{autoAlpha:1},i).from(lines,{yPercent:110,opacity:0,duration:.3,stagger:.04},i).from($('p',el),{y:20,opacity:0,duration:.25},i+.13);}if(i<2)st.to(el,{autoAlpha:0,y:-25,duration:.2},i+.77);});st.to({}, {duration:.25},2.75);
 if(!M){
 $$('.services-chapter').forEach(section=>{const track=$('.service-track,.project-track',section);const distance=()=>Math.max(0,track.scrollWidth-(vw()-parseFloat(getComputedStyle(section).paddingLeft)*2));
 const timeline=gsap.timeline({scrollTrigger:{trigger:section,start:'top top',end:()=>'+='+Math.max(vh()*1.4,distance()*.85),pin:true,scrub:.85,anticipatePin:1,invalidateOnRefresh:true}});
 timeline.to(track,{x:()=>-distance(),ease:'none',duration:1},0).to($('.track-meter i',section),{scaleX:1,ease:'none',duration:1},0);
 });
 $$('.film-chapter').forEach(section=>{const film=$('.film-wrap',section),copy=$('.film-copy',section);gsap.timeline({scrollTrigger:{trigger:section,start:'top top',end:()=>'+='+vh()*.45,pin:true,scrub:1,anticipatePin:1}}).fromTo(film,{y:35,opacity:.6},{y:0,opacity:1,duration:1},0).fromTo(copy,{y:35,opacity:.35},{y:0,opacity:1,duration:.65},0);});
 const steps=$$('.process-step');gsap.timeline({scrollTrigger:{trigger:'#processo',start:'top top',end:()=>'+='+vh(),pin:true,scrub:.6}}).to(steps,{opacity:1,stagger:.4,duration:.3});
 }else{
 $$('.service-panel').forEach(el=>gsap.from(el,{y:45,opacity:0,duration:.8,scrollTrigger:{trigger:el,start:'top 90%',toggleActions:'play none none reverse'}}));
 }
 }else{scenePose(1);$('.network').style.display='none';}
 const videoObserver=new IntersectionObserver(entries=>entries.forEach(entry=>{const v=$('video',entry.target);if(entry.isIntersecting&&!reduced&&!v.dataset.userPaused)v.play().catch(()=>{});else v.pause();}),{threshold:.25});
 $$('.film-wrap').forEach(el=>{videoObserver.observe(el);const v=$('video',el),btn=$('.video-toggle',el);function label(){btn.textContent=v.paused?'▶':'Ⅱ';btn.setAttribute('aria-label',v.paused?'Reproduzir vídeo':'Pausar vídeo');}v.addEventListener('play',label);v.addEventListener('pause',label);btn.addEventListener('click',()=>{if(v.paused){delete v.dataset.userPaused;v.play().catch(()=>{});}else{v.dataset.userPaused='1';v.pause();}label();});label();});
 window.addEventListener('pointerout',e=>{if(!e.relatedTarget)mouse.active=false;});
 window.addEventListener('pointermove',e=>{mouse.clientX=e.clientX;mouse.clientY=e.clientY;mouse.tx=e.clientX/vw()-.5;mouse.ty=e.clientY/vh()-.5;mouse.nx=e.clientX/vw()*2-1;mouse.ny=1-e.clientY/vh()*2;mouse.active=true;},{passive:true});
 $('#motionToggle').addEventListener('click',()=>{motionPaused=!motionPaused;body.classList.toggle('motion-paused',motionPaused);$('#motionToggle').textContent=motionPaused?'Retomar movimento ▶':'Pausar movimento Ⅱ';$('#motionToggle').setAttribute('aria-label',motionPaused?'Retomar animação de partículas':'Pausar animação de partículas');});
 gsap.ticker.add((time)=>{if(lenis)lenis.raf(time*1000);if(document.hidden)return;if(++frameCount%8===0){const current=[...chapters].reverse().find(el=>el.getBoundingClientRect().top<vh()*.45)||chapters[0];if(current!==activeChapter){activeChapter=current;setChapter(current);fadeScene(['hero','manifesto'].includes(current.id));if(current.id==='hero'||current.id==='contato')scenePose(1);}}if(!motionPaused&&gl?.ready){S.light=.8+Math.sin(time*.15)*.3;sync(time);}else if(gl?.ready)sync(0);if(fallbackDraw)fallbackDraw(motionPaused?0:time);});
 initEnergyInteractions();
 initPortfolioScroll();
 ScrollTrigger.sort();
 ScrollTrigger.refresh();
}
async function initFragmentFallback(){
 const img=$('img',fallback);await img.decode();
 const sample=document.createElement('canvas');sample.width=sample.height=300;
 const sx=sample.getContext('2d',{willReadFrequently:true});sx.drawImage(img,0,0,300,300);const data=sx.getImageData(0,0,300,300).data;
 const c=document.createElement('canvas');c.width=c.height=640;c.style.width='100%';c.style.height='auto';c.setAttribute('aria-label','Partículas que reagem ao mouse e à rolagem');
 const ctx=c.getContext('2d');if(!ctx)return;fallback.appendChild(c);img.style.display='none';
 const dots=[],step=M?3:2;
 for(let y=0;y<300;y+=step)for(let x=0;x<300;x+=step){const k=(y*300+x)*4;if(data[k+3]<100||data[k]+data[k+1]+data[k+2]<45)continue;
 const seed=Math.random()*PI*2,rad=60+Math.random()*210;
 const bx=40+x/300*560,by=40+y/300*560;
 dots.push({bx,by,x:bx,y:by,vx:0,vy:0,dx:Math.cos(seed)*rad,dy:Math.sin(seed)*rad,seed,size:1.5+Math.random()*1.3,color:`rgb(${Math.min(255,Math.pow(data[k]/255,.48)*300+15)},${Math.min(255,Math.pow(data[k+1]/255,.48)*310+20)},${Math.min(255,Math.pow(data[k+2]/255,.48)*320+25)})`});}
 let lastTime=-1;
 fallbackDraw=time=>{if(motionPaused&&lastTime===time)return;lastTime=time;
 ctx.clearRect(0,0,640,640);const p=smooth(clamp(S.mix,0,1)),burst=1-p,rect=c.getBoundingClientRect();
 const mx=(mouse.clientX-rect.left)*640/rect.width,my=(mouse.clientY-rect.top)*640/rect.height;
 const hover=mouse.active&&!motionPaused&&!reduced;
 const turn=Math.sin(time*.35)*.035,cos=Math.cos(turn),sin=Math.sin(turn);
 for(const d of dots){const bx=d.bx-320,by=d.by-320;
 let tx=320+bx*cos-by*sin+d.dx*burst+Math.sin(time*.85+d.seed)*3.5,ty=320+bx*sin+by*cos+d.dy*burst+Math.cos(time*.75+d.seed)*3.5+Math.sin(time*.55)*7;
 if(hover){const dx=tx-mx,dy=ty-my,dist=Math.hypot(dx,dy);if(dist<110){const f=(1-dist/110)**2*75;tx+=dx/Math.max(dist,1)*f;ty+=dy/Math.max(dist,1)*f;}}
 d.vx=(d.vx+(tx-d.x)*.055)*.78;d.vy=(d.vy+(ty-d.y)*.055)*.78;d.x+=d.vx;d.y+=d.vy;
 const wave=Math.pow(.5+.5*Math.sin(d.by*.018-time*1.6),14);
 ctx.fillStyle=d.color;ctx.globalAlpha=.8+.2*p;ctx.fillRect(d.x,d.y,d.size,d.size);
 if(wave>.35){ctx.globalAlpha=wave*.6;ctx.fillStyle=d.bx<320?'#66eaff':'#b59aff';ctx.fillRect(d.x-1,d.y-1,d.size+2,d.size+2);}

 }
 };
}


function initPortfolioScroll(){
 const section=$('#portfolio'),track=$('.project-track',section),cards=$$('.project',section);
 const bar=document.createElement('div');bar.className='portfolio-controls';
 bar.innerHTML='<span class="portfolio-hint">CONTINUE ROLANDO PARA EXPLORAR →</span><div><button type="button" aria-label="Protótipo anterior">←</button><span class="portfolio-count">01 / '+pad2(cards.length)+'</span><button type="button" aria-label="Próximo protótipo">→</button></div>';
 section.appendChild(bar);const count=$('.portfolio-count',bar),buttons=$$('button',bar);
 const distance=()=>Math.max(0,track.scrollWidth-section.clientWidth+parseFloat(getComputedStyle(section).paddingLeft)+parseFloat(getComputedStyle(section).paddingRight));
 let current=0,timeline;
 const update=p=>{current=Math.min(cards.length-1,Math.round(p*(cards.length-1)));count.textContent=pad2(current+1)+' / '+pad2(cards.length);buttons[0].disabled=current===0;buttons[1].disabled=current===cards.length-1;};
 if(!reduced){
 timeline=gsap.timeline({scrollTrigger:{id:'portfolio-gallery',trigger:section,start:'top top',end:()=>'+='+(distance()+vh()*.55),pin:true,pinSpacing:true,scrub:.65,anticipatePin:1,invalidateOnRefresh:true},onUpdate:()=>update(Math.min(1,timeline.progress()/ .92))});
 timeline.fromTo(track,{x:0},{x:()=>-distance(),duration:.92,ease:'none'},0).to($('.track-meter i',section),{scaleX:1,duration:.92,ease:'none'},0).to({}, {duration:.08});
 }else{section.classList.add('portfolio-native');$('.portfolio-hint',bar).textContent='DESLIZE PARA EXPLORAR →';track.addEventListener('scroll',()=>update(track.scrollLeft/Math.max(1,track.scrollWidth-track.clientWidth)),{passive:true});}
 buttons.forEach((button,i)=>button.addEventListener('click',()=>{const target=clamp(current+(i?1:-1),0,cards.length-1);if(timeline){const st=timeline.scrollTrigger;const y=st.start+(st.end-st.start)*.92*target/(cards.length-1);if(lenis)lenis.scrollTo(y,{duration:1});else window.scrollTo({top:y,behavior:'smooth'});}else track.scrollTo({left:cards[target].offsetLeft-track.offsetLeft,behavior:'auto'});}));
 update(0);
}

function initEnergyInteractions(){
 const halo=document.createElement('div');halo.className='energy-halo';halo.setAttribute('aria-hidden','true');
 halo.innerHTML='<div class="halo-glow"></div><svg viewBox="0 0 600 600"><defs><linearGradient id="orbitColor"><stop stop-color="#51dcff"/><stop offset="1" stop-color="#ba8cff"/></linearGradient></defs><g class="orbit-a"><ellipse cx="300" cy="300" rx="268" ry="215"/><circle cx="568" cy="300" r="3"/></g><g class="orbit-b"><ellipse cx="300" cy="300" rx="238" ry="278"/><circle cx="300" cy="22" r="3"/></g></svg>';
 body.insertBefore(halo,canvas);
 const headings=$$('main h1,main h2,main h3');
 headings.forEach(el=>{el.classList.add('energy-type');if(el.querySelector('.char')){el.querySelectorAll('.char').forEach(c=>c.classList.add('kinetic-word'));}else splitWords(el).forEach(w=>w.classList.add('kinetic-word'));});
 if(reduced)return;
 $$('.film-copy h2,.process-layout h2,.request-copy h2,.brief-form h3').forEach(el=>{gsap.fromTo(el.querySelectorAll('.kinetic-word'),{opacity:.4,y:14},{opacity:1,y:0,stagger:.08,ease:'none',scrollTrigger:{trigger:el,start:'top 92%',end:'top 60%',scrub:.5}});});
 if(!finePointer)return;
 const trail=document.createElement('canvas');trail.className='energy-trail';trail.setAttribute('aria-hidden','true');body.appendChild(trail);
 const ctx=trail.getContext('2d');if(!ctx)return;
 let width=vw(),height=vh(),points=[],lastX=0,lastY=0,hovered=null,spot=null;
 function resize(){width=vw();height=vh();const d=Math.min(devicePixelRatio||1,1.5);trail.width=width*d;trail.height=height*d;ctx.setTransform(d,0,0,d,0,0);points=[];}
 resize();window.addEventListener('resize',resize);
 document.addEventListener('pointermove',e=>{
 if(motionPaused)return;
 const x=e.clientX,y=e.clientY;
 if(Math.hypot(x-lastX,y-lastY)>2){points.push({x,y,t:performance.now()});if(points.length>24)points.shift();lastX=x;lastY=y;}
 const word=e.target.closest('.kinetic-word');
 if(word!==hovered){hovered?.classList.remove('is-lit');hovered=word;hovered?.classList.add('is-lit');}
 const card=e.target.closest('.project-image,.service-panel,.brief-form,.action,.brief-submit');
 if(spot!==card){spot?.classList.remove('pointer-lit');spot=card;spot?.classList.add('pointer-lit');}
 if(card){const r=card.getBoundingClientRect();card.style.setProperty('--pointer-x',`${x-r.left}px`);card.style.setProperty('--pointer-y',`${y-r.top}px`);}
 },{passive:true});
 document.addEventListener('pointerout',e=>{if(!e.relatedTarget){points=[];hovered?.classList.remove('is-lit');spot?.classList.remove('pointer-lit');}});
 gsap.ticker.add(()=>{
 ctx.clearRect(0,0,width,height);if(document.hidden||motionPaused){points=[];return;}
 const now=performance.now();points=points.filter(p=>now-p.t<430);if(points.length<2)return;
 ctx.lineCap='round';ctx.globalCompositeOperation='lighter';
 for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],life=1-(now-b.t)/430;if(Math.hypot(a.x-b.x,a.y-b.y)>130)continue;
 ctx.strokeStyle=`rgba(100,220,255,${life*.65})`;ctx.lineWidth=life*1.6;ctx.shadowColor='#78dfff';ctx.shadowBlur=9;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
 ctx.shadowBlur=0;const end=points[points.length-1],life=1-(now-end.t)/430;
 const glow=ctx.createRadialGradient(end.x,end.y,0,end.x,end.y,65);glow.addColorStop(0,`rgba(110,190,255,${life*.08})`);glow.addColorStop(1,'rgba(110,190,255,0)');ctx.fillStyle=glow;ctx.fillRect(end.x-65,end.y-65,130,130);
 ctx.globalCompositeOperation='source-over';
 });
}

async function boot(){
 try{await Promise.race([initGL(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('geometry timeout')),7000))]);if(!gl)body.classList.add('no-gl');}catch(e){console.warn('Particle scene fallback:',e.message);body.classList.add('no-gl');gl=null;}
 if(!gl)await initFragmentFallback();
 scenePose(1);if(gl)sync(0);
 buildExperience();
 gsap.to('.loading-word',{opacity:0,duration:.35});gsap.to('.curtain--top',{yPercent:-100,duration:1,ease:'expo.inOut'});gsap.to('.curtain--bottom',{yPercent:100,duration:1,ease:'expo.inOut',onComplete:()=>$('#preloader')?.remove()});
 window.addEventListener('resize',()=>{resizeGL();scenePose(1);ScrollTrigger.refresh();});
 if(location.hash){const destination=document.getElementById(location.hash.slice(1));if(destination)setTimeout(()=>scrollToEl(destination),150);}
}
boot();
})();
