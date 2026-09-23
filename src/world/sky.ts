import * as THREE from 'three';
import { PAL, PHOTO } from '../core/layout';
import { Rng, noise3 } from '../core/rng';
import { SHARED } from '../render/toon';

// ---------------------------------------------------------------------------
// Sky dome (gradient + sun + painted wisps) and cel-shaded cumulus.
// Directions are expressed as (azimuth, elevation) with azimuth 0 = -Z and
// positive to the right, matching how the reference photo was measured.
// ---------------------------------------------------------------------------

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
varying float vViewZ;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vDir = normalize(wp.xyz - cameraPosition);
  vec4 mv = viewMatrix * wp;
  vViewZ = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const SKY_FRAG = /* glsl */ `
layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outND;
varying vec3 vDir;
varying float vViewZ;
uniform vec3 uSunDir;
uniform vec3 uC0, uC1, uC2, uC3, uC4, uSun, uWispLit, uWispShade;
uniform float uTime;

float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.07 + 5.3; a *= 0.5; } return s; }

// small fair-weather puff centred at c (az, el) with half-size r; returns
// coverage in x and a lit/shade split in y
vec2 puff(vec2 ae, vec2 c, vec2 r, float slant, float seed) {
  vec2 d = ae - c;
  d.y -= d.x * slant;
  vec2 q = d / r;
  float n = fbm(q * 2.4 + seed);
  float cov = 1.0 - smoothstep(0.62, 0.95, length(q * vec2(1.0, 1.15)) + (n - 0.5) * 0.75);
  float litSide = smoothstep(-0.35, 0.45, q.y + (n - 0.5) * 0.6 - q.x * 0.25);
  return vec2(cov, litSide);
}

void main() {
  vec3 d = normalize(vDir);
  float el = asin(clamp(d.y, -1.0, 1.0));
  float az = atan(d.x, -d.z);
  vec3 c;
  if (el < 0.09) c = mix(uC0, uC1, smoothstep(0.0, 0.09, el));
  else if (el < 0.19) c = mix(uC1, uC2, smoothstep(0.09, 0.19, el));
  else if (el < 0.6) c = mix(uC2, uC3, smoothstep(0.19, 0.6, el));
  else c = mix(uC3, uC4, smoothstep(0.6, 1.4, el));
  if (el < 0.0) c = uC0;

  float sd = dot(d, uSunDir);
  c += uSun * (pow(max(sd, 0.0), 24.0) * 0.18 + pow(max(sd, 0.0), 4.0) * 0.05);
  float disc = smoothstep(0.99955, 0.9997, sd);
  c = mix(c, uSun * 3.0, disc);

  // the two little puffs at the top-left of the photograph
  vec2 ae = vec2(az, el);
  vec2 p1 = puff(ae, vec2(-0.110, 0.176), vec2(0.03, 0.011), -0.12, 1.0);
  vec2 p2 = puff(ae, vec2(-0.071, 0.168), vec2(0.02, 0.0075), 0.05, 7.0);
  vec2 p3 = puff(ae, vec2(-0.150, 0.186), vec2(0.03, 0.012), -0.2, 3.0);
  vec2 pf = p1;
  if (p2.x > pf.x) pf = p2;
  if (p3.x > pf.x) pf = p3;
  // sparse high cirrus elsewhere in the sky
  float ci = 0.0;
  if (el > 0.12) {
    vec2 pp = d.xz / max(d.y, 0.08);
    float cn = fbm(pp * vec2(1.1, 3.0) + 17.0);
    float mask = smoothstep(0.25, 0.9, fbm(pp * 0.3 + 3.0));
    ci = smoothstep(0.62, 0.72, cn) * mask * 0.8 * smoothstep(0.12, 0.3, el);
  }
  float cov = max(smoothstep(0.0, 0.5, pf.x), ci);
  vec3 cloudCol = mix(uWispShade, uWispLit, max(step(0.5, pf.y), step(0.001, ci) * 0.6));
  c = mix(c, cloudCol, cov * 0.95);

  outColor = vec4(c, 0.0);
  outND = vec4(0.0, 0.0, 60000.0, 0.0);
}
`;

