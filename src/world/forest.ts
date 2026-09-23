import * as THREE from 'three';
import { MAIN, PAL, PHOTO, groundHeight } from '../core/layout';
import { forestDensity, leftEdge, site } from '../core/ecology';
import { Rng, fbm2 } from '../core/rng';
import { cloneToon, toonMaterial } from '../render/toon';
import { frondAtlas, leafDepthMaterial } from '../render/leafAtlas';
import { type PlantTemplate, broomTree, conifer, deciduous, shrub } from './trees';
import { TwigLines } from './twigLines';

// ---------------------------------------------------------------------------
// Forest placement: hand-placed "hero" plants that recreate the photograph,
// plus a procedurally scattered autumn forest (instanced, three LODs).
// ---------------------------------------------------------------------------

const lin = (hex: number) => new THREE.Color(hex);
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const WHITE = new THREE.Color(1, 1, 1);

type Mats = {
  foliage: THREE.ShaderMaterial;
  foliageStill: THREE.ShaderMaterial;
  bark: THREE.ShaderMaterial;
  twig: THREE.ShaderMaterial;
  conifer: THREE.ShaderMaterial;
  frond: THREE.ShaderMaterial;
};

let leafDepth: THREE.MeshDepthMaterial;
let frondDepth: THREE.MeshDepthMaterial;

function makeMats(): Mats {
  leafDepth = leafDepthMaterial();
  frondDepth = leafDepthMaterial(frondAtlas());
  const frond = toonMaterial({
    vertexColors: true, pattern: 'leafcard', side: THREE.DoubleSide, outline: -0.55, rim: 0.2, terminator: 0.12, highlight: 0.3,
    wind: { amp: 0.03, flutter: 0.008, scale: 0.05 }, defines: { FROND: '' },
  });
  frond.uniforms.uLeafTex.value = frondAtlas();
  return {
    frond,
    // negative ink weight = foliage mode in the outline pass
    foliage: toonMaterial({
      vertexColors: true, pattern: 'leafcard', side: THREE.DoubleSide, outline: -0.65, rim: 0.3, terminator: 0.05, highlight: 0.1,
      wind: { amp: 0.05, flutter: 0.02, scale: 0.075 },
    }),
    foliageStill: toonMaterial({ vertexColors: true, pattern: 'foliage', outline: 0.8, rim: 0.3, terminator: 0.08, highlight: 0.08 }),
    bark: toonMaterial({ vertexColors: true, pattern: 'bark', outline: 1, rim: 0.25, terminator: 0.0 }),
    twig: toonMaterial({ vertexColors: true, outline: 0.0, rim: 0.0, terminator: -0.1, shadowLift: 1.3 }),
    conifer: toonMaterial({
      vertexColors: true, pattern: 'foliage', outline: 1, rim: 0.2, terminator: 0.1, highlight: 0.4,
      wind: { amp: 0.035, flutter: 0.006, scale: 0.05 },
    }),
  };
}

// --- instancing ---------------------------------------------------------------

interface Inst { m: THREE.Matrix4; fc: THREE.Color; wc: THREE.Color; x: number; z: number }

