import * as THREE from 'three';
import { Rng } from '../core/rng';
import { GeoBuilder } from './builder';

// ---------------------------------------------------------------------------
// Procedural plant templates. Geometry is authored in metres with the
// plant's base at the origin. Vertex colours are *tints* around 1.0 so the
// same template can be recoloured per instance (orange maple, red oak...).
// ---------------------------------------------------------------------------

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const WHITE = new THREE.Color(1, 1, 1);

export interface PlantTemplate {
  foliage: THREE.BufferGeometry | null;
  wood: THREE.BufferGeometry | null;
  /** fine twigs, drawn without ink so they read as a soft grey haze */
  twigs?: THREE.BufferGeometry | null;
  height: number;
  /** foliage is solid blobs (conifers) rather than alpha-cut leaf cards */
  solid?: boolean;
  /** hairline twigs as line-segment endpoints (x,y,z pairs) */
  lines?: Float32Array | null;
  /** which card atlas the foliage samples */
  cardAtlas?: 'leaf' | 'frond';
}

// --- deciduous crowns -------------------------------------------------------

export interface CrownShape {
  seed: number;
  height: number; // total tree height
  crownBase: number; // fraction of height where crown starts
  width: number; // crown diameter
  cards: number; // leaf-cluster cards
  cardSize: number; // metres
  lean?: number;
  trunkR?: number;
  flat?: number; // flattens crown top (0..1)
  limbs?: number;
  /** relative size of the dark inner mass (0 = hollow, airy crown) */
  core?: number;
  coreBlobs?: number;
  coreDetail?: number;
}

function basisFromDir(dir: THREE.Vector3, roll = 0): THREE.Matrix3 {
  // columns: x = side, y = dir, z = other  (a proper rotation)
  const y = dir.clone().normalize();
  const tmp = Math.abs(y.y) > 0.95 ? V(1, 0, 0) : V(0, 1, 0);
  const x = new THREE.Vector3().crossVectors(tmp, y).normalize();
  const z = new THREE.Vector3().crossVectors(x, y).normalize();
  if (roll) {
    const c = Math.cos(roll), s = Math.sin(roll);
    const x2 = x.clone().multiplyScalar(c).addScaledVector(z, s);
    const z2 = z.clone().multiplyScalar(c).addScaledVector(x, -s);
    x.copy(x2); z.copy(z2);
  }
  return new THREE.Matrix3().set(x.x, y.x, z.x, x.y, y.y, z.y, x.z, y.z, z.z);
}