const lin = (hex: number) => new THREE.Color(hex);

export function createSky(): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uSunDir: SHARED.uSunDir,
      uTime: SHARED.uTime,
      uC0: { value: lin(0xc6d8ea) },
      uC1: { value: lin(0xa4c6ea) },
      uC2: { value: lin(0x6ea9e8) },
      uC3: { value: lin(0x4885d8) },
      uC4: { value: lin(PAL.skyZenith) },
      uSun: { value: lin(PAL.sun) },
      uWispLit: { value: lin(0xf2f7fc) },
      uWispShade: { value: lin(0xc9dcf0) },
    },
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(20000, 48, 24), mat);
  sky.renderOrder = -1000;
  sky.frustumCulled = false;
  sky.onBeforeRender = (_r, _s, cam) => {
    sky.position.copy(cam.position);
    sky.updateMatrixWorld();
  };
  return sky;
}

// --- cumulus ----------------------------------------------------------------

const CLOUD_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vVN;
varying float vH;
varying float vViewZ;
flat varying float vId;
uniform float uObjectId;
attribute float aH;
attribute float aPuff;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vVN = normalize((viewMatrix * vec4(vN, 0.0)).xyz);
  vH = aH;
  vec4 mv = viewMatrix * wp;
  vViewZ = -mv.z;
  // each puff gets its own id so the ink pass draws soft lines between them
  vId = fract(uObjectId + aPuff * 0.618034);
  gl_Position = projectionMatrix * mv;
}
`;

const CLOUD_FRAG = /* glsl */ `
layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outND;
varying vec3 vN;
varying vec3 vVN;
varying float vH;
varying float vViewZ;
flat varying float vId;
uniform vec3 uSunDir, uLit, uMid, uShade, uDeep, uHaze;
void main() {
  vec3 N = normalize(vN);
  float ndl = dot(N, uSunDir);
  float w = fwidth(ndl) + 0.002;
  vec3 c = mix(uShade, uMid, smoothstep(-0.25 - w, -0.25 + w, ndl));
  c = mix(c, uLit, smoothstep(0.22 - w, 0.22 + w, ndl));
  // stepped, cooler bands toward the flat base
  float hw = fwidth(vH) + 0.002;
  c = mix(c, mix(c, uShade, 0.6), 1.0 - smoothstep(0.42 - hw, 0.42 + hw, vH));
  c = mix(c, uDeep, (1.0 - smoothstep(0.2 - hw, 0.2 + hw, vH)) * 0.75);
  // melt the base into the horizon haze
  c = mix(c, uHaze, (1.0 - smoothstep(0.0, 0.35, vH)) * 0.3);
  outColor = vec4(c, 0.16);
  outND = vec4(normalize(vVN).xy, vViewZ, vId);
}
`;

interface CloudSpec { az: number; el: number; dist: number; w: number; h: number; seed: number; puffs: number }

function buildCloudGeometry(spec: CloudSpec): THREE.BufferGeometry {
  const rng = new Rng(spec.seed);
  const pos: number[] = [], nor: number[] = [], hh: number[] = [], pid: number[] = [];
  const idx: number[] = [];
  const sphere = new THREE.IcosahedronGeometry(1, 3);
  const sp = sphere.getAttribute('position');
  const sIdx = sphere.index ? Array.from(sphere.index.array) : null;
  const W = spec.w, H = spec.h, D = spec.w * 0.45;
  // puffs arranged in a dome: big ones low and central, small cauliflower tops
  const puffs: { x: number; y: number; z: number; r: number }[] = [];
  for (let i = 0; i < spec.puffs; i++) {
    const t = rng.next();
    const x = (rng.next() * 2 - 1) * W * 0.5 * (1 - 0.25 * t);
    const dome = Math.sqrt(Math.max(0, 1 - (x / (W * 0.55)) ** 2));
    const y = H * (0.18 + 0.62 * dome * rng.range(0.35, 1.0));
    const z = (rng.next() * 2 - 1) * D * 0.4;
    const r = H * rng.range(0.16, 0.34) * (0.7 + 0.5 * dome);
    puffs.push({ x, y, z, r });
  }
  let base = 0;
  for (const p of puffs) {
    const vtx = sp.count;
    for (let i = 0; i < vtx; i++) {
      const nx = sp.getX(i), ny = sp.getY(i), nz = sp.getZ(i);
      const n = 1 + 0.12 * noise3(nx * 2.2 + p.x * 0.01, ny * 2.2, nz * 2.2 + spec.seed);
      const x = p.x + nx * p.r * n;
      let y = p.y + ny * p.r * n * 0.9;
      const z = p.z + nz * p.r * n;
      if (y < H * 0.1) y = H * 0.1 + (y - H * 0.1) * 0.15; // flat base
      // blend puff normal with whole-cloud normal for cohesive banding
      const cx = x / (W * 0.5), cy = (y - H * 0.35) / (H * 0.6), cz = z / (D * 0.5);
      const cl = Math.hypot(cx, cy, cz) || 1;
      let mx = nx * 0.55 + (cx / cl) * 0.45, my = ny * 0.55 + (cy / cl) * 0.45, mz = nz * 0.55 + (cz / cl) * 0.45;
      const ml = Math.hypot(mx, my, mz) || 1;
      mx /= ml; my /= ml; mz /= ml;
      pos.push(x, y, z);
      nor.push(mx, my, mz);
      hh.push(y / H);
      pid.push(puffs.indexOf(p) + 1);
    }
    if (sIdx) for (const k of sIdx) idx.push(base + k);
    else for (let k = 0; k < vtx; k++) idx.push(base + k);
    base += vtx;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aH', new THREE.Float32BufferAttribute(hh, 1));
  g.setAttribute('aPuff', new THREE.Float32BufferAttribute(pid, 1));
  g.setIndex(idx);
  return g;
}

export function createClouds(): THREE.Group {
  const group = new THREE.Group();
  const mk = (id: number) =>
    new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: CLOUD_VERT,
      fragmentShader: CLOUD_FRAG,
      uniforms: {
        uSunDir: SHARED.uSunDir,
        uLit: { value: lin(0xf1f6fb) },
        uMid: { value: lin(0xcddcec) },
        uShade: { value: lin(0xafc0d8) },
        uDeep: { value: lin(0x95a6bf) },
        uHaze: { value: lin(0xc4d6ea) },
        uObjectId: { value: id },
      },
    });

  // The photo's cumulus bank sits just above the ridge, left of centre.
  const yaw0 = -PHOTO.yaw;
  const specs: CloudSpec[] = [
    { az: yaw0 - 0.01, el: 0.079, dist: 7200, w: 1000, h: 430, seed: 11, puffs: 52 },
    { az: yaw0 - 0.09, el: 0.08, dist: 7700, w: 820, h: 520, seed: 12, puffs: 40 },
    { az: yaw0 - 0.165, el: 0.079, dist: 8200, w: 700, h: 400, seed: 13, puffs: 30 },
    { az: yaw0 + 0.062, el: 0.08, dist: 7000, w: 460, h: 250, seed: 14, puffs: 22 },
  ];
  // scattered fair-weather cumulus for the rest of the sky
  const r = new Rng(99);
  for (let i = 0; i < 22; i++) {
    const az = r.range(-Math.PI, Math.PI);
    if (Math.abs(az - yaw0) < 0.35) continue;
    specs.push({ az, el: r.range(0.06, 0.22), dist: r.range(5500, 11000), w: r.range(350, 900), h: r.range(180, 380), seed: 200 + i, puffs: r.int(14, 26) });
  }
  specs.forEach((s, i) => {
    const g = buildCloudGeometry(s);
    const m = new THREE.Mesh(g, mk(0.9 + i * 0.0031));
    const y = Math.tan(s.el) * s.dist;
    m.position.set(Math.sin(s.az) * s.dist, y, -Math.cos(s.az) * s.dist);
    m.rotation.y = -s.az; // face the viewer
    m.frustumCulled = false;
    group.add(m);
  });
  return group;
}
