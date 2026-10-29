import * as THREE from 'three';
import { LIGHTING_GLSL, NOISE_GLSL, WORLD_UNIFORMS_GLSL } from '../scene/shaderChunks';
import type { WorldUniforms } from '../scene/world';

/**
 * One painted material for every passenger part. Each part chooses its paint
 * with `uPart`; the rest is shared: the gouache light ramp with a gentle shade
 * for pale fluff, a warm rim on fluff edges, a soft star glow, the leaving fade
 * (paint lifting off the page) and the soft blue selection rim. Fluff parts
 * also draw two fur shells — the same mesh pushed out along its normals,
 * broken into fibres by noise — like MEADOW's sheep.
 */

export const PART = {
  bunnyBody: 10, bunnyHead: 11, bunnyEar: 12, bunnyTail: 13, bunnyFoot: 14, bunnyNose: 15,
  chickBody: 20, chickBeak: 21, chickWing: 22, chickFoot: 23, chickTuft: 24,
  kittenBody: 30, kittenHead: 31, kittenEar: 32, kittenTail: 33, kittenPaw: 34, kittenNose: 35,
  flowerStem: 40, flowerLeaf: 41, flowerBloom: 42, flowerCentre: 43,
  berry: 50, calyx: 51,
  star: 60,
  eye: 90, cheek: 91, petal: 92, leaf: 93,
} as const;

export const SHELL_LAYERS = 2;

export interface CharUniforms {
  [name: string]: THREE.IUniform;
  uSeed: THREE.IUniform<number>;
  uHighlight: THREE.IUniform<number>;
  /** x colour variant 0..1, y glow (the star's twinkle), z inside-a-bubble tint, w fade (leaving). */
  uLook: THREE.IUniform<THREE.Vector4>;
  uFur: THREE.IUniform<number>;
}

export function createCharUniforms(seed: number, variant: number): CharUniforms {
  return {
    uSeed: { value: (seed % 97) + 0.37 },
    uHighlight: { value: 0 },
    uLook: { value: new THREE.Vector4(variant, 0, 0, 1) },
    uFur: { value: 0.006 },
  };
}

const CHAR_UNIFORMS_GLSL = /* glsl */ `
uniform float uSeed;
uniform float uHighlight;
uniform vec4 uLook;
uniform float uFur;
uniform float uPart;
`;

const vertex = /* glsl */ `
${CHAR_UNIFORMS_GLSL}
attribute float aAO;
#ifdef SHELL
attribute float aShell;
#endif
varying vec3 vLocal;
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec3 vNormalL;
varying float vAO;
varying float vShell;

void main() {
  vec3 p = position;
  float h = 0.0;
#ifdef SHELL
  h = aShell;
  p += normal * h * uFur;
#endif
  vLocal = position;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vNormalL = normal;
  vAO = aAO;
  vShell = h;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const ALBEDO_GLSL = /* glsl */ `
vec3 srgb(vec3 c) { return pow(c, vec3(2.2)); }
vec3 pick3(vec3 a, vec3 b, vec3 c) { return uLook.x < 0.34 ? a : uLook.x < 0.67 ? b : c; }