export function deciduous(o: CrownShape): PlantTemplate {
  const r = new Rng(o.seed);
  const fol = new GeoBuilder();
  const wood = new GeoBuilder();
  const H = o.height;
  const cb = H * o.crownBase;
  const cy = (cb + H) / 2;
  const ry = (H - cb) / 2;
  const rx = o.width / 2;
  const lean = o.lean ?? 0;
  const centre = V(lean * ry * 0.5, cy, 0);
  const shapeN = (p: THREE.Vector3, out: THREE.Vector3) => {
    out.set((p.x - centre.x) / (rx * rx), ((p.y - centre.y) / (ry * ry)) * (1 + (o.flat ?? 0)), (p.z - centre.z) / (rx * rx)).normalize();
  };
  const shade = () => 0.66;
  // dark inner mass: stops the crown reading as hollow between leaf clusters
  const core = o.core ?? 0.48;
  if (core > 0) {
    const det = o.coreDetail ?? 1;
    fol.blob({ c: centre.clone(), r: V(rx * core, ry * core, rx * core), detail: det, bump: 0.3, seed: o.seed, color: WHITE, spherize: 0.7, shapeN, shade });
    for (let k = 0; k < (o.coreBlobs ?? 4) - 1; k++) {
      const off = V(r.range(-0.4, 0.4) * rx, r.range(-0.2, 0.45) * ry, r.range(-0.4, 0.4) * rx);
      const rr = r.range(0.32, 0.45);
      fol.blob({ c: centre.clone().add(off), r: V(rx * rr, ry * rr, rx * rr), detail: det, bump: 0.3, seed: o.seed + k + 1, color: WHITE, spherize: 0.7, shapeN, shade });
    }
  }
  fol.cards({
    centre,
    radii: V(rx, ry, rx),
    count: o.cards,
    size: o.cardSize,
    seed: o.seed * 7 + 3,
    lean,
    tint: (rnd) => {
      const t = rnd();
      const c = new THREE.Color(1 + (rnd() - 0.5) * 0.16, 1 + (rnd() - 0.5) * 0.26, 1 + (rnd() - 0.5) * 0.2);
      if (t < 0.2) c.multiply(new THREE.Color(1.06, 0.82, 0.78)); // redder clump
      else if (t < 0.38) c.multiply(new THREE.Color(1.03, 1.14, 0.84)); // yellower clump
      else if (t < 0.48) c.multiplyScalar(0.8);
      return c;
    },
  });

  // trunk + limbs reaching into the crown
  const bark = WHITE.clone();
  const tr = o.trunkR ?? Math.max(0.12, H * 0.018);
  const trunkTop = V(centre.x * 0.6, cb + ry * 0.35, 0);
  const pts: THREE.Vector3[] = [];
  const rad: number[] = [];
  const n = 6;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push(V(trunkTop.x * t + r.range(-0.05, 0.05) * t, trunkTop.y * t, r.range(-0.05, 0.05) * t));
    rad.push(tr * (1.15 - 0.45 * t) * (i === 0 ? 1.25 : 1));
  }
  wood.tube(pts, rad, 7, bark);
  const limbs = o.limbs ?? 4;
  for (let i = 0; i < limbs; i++) {
    const th = (i / limbs) * Math.PI * 2 + r.range(-0.4, 0.4);
    const out = V(Math.cos(th), r.range(0.9, 1.6), Math.sin(th)).normalize();
    const L = ry * r.range(0.8, 1.2);
    const lp: THREE.Vector3[] = [trunkTop.clone()];
    const lr: number[] = [tr * 0.62];
    for (let k = 1; k <= 4; k++) {
      const t = k / 4;
      lp.push(trunkTop.clone().addScaledVector(out, L * t).add(V(0, L * 0.15 * t * t, 0)));
      lr.push(tr * 0.62 * (1 - 0.8 * t) + 0.02);
    }
    wood.tube(lp, lr, 5, bark);
  }
  return { foliage: fol.build(), wood: wood.build(), height: H };
}

// --- bare trees -------------------------------------------------------------

export interface BareShape {
  seed: number;
  height: number;
  trunkR: number;
  forkAt: number; // fraction of height where the trunk splits
  leaders: number;
  spread: number; // radians of leader spread from vertical
  lean: THREE.Vector3; // horizontal bias for the whole crown
  depth: number;
  childCount: number;
  twigBias?: number;
  minR?: number;
  sides?: number;
  /** thinnest drawn radius (exaggerated so distant twigs still read) */
  minVisR?: number;
  angle?: [number, number];
  /** branches thinner than this become hairlines */
  lineR?: number;
  /** extra hairline twiglets sprouted from each branch tip */
  twiglets?: number;
  /** fewer tube segments/sides for instanced background trees */
  lite?: boolean;
  /** trunk runs up as a central leader with limbs spread along it (ash, poplar) */
  central?: boolean;
}