class InstanceSet {
  private items = new Map<PlantTemplate, Inst[]>();
  lineHook?: (t: PlantTemplate, m: THREE.Matrix4, wc: THREE.Color) => void;
  add(t: PlantTemplate, pos: THREE.Vector3, yaw: number, scale: THREE.Vector3, fc: THREE.Color, wc: THREE.Color, tilt = 0) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, yaw, tilt * 0.5, 'YXZ'));
    const m = new THREE.Matrix4().compose(pos, q, scale);
    if (t.lines && this.lineHook) this.lineHook(t, m, wc);
    let a = this.items.get(t);
    if (!a) this.items.set(t, (a = []));
    a.push({ m, fc, wc, x: pos.x, z: pos.z });
  }
  build(group: THREE.Group, mats: Mats, opts: { sectors: number; castShadow: (x: number, z: number) => boolean; foliageMat?: THREE.ShaderMaterial }) {
    for (const [t, list] of this.items) {
      const bySector = new Map<number, Inst[]>();
      for (const it of list) {
        const a = Math.atan2(it.x, -it.z);
        const k = opts.sectors > 1 ? Math.floor(((a + Math.PI) / (Math.PI * 2)) * opts.sectors) % opts.sectors : 0;
        let b = bySector.get(k);
        if (!b) bySector.set(k, (b = []));
        b.push(it);
      }
      for (const arr of bySector.values()) {
        const parts: [THREE.BufferGeometry | null | undefined, THREE.ShaderMaterial, 'fc' | 'wc'][] = [
          [t.foliage, t.solid ? mats.conifer : t.cardAtlas === 'frond' ? mats.frond : opts.foliageMat ?? mats.foliage, 'fc'],
          [t.wood, mats.bark, 'wc'],
          [t.twigs, mats.twig, 'wc'],
        ];
        // shadow casters split out so the shadow pass stays small
        const casters = arr.filter((i) => opts.castShadow(i.x, i.z));
        const others = arr.filter((i) => !opts.castShadow(i.x, i.z));
        for (const [subset, cast] of [[casters, true], [others, false]] as [Inst[], boolean][]) {
          if (!subset.length) continue;
          for (const [geo, mat, key] of parts) {
            if (!geo) continue;
            const im = new THREE.InstancedMesh(geo, mat, subset.length);
            subset.forEach((it, i) => {
              im.setMatrixAt(i, it.m);
              im.setColorAt(i, it[key]);
            });
            if (mat === mats.foliage) im.customDepthMaterial = leafDepth;
            if (mat === mats.frond) im.customDepthMaterial = frondDepth;
            im.castShadow = cast;
            // leaf cards self-shadow into mud; let the cel bands do their shading
            im.receiveShadow = mat !== mats.foliage && mat !== mats.frond;
            im.computeBoundingSphere();
            group.add(im);
          }
        }
      }
    }
  }
}

// --- species ------------------------------------------------------------------

type Species = 'maple' | 'oak' | 'birch' | 'peach' | 'bare' | 'conifer' | 'olive';

const SPECIES_COLORS: Record<Species, number[]> = {
  maple: [PAL.orange, PAL.deepOrange, 0xdb9450, 0xcf7a48, PAL.gold],
  oak: [PAL.rust, PAL.red, 0xa45a40, PAL.brownLeaf, 0xba6a44],
  birch: [PAL.gold, PAL.yellow, PAL.paleYellow, 0xd8b058],
  peach: [PAL.peach, PAL.tan, 0xc98a6c, 0xd9a488],
  bare: [PAL.bareGrey, 0x8d827e, 0xa39893],
  conifer: [PAL.pine, PAL.spruce, 0x34502f],
  olive: [PAL.olive, 0x8b8a3c, 0xa39a48],
};

function pickSpecies(r: Rng, x: number, z: number, dist: number): Species {
  // species come in patches
  const p1 = fbm2(x * 0.006 + 3, z * 0.006 - 1, 3);
  const p2 = fbm2(x * 0.009 - 7, z * 0.009 + 5, 3);
  const w: Record<Species, number> = {
    maple: 0.26 + Math.max(0, p1) * 0.8,
    oak: 0.22 + Math.max(0, -p1) * 0.7,
    birch: 0.13 + Math.max(0, p2) * 0.5,
    peach: dist > 500 ? 0.1 : 0.06,
    bare: 0.13 + Math.max(0, -p2) * 0.35,
    conifer: 0.06,
    olive: 0.03,
  };
  const keys = Object.keys(w) as Species[];
  return r.weighted(keys, keys.map((k) => w[k]));
}

function speciesColor(r: Rng, sp: Species): THREE.Color {
  const c = lin(r.pick(SPECIES_COLORS[sp]));
  const k = r.range(0.86, 1.1);
  return c.multiplyScalar(k);
}

const BARK = [0x8f8378, 0x6e6259, 0xa1968c, 0x5d524b].map(lin);
const BIRCH_BARK = lin(0xe6e1d6);

// --- templates ------------------------------------------------------------------

