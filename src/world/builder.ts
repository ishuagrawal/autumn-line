import * as THREE from 'three';
import { noise3 } from '../core/rng';

// Accumulates indexed geometry with vertex colours. Used by all the
// procedural plant generators so each template ends up as one draw.

const ICO_CACHE = new Map<number, { pos: Float32Array; idx: Uint32Array }>();

function icoData(detail: number) {
  let d = ICO_CACHE.get(detail);
  if (!d) {
    const g = new THREE.IcosahedronGeometry(1, detail);
    // merge duplicated vertices so displacement keeps the surface closed
    const src = g.getAttribute('position');
    const map = new Map<string, number>();
    const pos: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i < src.count; i++) {
      const x = src.getX(i), y = src.getY(i), z = src.getZ(i);
      const key = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
      let k = map.get(key);
      if (k === undefined) {
        k = pos.length / 3;
        map.set(key, k);
        pos.push(x, y, z);
      }
      idx.push(k);
    }
    d = { pos: new Float32Array(pos), idx: new Uint32Array(idx) };
    ICO_CACHE.set(detail, d);
  }
  return d;
}

export class GeoBuilder {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  uv: number[] = [];
  idx: number[] = [];

  /**
   * Leaf-cluster cards scattered through an ellipsoidal crown. Each card is a
   * quad textured with one cell of the leaf atlas; all of its normals point
   * out of the crown so the whole tree shades as one soft volume.
   */
  cards(o: {
    centre: THREE.Vector3;
    radii: THREE.Vector3;
    count: number;
    size: number;
    seed: number;
    clumps?: number;
    shell?: [number, number];
    tint?: (rng: () => number) => THREE.Color;
    lean?: number;
  }): void {
    let s = o.seed >>> 0;
    const rnd = () => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const { centre: c, radii: R } = o;
    const clumpN = o.clumps ?? Math.max(4, Math.round(o.count / 9));
    const [sh0, sh1] = o.shell ?? [0.55, 1.0];
    const clumps: { p: THREE.Vector3; r: number; tint: THREE.Color }[] = [];
    for (let i = 0; i < clumpN; i++) {
      const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2;
      const y = u * 0.9 + 0.1;
      const ring = Math.sqrt(Math.max(0, 1 - y * y));
      const k = sh0 + (sh1 - sh0) * Math.sqrt(rnd());
      const p = new THREE.Vector3(Math.cos(th) * ring * R.x * k, y * R.y * k, Math.sin(th) * ring * R.z * k);
      p.x += (o.lean ?? 0) * y * R.y * 0.4;
      const tint = o.tint ? o.tint(rnd) : new THREE.Color(1, 1, 1);
      clumps.push({ p: p.add(c), r: (R.x + R.y + R.z) / 3 * (0.22 + rnd() * 0.16), tint });
    }
    const n = new THREE.Vector3(), t = new THREE.Vector3(), b = new THREE.Vector3(), q = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < o.count; i++) {
      const cl = clumps[i % clumpN];
      // random point in the clump, kept inside the crown
      q.set(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1).normalize().multiplyScalar(Math.cbrt(rnd()) * cl.r);
      const p = cl.p.clone().add(q);
      const rel = p.clone().sub(c);
      const rr = Math.sqrt((rel.x / R.x) ** 2 + (rel.y / R.y) ** 2 + (rel.z / R.z) ** 2);
      if (rr > 1.02) p.copy(c).addScaledVector(rel, 1.02 / rr);
      // crown normal (ellipsoid gradient)
      n.set(rel.x / (R.x * R.x), rel.y / (R.y * R.y), rel.z / (R.z * R.z)).normalize();
      // card faces roughly outward with a random twist
      const f = n.clone().add(new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(1.6)).normalize();
      t.copy(Math.abs(f.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : up).cross(f).normalize();
      b.crossVectors(f, t).normalize();
      const ang = rnd() * Math.PI * 2;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const tt = t.clone().multiplyScalar(ca).addScaledVector(b, sa);
      const bb = b.clone().multiplyScalar(ca).addScaledVector(t, -sa);
      const size = o.size * (0.7 + rnd() * 0.6);
      const depth = Math.min(1, rr);
      const ao = 0.55 + 0.45 * depth * depth;
      const col = cl.tint.clone().multiplyScalar(ao * (0.9 + rnd() * 0.2));
      const cell = Math.floor(rnd() * 4);
      const u0 = (cell % 2) * 0.5, v0 = Math.floor(cell / 2) * 0.5;
      const nn = n.clone().multiplyScalar(0.85).addScaledVector(f, 0.15).normalize();
      const base = this.vertexCount;
      const corners: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      for (const [cx, cy] of corners) {
        this.pos.push(
          p.x + (tt.x * cx + bb.x * cy) * size * 0.5,
          p.y + (tt.y * cx + bb.y * cy) * size * 0.5,
          p.z + (tt.z * cx + bb.z * cy) * size * 0.5,
        );
        this.nor.push(nn.x, nn.y, nn.z);
        this.col.push(col.r, col.g, col.b);
        this.uv.push(u0 + (cx * 0.5 + 0.5) * 0.5, v0 + (cy * 0.5 + 0.5) * 0.5);
      }
      this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  /** one textured card: centre p, long axis a (length la), short axis b (length lb) */
  quad(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, la: number, lb: number, n: THREE.Vector3, color: THREE.Color, cell: number): void {
    const base = this.vertexCount;
    const u0 = (cell % 2) * 0.5, v0 = Math.floor(cell / 2) * 0.5;
    const corners: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (const [cx, cy] of corners) {
      this.pos.push(
        p.x + a.x * cx * la * 0.5 + b.x * cy * lb * 0.5,
        p.y + a.y * cx * la * 0.5 + b.y * cy * lb * 0.5,
        p.z + a.z * cx * la * 0.5 + b.z * cy * lb * 0.5,
      );
      this.nor.push(n.x, n.y, n.z);
      this.col.push(color.r, color.g, color.b);
      this.uv.push(u0 + (cx * 0.5 + 0.5) * 0.5, v0 + (cy * 0.5 + 0.5) * 0.5);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /**
   * A lumpy blob. `c` centre, `r` radii, optional basis (columns = local
   * x/y/z axes). Normals are blended toward `shapeN(p)` by `spherize` so a
   * cluster of blobs shades like one soft mass.
   */
  blob(o: {
    c: THREE.Vector3;
    r: THREE.Vector3;
    basis?: THREE.Matrix3;
    detail: number;
    bump: number;
    seed: number;
    color: THREE.Color;
    spherize: number;
    shapeN?: (p: THREE.Vector3, out: THREE.Vector3) => void;
    shade?: (p: THREE.Vector3, n: THREE.Vector3) => number;
    flatBottom?: number;
  }): void {
    const d = icoData(o.detail);
    const base = this.vertexCount;
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    const sn = new THREE.Vector3();
    const lp = new THREE.Vector3();
    const count = d.pos.length / 3;
    const tmpPos: THREE.Vector3[] = [];
    for (let i = 0; i < count; i++) {
      const ux = d.pos[i * 3], uy = d.pos[i * 3 + 1], uz = d.pos[i * 3 + 2];
      const k = 1 + o.bump * noise3(ux * 1.9 + o.seed * 3.1, uy * 1.9 + o.seed * 1.7, uz * 1.9 - o.seed);
      lp.set(ux * o.r.x * k, uy * o.r.y * k, uz * o.r.z * k);
      if (o.flatBottom !== undefined && lp.y < -o.r.y * o.flatBottom) lp.y = -o.r.y * o.flatBottom + (lp.y + o.r.y * o.flatBottom) * 0.25;
      if (o.basis) lp.applyMatrix3(o.basis);
      p.copy(lp).add(o.c);
      tmpPos.push(p.clone());
      this.pos.push(p.x, p.y, p.z);
    }
    // per-vertex normals from the (displaced) ellipsoid, then blend
    for (let i = 0; i < count; i++) {
      const ux = d.pos[i * 3], uy = d.pos[i * 3 + 1], uz = d.pos[i * 3 + 2];
      n.set(ux / o.r.x, uy / o.r.y, uz / o.r.z);
      if (o.basis) n.applyMatrix3(o.basis);
      n.normalize();
      if (o.shapeN && o.spherize > 0) {
        o.shapeN(tmpPos[i], sn);
        n.multiplyScalar(1 - o.spherize).addScaledVector(sn, o.spherize).normalize();
      }
      this.nor.push(n.x, n.y, n.z);
      const s = o.shade ? o.shade(tmpPos[i], n) : 1;
      this.col.push(o.color.r * s, o.color.g * s, o.color.b * s);
      this.uv.push(-1, -1);
    }
    for (let i = 0; i < d.idx.length; i++) this.idx.push(base + d.idx[i]);
  }

  /** tapered tube through `pts` with per-point radius */
  tube(pts: THREE.Vector3[], radii: number[], sides: number, color: THREE.Color, capEnd = false): void {
    if (pts.length < 2) return;
    const base = this.vertexCount;
    const up = new THREE.Vector3(0, 1, 0);
    const t = new THREE.Vector3();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    let prevA: THREE.Vector3 | null = null;
    for (let i = 0; i < pts.length; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[Math.min(pts.length - 1, i + 1)];
      t.subVectors(p1, p0).normalize();
      // parallel transport-ish frame
      if (!prevA) {
        a.copy(Math.abs(t.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : up).cross(t).normalize();
      } else {
        a.copy(prevA).addScaledVector(t, -prevA.dot(t)).normalize();
      }
      prevA = a.clone();
      b.crossVectors(t, a).normalize();
      for (let k = 0; k < sides; k++) {
        const ang = (k / sides) * Math.PI * 2;
        const cx = Math.cos(ang), sy = Math.sin(ang);
        const nx = a.x * cx + b.x * sy, ny = a.y * cx + b.y * sy, nz = a.z * cx + b.z * sy;
        const r = radii[i];
        this.pos.push(pts[i].x + nx * r, pts[i].y + ny * r, pts[i].z + nz * r);
        this.nor.push(nx, ny, nz);
        this.col.push(color.r, color.g, color.b);
        this.uv.push(-1, -1);
      }
    }
    for (let i = 0; i < pts.length - 1; i++) {
      for (let k = 0; k < sides; k++) {
        const k2 = (k + 1) % sides;
        const a0 = base + i * sides + k, a1 = base + i * sides + k2;
        const b0 = a0 + sides, b1 = a1 + sides;
        this.idx.push(a0, a1, b0, a1, b1, b0);
      }
    }
    if (capEnd) {
      const last = pts[pts.length - 1];
      const c = this.vertexCount;
      this.pos.push(last.x, last.y, last.z);
      this.nor.push(t.x, t.y, t.z);
      this.col.push(color.r, color.g, color.b);
      this.uv.push(-1, -1);
      const off = base + (pts.length - 1) * sides;
      for (let k = 0; k < sides; k++) this.idx.push(off + k, off + ((k + 1) % sides), c);
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}