export function bareTree(o: BareShape): PlantTemplate {
  const r = new Rng(o.seed);
  const thick = new GeoBuilder();
  const thin = new GeoBuilder();
  const minR = o.minR ?? 0.006;
  const lineR = o.lineR ?? 0;
  const lines: number[] = [];
  const tint = (lvl: number) => {
    const k = 1 - lvl * 0.035;
    return new THREE.Color(k, k * 0.985, k * 0.99);
  };

  const branch = (start: THREE.Vector3, dir: THREE.Vector3, len: number, rad: number, lvl: number): THREE.Vector3[] => {
    const segs = Math.max(2, Math.min(o.lite ? 4 : 7, Math.round(len / (0.9 + lvl * 0.2)) + 1));
    const pts: THREE.Vector3[] = [start.clone()];
    const rs: number[] = [rad];
    const d = dir.clone().normalize();
    const p = start.clone();
    const wander = lvl === 0 ? 0.035 : 0.22;
    for (let i = 1; i <= segs; i++) {
      // wander, then gravitropism (up) + crown lean
      d.x += r.range(-wander, wander) + o.lean.x * 0.05;
      d.z += r.range(-wander, wander) + o.lean.z * 0.05;
      d.y += (lvl < 2 ? 0.08 : 0.03) - (lvl >= 3 ? 0.05 : 0);
      d.normalize();
      p.addScaledVector(d, len / segs);
      pts.push(p.clone());
      rs.push(Math.max(o.minVisR ?? minR * 0.6, rad * (1 - 0.55 * (i / segs))));
    }
    const sides = o.lite ? (lvl === 0 ? 6 : lvl === 1 ? 4 : 3) : lvl === 0 ? o.sides ?? 7 : lvl === 1 ? 5 : lvl === 2 ? 4 : 3;
    if (rad <= lineR) {
      for (let i = 0; i < pts.length - 1; i++) lines.push(pts[i].x, pts[i].y, pts[i].z, pts[i + 1].x, pts[i + 1].y, pts[i + 1].z);
    } else {
      (rad > 0.035 ? thick : thin).tube(pts, rs, sides, tint(lvl), lvl <= 1);
    }
    if (lvl >= o.depth || rad < minR) {
      // hairline twiglets fan out from the tip
      const end = pts[pts.length - 1];
      const ed = end.clone().sub(pts[pts.length - 2]).normalize();
      for (let k = 0; k < (o.twiglets ?? 0); k++) {
        const td = ed.clone().add(V(r.range(-0.9, 0.9), r.range(-0.3, 0.8), r.range(-0.9, 0.9))).normalize();
        const at = pts[Math.max(1, pts.length - 1 - (k % 2))];
        const tl = r.range(0.2, 0.7) * Math.min(1, len * 0.8 + 0.3);
        lines.push(at.x, at.y, at.z, at.x + td.x * tl, at.y + td.y * tl, at.z + td.z * tl);
      }
      return pts;
    }
    const kids = lvl === 0 ? 0 : Math.round(o.childCount * r.range(0.7, 1.3) * (lvl >= 2 ? o.twigBias ?? 1 : 1));
    let az = r.range(0, Math.PI * 2);
    for (let k = 0; k < kids; k++) {
      const t = r.range(0.25, 0.98);
      const i = Math.min(pts.length - 2, Math.floor(t * (pts.length - 1)));
      const f = t * (pts.length - 1) - i;
      const at = pts[i].clone().lerp(pts[i + 1], f);
      const pd = pts[i + 1].clone().sub(pts[i]).normalize();
      az += 2.39996;
      const ang = r.range(o.angle?.[0] ?? 0.45, o.angle?.[1] ?? 0.95);
      const side = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
      side.addScaledVector(pd, -side.dot(pd)).normalize();
      const cd = pd.clone().multiplyScalar(Math.cos(ang)).addScaledVector(side, Math.sin(ang));
      const cr = rs[i] * r.range(0.45, 0.62);
      const cl = len * r.range(0.45, 0.72) * (1.1 - t * 0.35);
      branch(at, cd, cl, cr, lvl + 1);
    }
    // terminal continuation
    if (lvl >= 1 && rad > minR * 2) {
      const end = pts[pts.length - 1];
      const ed = end.clone().sub(pts[pts.length - 2]).normalize();
      branch(end, ed.add(V(r.range(-0.3, 0.3), 0.1, r.range(-0.3, 0.3))), len * 0.55, rs[rs.length - 1], lvl + 1);
    }
    return pts;
  };

  // trunk
  const forkY = o.central ? o.height * 0.88 : o.height * o.forkAt;
  const trunkDir = V(o.lean.x * 0.03, 1, o.lean.z * 0.03).normalize();
  const trunk = branch(V(0, 0, 0), trunkDir, forkY, o.trunkR, 0);
  const onTrunk = (f: number) => {
    const t = Math.min(0.999, Math.max(0, f)) * (trunk.length - 1);
    const i = Math.floor(t);
    return trunk[i].clone().lerp(trunk[i + 1], t - i);
  };
  // leaders from the fork (or spread up a central leader)
  const remaining = o.height - (o.central ? o.height * o.forkAt : forkY);
  for (let i = 0; i < o.leaders; i++) {
    const az = (i / o.leaders) * Math.PI * 2 + r.range(-0.5, 0.5);
    const tilt = o.spread * r.range(0.4, 1.1);
    const d = V(Math.sin(tilt) * Math.cos(az), Math.cos(tilt), Math.sin(tilt) * Math.sin(az));
    d.x += o.lean.x * 0.6; d.z += o.lean.z * 0.6;
    const f = o.central ? r.range(o.forkAt / 0.88, 0.97) : r.range(0.8, 1.0);
    const at = onTrunk(f);
    const len = o.central ? Math.max(3, (o.height - at.y) * r.range(0.9, 1.25) + 2) : remaining * r.range(0.7, 1.05);
    const rr = o.trunkR * (o.central ? r.range(0.3, 0.45) * (1.2 - f * 0.5) : r.range(0.45, 0.65));
    branch(at, d, len, rr, 1);
  }
  // a few low side limbs along the trunk
  for (let i = 0; i < 3; i++) {
    const az = r.range(0, Math.PI * 2);
    const d = V(Math.cos(az) * 0.8 + o.lean.x * 0.5, 0.55, Math.sin(az) * 0.8 + o.lean.z * 0.5);
    branch(onTrunk(r.range(0.45, 0.9)), d, remaining * r.range(0.35, 0.6), o.trunkR * 0.3, 2);
  }
  return {
    foliage: null,
    wood: thick.build(),
    twigs: thin.vertexCount > 0 ? thin.build() : null,
    lines: lines.length ? new Float32Array(lines) : null,
    height: o.height,
  };
}

