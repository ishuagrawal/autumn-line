import * as THREE from 'three';
import { CameraRig, type Mode } from './controls';
import { PHOTO, SUN_DIR } from './core/layout';
import { Pipeline } from './render/post';
import { SHARED } from './render/toon';
import { buildGrass, buildLeaves } from './world/cover';
import { buildForest } from './world/forest';
import { buildProps } from './world/props';
import { createClouds, createSky } from './world/sky';
import { buildFar, buildMid, buildStrip } from './world/terrain';
import { buildTrack } from './world/track';

const app = document.getElementById('app')!;
const loading = document.getElementById('loading')!;
const ldBar = loading.querySelector('.ld-bar i') as HTMLElement;
const ldMsg = loading.querySelector('.ld-msg') as HTMLElement;

// preserveDrawingBuffer only in dev, where the capture hook reads the canvas back
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: import.meta.env.DEV });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
// the sun never moves: re-render the shadow map only when the view changes
renderer.shadowMap.autoUpdate = false;
renderer.autoClear = false;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(PHOTO.fovY, 1, 0.5, 30000);
const pipeline = new Pipeline(renderer);
const rig = new CameraRig(camera, renderer.domElement);

// the sun: only used for its shadow map; shading uses SHARED.uSunDir
const sun = new THREE.DirectionalLight(0xffffff, 1);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.bias = -0.00003;
sun.shadow.normalBias = 0.03;
sun.shadow.radius = 1.2;
scene.add(sun, sun.target);

// --- sizing -------------------------------------------------------------------
let pixelRatioOverride: number | null = null;
function size(): { w: number; h: number } {
  const w = document.documentElement.clientWidth || window.innerWidth || 1;
  const h = document.documentElement.clientHeight || window.innerHeight || 1;
  return { w, h };
}
/** device pixel ratio, capped so the 4x-MSAA two-target scene buffer stays ~4 MP */
function autoPixelRatio(w: number, h: number): number {
  const dpr = window.devicePixelRatio || 1;
  return Math.max(1, Math.min(dpr, 2, Math.sqrt(4.0e6 / (w * h))));
}
let pixelRatio = 1;
function resize(): void {
  const { w, h } = size();
  pixelRatio = pixelRatioOverride ?? autoPixelRatio(w, h);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(w, h, false);
  pipeline.setSize(w, h, pixelRatio);
  camera.aspect = w / h;
  rig.dirty = true;
}
window.addEventListener('resize', resize);
resize();

// --- shadow frustum follows the view -----------------------------------------------
const shadowCam = sun.shadow.camera as THREE.OrthographicCamera;
// a camera (not a bare Object3D) so lookAt() aims -Z like the shadow camera
const tmpCam = new THREE.OrthographicCamera();
function fitShadow(): void {
  const near = 1.0;
  const far = rig.mode === 'photo' ? 150 : Math.min(140, 40 + 1800 / Math.max(10, camera.fov));
  const corners: THREE.Vector3[] = [];
  const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  for (const d of [near, far]) {
    const hh = t * d, hw = hh * camera.aspect;
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      corners.push(new THREE.Vector3(sx * hw, sy * hh, -d).applyMatrix4(camera.matrixWorld));
    }
  }
  const centre = new THREE.Vector3();
  for (const c of corners) centre.add(c);
  centre.multiplyScalar(1 / corners.length);
  tmpCam.position.copy(centre).addScaledVector(SUN_DIR, 400);
  tmpCam.up.set(0, 1, 0);
  tmpCam.lookAt(centre);
  tmpCam.updateMatrixWorld();
  const inv = tmpCam.matrixWorld.clone().invert();
  const box = new THREE.Box3();
  for (const c of corners) box.expandByPoint(c.clone().applyMatrix4(inv));
  const half = Math.max(box.max.x - box.min.x, box.max.y - box.min.y) * 0.5 + 6;
  const texel = (half * 2) / sun.shadow.mapSize.x;
  const cx = Math.round(((box.max.x + box.min.x) * 0.5) / texel) * texel;
  const cy = Math.round(((box.max.y + box.min.y) * 0.5) / texel) * texel;
  const cz = (box.max.z + box.min.z) * 0.5;
  const c = new THREE.Vector3(cx, cy, cz).applyMatrix4(tmpCam.matrixWorld);
  sun.position.copy(c).addScaledVector(SUN_DIR, 400);
  sun.target.position.copy(c);
  sun.target.updateMatrixWorld();
  shadowCam.left = -half;
  shadowCam.right = half;
  shadowCam.top = half;
  shadowCam.bottom = -half;
  shadowCam.near = 1;
  shadowCam.far = 400 + (box.max.z - box.min.z) * 0.5 + 60;
  shadowCam.updateProjectionMatrix();
  sun.shadow.needsUpdate = true;
  renderer.shadowMap.needsUpdate = true;
}

