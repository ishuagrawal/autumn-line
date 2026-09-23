import * as THREE from 'three';
import { MAIN, PAL, RAIL_HALF, RAIL_TOP, TIE_TOP, leftOffset, trackbed } from '../core/layout';
import { Rng, noise2 } from '../core/rng';
import { toonMaterial } from '../render/toon';

// ---------------------------------------------------------------------------
// Railway: extruded rails, instanced ties / plates / spikes / joint bars,
// and a carpet of instanced ballast stones near the camera.
// ---------------------------------------------------------------------------

const lin = (hex: number) => new THREE.Color(hex);

// rail cross-section (u lateral, v up from rail base), counter-clockwise
const HALF_PROFILE: [number, number][] = [
  [0.0, 0.0], [0.07, 0.0], [0.07, 0.012], [0.02, 0.024], [0.009, 0.036], [0.009, 0.112],
  [0.033, 0.124], [0.036, 0.15], [0.034, 0.163], [0.024, 0.1705],
];
const PROFILE: [number, number][] = (() => {
  const left = HALF_PROFILE.slice(1).reverse().map(([u, v]) => [-u, v] as [number, number]);
  return [...HALF_PROFILE, [0, 0.172] as [number, number], ...left];
})();
const RAIL_H = 0.172;

/** centre offset of a track at station s: main = 0, siding = leftOffset */
type OffsetFn = (s: number) => number | null;
const mainOffset: OffsetFn = () => 0;

function stations(s0: number, s1: number): number[] {
  const out: number[] = [];
  let s = s0;
  while (s <= s1) {
    out.push(s);
    s += Math.abs(s) < 250 ? 0.5 : 1.5;
  }
  return out;
}

function edgeColor(v0: number, v1: number, nu: number, nv: number, rustyHead: boolean): THREE.Color {
  const vm = (v0 + v1) * 0.5;
  if (nv > 0.97 && vm > 0.17) return rustyHead ? lin(0x8a5a40) : lin(PAL.railHead);
  if (nv > 0.6 && vm > 0.15) return rustyHead ? lin(0x7a4a34) : lin(0x8c847c);
  if (vm > 0.12) return lin(0x75665c).lerp(lin(PAL.railRust), 0.35 + 0.2 * Math.abs(nu));
  return lin(PAL.railRust).multiplyScalar(vm < 0.03 ? 0.75 : 0.95);
}