// --- broom-crowned bare trees (ash, poplar, oak skeletons) -----------------

export interface BroomShape {
  seed: number;
  height: number;
  trunkR: number;
  /** trunk top as fraction of height (central leader) */
  trunkTop?: number;
  limbs: number;
  /** limbs attach between these fractions of the height */
  limbFrom: number;
  limbTo?: number;
  /** limb length as fraction of height */
  limbLen: [number, number];
  /** limb angle from vertical, radians */
  limbAngle: [number, number];
  lean: THREE.Vector3;
  /** fraction of limbs forced toward the lean direction */
  leanBias?: number;
  subSpacing?: number;
  twigSpacing?: number;
  lite?: boolean;
  barkTint?: THREE.Color;
  /** how hard limbs curl upward per segment */
  limbBend?: number;
  /** random kink per limb segment (0.06 = gently curving) */
  limbWander?: number;
  /** darken limbs relative to the trunk (0..1) */
  limbShade?: number;
}

export function broomTree(o: BroomShape): PlantTemplate {
  const r = new Rng(o.seed);
  const wood = new GeoBuilder();
  const thin = new GeoBuilder();
  const lines: number[] = [];
  const lite = !!o.lite;
  const up = V(0, 1, 0);
  const tint = o.barkTint ?? WHITE;

  /** walk a curving branch; returns points */
  const walk = (start: THREE.Vector3, dir: THREE.Vector3, len: number, bend: number, wander: number, segLen: number) => {
    const n = Math.max(2, Math.round(len / segLen));
    const pts = [start.clone()];
    const d = dir.clone().normalize();
    const p = start.clone();
    for (let i = 0; i < n; i++) {
      d.x += r.range(-wander, wander);
      d.z += r.range(-wander, wander);
      d.lerp(up, bend).normalize();
      p.addScaledVector(d, len / n);
      pts.push(p.clone());
    }
    return pts;
  };
  const at = (pts: THREE.Vector3[], f: number) => {
    const t = Math.min(0.999, Math.max(0, f)) * (pts.length - 1);
    const i = Math.floor(t);
    return { p: pts[i].clone().lerp(pts[i + 1], t - i), d: pts[i + 1].clone().sub(pts[i]).normalize() };
  };
  const sideDir = (d: THREE.Vector3, ang: number, az: number) => {
    const a = Math.abs(d.y) > 0.95 ? V(1, 0, 0) : up.clone();
    const s1 = new THREE.Vector3().crossVectors(d, a).normalize();
    const s2 = new THREE.Vector3().crossVectors(d, s1).normalize();
    const side = s1.multiplyScalar(Math.cos(az)).addScaledVector(s2, Math.sin(az));
    return d.clone().multiplyScalar(Math.cos(ang)).addScaledVector(side, Math.sin(ang)).normalize();
  };
  const pushLines = (pts: THREE.Vector3[]) => {
    for (let i = 0; i < pts.length - 1; i++) lines.push(pts[i].x, pts[i].y, pts[i].z, pts[i + 1].x, pts[i + 1].y, pts[i + 1].z);
  };

  // trunk (central leader)
  const H = o.height;
  const trunkLen = H * (o.trunkTop ?? 0.86);
  const trunk = walk(V(0, 0, 0), V(o.lean.x * 0.05, 1, o.lean.z * 0.05), trunkLen, 0.0, 0.025, 1.4);
  wood.tube(trunk, trunk.map((_, i) => o.trunkR * (1.12 - 0.72 * (i / (trunk.length - 1)))), lite ? 6 : 9, tint, true);

  const leanDir = V(o.lean.x, 0, o.lean.z);
  const leanAz = Math.atan2(leanDir.z, leanDir.x);
  for (let li = 0; li < o.limbs; li++) {
    const f = o.limbFrom + ((o.limbTo ?? 0.97) - o.limbFrom) * ((li + r.next()) / o.limbs);
    const base = at(trunk, f / (o.trunkTop ?? 0.86));
    let az = r.range(0, Math.PI * 2);
    if (r.next() < (o.leanBias ?? 0.5)) az = leanAz + r.range(-0.9, 0.9);
    const ang = r.range(o.limbAngle[0], o.limbAngle[1]) * (1.15 - 0.3 * f);
    const dir = V(Math.sin(ang) * Math.cos(az), Math.cos(ang), Math.sin(ang) * Math.sin(az));
    const len = H * r.range(o.limbLen[0], o.limbLen[1]) * (1.25 - 0.45 * f);
    const limb = walk(base.p, dir, len, o.limbBend ?? 0.05, o.limbWander ?? 0.06, 0.8);
    const lr = o.trunkR * r.range(0.28, 0.4) * (1.1 - 0.5 * f);
    const limbTint = tint.clone().multiplyScalar(1 - (o.limbShade ?? 0.3));
    wood.tube(limb, limb.map((_, i) => Math.max(0.012, lr * (1 - 0.8 * (i / (limb.length - 1))))), lite ? 4 : 6, limbTint, true);
    // sub-branches along the limb
    const sub = o.subSpacing ?? 0.75;
    for (let s = 0.12; s < 0.98; s += (sub / len) * r.range(0.7, 1.3)) {
      const b = at(limb, s);
      const sl = Math.max(0.6, len * r.range(0.22, 0.42) * (1.1 - s * 0.6));
      const sd = sideDir(b.d, r.range(0.5, 0.95), r.range(0, Math.PI * 2));
      const br = walk(b.p, sd, sl, 0.09, 0.2, 0.45);
      const bRad = lr * (1 - 0.7 * s) * 0.45;
      if (bRad > 0.016 && !lite) thin.tube(br, br.map((_, i) => Math.max(0.01, bRad * (1 - 0.7 * (i / (br.length - 1))))), 3, limbTint);
      else pushLines(br);
      // twigs
      const tw = o.twigSpacing ?? 0.32;
      for (let t = 0.15; t < 1; t += (tw / sl) * r.range(0.7, 1.4)) {
        const c = at(br, t);
        const tl = r.range(0.35, 1.1) * (1.1 - t * 0.4);
        const tdir = sideDir(c.d, r.range(0.45, 1.0), r.range(0, Math.PI * 2));
        const twig = walk(c.p, tdir, tl, 0.12, 0.2, 0.35);
        pushLines(twig);
        // a couple of fine forks near the tip
        if (!lite && r.chance(0.7)) {
          const e = at(twig, r.range(0.5, 0.9));
          pushLines(walk(e.p, sideDir(e.d, r.range(0.4, 0.8), r.range(0, 6.28)), tl * r.range(0.3, 0.6), 0.1, 0.2, 0.3));
        }
      }
    }
  }
  return {
    foliage: null,
    wood: wood.build(),
    twigs: thin.vertexCount ? thin.build() : null,
    lines: lines.length ? new Float32Array(lines) : null,
    height: H,
  };
}

