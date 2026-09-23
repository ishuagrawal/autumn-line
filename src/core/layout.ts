import * as THREE from 'three';
import { clamp, fbm2, noise2, smoothstep } from './rng';

// ---------------------------------------------------------------------------
// World layout. Derived from the reference photo, which is a ~5x telephoto
// shot (vertical FOV ~16 deg) taken standing between the rails:
//   - rails at the bottom edge are ~14 m away, the curve starts ~80 m out
//   - the second (left) track runs parallel ~4 m to the left
//   - the autumn hill on the skyline is ~0.9-1.1 km away, ~100 m high
//   - sun is low, behind-left of the photographer
// Units are metres. Camera looks down -Z; +X is to the right.
// ---------------------------------------------------------------------------

export const RAIL_TOP = 0.485;
export const TIE_TOP = 0.3;
export const RAIL_HALF = 0.7525; // centre of rail head from track centre
export const LEFT_OFFSET = -4.0;

export const PHOTO = {
  eye: RAIL_TOP + 1.46,
  yaw: 0.0155, // camera turned slightly left of the track direction
  pitch: 0.036, // horizon sits below frame centre, so the camera tilts up slightly
  fovY: 16.4, // degrees, for the full height of the 3:4 photo
  aspect: 0.75,
};

// direction *towards* the sun
export const SUN_DIR = new THREE.Vector3(-0.507, 0.469, 0.723).normalize();

// --- track centreline via integrated curvature -----------------------------

interface CurvSeg { s0: number; s1: number; k: number }
const MAIN_CURVATURE: CurvSeg[] = [
  { s0: -900, s1: -260, k: -1 / 760 },
  { s0: 80, s1: 400, k: 1 / 550 },
  { s0: 560, s1: 900, k: -1 / 800 },
];

function curvatureAt(s: number): number {
  for (const c of MAIN_CURVATURE) if (s >= c.s0 && s < c.s1) return c.k;
  return 0;
}

export const PATH_S_MIN = -900;
export const PATH_S_MAX = 1300;
const DS = 0.5;

class TrackPath {
  readonly n: number;
  readonly xs: Float64Array;
  readonly zs: Float64Array;
  readonly th: Float64Array;
  private coarse: number[] = [];

  constructor() {
    this.n = Math.round((PATH_S_MAX - PATH_S_MIN) / DS) + 1;
    this.xs = new Float64Array(this.n);
    this.zs = new Float64Array(this.n);
    this.th = new Float64Array(this.n);
    const i0 = Math.round(-PATH_S_MIN / DS);
    this.xs[i0] = 0; this.zs[i0] = 0; this.th[i0] = 0;
    for (let i = i0 + 1; i < this.n; i++) {
      const s = PATH_S_MIN + (i - 0.5) * DS;
      const th = this.th[i - 1] + curvatureAt(s) * DS;
      const tm = (this.th[i - 1] + th) * 0.5;
      this.th[i] = th;
      this.xs[i] = this.xs[i - 1] + Math.sin(tm) * DS;
      this.zs[i] = this.zs[i - 1] - Math.cos(tm) * DS;
    }
    for (let i = i0 - 1; i >= 0; i--) {
      const s = PATH_S_MIN + (i + 0.5) * DS;
      const th = this.th[i + 1] - curvatureAt(s) * DS;
      const tm = (this.th[i + 1] + th) * 0.5;
      this.th[i] = th;
      this.xs[i] = this.xs[i + 1] - Math.sin(tm) * DS;
      this.zs[i] = this.zs[i + 1] + Math.cos(tm) * DS;
    }
    for (let i = 0; i < this.n; i += 16) this.coarse.push(i);
  }

  /** position/heading at arc length s (clamped to path range) */
  at(s: number): { x: number; z: number; th: number } {
    const f = clamp((s - PATH_S_MIN) / DS, 0, this.n - 1.0001);
    const i = Math.floor(f), t = f - i;
    return {
      x: this.xs[i] + (this.xs[i + 1] - this.xs[i]) * t,
      z: this.zs[i] + (this.zs[i + 1] - this.zs[i]) * t,
      th: this.th[i] + (this.th[i + 1] - this.th[i]) * t,
    };
  }