// --- UI --------------------------------------------------------------------------
const bar = document.getElementById('bar')!;
const compare = document.getElementById('compare')!;
const frame = compare.querySelector('.frame') as HTMLElement;
const buttons = Array.from(bar.querySelectorAll('button'));
function syncButtons(): void {
  document.body.classList.toggle('comparing', !compare.hidden);
  for (const b of buttons) {
    const act = b.dataset.act;
    b.classList.toggle('on', (act === 'photo' && rig.mode === 'photo' && compare.hidden) || (act === 'explore' && rig.mode === 'explore') || (act === 'compare' && !compare.hidden));
  }
}
rig.onModeChange = (m: Mode) => {
  if (m === 'explore') compare.hidden = true;
  syncButtons();
};
function setCompare(on: boolean): void {
  compare.hidden = !on;
  if (on) rig.setMode('photo');
  syncButtons();
}
bar.addEventListener('click', (e) => {
  const act = (e.target as HTMLElement).closest('button')?.dataset.act;
  if (act === 'photo') { setCompare(false); rig.setMode('photo'); }
  if (act === 'explore') rig.setMode('explore');
  if (act === 'compare') setCompare(compare.hidden);
  syncButtons();
});
let splitDrag = false;
const setSplit = (clientX: number) => {
  const r = frame.getBoundingClientRect();
  const p = THREE.MathUtils.clamp((clientX - r.left) / r.width, 0, 1);
  frame.style.setProperty('--split', `${(p * 100).toFixed(2)}%`);
};
frame.addEventListener('pointerdown', (e) => { splitDrag = true; frame.setPointerCapture(e.pointerId); setSplit(e.clientX); });
frame.addEventListener('pointermove', (e) => { if (splitDrag) setSplit(e.clientX); });
frame.addEventListener('pointerup', () => { splitDrag = false; });
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'c') setCompare(compare.hidden);
  if (k === 'p') { setCompare(false); rig.setMode('photo'); }
  if (k === 'h') document.body.classList.toggle('clean');
});

// --- build ---------------------------------------------------------------------------
const tick = () => new Promise<void>((r) => setTimeout(r, 0));
const stages = 9;
let stage = 0;
async function step(msg: string): Promise<void> {
  stage++;
  ldMsg.textContent = msg;
  ldBar.style.width = `${Math.round((stage / stages) * 100)}%`;
  await tick();
}

let ready = false;
async function build(): Promise<void> {
  const t0 = performance.now();
  await step('painting the sky');
  scene.add(createSky());
  scene.add(createClouds());
  await step('shaping the valley');
  scene.add(buildFar());
  await step('grading the embankment');
  scene.add(buildMid());
  scene.add(buildStrip());
  await step('laying track');
  scene.add(buildTrack().group);
  await step('growing the forest');
  scene.add(buildForest().group);
  await step('sowing grass');
  scene.add(buildGrass());
  await step('dropping leaves');
  scene.add(buildLeaves());
  await step('setting posts');
  scene.add(buildProps());
  await step('mixing paint');
  rig.update(0);
  fitShadow();
  renderer.compile(scene, camera);
  ready = true;
  loading.classList.add('done');
  console.info(`[autumn-line] world built in ${Math.round(performance.now() - t0)} ms`);
}

// --- loop ------------------------------------------------------------------------------
const clock = { last: performance.now(), t: 0 };
function frame_(dt: number): void {
  if (!ready) return;
  clock.t += dt;
  SHARED.uTime.value = clock.t;
  const wasDirty = rig.dirty;
  rig.update(dt);
  if (wasDirty) {
    fitShadow();
    rig.dirty = false;
  }
  pipeline.render(scene, camera, clock.t);
}
function loop(now: number): void {
  const dt = Math.min(0.05, (now - clock.last) / 1000);
  clock.last = now;
  frame_(dt);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

build().catch((err) => {
  console.error(err);
  ldMsg.textContent = 'failed: ' + (err as Error).message;
});

// debug / capture hooks (the preview pane runs hidden, so rAF may not tick)
declare global {
  interface Window { __app: unknown }
}
/** render one frame at an explicit size and POST it to the dev server */
async function capture(w: number, h: number, name = 'capture'): Promise<string> {
  renderer.setPixelRatio(1);
  renderer.setSize(w, h, false);
  pipeline.setSize(w, h, 1);
  camera.aspect = w / h;
  rig.dirty = true;
  frame_(1 / 60);
  const blob = await new Promise<Blob | null>((r) => renderer.domElement.toBlob(r, 'image/png'));
  resize();
  if (!blob) return 'no blob';
  const res = await fetch(`/__capture?name=${encodeURIComponent(name)}`, { method: 'POST', body: blob });
  return res.text();
}

window.__app = {
  THREE, renderer, scene, camera, pipeline, rig, sun, SHARED,
  get ready() { return ready; },
  frame: (dt = 1 / 60) => frame_(dt),
  setPixelRatio: (p: number | null) => { pixelRatioOverride = p; resize(); },
  resize,
  fitShadow,
  // dev-only: POSTs a PNG to the Vite capture endpoint (absent in builds)
  ...(import.meta.env.DEV ? { capture } : {}),
};
