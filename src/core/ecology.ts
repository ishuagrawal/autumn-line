import { MAIN, leftOffset, trackbed } from './layout';
import { fbm2, noise2, smoothstep } from './rng';

// Where things grow. Everything is expressed relative to the railway:
// s = station along the main line, u = lateral offset (+ right).

export interface Site { s: number; u: number; d: number; c: number | null }

export function site(x: number, z: number): Site {
  const q = MAIN.project(x, z);
  return { s: q.s, u: q.u, d: q.d, c: leftOffset(q.s) };
}

/** u of the grass -> forest boundary on the left side (negative number) */
export function leftEdge(s: number): number {
  const n = noise2(s * 0.035, 3.1) * 0.5 + noise2(s * 0.11, 7.7) * 0.25;
  const c = leftOffset(s);
  const e = c !== null && c < -1 ? c - 7.0 - n * 5 : -9.5 - n * 4;
  // open meadow beside the photographer: lets low sun reach the mid-distance
  // ballast while trees further back still shade the foreground
  const m = smoothstep(-12, -2, s) * (1 - smoothstep(62, 82, s));
  return e - m * (12 + n * 4);
}

/** u where grass/brush gives way to forest on the right */
export function rightEdge(s: number): number {
  const n = noise2(s * 0.04, 1.3) * 0.5 + noise2(s * 0.13, 5.2) * 0.25;
  if (s > 34 && s < 150) return 4.2 + n * 2.5;
  if (s >= 0 && s <= 34) return 9.5 + n * 3;
  return 7 + n * 4;
}

/** 0 = open ground, 1 = full forest */
export function forestDensity(x: number, z: number, q: Site): number {
  let f = 1;
  if (q.s > -880 && q.s < 1280) {
    if (q.u < 0) f = smoothstep(0, 3, leftEdge(q.s) - q.u);
    else f = smoothstep(0, 3, q.u - rightEdge(q.s));
  }
  // occasional clearings well away from the line
  const clr = fbm2(x * 0.0032 + 11, z * 0.0032 - 4, 3);
  f *= smoothstep(-0.28, -0.12, clr) * smoothstep(20, 60, q.d) + (1 - smoothstep(20, 60, q.d));
  return f;
}

/** ground paint weights: gravel, grass, forest litter, dry straw */
export function zoneAt(x: number, z: number, q: Site): [number, number, number, number] {
  const tb = trackbed(q.s, q.u);
  const inRange = q.s > -880 && q.s < 1280;
  const gravel = inRange ? tb.gravel * tb.w : 0;
  const fd = forestDensity(x, z, q);
  const litter = smoothstep(0.15, 0.8, fd);
  const dryN = fbm2(x * 0.08, z * 0.08, 3);
  let dry = smoothstep(-0.05, 0.25, dryN);
  // straw-coloured fringe along the ballast shoulder
  dry = Math.max(dry, (1 - smoothstep(0.4, 1.6, Math.abs(Math.abs(q.u) - 3.1))) * 0.8);
  // the right-hand lawn in the photo is a vivid green
  if (q.u > 3 && q.s > 0 && q.s < 38) dry *= 0.25;
  return [gravel, 1 - litter, litter, dry];
}