function makeTemplates() {
  const near: PlantTemplate[] = [];
  const shapes = [
    { width: 9, crownBase: 0.3, flat: 0.1 },
    { width: 7, crownBase: 0.28, flat: 0 },
    { width: 11, crownBase: 0.35, flat: 0.3 },
    { width: 6, crownBase: 0.22, flat: -0.2 },
    { width: 8.5, crownBase: 0.4, flat: 0.2 },
    { width: 10, crownBase: 0.3, flat: 0.15 },
  ];
  shapes.forEach((s, i) =>
    near.push(deciduous({ seed: 100 + i, height: 16, lean: (i % 3 - 1) * 0.15, ...s, cards: 330, cardSize: 1.45, coreBlobs: 2, core: 0.4 })),
  );
  const mid: PlantTemplate[] = [];
  for (let i = 0; i < 6; i++) {
    mid.push(deciduous({
      seed: 200 + i, height: 16, width: 8 + (i % 3) * 1.6, crownBase: 0.3, cards: 150, cardSize: 2.1,
      flat: (i % 2) * 0.2, limbs: 2, core: 0.5, coreBlobs: 1,
    }));
  }
  const far: PlantTemplate[] = [];
  for (let i = 0; i < 4; i++) {
    const t = deciduous({
      seed: 300 + i, height: 16, width: 9 + i, crownBase: 0.35, cards: 46, cardSize: 3.1,
      flat: 0.2, limbs: 0, core: 0.72, coreBlobs: 1, coreDetail: 0,
    });
    far.push({ foliage: t.foliage, wood: null, height: 16 });
  }
  const bareNear: PlantTemplate[] = [];
  for (let i = 0; i < 5; i++) {
    bareNear.push(broomTree({
      seed: 400 + i, height: 16, trunkR: 0.2, trunkTop: 0.8, limbs: 7 + (i % 3), limbFrom: 0.38 + (i % 2) * 0.08,
      limbLen: [0.25, 0.42], limbAngle: [0.35, 0.85], lean: V(0, 0, 0), leanBias: 0, subSpacing: 0.6, twigSpacing: 0.28, lite: true,
    }));
  }
  const bareMid: PlantTemplate[] = [];
  for (let i = 0; i < 3; i++) {
    bareMid.push(broomTree({
      seed: 450 + i, height: 16, trunkR: 0.22, trunkTop: 0.8, limbs: 5, limbFrom: 0.45,
      limbLen: [0.28, 0.42], limbAngle: [0.35, 0.8], lean: V(0, 0, 0), leanBias: 0, subSpacing: 1.8, twigSpacing: 0.9, lite: true,
    }));
  }
  const coniferNear: PlantTemplate[] = [];
  for (let i = 0; i < 3; i++) {
    coniferNear.push(conifer({ seed: 500 + i, height: 18, radius: 3.6, whorlStep: 0.6, perWhorl: 7, detail: 1, droop: 0.3, fronds: true }));
  }
  const coniferFar: PlantTemplate[] = [];
  for (let i = 0; i < 2; i++) {
    const t = conifer({ seed: 550 + i, height: 18, radius: 3.8, whorlStep: 1.6, perWhorl: 4, detail: 1, droop: 0.2 });
    coniferFar.push({ foliage: t.foliage, wood: null, height: 18, solid: true });
  }
  // white pine silhouette for the ridge: irregular layered clumps
  const pines: PlantTemplate[] = [];
  for (let i = 0; i < 2; i++) {
    pines.push(deciduous({
      seed: 600 + i, height: 18, width: 8, crownBase: 0.45, cards: 50, cardSize: 2.6, flat: 0.6, limbs: 2, core: 0.7, coreBlobs: 2,
    }));
  }
  const shrubsYellow: PlantTemplate[] = [];
  for (let i = 0; i < 4; i++) {
    shrubsYellow.push(shrub({ seed: 700 + i, height: 3.2, width: 2.6, stems: 6, leafClumps: 44, clumpSize: 0.27 }));
  }
  const shrubsBrown: PlantTemplate[] = [];
  for (let i = 0; i < 3; i++) {
    shrubsBrown.push(shrub({ seed: 750 + i, height: 1.8, width: 1.8, stems: 8, leafClumps: 22, clumpSize: 0.17, sparse: 0.4 }));
  }
  return { near, mid, far, bareNear, bareMid, coniferNear, coniferFar, pines, shrubsYellow, shrubsBrown };
}

export interface ForestBuild {
  group: THREE.Group;
  count: number;
}

