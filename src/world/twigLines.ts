import * as THREE from 'three';
import { SHARED } from '../render/toon';

// ---------------------------------------------------------------------------
// Hairline twigs. Bare crowns in the photo read as a fine grey haze made of
// thousands of twigs; drawing them as 1-pixel GL lines (antialiased by the
// scene target's MSAA) is far cheaper than tubes and keeps them crisp at any
// distance. Everything is baked into one LineSegments in world space.
// ---------------------------------------------------------------------------

const VERT = /* glsl */ `
attribute vec3 aCol;
varying vec3 vCol;
varying float vViewZ;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec4 mv = viewMatrix * wp;
  vViewZ = -mv.z;
  vCol = aCol;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outND;
varying vec3 vCol;
varying float vViewZ;
uniform vec3 uSunColor;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uFogStart;
void main() {
  vec3 col = vCol * (0.78 + 0.18 * uSunColor);
  float fog = 1.0 - exp(-max(vViewZ - uFogStart, 0.0) * uFogDensity);
  col = mix(col, uFogColor, clamp(fog, 0.0, 1.0));
  outColor = vec4(col, 0.0);
  outND = vec4(0.0, 0.0, vViewZ, 0.7713);
}
`;

export class TwigLines {
  private pos: number[] = [];
  private col: number[] = [];
  private seed = 1;

  private rnd(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  /** add a template's hairlines transformed by `m`; `keep` thins them out */
  add(lines: Float32Array, m: THREE.Matrix4, tint: THREE.Color, keep = 1): void {
    const v = new THREE.Vector3();
    for (let i = 0; i < lines.length; i += 6) {
      if (keep < 1 && this.rnd() > keep) continue;
      const k = 0.8 + this.rnd() * 0.35;
      for (let j = 0; j < 2; j++) {
        v.set(lines[i + j * 3], lines[i + j * 3 + 1], lines[i + j * 3 + 2]).applyMatrix4(m);
        this.pos.push(v.x, v.y, v.z);
        this.col.push(tint.r * k, tint.g * k, tint.b * k);
      }
    }
  }

  get segments(): number {
    return this.pos.length / 6;
  }

  build(): THREE.LineSegments {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('aCol', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    const mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uSunColor: SHARED.uSunColor,
        uFogColor: SHARED.uFogColor,
        uFogDensity: SHARED.uFogDensity,
        uFogStart: SHARED.uFogStart,
      },
    });
    const ls = new THREE.LineSegments(g, mat);
    ls.name = 'twig-lines';
    ls.frustumCulled = false;
    return ls;
  }
}
