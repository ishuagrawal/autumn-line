import * as THREE from 'three';
import { PAL, SUN_DIR } from '../core/layout';
import { leafAtlas } from './leafAtlas';

// ---------------------------------------------------------------------------
// Cel shader used by every lit surface in the scene.
//
// Writes two render targets:
//   0: rgb = shaded colour (linear), a = ink-line weight for this surface
//   1: xy  = view-space normal, z = view depth (m), w = object/instance id
// The post pass turns attachment 1 into ink lines.
// ---------------------------------------------------------------------------

const lin = (hex: number) => new THREE.Color(hex);

/** uniforms shared by reference between every toon material */
export const SHARED = {
  uTime: { value: 0 },
  uSunDir: { value: SUN_DIR.clone() },
  uSunColor: { value: lin(PAL.sun).multiplyScalar(1.22) },
  uSkyAmb: { value: lin(PAL.skyAmb) },
  uGroundAmb: { value: lin(PAL.groundAmb) },
  uShadowTint: { value: lin(PAL.shadowTint) },
  uFogColor: { value: lin(PAL.haze) },
  uFogDensity: { value: 0.00018 },
  uFogStart: { value: 240 },
  uWindDir: { value: new THREE.Vector3(0.8, 0, -0.35).normalize() },
  uWindStrength: { value: 1 },
  uDebug: { value: 0 },
  uGravelA: { value: lin(0xc6c1b9) },
  uGravelB: { value: lin(0x8f8b87) },
  uGravelC: { value: lin(0xd2c4b0) },
  uGravelDark: { value: lin(0x2e2c2f) },
  uGrassA: { value: lin(PAL.grass) },
  uGrassB: { value: lin(0x929f50) },
  uGrassDry: { value: lin(PAL.grassDry) },
  uDirt: { value: lin(PAL.dirt) },
  uLitter: { value: lin(PAL.litter) },
  uLitterB: { value: lin(0x946848) },
  // distant forest canopy palette (cellular crowns painted on far terrain)
  uCanopy: {
    value: [PAL.orange, PAL.rust, PAL.peach, PAL.gold, PAL.brownLeaf, PAL.bareGrey, PAL.olive, PAL.pine].map(lin),
  },
};

export type Pattern = 'none' | 'ground' | 'canopy' | 'wood' | 'bark' | 'grass' | 'leaf' | 'rail' | 'foliage' | 'leafcard';

export interface ToonOptions {
  color?: THREE.ColorRepresentation;
  vertexColors?: boolean;
  outline?: number;
  pattern?: Pattern;
  side?: THREE.Side;
  rim?: number;
  terminator?: number;
  wind?: { amp: number; flutter?: number; scale?: number };
  id?: number;
  fog?: number;
  /** multiplier on the ambient/shadow side (<1 darker shadows) */
  shadowLift?: number;
  /** how far lit colour is pushed brighter in the highlight band */
  highlight?: number;
  /** extra defines */
  defines?: Record<string, string | number | boolean>;
}