// returns the paint before light; softness widens the light ramp, keep holds colour against shade
vec3 albedo(inout float softness, inout float keep, inout float glow) {
  vec3 p = vLocal;
  float g = 0.95 + 0.08 * vnoise3(p * 60.0 + uSeed);
  // --- bunny
  if (uPart < 16.0) {
    vec3 coat = pick3(srgb(vec3(0.985, 0.96, 0.925)), srgb(vec3(0.91, 0.885, 0.94)), srgb(vec3(0.97, 0.92, 0.84)));
    softness = 0.5; keep = 0.35;
    if (uPart < 10.5) return mix(coat, srgb(vec3(1.0, 0.98, 0.96)), smoothstep(0.08, 0.0, p.y) * 0.5) * g;
    if (uPart < 11.5) {
      vec3 c = coat;
      c = mix(c, srgb(vec3(1.0, 0.985, 0.97)), smoothstep(0.02, 0.07, p.x) * smoothstep(0.0, -0.05, p.y) * 0.7);
      return c * g;
    }
    if (uPart < 12.5) {
      // blush inside the ear, the coat round its edge
      float inner = smoothstep(0.003, 0.012, p.x) * smoothstep(0.016, 0.009, abs(p.z)) * smoothstep(0.012, 0.035, p.y) * smoothstep(0.16, 0.12, p.y);
      return mix(coat, srgb(vec3(0.97, 0.76, 0.80)), inner);
    }
    if (uPart < 13.5) return srgb(vec3(1.0, 0.99, 0.98)) * g;
    if (uPart < 14.5) return mix(coat, srgb(vec3(0.98, 0.86, 0.86)), smoothstep(0.0, -0.02, p.y) * 0.6);
    keep = 0.5; return srgb(vec3(0.95, 0.66, 0.72));
  }
  // --- chick
  if (uPart < 25.0) {
    vec3 down = pick3(srgb(vec3(0.99, 0.91, 0.62)), srgb(vec3(1.0, 0.94, 0.72)), srgb(vec3(0.99, 0.88, 0.66)));
    softness = 0.5; keep = 0.35;
    if (uPart < 20.5) return mix(down, srgb(vec3(1.0, 0.97, 0.84)), smoothstep(0.1, 0.03, p.y) * 0.6) * g;
    if (uPart < 21.5) { keep = 0.4; return srgb(vec3(0.97, 0.72, 0.52)); }
    if (uPart < 22.5) return down * 0.94 * g;
    if (uPart < 23.5) { keep = 0.4; return srgb(vec3(0.97, 0.74, 0.55)); }
    return down * 0.96;
  }
  // --- kitten
  if (uPart < 36.0) {
    vec3 coat = pick3(srgb(vec3(0.97, 0.80, 0.67)), srgb(vec3(0.86, 0.82, 0.91)), srgb(vec3(0.97, 0.88, 0.72)));
    vec3 stripe = coat * pick3(vec3(0.88, 0.8, 0.76), vec3(0.86, 0.85, 0.9), vec3(0.9, 0.84, 0.76));
    vec3 cream = srgb(vec3(1.0, 0.96, 0.91));
    softness = 0.45; keep = 0.3;
    if (uPart < 30.5) {
      float st = smoothstep(0.55, 0.75, sin(p.x * 70.0 + sin(p.z * 30.0) * 0.8)) * smoothstep(0.12, 0.18, p.y);
      vec3 c = mix(coat, stripe, st * 0.8);
      c = mix(c, cream, smoothstep(0.08, 0.15, p.x) * smoothstep(0.16, 0.06, p.y) * 0.8);
      return c * g;
    }
    if (uPart < 31.5) {
      float st = smoothstep(0.6, 0.8, sin(p.z * 90.0)) * smoothstep(0.03, 0.06, p.y) * smoothstep(0.04, -0.03, p.x);
      vec3 c = mix(coat, stripe, st * 0.8);
      c = mix(c, cream, smoothstep(0.025, 0.06, p.x) * smoothstep(0.01, -0.04, p.y));
      return c * g;
    }
    if (uPart < 32.5) {
      float inner = smoothstep(0.0, 0.01, p.x) * smoothstep(0.024, 0.008, abs(p.z)) * smoothstep(0.05, 0.0, p.y);
      return mix(coat, srgb(vec3(0.97, 0.78, 0.80)), inner * 0.9);
    }
    if (uPart < 33.5) return mix(coat, stripe, smoothstep(0.5, 0.8, sin((p.x - p.z) * 60.0)) * 0.8) * g;
    if (uPart < 34.5) return cream;
    keep = 0.5; return srgb(vec3(0.95, 0.66, 0.70));
  }
  // --- flower
  if (uPart < 44.0) {
    softness = 0.4; keep = 0.3;
    if (uPart < 41.5) return srgb(vec3(0.66, 0.83, 0.63)) * mix(0.92, 1.05, smoothstep(0.0, 0.2, p.y));
    if (uPart < 42.5) {
      vec3 petal = pick3(srgb(vec3(0.97, 0.74, 0.80)), srgb(vec3(0.74, 0.78, 0.95)), srgb(vec3(0.98, 0.90, 0.64)));
      float r = length(p.yz);
      vec3 c = mix(petal * 0.92, mix(petal, vec3(1.0), 0.25), smoothstep(0.04, 0.12, r));
      return c * g;
    }
    keep = 0.4;
    return srgb(vec3(0.99, 0.88, 0.55)) * (0.96 + 0.06 * vnoise3(p * 120.0));
  }
  // --- strawberry
  if (uPart < 52.0) {
    softness = 0.4; keep = 0.35;
    if (uPart < 50.5) {
      vec3 c = pick3(srgb(vec3(0.95, 0.58, 0.63)), srgb(vec3(0.97, 0.66, 0.66)), srgb(vec3(0.94, 0.62, 0.70)));
      c = mix(c, c * vec3(1.03, 1.1, 1.05), smoothstep(0.12, 0.22, p.y) * 0.5);
      // seeds: little pale teardrops in staggered rows
      vec2 q = vec2(atan(p.z, p.x) * 3.2, p.y * 34.0);
      q.x += floor(q.y) * 0.5;
      vec2 f = fract(q) - 0.5;
      float seed = smoothstep(0.17, 0.09, length(f * vec2(1.0, 1.4))) * step(0.03, p.y) * step(p.y, 0.205);
      // keep the face clear
      seed *= 1.0 - smoothstep(0.07, 0.04, length(vec2(p.z, p.y - 0.12))) * step(0.0, p.x);
      return mix(c, srgb(vec3(0.99, 0.93, 0.74)), seed * 0.9) * g;
    }
    return srgb(vec3(0.62, 0.84, 0.64)) * g;
  }
  // --- star
  if (uPart < 61.0) {
    softness = 0.5; keep = 0.45; glow = 1.0;
    vec3 c = pick3(srgb(vec3(0.99, 0.90, 0.58)), srgb(vec3(0.99, 0.86, 0.70)), srgb(vec3(0.97, 0.92, 0.70)));
    return mix(c, c * vec3(1.02, 1.0, 0.92), smoothstep(0.02, 0.06, abs(p.x))) * g;
  }
  // --- shared
  if (uPart < 90.5) {
    float cl = smoothstep(0.82, 0.93, dot(vNormalL, normalize(vec3(0.6, 0.6, 0.3))));
    keep = 0.75;
    return mix(srgb(vec3(0.26, 0.2, 0.25)), vec3(1.0), cl);
  }
  if (uPart < 91.5) { keep = 0.6; return srgb(vec3(0.97, 0.70, 0.76)); }
  if (uPart < 92.5) {
    softness = 0.5; keep = 0.3;
    float r = length(p.xz);
    vec3 c = mix(srgb(vec3(0.98, 0.80, 0.85)), srgb(vec3(1.0, 0.93, 0.94)), smoothstep(0.03, 0.15, r));
    // a few fine veins fanning from the stalk
    float vein = smoothstep(0.9, 1.0, cos(atan(p.z, p.x + 0.17) * 14.0)) * 0.08;
    return c * (1.0 - vein);
  }
  softness = 0.45; keep = 0.3;
  return mix(srgb(vec3(0.62, 0.84, 0.64)), srgb(vec3(0.78, 0.92, 0.74)), smoothstep(0.02, 0.1, length(p.xz)));
}
`;

const fragment = /* glsl */ `
${WORLD_UNIFORMS_GLSL}
${CHAR_UNIFORMS_GLSL}
${NOISE_GLSL}
${LIGHTING_GLSL}
varying vec3 vLocal;
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec3 vNormalL;
varying float vAO;
varying float vShell;
${ALBEDO_GLSL}

