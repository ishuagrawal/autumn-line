import * as THREE from 'three';
import { MAIN, groundHeightQ, leftOffset } from '../core/layout';
import { forestDensity, site, zoneAt } from '../core/ecology';
import { toonMaterial } from '../render/toon';

// Three ground layers:
//   strip - fine mesh that follows the railway (ballast, shoulders, grass)
//   mid   - 2 m grid around the photo area
//   far   - 40 m grid to the horizon, painted as forest canopy
// Each coarser layer cuts a hole where a finer one exists.

const STRIP_U: number[] = (() => {
  const u: number[] = [];
  for (let v = -16; v < -7; v += 0.5) u.push(v);
  for (let v = -7; v <= 3.5 + 1e-6; v += 0.2) u.push(+v.toFixed(3));
  for (let v = 4; v <= 9 + 1e-6; v += 0.5) u.push(v);
  return u;
})();
const STRIP_S0 = -260, STRIP_S1 = 420;
const STRIP_UMIN = -16, STRIP_UMAX = 9;

function stripStations(): number[] {
  const s: number[] = [];
  for (let v = STRIP_S0; v < -60; v += 1) s.push(v);
  for (let v = -60; v < 200; v += 0.5) s.push(v);
  for (let v = 200; v <= STRIP_S1; v += 1) s.push(v);
  return s;
}

function insideStrip(q: { s: number; u: number }, margin: number): boolean {
  return q.s > STRIP_S0 + margin && q.s < STRIP_S1 - margin && q.u > STRIP_UMIN + margin && q.u < STRIP_UMAX - margin;
}

export function buildStrip(): THREE.Mesh {
  const ss = stripStations();
  const nu = STRIP_U.length;
  const cols = nu + 2; // + skirt columns
  const pos = new Float32Array(ss.length * cols * 3);
  const zone = new Float32Array(ss.length * cols * 4);
  let k = 0;
  for (const s of ss) {
    for (let j = -1; j <= nu; j++) {
      const skirt = j < 0 || j >= nu;
      const u = STRIP_U[Math.min(nu - 1, Math.max(0, j))];
      const p = MAIN.point(s, u);
      const q = { s, u, d: Math.abs(u), c: leftOffset(s) };
      let h = groundHeightQ(p.x, p.z, q);
      const edge = Math.abs(u) > 6 ? 0.04 : 0;
      h += edge;
      if (skirt) h -= 0.5;
      pos[k * 3] = p.x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = p.z;
      const zz = zoneAt(p.x, p.z, q);
      zone.set(zz, k * 4);
      k++;
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < ss.length - 1; i++) {
    for (let j = 0; j < cols - 1; j++) {
      const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aZone', new THREE.BufferAttribute(zone, 4));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, toonMaterial({ pattern: 'ground', rim: 0, outline: 0 }));
  m.receiveShadow = true;
  m.name = 'strip';
  return m;
}

export const MID = { x0: -170, x1: 230, z0: -440, z1: 280, step: 2 };

export function buildMid(): THREE.Mesh {
  const nx = Math.round((MID.x1 - MID.x0) / MID.step) + 1;
  const nz = Math.round((MID.z1 - MID.z0) / MID.step) + 1;
  const pos = new Float32Array(nx * nz * 3);
  const zone = new Float32Array(nx * nz * 4);
  const inside = new Uint8Array(nx * nz);
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const x = MID.x0 + ix * MID.step, z = MID.z0 + iz * MID.step;
      const q = site(x, z);
      let h = groundHeightQ(x, z, q);
      const k = iz * nx + ix;
      if (insideStrip(q, 0.05)) { inside[k] = 1; h -= 0.1; }
      pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
      zone.set(zoneAt(x, z, q), k * 4);
    }
  }
  const idx: number[] = [];
  for (let iz = 0; iz < nz - 1; iz++) {
    for (let ix = 0; ix < nx - 1; ix++) {
      const a = iz * nx + ix, b = a + 1, c = a + nx, d = c + 1;
      if (inside[a] && inside[b] && inside[c] && inside[d]) continue;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aZone', new THREE.BufferAttribute(zone, 4));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, toonMaterial({ pattern: 'ground', rim: 0, outline: 0 }));
  m.receiveShadow = true;
  m.name = 'mid';
  return m;
}

export const CANOPY_LIFT = 8;

export function buildFar(): THREE.Mesh {
  const R = 4200, step = 40;
  const n = Math.round((2 * R) / step) + 1;
  const pos = new Float32Array(n * n * 3);
  const zone = new Float32Array(n * n * 4);
  const inside = new Uint8Array(n * n);
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const x = -R + ix * step, z = -R + iz * step;
      const q = site(x, z);
      let h = groundHeightQ(x, z, q);
      const fd = forestDensity(x, z, q);
      const k = iz * n + ix;
      const inMid = x > MID.x0 + 1 && x < MID.x1 - 1 && z > MID.z0 + 1 && z < MID.z1 - 1;
      if (inMid) { inside[k] = 1; h -= 2; }
      else h += CANOPY_LIFT * fd * Math.min(1, q.d / 60);
      pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
      zone[k * 4 + 2] = fd;
      zone[k * 4 + 3] = 0.5;
    }
  }
  const idx: number[] = [];
  for (let iz = 0; iz < n - 1; iz++) {
    for (let ix = 0; ix < n - 1; ix++) {
      const a = iz * n + ix, b = a + 1, c = a + n, d = c + 1;
      if (inside[a] && inside[b] && inside[c] && inside[d]) continue;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aZone', new THREE.BufferAttribute(zone, 4));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, toonMaterial({ pattern: 'canopy', rim: 0, outline: 0.35 }));
  m.name = 'far';
  return m;
}