function buildRails(off: OffsetFn, s0: number, s1: number, drop: number, rustiness: number, rustyHead = false): THREE.BufferGeometry {
  const st = stations(s0, s1).filter((s) => off(s) !== null && Math.abs(off(s)!) >= (off === mainOffset ? 0 : 1.2));
  const pos: number[] = [], nor: number[] = [], col: number[] = [];
  const idx: number[] = [];
  let base = 0;
  for (const side of [-1, 1]) {
    // runs split where the station list breaks
    const runs: number[][] = [];
    let cur: number[] = [];
    for (let i = 0; i < st.length; i++) {
      if (cur.length && st[i] - cur[cur.length - 1] > 2) { runs.push(cur); cur = []; }
      cur.push(st[i]);
    }
    if (cur.length) runs.push(cur);
    for (const run of runs) {
      if (run.length < 2) continue;
      const frames = run.map((s) => {
        const c = off(s)!;
        const p = MAIN.point(s, c + side * RAIL_HALF);
        const p2 = MAIN.point(s + 0.25, (off(s + 0.25) ?? c) + side * RAIL_HALF);
        const tx = p2.x - p.x, tz = p2.z - p.z;
        const tl = Math.hypot(tx, tz) || 1;
        // right-hand normal of the direction of travel
        return { x: p.x, z: p.z, rx: -tz / tl, rz: tx / tl, s };
      });
      const nE = PROFILE.length;
      for (let e = 0; e < nE; e++) {
        const [u0, v0] = PROFILE[e];
        const [u1, v1] = PROFILE[(e + 1) % nE];
        // outward normal of a counter-clockwise profile edge
        let nu = v1 - v0, nv = -(u1 - u0);
        const nl = Math.hypot(nu, nv) || 1;
        nu /= nl; nv /= nl;
        const c0 = edgeColor(v0, v1, nu, nv, rustyHead);
        for (let f = 0; f < frames.length; f++) {
          const fr = frames[f];
          const rust = 0.85 + 0.3 * noise2(fr.s * 0.07 + side * 13, e * 0.3) * rustiness;
          const cc = c0.clone().multiplyScalar(nv > 0.97 && v0 > 0.17 && !rustyHead ? 1 : rust);
          for (const [u, v] of [[u0, v0], [u1, v1]] as [number, number][]) {
            pos.push(fr.x + fr.rx * u, RAIL_TOP - RAIL_H + v - drop, fr.z + fr.rz * u);
            nor.push(fr.rx * nu, nv, fr.rz * nu);
            col.push(cc.r, cc.g, cc.b);
          }
        }
        for (let f = 0; f < frames.length - 1; f++) {
          const a = base + f * 2, b = a + 1, c = a + 2, d = a + 3;
          idx.push(a, c, b, b, c, d);
        }
        base += frames.length * 2;
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

/** box with its long axis on X, chamfered top edges */
function tieGeometry(): THREE.BufferGeometry {
  const L = 2.59, W = 0.23, H = 0.18, ch = 0.025;
  const shape = new THREE.Shape();
  shape.moveTo(-W / 2, -H);
  shape.lineTo(W / 2, -H);
  shape.lineTo(W / 2, -ch);
  shape.lineTo(W / 2 - ch, 0);
  shape.lineTo(-W / 2 + ch, 0);
  shape.lineTo(-W / 2, -ch);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: L, bevelEnabled: false, steps: 6 });
  g.translate(0, 0, -L / 2);
  g.rotateY(Math.PI / 2); // extrusion (z) -> x
  // gentle weathering: sag the top surface a little
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    if (y > -0.01) p.setY(i, y - 0.008 * Math.cos((x / L) * Math.PI) - 0.004);
  }
  g.computeVertexNormals();
  return g;
}

interface TieRec { s: number; c: number; drop: number }

export interface TrackBuild {
  group: THREE.Group;
  ties: TieRec[];
}

export function buildTrack(): TrackBuild {
  const group = new THREE.Group();
  group.name = 'track';
  const rng = new Rng(4242);

  // --- rails -------------------------------------------------------------
  const railMat = toonMaterial({ vertexColors: true, pattern: 'rail', outline: 1, rim: 0.2, terminator: 0.0 });
  const rustMat = toonMaterial({ vertexColors: true, outline: 1, rim: 0.2, terminator: 0.0 });
  const mainRails = new THREE.Mesh(buildRails(mainOffset, -620, 1100, 0, 1), railMat);
  const sidingRails = new THREE.Mesh(buildRails((s) => leftOffset(s), -280, 250, 0.05, 1.6, true), rustMat);
  for (const m of [mainRails, sidingRails]) {
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    group.add(m);
  }

  // --- ties ----------------------------------------------------------------
  const ties: TieRec[] = [];
  const addTies = (off: OffsetFn, s0: number, s1: number, drop: number, minAbs: number) => {
    let s = s0;
    while (s < s1) {
      const c = off(s);
      if (c !== null && Math.abs(c) >= minAbs) ties.push({ s: s + rng.range(-0.025, 0.025), c, drop });
      s += 0.495 + rng.range(-0.02, 0.02);
    }
  };
  addTies(mainOffset, -620, 1100, 0, 0);
  addTies((s) => leftOffset(s), -280, 250, 0.05, 2.7);

  const tieGeo = tieGeometry();
  const tieMat = toonMaterial({ vertexColors: false, pattern: 'wood', outline: 1, rim: 0.15 });
  const tieMesh = new THREE.InstancedMesh(tieGeo, tieMat, ties.length);
  const plateGeo = new THREE.BoxGeometry(0.36, 0.016, 0.19).toNonIndexed();
  plateGeo.translate(0, 0.008, 0);
  const plateMat = toonMaterial({ color: 0x5b4a40, outline: 0.8, rim: 0.1 });
  const plates = new THREE.InstancedMesh(plateGeo, plateMat, ties.length * 2);
  const spikeGeo = new THREE.BoxGeometry(0.018, 0.03, 0.022).toNonIndexed();
  spikeGeo.translate(0, 0.015, 0);
  const spikeMat = toonMaterial({ color: 0x4a3a33, outline: 0.6, rim: 0.1 });
  const spikeCount = ties.filter((t) => t.s > -60 && t.s < 260).length * 8;
  const spikes = new THREE.InstancedMesh(spikeGeo, spikeMat, spikeCount);

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3(1, 1, 1);
  const color = new THREE.Color();
  const tieCols = [0x5c4d44, 0x4d403a, 0x6b5d52, 0x57493f, 0x3f3531, 0x74665a].map(lin);
  let si = 0;
  ties.forEach((t, i) => {
    const p = MAIN.point(t.s, t.c + rng.range(-0.03, 0.03));
    const yaw = -p.th + rng.range(-0.025, 0.025);
    const sink = rng.range(0, 0.025) + t.drop;
    e.set(rng.range(-0.02, 0.02), yaw, rng.range(-0.012, 0.012), 'YXZ');
    q.setFromEuler(e);
    v.set(p.x, TIE_TOP - sink, p.z);
    sc.set(1 + rng.range(-0.02, 0.03), 1, 1 + rng.range(-0.06, 0.08));
    m4.compose(v, q, sc);
    tieMesh.setMatrixAt(i, m4);
    color.copy(rng.pick(tieCols)).multiplyScalar(t.drop > 0 ? 1.12 : 1);
    tieMesh.setColorAt(i, color);

    for (const side of [-1, 1]) {
      const rp = MAIN.point(t.s, t.c + side * RAIL_HALF);
      e.set(0, -rp.th + rng.range(-0.02, 0.02), 0, 'YXZ');
      q.setFromEuler(e);
      v.set(rp.x, TIE_TOP - t.drop - 0.002, rp.z);
      sc.set(1, 1, 1);
      m4.compose(v, q, sc);
      plates.setMatrixAt(i * 2 + (side > 0 ? 1 : 0), m4);
      if (t.s > -60 && t.s < 260) {
        // two spikes each side of the rail foot
        for (const du of [-0.095, 0.095]) {
          for (const ds of [-0.055, 0.055]) {
            if (rng.chance(0.18)) continue;
            const pp = MAIN.point(t.s + ds, t.c + side * RAIL_HALF + du);
            e.set(0, -pp.th + rng.range(-0.4, 0.4), 0, 'YXZ');
            q.setFromEuler(e);
            v.set(pp.x, TIE_TOP - t.drop + 0.012, pp.z);
            m4.compose(v, q, sc);
            spikes.setMatrixAt(si++, m4);
          }
        }
      }
    }
  });
  spikes.count = si;
  for (const m of [tieMesh, plates, spikes]) {
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    m.instanceMatrix.needsUpdate = true;
    group.add(m);
  }

  // --- joint bars (39 ft rails, staggered) ---------------------------------
  const barGeo = new THREE.BoxGeometry(0.018, 0.075, 0.86).toNonIndexed();
  const boltGeo = new THREE.CylinderGeometry(0.014, 0.014, 0.03, 6).toNonIndexed();
  boltGeo.rotateZ(Math.PI / 2);
  const joints: { s: number; c: number; side: number; drop: number }[] = [];
  for (let s = -600; s < 1090; s += 11.89) {
    joints.push({ s, c: 0, side: -1, drop: 0 });
    joints.push({ s: s + 5.94, c: 0, side: 1, drop: 0 });
  }
  for (let s = -270; s < 245; s += 11.89) {
    const c = leftOffset(s);
    if (c === null || Math.abs(c) < 1.3) continue;
    joints.push({ s: s + 2.1, c, side: -1, drop: 0.05 });
    joints.push({ s: s + 8.0, c, side: 1, drop: 0.05 });
  }
  const bars = new THREE.InstancedMesh(barGeo, plateMat, joints.length * 2);
  const bolts = new THREE.InstancedMesh(boltGeo, spikeMat, joints.length * 8);
  let bi = 0, oi = 0;
  for (const j of joints) {
    for (const face of [-1, 1]) {
      const p = MAIN.point(j.s, j.c + j.side * RAIL_HALF + face * 0.02);
      e.set(0, -p.th, 0, 'YXZ');
      q.setFromEuler(e);
      v.set(p.x, RAIL_TOP - RAIL_H + 0.075 - j.drop, p.z);
      sc.set(1, 1, 1);
      m4.compose(v, q, sc);
      bars.setMatrixAt(bi++, m4);
      for (const ds of [-0.28, 0.28, -0.1, 0.1]) {
        const pb = MAIN.point(j.s + ds, j.c + j.side * RAIL_HALF + face * 0.032);
        v.set(pb.x, RAIL_TOP - RAIL_H + 0.078 - j.drop, pb.z);
        m4.compose(v, q, sc);
        bolts.setMatrixAt(oi++, m4);
      }
    }
  }
  for (const m of [bars, bolts]) {
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    group.add(m);
  }

  group.add(buildBallast());
  return { group, ties };
}

// --- ballast stones -------------------------------------------------------

function rockGeometry(seed: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 0);
  const p = g.getAttribute('position');
  const r = new Rng(seed);
  // squash + jitter into an angular crushed-stone shape
  const sx = r.range(0.8, 1.25), sy = r.range(0.55, 0.8), sz = r.range(0.8, 1.2);
  const moved = new Map<string, [number, number, number]>();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let o = moved.get(key);
    if (!o) {
      const k = r.range(0.78, 1.15);
      o = [p.getX(i) * sx * k, p.getY(i) * sy * k, p.getZ(i) * sz * k];
      moved.set(key, o);
    }
    p.setXYZ(i, o[0], o[1], o[2]);
  }
  g.computeVertexNormals();
  return g;
}

