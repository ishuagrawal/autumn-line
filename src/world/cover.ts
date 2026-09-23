import * as THREE from 'three';
import { MAIN, PAL, groundHeight, leftOffset, trackbed } from '../core/layout';
import { leftEdge, rightEdge } from '../core/ecology';
import { Rng, fbm2 } from '../core/rng';
import { toonMaterial } from '../render/toon';

// ---------------------------------------------------------------------------
// Ground cover: grass tufts, weeds between the siding's ties, fallen leaves
// on the ballast, and a handful of leaves drifting down through the air.
// ---------------------------------------------------------------------------

const lin = (hex: number) => new THREE.Color(hex);

function tuftGeometry(seed: number, blades: number): THREE.BufferGeometry {
  const r = new Rng(seed);
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let b = 0; b < blades; b++) {
    const az = r.range(0, Math.PI * 2);
    const lean = r.range(0.1, 0.55);
    const h = r.range(0.55, 1.0);
    const w = r.range(0.018, 0.03);
    const ox = r.range(-0.07, 0.07), oz = r.range(-0.07, 0.07);
    const dx = Math.cos(az), dz = Math.sin(az);
    const sx = -dz, sz = dx; // blade width axis
    const base = pos.length / 3;
    const rows = 3;
    for (let k = 0; k <= rows; k++) {
      const t = k / rows;
      const bend = lean * t * t;
      const cx = ox + dx * bend * h, cz = oz + dz * bend * h, cy = h * t * (1 - lean * 0.25 * t);
      const ww = w * (1 - t * 0.92);
      for (const s of [-1, 1]) {
        pos.push(cx + sx * ww * s, cy, cz + sz * ww * s);
        nor.push(dx * 0.4, 0.9, dz * 0.4);
        uv.push(s * 0.5 + 0.5, t);
      }
    }
    for (let k = 0; k < rows; k++) {
      const a = base + k * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

export function buildGrass(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'grass';
  const rng = new Rng(31337);
  const geos = [tuftGeometry(1, 6), tuftGeometry(2, 5), tuftGeometry(3, 7)];
  const mat = toonMaterial({
    pattern: 'grass', side: THREE.DoubleSide, outline: 0, rim: 0, terminator: -0.2,
    wind: { amp: 0.06, flutter: 0.01, scale: 2.2 },
  });
  const greens = [0x8a9a44, 0x7a8c3c, 0x9eaa52, 0x92a04a].map(lin);
  const dries = [0xc8b46c, 0xb8a060, 0xd4c080, 0xa89a58].map(lin);
  type T = { x: number; y: number; z: number; s: number; yaw: number; c: THREE.Color };
  const lists: T[][] = [[], [], []];
  const add = (x: number, z: number, h: number, dryness: number) => {
    const c = rng.next() < dryness ? rng.pick(dries).clone() : rng.pick(greens).clone();
    c.multiplyScalar(rng.range(0.85, 1.12));
    lists[rng.int(0, 2)].push({ x, z, y: groundHeight(x, z) - 0.02, s: h, yaw: rng.range(0, 6.28), c });
  };
  const scatter = (s0: number, s1: number, uFn: (s: number) => [number, number], density: number, hRange: [number, number]) => {
    for (let s = s0; s < s1; s += 0.25) {
      const [ua, ub] = uFn(s);
      if (ub <= ua) continue;
      const n = (ub - ua) * 0.25 * density;
      let k = Math.floor(n) + (rng.next() < n % 1 ? 1 : 0);
      while (k-- > 0) {
        const ss = s + rng.range(0, 0.25);
        const u = rng.range(ua, ub);
        const p = MAIN.point(ss, u);
        const patch = fbm2(p.x * 0.35, p.z * 0.35, 2);
        if (patch < -0.25 && rng.chance(0.7)) continue;
        const dry = Math.min(1, Math.max(0, 0.35 + fbm2(p.x * 0.08, p.z * 0.08, 3) * 1.6));
        add(p.x, p.z, rng.range(hRange[0], hRange[1]) * (0.8 + 0.4 * (patch + 0.5)), dry);
      }
    }
  };
  // left strip between the siding and the forest edge
  scatter(-45, 175, (s) => {
    const c = leftOffset(s);
    const inner = c !== null && c < -1.5 ? c - 1.75 : -2.9;
    // the wide meadow near the camera only needs grass close to the line
    return [Math.max(leftEdge(s) - 1.5, inner - 10), inner];
  }, 10, [0.22, 0.5]);
  // right lawn and verge
  scatter(-45, 130, (s) => [2.85, Math.min(rightEdge(s) + 1, s > 34 ? 5.5 : 12)], 12, [0.18, 0.42]);
  // weeds in the siding's cribs and between the tracks
  scatter(-40, 160, (s) => {
    const c = leftOffset(s);
    return c === null ? [0, 0] : [c - 1.2, c + 1.2];
  }, 7, [0.12, 0.34]);
  scatter(-40, 160, (s) => {
    const c = leftOffset(s);
    return c === null ? [0, 0] : [c + 1.6, -2.1];
  }, 1.4, [0.1, 0.25]);

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();
  lists.forEach((list, k) => {
    const im = new THREE.InstancedMesh(geos[k], mat, list.length);
    list.forEach((t, i) => {
      e.set(0, t.yaw, 0);
      q.setFromEuler(e);
      v.set(t.x, t.y, t.z);
      sc.set(t.s, t.s, t.s);
      m4.compose(v, q, sc);
      im.setMatrixAt(i, m4);
      im.setColorAt(i, t.c);
    });
    im.receiveShadow = true;
    im.computeBoundingSphere();
    group.add(im);
  });
  return group;
}

// --- leaves ---------------------------------------------------------------------

const LEAF_COLS = [PAL.orange, PAL.gold, PAL.rust, PAL.yellow, PAL.brownLeaf, PAL.red, 0xd88a3a];

function leafGeometry(): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(1, 1.25, 1, 1);
  g.rotateX(-Math.PI / 2);
  return g;
}

export function buildLeaves(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'leaves';
  const rng = new Rng(8080);
  const mat = toonMaterial({ pattern: 'leaf', side: THREE.DoubleSide, outline: 0.25, rim: 0, terminator: -0.3 });
  const geo = leafGeometry();
  const items: { m: THREE.Matrix4; c: THREE.Color }[] = [];
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();
  for (let i = 0; i < 9000; i++) {
    const s = rng.range(-35, 140);
    const u = rng.range(-7, 5);
    const p = MAIN.point(s, u);
    const tb = trackbed(s, u);
    // leaves pile up along the shoulders and in the cribs
    const edgeBias = Math.abs(Math.abs(u) - 2.4) < 0.9 || u > 2.6 ? 1 : 0.45;
    if (rng.next() > edgeBias) continue;
    const y = Math.max(groundHeight(p.x, p.z), tb.h) + 0.012;
    const size = rng.range(0.05, 0.09);
    e.set(rng.range(-0.25, 0.25), rng.range(0, 6.28), rng.range(-0.25, 0.25));
    q.setFromEuler(e);
    v.set(p.x, y, p.z);
    sc.set(size, size, size);
    m4.compose(v, q, sc);
    const c = lin(rng.pick(LEAF_COLS)).multiplyScalar(rng.range(0.8, 1.1));
    items.push({ m: m4.clone(), c });
  }
  const im = new THREE.InstancedMesh(geo, mat, items.length);
  items.forEach((it, i) => {
    im.setMatrixAt(i, it.m);
    im.setColorAt(i, it.c);
  });
  im.receiveShadow = true;
  im.computeBoundingSphere();
  group.add(im);

  // drifting leaves
  const fallMat = toonMaterial({
    pattern: 'leaf', side: THREE.DoubleSide, outline: 0.35, rim: 0, terminator: -0.3,
    defines: { USE_FALL: '' },
  });
  const N = 320;
  const fall = new THREE.InstancedMesh(geo, fallMat, N);
  const aFall = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    const s = rng.range(18, 150);
    const side = rng.chance(0.55) ? rng.range(-16, -4) : rng.range(2.5, 12);
    const p = MAIN.point(s, side * 0.7);
    const top = rng.range(6, 14);
    const size = rng.range(0.06, 0.1);
    e.set(0, 0, 0);
    q.setFromEuler(e);
    v.set(p.x, groundHeight(p.x, p.z) + top, p.z);
    sc.set(size, size, size);
    m4.compose(v, q, sc);
    fall.setMatrixAt(i, m4);
    fall.setColorAt(i, lin(rng.pick(LEAF_COLS)));
    aFall[i * 4] = rng.range(0, 100); // phase
    aFall[i * 4 + 1] = rng.range(0.55, 1.1); // fall speed m/s
    aFall[i * 4 + 2] = top; // drop height
    aFall[i * 4 + 3] = rng.range(0, 1); // seed
  }
  fall.geometry = geo.clone();
  fall.geometry.setAttribute('aFall', new THREE.InstancedBufferAttribute(aFall, 4));
  fall.frustumCulled = false;
  group.add(fall);
  return group;
}
