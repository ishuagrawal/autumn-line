import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Two-attachment scene target + a full-screen pass that inks outlines from
// depth / normal / id discontinuities, then grades and outputs sRGB.
// ---------------------------------------------------------------------------

const POST_VERT = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const POST_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
layout(location = 0) out vec4 fragColor;

uniform sampler2D tColor;
uniform sampler2D tND;
uniform vec2 uTexel;
uniform float uLine;
uniform float uDepthK;
uniform float uNormalK;
uniform float uFadeNear;
uniform float uFadeFar;
uniform float uFarLine;
uniform float uInk;
uniform float uTime;
uniform float uVignette;
uniform float uGrain;
uniform float uSat;
uniform float uDebug;

vec3 decodeN(vec2 xy) {
  return vec3(xy, sqrt(max(0.0, 1.0 - dot(xy, xy))));
}

float h21(vec2 p) {
  p = fract(p * vec2(233.34, 851.73));
  p += dot(p, p + 23.45);
  return fract(p.x * p.y);
}

vec3 toSRGB(vec3 c) {
  c = max(c, 0.0);
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
  return mix(lo, hi, step(0.0031308, c));
}

void main() {
  vec4 C = texture(tColor, vUv);
  vec4 ND = texture(tND, vUv);
  float dC = max(ND.z, 1e-3);
  float iC = 1.0 / dC;
  vec3 nC = decodeN(ND.xy);

  vec2 offs[8] = vec2[8](
    vec2(1.0, 0.0), vec2(-1.0, 0.0), vec2(0.0, 1.0), vec2(0.0, -1.0),
    vec2(0.7071, 0.7071), vec2(-0.7071, -0.7071), vec2(0.7071, -0.7071), vec2(-0.7071, 0.7071)
  );
  vec4 S[8];
  for (int k = 0; k < 8; k++) S[k] = texture(tND, vUv + offs[k] * uTexel * uLine);

  // negative ink weight marks foliage: leaf cards overlap at many depths, so
  // only silhouettes against other objects / big depth gaps get inked there
  float foliage = step(C.a, -0.001);
  float kD = mix(uDepthK, 0.3, foliage);
  float edge = 0.0;
  for (int k = 0; k < 8; k++) {
    vec4 a = S[k];
    vec4 b = S[k ^ 1];
    float dA = max(a.z, 1e-3), dB = max(b.z, 1e-3);
    // depth: neighbour meaningfully farther, and not explained by a plane
    float lap = abs(1.0 / dA + 1.0 / dB - 2.0 * iC) / iC;
    float farther = smoothstep(dC * (1.0 + kD * 0.5), dC * (1.0 + kD), dA);
    float eD = farther * smoothstep(kD * 0.5, kD * 1.5, lap);
    // crease from normals (only when neighbour isn't nearer)
    float notNearer = step(dC * 0.995, dA);
    float eN = smoothstep(uNormalK, uNormalK + 0.2, 1.0 - dot(nC, decodeN(a.xy))) * notNearer * (1.0 - foliage);
    // different object at a similar depth
    float eI = step(0.003, abs(a.w - ND.w)) * notNearer * step(dA, dC * 1.6);
    float wgt = k < 4 ? 1.0 : 0.7;
    edge = max(edge, max(eD, max(eN * 0.8, eI)) * wgt);
  }

  float fade = mix(1.0, uFarLine, smoothstep(uFadeNear, uFadeFar, dC));
  float ink = clamp(edge * abs(C.a) * fade, 0.0, 1.0);

  vec3 col = C.rgb;
  vec3 inkCol = pow(max(col, 0.0), vec3(1.25)) * uInk + vec3(0.006, 0.004, 0.008);
  col = mix(col, inkCol, ink);

  // grade: gentle saturation lift and filmic shoulder
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, uSat);
  col = col / (1.0 + col * 0.12) * 1.1;

  vec2 q = vUv - 0.5;
  col *= 1.0 - uVignette * dot(q, q) * 2.2;

  vec3 outc = toSRGB(col);
  outc += (h21(gl_FragCoord.xy + fract(uTime) * 91.0) - 0.5) * uGrain;
  if (uDebug > 0.5 && uDebug < 1.5) outc = vec3(ink);
  if (uDebug > 1.5 && uDebug < 2.5) outc = nC * 0.5 + 0.5;
  if (uDebug > 2.5) outc = vec3(fract(ND.z / 50.0));
  fragColor = vec4(outc, 1.0);
}
`;

export class Pipeline {
  readonly target: THREE.WebGLRenderTarget;
  private readonly quad: THREE.Mesh;
  private readonly postScene = new THREE.Scene();
  private readonly postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  readonly post: THREE.ShaderMaterial;

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    this.target = new THREE.WebGLRenderTarget(4, 4, {
      count: 2,
      type: THREE.HalfFloatType,
      samples: 4,
      depthBuffer: true,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
    });
    this.post = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: POST_VERT,
      fragmentShader: POST_FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tColor: { value: this.target.textures[0] },
        tND: { value: this.target.textures[1] },
        uTexel: { value: new THREE.Vector2(1 / 4, 1 / 4) },
        uLine: { value: 1.5 },
        uDepthK: { value: 0.05 },
        uNormalK: { value: 0.45 },
        uFadeNear: { value: 120 },
        uFadeFar: { value: 1400 },
        uFarLine: { value: 0.45 },
        uInk: { value: 0.3 },
        uTime: { value: 0 },
        uVignette: { value: 0.22 },
        uGrain: { value: 0.012 },
        uSat: { value: 0.96 },
        uDebug: { value: 0 },
      },
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    this.quad = new THREE.Mesh(geo, this.post);
    this.quad.frustumCulled = false;
    this.postScene.add(this.quad);
  }

  setSize(w: number, h: number, pixelRatio: number): void {
    const W = Math.max(1, Math.round(w * pixelRatio));
    const H = Math.max(1, Math.round(h * pixelRatio));
    this.target.setSize(W, H);
    (this.post.uniforms.uTexel.value as THREE.Vector2).set(1 / W, 1 / H);
    // keep ink lines ~1.1 css px wide regardless of density
    this.post.uniforms.uLine.value = Math.max(1, 1.1 * pixelRatio);
  }

  render(scene: THREE.Scene, camera: THREE.Camera, time: number): void {
    const r = this.renderer;
    r.setRenderTarget(this.target);
    r.setClearColor(0x000000, 0);
    r.clear(true, true, false);
    r.render(scene, camera);
    r.setRenderTarget(null);
    this.post.uniforms.uTime.value = time;
    r.render(this.postScene, this.postCam);
  }
}
