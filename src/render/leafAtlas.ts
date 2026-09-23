import * as THREE from 'three';
import { Rng } from '../core/rng';

// ---------------------------------------------------------------------------
// Procedural leaf-cluster atlas (2x2 variants). Alpha = leaf coverage, RGB =
// per-leaf shade multiplier. Clusters are kept roughly round so that at low
// mip levels a card degrades into a soft blob instead of a square.
// ---------------------------------------------------------------------------

let atlas: THREE.CanvasTexture | null = null;

function leafPath(g: CanvasRenderingContext2D, len: number, wid: number, lobed: boolean): void {
  g.beginPath();
  if (!lobed) {
    g.moveTo(-len / 2, 0);
    g.bezierCurveTo(-len * 0.2, -wid * 0.9, len * 0.25, -wid * 0.7, len / 2, 0);
    g.bezierCurveTo(len * 0.25, wid * 0.7, -len * 0.2, wid * 0.9, -len / 2, 0);
  } else {
    // simple maple-ish star: five rounded lobes
    const n = 5;
    for (let i = 0; i <= n * 2; i++) {
      const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2;
      const r = (i % 2 === 0 ? len * 0.5 : len * 0.24) * (i === 0 || i === n * 2 ? 1 : 1);
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
  }
  g.closePath();
}

export function leafAtlas(): THREE.CanvasTexture {
  if (atlas) return atlas;
  const S = 512, C = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d')!;
  g.clearRect(0, 0, S, S);
  const rng = new Rng(55);
  for (let v = 0; v < 4; v++) {
    const ox = (v % 2) * C, oy = Math.floor(v / 2) * C;
    const lobed = v === 3;
    const n = lobed ? 10 : 13 + v * 3;
    for (let i = 0; i < n; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = Math.sqrt(rng.next()) * C * 0.29;
      const x = ox + C / 2 + Math.cos(a) * r;
      const y = oy + C / 2 + Math.sin(a) * r;
      const len = C * (lobed ? rng.range(0.2, 0.27) : rng.range(0.15, 0.22));
      const wid = len * rng.range(0.42, 0.6);
      const shade = Math.round(255 * rng.range(0.7, 1.0));
      g.save();
      g.translate(x, y);
      g.rotate(rng.range(0, Math.PI * 2));
      g.fillStyle = `rgb(${shade},${shade},${shade})`;
      leafPath(g, len, wid, lobed);
      g.fill();
      // darker rim + midrib give each leaf a drawn look
      g.strokeStyle = `rgba(${Math.round(shade * 0.55)},${Math.round(shade * 0.55)},${Math.round(shade * 0.55)},1)`;
      g.lineWidth = 3;
      g.stroke();
      g.beginPath();
      g.moveTo(-len * 0.45, 0);
      g.lineTo(len * 0.4, 0);
      g.lineWidth = 2;
      g.stroke();
      g.restore();
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  atlas = tex;
  return tex;
}

let frond: THREE.CanvasTexture | null = null;

/** conifer foliage: drooping needle fronds, 2x2 variants, stem along +x */
export function frondAtlas(): THREE.CanvasTexture {
  if (frond) return frond;
  const S = 512, C = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d')!;
  const rng = new Rng(77);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  // Each cell: a branch running along +x with 5-8 drooping branchlets hanging
  // off it. Strokes are chunky on purpose: at viewing distance a card is only
  // ~30 px, so the readable detail is the branchlet pattern and its gaps.
  for (let v = 0; v < 4; v++) {
    const ox = (v % 2) * C, oy = Math.floor(v / 2) * C;
    const y0 = oy + C * rng.range(0.3, 0.4);
    const x0 = ox + C * 0.05, x1 = ox + C * 0.95;
    const sag = rng.range(10, 30);
    const at = (t: number) => ({ x: x0 + (x1 - x0) * t, y: y0 + sag * t * t });
    const n = 5 + (v % 3);
    for (let i = 0; i < n; i++) {
      const t = (i + rng.range(0.2, 0.8)) / n;
      const p = at(t);
      const len = C * rng.range(0.28, 0.52) * (1 - t * 0.35);
      const drift = rng.range(0.05, 0.3) * len;
      const shade = Math.round(255 * rng.range(0.62, 1.0));
      // a ragged hanging branchlet: fat stroke with a notched outline
      for (let k = 0; k < 9; k++) {
        const f = k / 8;
        const w = C * 0.05 * (1 - f * 0.6) * rng.range(0.8, 1.2);
        g.fillStyle = `rgb(${shade},${shade},${shade})`;
        g.beginPath();
        g.ellipse(p.x + drift * f + rng.range(-3, 3), p.y + len * f, w, w * 1.4, 0, 0, Math.PI * 2);
        g.fill();
      }
      g.strokeStyle = `rgb(${Math.round(shade * 0.5)},${Math.round(shade * 0.5)},${Math.round(shade * 0.5)})`;
      g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(p.x, p.y);
      g.lineTo(p.x + drift, p.y + len);
      g.stroke();
    }
    // the carrying branch, needled along its top
    for (let i = 0; i <= 30; i++) {
      const p = at(i / 30);
      const w = C * 0.045 * (1 - i / 45);
      g.fillStyle = 'rgb(225,225,225)';
      g.beginPath();
      g.ellipse(p.x, p.y, w * 1.3, w, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  frond = tex;
  return tex;
}

/** shadow-pass material that cuts the same leaf holes as the colour pass */
export function leafDepthMaterial(map: THREE.Texture = leafAtlas()): THREE.MeshDepthMaterial {
  return new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    map,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
  });
}