const VERT = /* glsl */ `
#include <common>
#include <shadowmap_pars_vertex>

uniform float uTime;
uniform vec3 uWindDir;
uniform float uWindStrength;
uniform float uWindAmp;
uniform float uFlutter;
uniform float uWindScale;
uniform float uObjectId;

varying vec3 vWorldPos;
varying vec3 vNormalW;
varying vec3 vViewNormal;
varying vec3 vCol;
varying vec3 vLocal;
varying float vViewZ;
flat varying float vId;
#ifdef USE_UV_ATTR
  varying vec2 vUv2;
#endif
#ifdef USE_ZONE
  attribute vec4 aZone;
  varying vec4 vZone;
#endif
#ifdef USE_FALL
  attribute vec4 aFall; // phase, speed, drop height, seed
#endif

void main() {
  vec3 transformed = position;
  vec3 objectNormal = normal;
  mat4 model = modelMatrix;
  #ifdef USE_INSTANCING
    model = modelMatrix * instanceMatrix;
  #endif
  #ifdef USE_FALL
    float ft = uTime * aFall.y + aFall.x;
    float cyc = mod(ft, aFall.z);
    float ang = uTime * (1.6 + aFall.w * 2.6) + aFall.w * 20.0;
    vec3 ax = normalize(vec3(sin(aFall.w * 7.0 + uTime * 0.3), 0.7, cos(aFall.w * 5.0)));
    float ca = cos(ang), sa = sin(ang);
    transformed = transformed * ca + cross(ax, transformed) * sa + ax * dot(ax, transformed) * (1.0 - ca);
    objectNormal = objectNormal * ca + cross(ax, objectNormal) * sa + ax * dot(ax, objectNormal) * (1.0 - ca);
    transformed *= smoothstep(0.0, 0.6, cyc) * (1.0 - smoothstep(aFall.z - 0.25, aFall.z, cyc));
  #endif
  vec4 worldPosition = model * vec4(transformed, 1.0);
  vec3 wn = normalize(mat3(model) * objectNormal);
  #ifdef USE_FALL
    worldPosition.y -= cyc;
    worldPosition.x += sin(ft * 0.9 + aFall.w * 6.0) * 0.7 + cyc * 0.45 * uWindDir.x;
    worldPosition.z += cos(ft * 0.7 + aFall.w * 4.0) * 0.5 + cyc * 0.45 * uWindDir.z;
  #endif

  #ifdef USE_WIND
    // sway grows with height above the object's origin
    float h = max(0.0, transformed.y) * uWindScale;
    h = h * h;
    #ifdef USE_INSTANCING
      vec3 root = (model * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    #else
      vec3 root = vec3(0.0);
    #endif
    float ph = dot(root.xz, vec2(0.071, 0.053)) + uTime * 0.9;
    float gust = 0.6 + 0.4 * sin(uTime * 0.23 + root.x * 0.01);
    vec3 sway = uWindDir * (sin(ph) * 0.8 + sin(ph * 2.3 + 1.7) * 0.35) * uWindAmp * h * gust;
    float fl = uTime * 5.3 + dot(worldPosition.xyz, vec3(2.1, 1.7, 1.3));
    sway += vec3(sin(fl), sin(fl * 1.3 + 2.0) * 0.5, cos(fl * 0.9)) * uFlutter * min(h, 1.0);
    worldPosition.xyz += sway * uWindStrength;
  #endif

  vec4 mvPosition = viewMatrix * worldPosition;
  gl_Position = projectionMatrix * mvPosition;

  vWorldPos = worldPosition.xyz;
  vNormalW = wn;
  vec3 transformedNormal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
  vViewNormal = transformedNormal;
  vViewZ = -mvPosition.z;
  vLocal = position;

  vCol = vec3(1.0);
  #ifdef USE_COLOR
    vCol *= color.rgb;
  #endif
  #ifdef USE_INSTANCING_COLOR
    vCol *= instanceColor.rgb;
  #endif

  #ifdef USE_INSTANCING
    vId = fract(float(gl_InstanceID) * 0.618034 + uObjectId);
  #else
    vId = uObjectId;
  #endif
  #ifdef USE_UV_ATTR
    vUv2 = uv;
  #endif
  #ifdef USE_ZONE
    vZone = aZone;
  #endif

  #include <shadowmap_vertex>
}
`;