function buildBallast(): THREE.Group {
  const grp = new THREE.Group();
  const rng = new Rng(777);
  const geos = [rockGeometry(1), rockGeometry(2), rockGeometry(3)];
  const mat = toonMaterial({ outline: 0.55, rim: 0.12, terminator: 0.05, highlight: 0.1 });
  const rockCols = [0xa9a59f, 0x8c8883, 0x6e6b69, 0xc2bcb2, 0x9c8e7e, 0x5d5a58, 0xb7b0a6].map(lin);
  type R = { x: number; y: number; z: number; s: number; ry: number; rx: number; c: THREE.Color };
  const buckets: R[][] = [[], [], []];
  const place = (s0: number, s1: number, density: number) => {
    const area = (s1 - s0) * 9.4;
    const n = Math.round(area * density);
    for (let i = 0; i < n; i++) {
      const s = rng.range(s0, s1);
      const u = rng.range(-6.6, 2.8);
      const tb = trackbed(s, u);
      if (tb.gravel < 0.55 || rng.next() > tb.gravel) continue;
      const p = MAIN.point(s, u);
      const size = 0.028 + Math.pow(rng.next(), 2.2) * 0.05;
      buckets[rng.int(0, 2)].push({
        x: p.x, z: p.z, y: tb.h + rng.range(-0.35, 0.15) * size,
        s: size, ry: rng.range(0, Math.PI * 2), rx: rng.range(-0.4, 0.4), c: rng.pick(rockCols),
      });
    }
  };
  place(-40, 11, 38);
  place(11, 45, 70);
  place(45, 95, 40);

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const c = new THREE.Color();
  buckets.forEach((b, k) => {
    const mesh = new THREE.InstancedMesh(geos[k], mat, b.length);
    b.forEach((r, i) => {
      e.set(r.rx, r.ry, rng.range(-0.3, 0.3));
      q.setFromEuler(e);
      v.set(r.x, r.y, r.z);
      sc.setScalar(r.s);
      m4.compose(v, q, sc);
      mesh.setMatrixAt(i, m4);
      c.copy(r.c).multiplyScalar(rng.range(0.85, 1.12));
      mesh.setColorAt(i, c);
    });
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    grp.add(mesh);
  });
  return grp;
}