  /** world point at station s with lateral offset u (+ = right of travel) */
  point(s: number, u: number): { x: number; z: number; th: number } {
    const p = this.at(s);
    return { x: p.x + Math.cos(p.th) * u, z: p.z + Math.sin(p.th) * u, th: p.th };
  }

  /** nearest station and signed lateral offset for a world point */
  project(x: number, z: number): { s: number; u: number; d: number } {
    let best = 0, bd = Infinity;
    for (const i of this.coarse) {
      const dx = x - this.xs[i], dz = z - this.zs[i];
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = i; }
    }
    const lo = Math.max(0, best - 18), hi = Math.min(this.n - 1, best + 18);
    bd = Infinity;
    for (let i = lo; i <= hi; i++) {
      const dx = x - this.xs[i], dz = z - this.zs[i];
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = i; }
    }
    const th = this.th[best];
    const tx = Math.sin(th), tz = -Math.cos(th);
    const dx = x - this.xs[best], dz = z - this.zs[best];
    const along = dx * tx + dz * tz;
    const s = PATH_S_MIN + best * DS + along;
    const u = dx * Math.cos(th) + dz * Math.sin(th);
    const clampedEnd = s < PATH_S_MIN + 1 || s > PATH_S_MAX - 1;
    return { s, u, d: clampedEnd ? Math.hypot(dx, dz) : Math.abs(u) };
  }
}

export const MAIN = new TrackPath();

/** lateral offset of the left (siding) track centre, or null where it doesn't exist */
export function leftOffset(s: number): number | null {
  if (s < -280 || s > 250) return null;
  if (s > 165) return LEFT_OFFSET * (1 - smoothstep(165, 250, s));
  if (s < -200) return LEFT_OFFSET * (1 - smoothstep(-200, -280, s));
  return LEFT_OFFSET;
}

// --- ground shaping ---------------------------------------------------------

/** ballast/trackbed height at (s,u) and how strongly it overrides terrain */
export function trackbed(s: number, u: number): { h: number; w: number; gravel: number } {
  const prof = (du: number, crest: number) => {
    const a = Math.abs(du);
    if (a < 1.5) return crest;
    if (a < 2.7) return crest * (1 - smoothstep(1.5, 2.7, a)) + 0.02;
    return 0.02 - Math.min(0.12, (a - 2.7) * 0.05);
  };
  // cribs are filled nearly to the tie tops (0.30), as on the real line
  let h = prof(u, 0.262);
  let gravel = 1 - smoothstep(2.35, 3.0, Math.abs(u));
  const c = leftOffset(s);
  let span = Math.abs(u) - 3.2;
  if (c !== null) {
    h = Math.max(h, prof(u - c, 0.218));
    // gravel fill between the two tracks
    if (u < 0 && u > c) h = Math.max(h, 0.1);
    const gl = 1 - smoothstep(1.9, 2.5, Math.abs(u - c));
    gravel = Math.max(gravel, gl * 0.75);
    if (u < 0 && u > c) gravel = Math.max(gravel, 0.9);
    span = Math.min(span, Math.abs(u - c) - 2.8);
  }
  const w = 1 - smoothstep(0, 5, span);
  // a few mm of lumpy variation so the shoulder isn't ruler-straight
  h += noise2(s * 0.35, u * 0.9) * 0.018;
  return { h, w, gravel };
}

interface Bump { x: number; z: number; sx: number; sz: number; rot: number; h: number }
const HILLS: Bump[] = [
  // the autumn ridge on the photo's skyline (ahead-left)
  { x: -330, z: -1010, sx: 620, sz: 250, rot: -0.12, h: 86 },
  { x: -780, z: -860, sx: 380, sz: 300, rot: 0.3, h: 70 },
  { x: 120, z: -1250, sx: 260, sz: 200, rot: 0.0, h: 55 },
  // right-hand valley wall, hidden behind the spruce in the photo
  { x: 620, z: -320, sx: 360, sz: 520, rot: 0.2, h: 88 },
  { x: 900, z: -1000, sx: 420, sz: 380, rot: 0.0, h: 110 },
  // behind the photographer
  { x: -520, z: 520, sx: 420, sz: 380, rot: 0.4, h: 95 },
  { x: 480, z: 700, sx: 460, sz: 360, rot: -0.3, h: 105 },
  { x: -60, z: 1400, sx: 700, sz: 300, rot: 0.0, h: 120 },
  // far ranges for the horizon
  { x: -1500, z: -300, sx: 500, sz: 900, rot: 0.1, h: 150 },
  { x: 1700, z: 200, sx: 600, sz: 900, rot: -0.1, h: 160 },
  { x: 400, z: -2300, sx: 1100, sz: 400, rot: 0.05, h: 170 },
];