const FRAG = /* glsl */ `
#include <common>
#include <bsdfs>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>

layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outND;

uniform vec3 uColor;
uniform float uOutline;
uniform float uRim;
uniform float uTerminator;
uniform float uShadowLift;
uniform float uHighlight;
uniform float uFogScale;
uniform float uTime;

uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyAmb;
uniform vec3 uGroundAmb;
uniform vec3 uShadowTint;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uFogStart;
uniform float uDebug;

uniform vec3 uGravelA, uGravelB, uGravelC, uGravelDark;
uniform vec3 uGrassA, uGrassB, uGrassDry, uDirt, uLitter, uLitterB;
uniform vec3 uCanopy[8];
uniform sampler2D uLeafTex;

varying vec3 vWorldPos;
varying vec3 vNormalW;
varying vec3 vViewNormal;
varying vec3 vCol;
varying vec3 vLocal;
varying float vViewZ;
flat varying float vId;
#ifdef USE_UV_ATTR
  varying vec2 vUv2;
#endif
#ifdef USE_ZONE
  varying vec4 vZone;
#endif

float h21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
vec2 h22(vec2 p) {
  float n = h21(p);
  return vec2(n, h21(p + n + 17.17));
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 11.7; a *= 0.5; }
  return s;
}

#ifdef PATTERN_GROUND
// Voronoi pebbles: each cell is a domed stone with its own tone.
vec3 pebbles(vec2 wp, float cell, float lod, inout vec3 N) {
  vec2 p = wp / cell;
  vec2 ip = floor(p), fp = fract(p);
  float d1 = 8.0, d2 = 8.0;
  vec2 bestOff = vec2(0.0), bestId = vec2(0.0);
  for (int j = -1; j <= 1; j++)
  for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 o = h22(ip + g) * 0.8 + 0.1;
    vec2 r = g + o - fp;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; bestOff = r; bestId = ip + g; }
    else if (d < d2) { d2 = d; }
  }
  float edge = sqrt(d2) - sqrt(d1);
  float t = h21(bestId * 1.31);
  vec3 c = t < 0.45 ? uGravelA : (t < 0.8 ? uGravelB : uGravelC);
  c *= 0.82 + 0.36 * h21(bestId + 3.7);
  if (t > 0.965) c = uLitter * 1.1; // a fallen leaf fragment or rusty chip
  float crevice = 1.0 - smoothstep(0.06, 0.2, edge);
  c = mix(c, uGravelDark, crevice * 0.85 * (1.0 - lod));
  // dome normal from offset to pebble centre
  vec2 tilt = -bestOff * 1.4 * (1.0 - lod);
  N = normalize(N + vec3(tilt.x, 0.0, tilt.y));
  return c;
}
#endif

void main() {
  vec3 N = normalize(vNormalW);
  #ifdef DOUBLE_SIDED
    if (!gl_FrontFacing) N = -N;
  #endif
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 base = uColor * vCol;
  float extraShade = 1.0;
  float outlineMul = 1.0;

  #ifdef PATTERN_WOOD
    // weathered tie: grain streaks along the length + checks at the ends
    float g1 = vnoise(vec2(vLocal.x * 0.9, (vLocal.z + vLocal.y * 0.7) * 26.0 + vId * 50.0));
    float g2 = vnoise(vec2(vLocal.x * 3.0 + 4.0, vLocal.z * 60.0 + vId * 17.0));
    float streak = smoothstep(0.58, 0.63, g1) * 0.28 + smoothstep(0.7, 0.74, g2) * 0.22;
    float check = (1.0 - smoothstep(0.0, 0.035, abs(g2 - 0.5))) * step(0.5, g1) * 0.35;
    base *= 1.0 - streak - check;
    base = mix(base, base * vec3(1.08, 1.0, 0.92), smoothstep(0.3, 0.7, vnoise(vLocal.xz * 2.0 + vId * 9.0)));
  #endif

  #ifdef PATTERN_BARK
    float a = atan(vLocal.x, vLocal.z);
    float bk = vnoise(vec2(a * 3.0, vLocal.y * 1.4 + vId * 10.0));
    float bk2 = vnoise(vec2(a * 9.0, vLocal.y * 5.0));
    base *= 1.0 - smoothstep(0.55, 0.62, bk) * 0.28 - smoothstep(0.66, 0.7, bk2) * 0.18;
  #endif

  #ifdef PATTERN_GROUND
    float px = length(fwidth(vWorldPos.xz));
    vec4 z = vZone; // x gravel, y grass, z litter, w dry meadow
    float br = fbm(vWorldPos.xz * 0.45);
    float br2 = vnoise(vWorldPos.xz * 2.7);
    // ragged gravel/grass border
    float gm = smoothstep(0.35, 0.65, z.x + (br - 0.5) * 0.55 + (br2 - 0.5) * 0.25);
    float lod1 = smoothstep(0.22, 0.55, px / 0.055);
    vec3 Ng = N;
    vec3 grav = pebbles(vWorldPos.xz, 0.055, lod1, Ng);
    // coarse secondary stones
    float lod2 = smoothstep(0.22, 0.55, px / 0.13);
    vec3 Ng2 = N;
    vec3 grav2 = pebbles(vWorldPos.xz + 31.7, 0.13, lod2, Ng2);
    float big = step(0.62, h21(floor(vWorldPos.xz / 0.13) + 7.0)) * (1.0 - lod2);
    grav = mix(grav, grav2, big * 0.6);
    vec3 gravAvg = mix(uGravelA, uGravelB, 0.45) * 0.86;
    grav = mix(grav, gravAvg, smoothstep(0.6, 1.4, px / 0.055));
    Ng = normalize(mix(Ng, Ng2, big * 0.6));

    // grass: patchy two-tone + dry straw
    float gp = step(0.52, fbm(vWorldPos.xz * 0.9 + 3.0));
    vec3 grass = mix(uGrassA, uGrassB, gp);
    grass = mix(grass, uGrassDry, smoothstep(0.45, 0.75, z.w + (br2 - 0.5) * 0.5));
    grass *= 0.9 + 0.2 * vnoise(vWorldPos.xz * 7.0);
    // forest floor: leaf litter
    float lp = vnoise(vWorldPos.xz * 3.3);
    vec3 litter = mix(uLitter, uLitterB, step(0.55, lp));
    litter = mix(litter, uDirt, step(0.72, vnoise(vWorldPos.xz * 0.7 + 9.0)) * 0.6);
    vec3 soft = mix(grass, litter, smoothstep(0.35, 0.65, z.z + (br - 0.5) * 0.4));
    base = mix(soft, grav, gm);
    N = normalize(mix(N, Ng, gm));
    outlineMul = 0.0;
  #endif

  #ifdef PATTERN_CANOPY
    {
      // far hillsides: a quilt of domed crowns
      float px = length(fwidth(vWorldPos.xz));
      vec2 p = vWorldPos.xz / 10.0;
      vec2 ip = floor(p), fp = fract(p);
      float d1 = 8.0, d2 = 8.0; vec2 bo = vec2(0.0), bid = vec2(0.0);
      for (int j = -1; j <= 1; j++)
      for (int i = -1; i <= 1; i++) {
        vec2 g = vec2(float(i), float(j));
        vec2 o = h22(ip + g) * 0.85 + 0.075;
        vec2 r = g + o - fp;
        float d = dot(r, r);
        if (d < d1) { d2 = d1; d1 = d; bo = r; bid = ip + g; } else if (d < d2) d2 = d;
      }
      float t = h21(bid * 0.731);
      float pz = fbm(vWorldPos.xz * 0.004);
      int k = t < 0.2 ? 0 : t < 0.36 ? 1 : t < 0.5 ? 2 : t < 0.62 ? 3 : t < 0.72 ? 4 : t < 0.84 ? 5 : t < 0.93 ? 6 : 7;
      if (pz > 0.62 && t > 0.5) k = 1;
      vec3 cc = uCanopy[k] * (0.85 + 0.3 * h21(bid + 5.1));
      float lod = smoothstep(0.08, 0.3, px / 10.0);
      float crev = (1.0 - smoothstep(0.02, 0.18, sqrt(d2) - sqrt(d1))) * (1.0 - lod);
      cc = mix(cc, cc * 0.45, crev);
      cc = mix(cc, (uCanopy[0] + uCanopy[1] + uCanopy[2] + uCanopy[4]) * 0.24, lod);
      float forest = smoothstep(0.3, 0.7, vZone.z);
      vec3 meadow = mix(uGrassB, uGrassDry, 0.55) * (0.9 + 0.2 * vnoise(vWorldPos.xz * 0.05));
      base = mix(meadow, cc, forest);
      vec2 tilt = -bo * 1.5 * (1.0 - lod) * forest;
      N = normalize(N + vec3(tilt.x, 0.0, tilt.y));
      outlineMul = 0.0;
    }
  #endif

  #ifdef PATTERN_GRASS
    float t = vUv2.y;
    base *= mix(0.55, 1.12, t);
    N = normalize(mix(N, vec3(0.0, 1.0, 0.0), 0.75));
  #endif

  #ifdef PATTERN_LEAF
    vec2 q = vUv2 - 0.5;
    float r = length(q * vec2(2.2, 2.0));
    float tipFade = 1.0 - 0.45 * abs(q.y * 2.0);
    if (r > tipFade) discard;
    base *= 1.0 - 0.28 * (1.0 - smoothstep(0.0, 0.06, abs(q.x)));
  #endif

  #ifdef PATTERN_FOLIAGE
    // speckled leaf texture on crowns
    float sp = vnoise(vLocal.xy * 3.1 + vLocal.z * 1.7 + vId * 31.0);
    base *= 0.93 + 0.14 * step(0.5, sp);
  #endif

  #ifdef PATTERN_LEAFCARD
    if (vUv2.x > -0.5) {
      vec4 lt = texture(uLeafTex, vUv2);
      if (lt.a < 0.5) discard;
      base *= lt.r * 1.06;
      #ifdef FROND
        // shaded where the frond meets the trunk, sunlit at the tip
        base *= mix(0.62, 1.18, fract(vUv2.x * 2.0));
      #endif
    } else {
      // inner mass: leaf atlas projected in object space with dark gaps, so
      // it reads as dense foliage rather than a smooth ball
      vec3 ap = abs(normalize(vNormalW));
      vec2 tuv = ap.x > ap.z ? vLocal.zy : vLocal.xy;
      vec4 lt = texture(uLeafTex, fract(tuv * 0.55) * 0.5);
      base *= mix(0.52, lt.r, lt.a);
    }
  #endif

  // ---- light --------------------------------------------------------------
  float ndl = dot(N, uSunDir);
  float sh = getShadowMask();
  sh = smoothstep(0.28, 0.72, sh);
  float w = fwidth(ndl) * 0.8 + 0.002;
  float lit = smoothstep(uTerminator - w, uTerminator + w, ndl) * sh;
  float hi = smoothstep(0.62 - w, 0.62 + w, ndl) * sh;

  vec3 amb = mix(uGroundAmb, uSkyAmb, clamp(N.y * 0.5 + 0.5, 0.0, 1.0));
  // hue-preserving cool shade (a plain blue multiply turns yellows green)
  float skyward = clamp(N.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 shadowCol = base * uShadowTint * mix(0.78, 1.08, skyward) * uShadowLift;
  vec3 litCol = base * (uSunColor * 0.92 + amb * 0.18);
  vec3 col = mix(shadowCol, litCol, lit);
  // highlight band, nudged warm (makes spruce tips go yellow-green)
  col *= mix(vec3(1.0), vec3(1.0 + uHighlight * 1.1, 1.0 + uHighlight, 1.0 + uHighlight * 0.25), hi);
  col *= extraShade;

  // rim of skylight on silhouettes (painterly edge glow)
  float fr = 1.0 - clamp(dot(N, V), 0.0, 1.0);
  float rim = smoothstep(0.6, 0.66, fr) * uRim;
  col += base * uSkyAmb * rim * (0.35 + 0.4 * lit);

  #ifdef PATTERN_RAIL
    // polished rail head catches the bright sky
    float top = smoothstep(0.95, 0.99, N.y);
    col = mix(col, vec3(0.64, 0.62, 0.6) * (0.55 + 0.6 * sh), top * 0.7);
  #endif

  // aerial perspective
  float fd = max(vViewZ - uFogStart, 0.0);
  float fog = (1.0 - exp(-fd * uFogDensity)) * uFogScale;
  col = mix(col, uFogColor, clamp(fog, 0.0, 1.0));

  if (uDebug > 0.5 && uDebug < 1.5) col = vec3(sh, lit, 0.0);
  #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
    if (uDebug > 1.5) {
      vec4 sc = vDirectionalShadowCoord[0];
      col = vec3(fract(sc.xy / sc.w * 4.0), clamp(sc.z / sc.w, 0.0, 1.0));
      if (uDebug > 2.5) col = vec3(receiveShadow ? 1.0 : 0.0, 0.0, 1.0);
    }
  #else
    if (uDebug > 1.5) col = vec3(1.0, 0.0, 1.0);
  #endif
  outColor = vec4(col, uOutline * outlineMul);
  outND = vec4(normalize(vViewNormal).xy, vViewZ, vId);
}
`;