export function buildForest(onProgress?: (msg: string) => void): ForestBuild {
  const group = new THREE.Group();
  group.name = 'forest';
  const mats = makeMats();
  onProgress?.('growing trees');
  const T = makeTemplates();
  const set = new InstanceSet();
  const rng = new Rng(2024);
  let count = 0;
  const twigs = new TwigLines();
  const tmpV = new THREE.Vector3();
  set.lineHook = (t, m, wc) => {
    tmpV.setFromMatrixPosition(m);
    const d = Math.hypot(tmpV.x, tmpV.z);
    const a = Math.abs(Math.atan2(tmpV.x, -tmpV.z) + PHOTO.yaw);
    if (d > 420 || (d > 120 && a > 0.4)) return;
    const tint = lin(rng.pick([0x8a8280, 0x7a7372, 0x958d88, 0x6f6866]));
    twigs.add(t.lines!, m, tint, Math.min(1, 170 / Math.max(1, d)));
    void wc;
  };

  const yaw0 = -PHOTO.yaw;
  const inWedge = (x: number, z: number, half: number) => {
    const a = Math.atan2(x, -z);
    return Math.abs(a - yaw0) < half;
  };

  // hero exclusion: keep fill trees out of the hand-dressed photo zone
  const heroZone = (x: number, z: number) => {
    const q = site(x, z);
    return q.s > 36 && q.s < 170 && q.u > -17 && q.u < 13;
  };

  // --- fill ------------------------------------------------------------------
  const place = (x: number, z: number, dist: number) => {
    const q = site(x, z);
    const fd = forestDensity(x, z, q);
    if (rng.next() > fd) return;
    if (heroZone(x, z)) return;
    const y = groundHeight(x, z);
    let sp = pickSpecies(rng, x, z, dist);
    // where the line bends away the photo shows a grey stand of leafless
    // trees; the far ridge is mostly rust and orange, few yellows
    const bend = z < -150 && z > -330 && x > -22 && x < 40;
    if (bend && rng.chance(0.72)) sp = 'bare';
    if (dist > 600 && sp === 'birch' && rng.chance(0.6)) sp = rng.pick(['maple', 'oak'] as Species[]);
    // valley-floor woods in the photo's view stay low enough that the far
    // ridge shows above them, as in the reference
    const valley = dist < 620 && inWedge(x, z, 0.3);
    const h = valley ? rng.range(8, 14) : rng.range(12, 21) * (dist > 600 ? 1.1 : 1);
    const yaw = rng.range(0, Math.PI * 2);
    const fc = speciesColor(rng, sp);
    const wc = rng.pick(BARK).clone();
    const lod = dist < 230 ? 0 : dist < 700 ? 1 : 2;
    let t: PlantTemplate;
    if (sp === 'bare') {
      if (lod === 0) t = rng.pick(T.bareNear);
      else if (lod === 1) t = rng.pick(T.bareMid);
      else { t = rng.pick(T.far); fc.copy(lin(rng.pick(SPECIES_COLORS.bare))).multiplyScalar(rng.range(0.85, 1.05)); }
    } else if (sp === 'conifer') {
      t = lod === 0 ? rng.pick(T.coniferNear) : lod === 1 ? rng.pick(T.coniferFar) : rng.pick(T.pines);
    } else {
      t = lod === 0 ? rng.pick(T.near) : lod === 1 ? rng.pick(T.mid) : rng.pick(T.far);
    }
    if (sp === 'birch') wc.copy(BIRCH_BARK);
    const s = h / t.height;
    const sx = s * rng.range(0.85, 1.15);
    set.add(t, V(x, y - 0.2, z), yaw, V(sx, s, sx * rng.range(0.9, 1.1)), fc, wc, rng.range(-0.04, 0.04));
    count++;
  };

  onProgress?.('scattering the forest');
  // jittered grid; farther rings are thinned so crowns get sparser (and bigger)
  const G = 6.5;
  const ringStep = (d: number) => (d < 160 ? 6.5 : d < 450 ? 8.5 : 10.5);
  for (let gz = -1650; gz <= 700; gz += G) {
    for (let gx = -1400; gx <= 1400; gx += G) {
      const d0 = Math.hypot(gx, gz);
      if (d0 > 1680) continue;
      if (d0 > 260 && !inWedge(gx, gz, d0 > 480 ? 0.36 : 0.64)) continue;
      const st = ringStep(d0);
      const keep = (G / st) ** 2;
      if (rng.next() > keep) continue;
      const x = gx + rng.range(-0.45, 0.45) * G;
      const z = gz + rng.range(-0.45, 0.45) * G;
      place(x, z, Math.hypot(x, z));
    }
  }

  // --- hero plants from the photograph ----------------------------------------
  onProgress?.('dressing the scene');
  const heroes = new THREE.Group();
  heroes.name = 'heroes';
  const addUnique = (t: PlantTemplate, x: number, z: number, fc: THREE.Color, wc: THREE.Color, yaw = 0, scale = 1, foliageMat = mats.foliage, tc?: THREE.Color) => {
    const y = groundHeight(x, z) - 0.15;
    const mk = (g: THREE.BufferGeometry | null | undefined, m: THREE.ShaderMaterial, c: THREE.Color) => {
      if (!g) return;
      const mesh = new THREE.Mesh(g, cloneToon(m, c));
      mesh.position.set(x, y, z);
      mesh.rotation.y = yaw;
      mesh.scale.setScalar(scale);
      mesh.castShadow = true;
      mesh.receiveShadow = m !== mats.foliage && m !== mats.frond;
      if (m === mats.foliage) mesh.customDepthMaterial = leafDepth;
      if (m === mats.frond) mesh.customDepthMaterial = frondDepth;
      heroes.add(mesh);
    };
    mk(t.foliage, foliageMat, fc);
    mk(t.wood, mats.bark, wc);
    mk(t.twigs, mats.twig, tc ?? wc.clone().multiplyScalar(0.72));
    if (t.lines) {
      const m = new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), yaw), V(scale, scale, scale));
      twigs.add(t.lines, m, (tc ?? wc).clone().multiplyScalar(0.95));
    }
  };

  // 1. the tall bare ash on the right, arching over the line
  const ash = broomTree({
    seed: 9001, height: 24, trunkR: 0.3, trunkTop: 0.8, limbs: 22, limbFrom: 0.38,
    limbLen: [0.3, 0.55], limbAngle: [0.6, 1.2], lean: V(-1, 0, 0.12), leanBias: 0.7,
    subSpacing: 0.3, twigSpacing: 0.12, limbBend: 0.018, limbWander: 0.14,
  });
  addUnique(ash, 4.4, -86, WHITE, lin(0x9c948d), 0, 1, mats.foliage, lin(0x5c5550));
  // 2. Norway spruce, right edge
  const spruce = conifer({
    seed: 9002, height: 35, radius: 5.8, whorlStep: 0.36, perWhorl: 12, detail: 1, droop: 0.55, curtain: true, curtainChance: 0.15,
    bareBase: 0.06, profile: 0.55, fronds: true, trim: { x: -1, z: 0, below: 15, factor: 0.3 },
  });
  addUnique(spruce, 6.9, -99, lin(0x55603a), lin(0x4d3f36), 0, 1, mats.frond);
  const spruce2 = conifer({ seed: 9003, height: 26, radius: 4.8, whorlStep: 0.42, perWhorl: 9, detail: 1, droop: 0.42, curtain: true, profile: 0.7, fronds: true });
  addUnique(spruce2, 16.5, -128, lin(0x565e3e), lin(0x4d3f36), 1.1, 1, mats.frond);
  // 3. tall narrow rust-orange tree left of the siding
  const tall = deciduous({ seed: 9004, height: 12, width: 4.4, crownBase: 0.12, cards: 1200, cardSize: 0.72, lean: 0.1, limbs: 3 });
  addUnique(tall, -8.3, -104, lin(0xba6440), lin(0x6e6259));
  // 4. yellow trees lower left
  const yel = deciduous({ seed: 9005, height: 5.6, width: 4.4, crownBase: 0.15, cards: 760, cardSize: 0.62 });
  addUnique(yel, -8.7, -79, lin(0xcaa44a), lin(0x8f8378), 0.6);
  const yel2 = deciduous({ seed: 9006, height: 8, width: 6, crownBase: 0.25, cards: 950, cardSize: 0.72 });
  addUnique(yel2, -10.2, -90, lin(0xe2c060), lin(0x8f8378), 2.1);
  // 5. big orange crown top-left
  const big = deciduous({ seed: 9007, height: 12.5, width: 8, crownBase: 0.35, cards: 1100, cardSize: 0.9 });
  addUnique(big, -19, -126, lin(0xc87044), lin(0x6e6259), 1.3);
  // 6. slim bare poles at the left edge
  for (const [x, z, s] of [[-11.2, -91, 9010], [-12.6, -99, 9011], [-9.8, -112, 9012]] as const) {
    const b = broomTree({
      seed: s, height: 13, trunkR: 0.11, trunkTop: 0.85, limbs: 5, limbFrom: 0.5, limbLen: [0.22, 0.38],
      limbAngle: [0.3, 0.7], lean: V(0.3, 0, 0), leanBias: 0.3, subSpacing: 0.8, twigSpacing: 0.35,
    });
    addUnique(b, x, z, WHITE, lin(0xa39a92), 0, 1, mats.foliage, lin(0x7a716b));
  }
  // 7. pale yellow aspen inside the curve
  const aspen = deciduous({ seed: 9013, height: 12, width: 5, crownBase: 0.35, cards: 760, cardSize: 0.7, limbs: 4, core: 0.35 });
  addUnique(aspen, -7.2, -152, lin(0xe7d38c), BIRCH_BARK);
  const aspen2 = deciduous({ seed: 9014, height: 10.5, width: 4.2, crownBase: 0.4, cards: 620, cardSize: 0.7, limbs: 3, core: 0.35 });
  addUnique(aspen2, -4.8, -166, lin(0xdcc47a), BIRCH_BARK, 1.7);
  // 8. dark red maple, centre
  const maple = deciduous({ seed: 9015, height: 11.5, width: 7.2, crownBase: 0.3, cards: 1150, cardSize: 0.85 });
  addUnique(maple, -3.3, -184, lin(0xb0503a), lin(0x5e524b));
  const maple2 = deciduous({ seed: 9016, height: 10, width: 6, crownBase: 0.3, cards: 880, cardSize: 0.85 });
  addUnique(maple2, -13, -140, lin(0xc46a42), lin(0x5e524b), 0.8);
  group.add(heroes);

  // 9. stand of grey bare trees where the line bends away
  for (let i = 0; i < 70; i++) {
    const x = rng.range(-14, 34);
    const z = rng.range(-160, -310);
    const q = site(x, z);
    if (q.u > -6.5 || q.u < -40) continue;
    const t = rng.pick(T.bareNear);
    const h = rng.range(14, 23);
    const s = h / t.height;
    set.add(t, V(x, groundHeight(x, z) - 0.2, z), rng.range(0, 6.28), V(s, s, s), WHITE.clone(), lin(rng.pick([0xa39a92, 0x928a84, 0xb3aaa2])));
  }
  // understory in the bend: low, dim rust/brown scrub under the grey stand
  for (let i = 0; i < 60; i++) {
    const x = rng.range(-12, 30);
    const z = rng.range(-110, -260);
    const q = site(x, z);
    if (q.u > -5 || q.u < -30) continue;
    const t = rng.pick(T.near);
    const h = rng.range(3.5, 6.5);
    const s = h / t.height;
    const c = lin(rng.pick([0x94603f, 0x8a5a44, 0xa06a48, 0x7e5a44, 0xb07a4c])).multiplyScalar(rng.range(0.85, 1.05));
    set.add(t, V(x, groundHeight(x, z) - 0.2, z), rng.range(0, 6.28), V(s, s, s), c, rng.pick(BARK).clone());
  }
  // left-side forest behind the hero trees: young growth near the line,
  // taller canopy further back (keeps the far ridge visible over it)
  for (let i = 0; i < 110; i++) {
    const s = rng.range(58, 170);
    const u = leftEdge(s) - rng.range(0.5, 26);
    const p = MAIN.point(s, u);
    const t = rng.pick(T.near);
    const back = -u - 14;
    const h = Math.min(16, Math.max(4.5, 5 + back * 0.32)) * rng.range(0.8, 1.2);
    const sc = h / t.height;
    const sp = rng.weighted<Species>(['maple', 'oak', 'birch', 'bare', 'peach'], [3, 3, 2, 1.2, 1]);
    const tt = sp === 'bare' ? rng.pick(T.bareNear) : t;
    set.add(tt, V(p.x, groundHeight(p.x, p.z) - 0.2, p.z), rng.range(0, 6.28), V(sc, sc, sc), speciesColor(rng, sp), rng.pick(BARK).clone());
  }
  // right-hand woods behind the spruce
  for (let i = 0; i < 70; i++) {
    const s = rng.range(36, 170);
    // keep clear of the spruce's silhouette in the photo (it should read dark)
    const u = rng.range(s < 145 ? 15 : 9, 40);
    const p = MAIN.point(s, u);
    if (Math.hypot(p.x - 6.9, p.z + 99) < 7) continue;
    const sp = rng.weighted<Species>(['maple', 'oak', 'birch', 'bare', 'conifer'], [0.8, 0.8, 1, 5, 1]);
    const t = sp === 'bare' ? rng.pick(T.bareNear) : sp === 'conifer' ? rng.pick(T.coniferNear) : rng.pick(T.near);
    const h = rng.range(11, 20);
    const sc = h / t.height;
    set.add(t, V(p.x, groundHeight(p.x, p.z) - 0.2, p.z), rng.range(0, 6.28), V(sc, sc, sc), speciesColor(rng, sp), rng.pick(BARK).clone());
  }
  // the dark white-pine clump on the far ridge (top-left of the photo)
  for (let i = 0; i < 7; i++) {
    const x = -64 + rng.range(-14, 14);
    const z = -1005 + rng.range(-25, 25);
    const t = rng.pick(T.pines);
    const h = rng.range(20, 27);
    const s = h / t.height;
    set.add(t, V(x, groundHeight(x, z) + 4, z), rng.range(0, 6.28), V(s * 1.2, s, s * 1.2), lin(rng.pick([0x2f4a2e, 0x34502f, 0x2a4429])), lin(0x4d3f36));
  }
  // shade trees behind-left of the photographer: they throw the foreground shadow
  const shadeTrees: [number, number, number][] = [[-13, 4, 18], [-19, 12, 19], [-21, -1, 16], [-14.5, 14, 17], [-10.5, 9, 14]];
  for (const [x, z, h] of shadeTrees) {
    const t = rng.pick(T.near);
    const s = h / t.height;
    set.add(t, V(x, groundHeight(x, z) - 0.2, z), rng.range(0, 6.28), V(s * 1.15, s, s * 1.15), speciesColor(rng, rng.pick(['maple', 'oak', 'birch'] as Species[])), rng.pick(BARK).clone());
  }

  // --- shrubs along the right shoulder ------------------------------------------
  for (let i = 0; i < 80; i++) {
    const s = rng.range(38, 122);
    const u = rng.range(3.3, 10.5);
    const p = MAIN.point(s, u);
    const t = rng.pick(T.shrubsYellow);
    // taller where they screen the spruce's skirt
    const h = rng.range(2.4, 4.6) * (u > 6 ? 1.2 : 1);
    const sc = h / t.height;
    const col = rng.chance(0.82) ? lin(rng.pick([0xeccf62, 0xf2d870, 0xe2bc50, 0xe8c858])) : lin(rng.pick([0xc8844e, 0xb86a48, 0xa8a854]));
    set.add(t, V(p.x, groundHeight(p.x, p.z) - 0.1, p.z), rng.range(0, 6.28), V(sc, sc, sc), col, lin(0x7a6656));
  }
  for (let i = 0; i < 60; i++) {
    const s = rng.range(24, 125);
    const u = rng.range(2.7, 4.6);
    const p = MAIN.point(s, u);
    const t = rng.pick(T.shrubsBrown);
    const h = rng.range(0.9, 2.3);
    const sc = h / t.height;
    const col = lin(rng.pick([0xa46a4a, 0xb07650, 0x945640, 0xb88858, 0x8a6a4c]));
    set.add(t, V(p.x, groundHeight(p.x, p.z) - 0.05, p.z), rng.range(0, 6.28), V(sc, sc, sc), col, lin(0x5b4638));
  }
  // left side: brush at the forest edge
  for (let i = 0; i < 70; i++) {
    const s = rng.range(20, 170);
    const u = leftEdge(s) + rng.range(-1.5, 1.2);
    const p = MAIN.point(s, u);
    const yellow = rng.chance(0.45);
    const t = rng.pick(yellow ? T.shrubsYellow : T.shrubsBrown);
    const h = rng.range(1.2, 3.2);
    const sc = h / t.height;
    const col = yellow ? lin(rng.pick([0xe0b640, 0xd8a838, 0xc98a30])) : lin(rng.pick([0x8a4a30, 0x9c5a36, 0x7a5a36]));
    set.add(t, V(p.x, groundHeight(p.x, p.z) - 0.05, p.z), rng.range(0, 6.28), V(sc, sc, sc), col, lin(0x5b4638));
  }

  onProgress?.('instancing');
  const castShadow = (x: number, z: number) => x > -40 && x < 40 && z > -130 && z < 30;
  set.build(group, mats, { sectors: 6, castShadow });
  group.add(twigs.build());
  count += heroes.children.length;
  return { group, count };
}