void main() {
  // leaving: the passenger thins out like paint lifted off the page
  if (uLook.w < 0.999 && hash13(floor(vWorld * 90.0)) > uLook.w) discard;
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 N = normalize(vNormalW);
  if (!gl_FrontFacing) N = -N;
  float softness = 0.3;
  float keep = 0.0;
  float glow = 0.0;
  vec3 base = albedo(softness, keep, glow);
#ifdef SHELL
  float fibre = vnoise3(vLocal * 260.0 + uSeed) * 0.7 + vnoise3(vLocal * 90.0) * 0.3;
  float facing = abs(dot(N, V));
  if (fibre < 0.42 + vShell * 0.4 || facing > 0.35 + 0.3 * fibre) discard;
  float sunVis = castLightFast(vWorld, 0.02);
#else
  float sunVis = castLight(vWorld, 0.02);
#endif
  float ao = mix(0.62, 1.0, smoothstep(0.1, 0.9, vAO));
  vec3 lit = paintLight(base, N, sunVis, ao, softness);
  lit = mix(lit, base * mix(vec3(1.0), uShadeColor, 0.12), keep * (1.0 - sunVis * 0.5));
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  lit += base * rim * 0.12 * sunVis;
  // the star glows softly from within, and twinkles
  lit = mix(lit, base * (1.05 + 0.25 * uLook.y), glow * (0.45 + 0.3 * uLook.y));
  // inside a bubble: a breath of the film's cool tint
  lit = mix(lit, lit * vec3(0.95, 0.97, 1.04), uLook.z);
  lit += vec3(0.12, 0.3, 0.75) * uHighlight * pow(1.0 - max(dot(N, V), 0.0), 2.5) * 0.6;
  gl_FragColor = vec4(lit, 1.0);
}
`;

export function createPartMaterial(world: WorldUniforms, char: CharUniforms, part: number, options: { doubleSided?: boolean; shell?: boolean } = {}): THREE.ShaderMaterial {
  const material = new THREE.ShaderMaterial({
    uniforms: { ...world, ...char, uPart: { value: part } },
    vertexShader: vertex,
    fragmentShader: fragment,
    side: options.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
  });
  if (options.shell) material.defines = { SHELL: 1 };
  return material;
}

const shellLayerData = (() => {
  const a = new Float32Array(SHELL_LAYERS);
  for (let i = 0; i < SHELL_LAYERS; i++) a[i] = (i + 1) / SHELL_LAYERS;
  return new THREE.InstancedBufferAttribute(a, 1);
})();

/** An instanced view of a fluff geometry: the same buffers, drawn once per fur shell. */
export function shellGeometry(base: THREE.BufferGeometry): THREE.InstancedBufferGeometry {
  const geo = new THREE.InstancedBufferGeometry();
  for (const [name, attr] of Object.entries(base.attributes)) geo.setAttribute(name, attr);
  geo.setIndex(base.getIndex());
  geo.setAttribute('aShell', shellLayerData);
  geo.instanceCount = SHELL_LAYERS;
  geo.boundingSphere = base.boundingSphere;
  return geo;
}