let objectCounter = 1;

/** clone a toon material but keep the shared (global) uniforms linked */
export function cloneToon(m: THREE.ShaderMaterial, color?: THREE.Color): THREE.ShaderMaterial {
  const c = m.clone();
  for (const k of Object.keys(SHARED) as (keyof typeof SHARED)[]) c.uniforms[k] = SHARED[k];
  c.uniforms.uObjectId.value = (objectCounter++ * 0.1373) % 1;
  if (color) c.uniforms.uColor.value = color.clone();
  return c;
}

export function toonMaterial(o: ToonOptions = {}): THREE.ShaderMaterial {
  const defines: Record<string, string | number | boolean> = { ...(o.defines ?? {}) };
  const pattern = o.pattern ?? 'none';
  if (pattern !== 'none') defines['PATTERN_' + pattern.toUpperCase()] = '';
  if (pattern === 'grass' || pattern === 'leaf' || pattern === 'leafcard') defines.USE_UV_ATTR = '';
  if (pattern === 'ground' || pattern === 'canopy') defines.USE_ZONE = '';
  if (o.wind) defines.USE_WIND = '';
  // leaf cards keep their crown-volume normals on both faces
  if (o.side === THREE.DoubleSide && pattern !== 'leafcard') defines.DOUBLE_SIDED = '';

  const id = o.id ?? ((objectCounter++ * 0.1373) % 1);
  const uniforms = {
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.lights),
    ...SHARED,
    uColor: { value: new THREE.Color(o.color ?? 0xffffff) },
    uOutline: { value: o.outline ?? 1 },
    uRim: { value: o.rim ?? 0.35 },
    uTerminator: { value: o.terminator ?? 0.02 },
    uShadowLift: { value: o.shadowLift ?? 1 },
    uHighlight: { value: o.highlight ?? 0.06 },
    uFogScale: { value: o.fog ?? 1 },
    uWindAmp: { value: o.wind?.amp ?? 0 },
    uFlutter: { value: o.wind?.flutter ?? 0 },
    uWindScale: { value: o.wind?.scale ?? 0.1 },
    uObjectId: { value: id },
    uLeafTex: { value: leafAtlas() },
  };

  const m = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms,
    defines,
    lights: true,
    vertexColors: o.vertexColors ?? false,
    side: o.side ?? THREE.FrontSide,
  });
  return m;
}