function bump(b: Bump, x: number, z: number): number {
  const dx = x - b.x, dz = z - b.z;
  const c = Math.cos(b.rot), s = Math.sin(b.rot);
  const a = (dx * c - dz * s) / b.sx;
  const bb = (dx * s + dz * c) / b.sz;
  const r2 = a * a + bb * bb;
  return b.h * Math.exp(-r2 * 1.6);
}

/** natural (pre-trackbed) ground height */
export function naturalHeight(x: number, z: number, d: number): number {
  let h = 0;
  for (const b of HILLS) h += bump(b, x, z);
  // valley walls rise with distance from the railway
  h += 38 * smoothstep(140, 900, d);
  // rolling forest-floor texture, stronger away from the line
  const amp = 0.35 + 6 * smoothstep(40, 400, d);
  h += fbm2(x * 0.004, z * 0.004, 4) * amp * 2.2;
  h += noise2(x * 0.05, z * 0.05) * 0.35 * smoothstep(8, 30, d);
  // the ridge line itself gets a ragged crest
  h += fbm2(x * 0.0022 + 7.1, z * 0.0022 - 3.3, 3) * 18 * smoothstep(300, 900, d);
  return h;
}

export function groundHeight(x: number, z: number): number {
  return groundHeightQ(x, z, MAIN.project(x, z));
}

export function groundHeightQ(x: number, z: number, q: { s: number; u: number; d: number }): number {
  let h = naturalHeight(x, z, q.d);
  if (q.s > PATH_S_MIN + 2 && q.s < PATH_S_MAX - 2) {
    // flatten a corridor, then lay the trackbed into it
    const flat = 1 - smoothstep(8, 45, q.d);
    h = h * (1 - flat) + (h * 0.12) * flat;
    const tb = trackbed(q.s, q.u);
    h = h * (1 - tb.w) + tb.h * tb.w;
  }
  return h;
}

// --- palette (sRGB hex; converted to linear by THREE.Color) ---------------

export const PAL = {
  skyZenith: 0x3b7bd4,
  skyHigh: 0x5f9fe6,
  skyHorizon: 0xb3cfea,
  haze: 0xa9bfd6,
  cloudLit: 0xffffff,
  cloudShade: 0xb7c5d9,
  cloudDeep: 0x93a3bb,
  sun: 0xfff1d8,
  skyAmb: 0xa8c4ee,
  groundAmb: 0x8a7258,
  shadowTint: 0x8a90b4,
  // foliage (sunlit tones sampled from the photo, nudged a little brighter)
  orange: 0xcf7d45,
  deepOrange: 0xbd6a3e,
  rust: 0xa85a3e,
  red: 0xad4a38,
  gold: 0xd6ad55,
  yellow: 0xe0c868,
  paleYellow: 0xe0d09a,
  peach: 0xc89880,
  tan: 0xb89c80,
  brownLeaf: 0x946a4c,
  olive: 0x9f9650,
  bareGrey: 0xa59a94,
  spruce: 0x565a3a,
  spruceDeep: 0x223822,
  pine: 0x2f4d30,
  // wood & ground
  barkGrey: 0xb5aa9f,
  barkDark: 0x5e5048,
  tie: 0x5b4c43,
  tieOld: 0x6e6258,
  railHead: 0xd9d6d0,
  railRust: 0x6a4230,
  steel: 0x4e4a47,
  gravel: 0x8f8b86,
  gravelDark: 0x4f4d4c,
  grass: 0x76883f,
  grassDry: 0xb8a86c,
  dirt: 0x6a5846,
  litter: 0x7c5c40,
};