// --- conifers ---------------------------------------------------------------

export interface ConiferShape {
  seed: number;
  height: number;
  radius: number;
  whorlStep: number;
  perWhorl: number;
  detail: number;
  droop: number;
  curtain?: boolean;
  bareBase?: number; // fraction of height with no branches
  /** taper exponent: <1 keeps the lower half columnar (old spruce), ~0.85 conical */
  profile?: number;
  /** target length of one foliage spray (smaller = finer texture) */
  sprayLen?: number;
  /** build foliage from needle-frond cards instead of solid sprays */
  fronds?: boolean;
  /** lineside trimming: branches pointing along `dir` (x,z) below `below` m are cut back */
  trim?: { x: number; z: number; below: number; factor: number };
  /** chance of a hanging curtain under each frond */
  curtainChance?: number;
}

export function conifer(o: ConiferShape): PlantTemplate {
  const r = new Rng(o.seed);
  const fol = new GeoBuilder();
  const wood = new GeoBuilder();
  const H = o.height;
  const base = H * (o.bareBase ?? 0.06);
  const shapeN = (p: THREE.Vector3, out: THREE.Vector3) => {
    // cone normal: outward + up
    const d = Math.hypot(p.x, p.z) || 1;
    out.set(p.x / d, o.radius / H * 1.6 + 0.25, p.z / d).normalize();
  };
  const shade = (p: THREE.Vector3, n: THREE.Vector3) => {
    const d = Math.hypot(p.x, p.z);
    const rAt = o.radius * Math.pow(Math.max(0, 1 - p.y / H), o.profile ?? 0.85);
    const out = Math.min(1, d / Math.max(0.3, rAt));
    return 0.42 + 0.58 * out * out + 0.05 * n.y;
  };
  for (let y = base; y < H - 0.4; y += o.whorlStep * r.range(0.75, 1.25)) {
    const t = y / H;
    const L = o.radius * Math.pow(1 - t, o.profile ?? 0.85) * r.range(0.62, 1.18) + 0.35;
    const n = Math.max(3, Math.round(o.perWhorl * (0.7 + 0.3 * (1 - t))));
    const az0 = r.range(0, Math.PI * 2);
    for (let i = 0; i < n; i++) {
      const az = az0 + (i / n) * Math.PI * 2 + r.range(-0.3, 0.3);
      const out = V(Math.cos(az), 0, Math.sin(az));
      let LL = L * r.range(0.8, 1.1);
      if (o.trim && y < o.trim.below && out.x * o.trim.x + out.z * o.trim.z > 0.25) {
        LL *= o.trim.factor + (1 - o.trim.factor) * (y / o.trim.below) ** 3;
      }
      if (o.fronds) {
        // needle fronds strung along a sagging branch, plus hanging curtains
        const nf = Math.max(1, Math.round(LL / 0.5));
        for (let k = 0; k < nf; k++) {
          const f = (k + 0.6) / nf;
          const sag = -o.droop * LL * f * f;
          for (let side = 0; side < 2; side++) {
            const a2 = az + (side ? r.range(-0.45, 0.45) : 0);
            const o2 = V(Math.cos(a2), 0, Math.sin(a2));
            const c = V(o2.x * LL * f, y + sag, o2.z * LL * f);
            const dir = o2.clone().add(V(0, -o.droop * f * 1.4 - 0.1, 0)).normalize();
            // card hangs in the branch's vertical plane (branchlets droop down
            // the texture), rolled a little so neighbours don't align
            const upv = V(0, 1, 0).addScaledVector(dir, -dir.y).normalize();
            const sideAx = new THREE.Vector3().crossVectors(dir, upv).normalize();
            const roll = r.range(-0.65, 0.65);
            const bAx = upv.multiplyScalar(Math.cos(roll)).addScaledVector(sideAx, Math.sin(roll));
            const la = Math.min(1.35, (LL / nf) * 1.8 + 0.4);
            const lb = la * 0.8;
            const nn = V();
            shapeN(c, nn);
            const tint = new THREE.Color(1 + r.range(-0.06, 0.06), 1 + r.range(-0.1, 0.14), 1 + r.range(-0.12, 0.04))
              .multiplyScalar(shade(c, nn) * (r.chance(0.15) ? 0.8 : 1));
            fol.quad(c.clone().addScaledVector(bAx, -lb * 0.18), dir, bAx, la, lb, nn, tint, r.int(0, 3));
          }
          if (o.curtain && LL > 1 && r.chance(o.curtainChance ?? 0.55)) {
            const c = V(out.x * LL * f, y + sag - r.range(0.3, 0.6), out.z * LL * f);
            const dn = V(r.range(-0.2, 0.2), -1, r.range(-0.2, 0.2)).normalize();
            const wax = new THREE.Vector3().crossVectors(dn, out).normalize();
            const nn = V();
            shapeN(c, nn);
            const tint = new THREE.Color(0.92, 0.95, 0.9).multiplyScalar(shade(c, nn));
            fol.quad(c, dn, wax, r.range(0.7, 1.2), 0.5, nn, tint, r.int(0, 3));
          }
        }
        continue;
      }
      // branch as a chain of flattened sprays sagging downward
      const blobs = o.sprayLen ? Math.max(1, Math.round(LL / o.sprayLen)) : LL > 2.4 ? 3 : LL > 1.1 ? 2 : 1;
      for (let b = 0; b < blobs; b++) {
        const f = (b + 1) / (blobs + 0.35);
        const sag = -o.droop * LL * f * f;
        const c = V(out.x * LL * f, y + sag + LL * 0.05, out.z * LL * f);
        const dir = out.clone().add(V(0, -o.droop * f * 1.3, 0)).normalize();
        const len = (LL / blobs) * 0.9 + 0.2;
        const tint = new THREE.Color(1 + r.range(-0.06, 0.06), 1 + r.range(-0.1, 0.14), 1 + r.range(-0.12, 0.04));
        if (r.chance(0.15)) tint.multiplyScalar(0.78);
        fol.blob({
          c,
          r: V(len * 0.5, len * 0.95, len * 0.2),
          basis: basisFromDir(dir, r.range(-0.3, 0.3)),
          detail: o.detail,
          bump: 0.36,
          seed: o.seed + i * 7 + b,
          color: tint,
          spherize: 0.35,
          shapeN,
          shade,
        });
        if (o.curtain && LL > 1.1 && r.chance(b === blobs - 1 ? 0.75 : 0.35)) {
          // hanging branchlets (Norway spruce "curtains")
          fol.blob({
            c: c.clone().add(V(r.range(-0.2, 0.2), -len * r.range(0.4, 0.7), r.range(-0.2, 0.2))),
            r: V(len * 0.2, len * r.range(0.45, 0.7), len * 0.16),
            detail: 1,
            bump: 0.34,
            seed: o.seed + i * 11 + b + 99,
            color: tint.clone().multiplyScalar(0.86),
            spherize: 0.3,
            shapeN,
            shade,
          });
        }
      }
    }
  }
  // tip
  fol.blob({ c: V(0, H - 0.6, 0), r: V(0.3, 0.9, 0.3), detail: 1, bump: 0.1, seed: o.seed, color: WHITE, spherize: 0.3, shapeN, shade });
  if (o.fronds) {
    // dark inner cone so gaps between fronds read as deep shade, not sky
    const steps = 7;
    for (let k = 0; k < steps; k++) {
      const y = base + ((H * 0.92 - base) * (k + 0.5)) / steps;
      const rAt = o.radius * Math.pow(Math.max(0, 1 - y / H), o.profile ?? 0.85);
      const rr = Math.max(0.3, rAt * 0.42);
      fol.blob({
        c: V(0, y, 0), r: V(rr, (H - base) / steps * 0.75, rr), detail: 1, bump: 0.25, seed: o.seed + 300 + k,
        color: new THREE.Color(0.42, 0.42, 0.42), spherize: 0.5, shapeN,
      });
    }
  }
  const pts: THREE.Vector3[] = [], rad: number[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    pts.push(V(r.range(-0.03, 0.03), H * t * 0.97, r.range(-0.03, 0.03)));
    rad.push(Math.max(0.03, H * 0.018 * (1 - t)));
  }
  wood.tube(pts, rad, 7, WHITE);
  return { foliage: fol.build(), wood: wood.build(), height: H, solid: !o.fronds, cardAtlas: o.fronds ? 'frond' : 'leaf' };
}

// --- shrubs -----------------------------------------------------------------

export interface ShrubShape {
  seed: number;
  height: number;
  width: number;
  stems: number;
  leafClumps: number;
  clumpSize: number;
  sparse?: number; // 0 dense .. 1 mostly twigs
}

export function shrub(o: ShrubShape): PlantTemplate {
  const r = new Rng(o.seed);
  const fol = new GeoBuilder();
  const wood = new GeoBuilder();
  const tips: THREE.Vector3[] = [];
  for (let i = 0; i < o.stems; i++) {
    const az = r.range(0, Math.PI * 2);
    const spread = r.range(0.15, 0.55);
    const h = o.height * r.range(0.6, 1.0);
    const pts: THREE.Vector3[] = [], rad: number[] = [];
    for (let k = 0; k <= 5; k++) {
      const t = k / 5;
      const out = Math.sin(t * 1.2) * spread * o.width * 0.6;
      pts.push(V(Math.cos(az) * out + r.range(-0.04, 0.04), h * t, Math.sin(az) * out + r.range(-0.04, 0.04)));
      rad.push(0.022 * (1 - 0.7 * t) + 0.005);
    }
    wood.tube(pts, rad, 4, WHITE);
    tips.push(...pts.slice(2));
    // side twigs
    for (let k = 0; k < 3; k++) {
      const a = pts[2 + k];
      const d = V(r.range(-1, 1), r.range(0.3, 1), r.range(-1, 1)).normalize().multiplyScalar(o.height * 0.25);
      wood.tube([a, a.clone().add(d)], [0.01, 0.004], 3, WHITE);
      tips.push(a.clone().add(d));
    }
  }
  void tips;
  const dense = 1 - (o.sparse ?? 0);
  const n = Math.round(o.leafClumps * 3 * dense);
  if (n > 0) {
    fol.cards({
      centre: V(0, o.height * 0.62, 0),
      radii: V(o.width * 0.5, o.height * 0.42, o.width * 0.5),
      count: n,
      size: o.clumpSize * 2.4,
      seed: o.seed * 5 + 1,
      shell: [0.35, 1.0],
      clumps: Math.max(5, Math.round(n / 7)),
      tint: (rnd) => new THREE.Color(1 + (rnd() - 0.5) * 0.2, 1 + (rnd() - 0.5) * 0.3, 1 + (rnd() - 0.5) * 0.2).multiplyScalar(rnd() < 0.2 ? 0.8 : 1),
    });
  }
  return { foliage: n > 0 ? fol.build() : null, wood: wood.build(), height: o.height };
}
