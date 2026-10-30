import * as THREE from 'three';
import { NOISE_GLSL, WORLD_UNIFORMS_GLSL } from '../scene/shaderChunks';
import type { WorldUniforms } from '../scene/world';
import { MAX_MODES } from './wobble';

/**
 * The soap film. One vertex shader shapes the sphere (wobble modes, a stretch
 * along the motion, the inflate); three passes paint it:
 *
 *   back    — the far side of the film seen from inside: a faint wash and a weak reflection
 *   tint    — a gentle multiply by the light the film lets through (the
 *             complement of what it reflects), so whatever is inside is tinted
 *   front   — the near side: the interference wash at the rim, the curved
 *             reflection of the garden, the window highlight and its echo
 *
 * The film's thickness drains (thick at the bottom, thinning to almost nothing
 * at the top) and swirls with differential rotation; thickness becomes colour
 * through the interference of three wavelengths, softly quantised and lifted
 * toward white so the bands read as gouache washes rather than a photograph.
 */

export interface BubbleUniforms {
  [name: string]: THREE.IUniform;
  /** Wobble modes: (axis.xyz, current coefficient). */
  uModes: THREE.IUniform<THREE.Vector4[]>;
  /** Legendre degree of each mode. */
  uModeL: THREE.IUniform<THREE.Vector4>;
  /** Stretch along the motion: (unit dir, amount). */
  uStretch: THREE.IUniform<THREE.Vector4>;
  /** Per-bubble seed for the swirl, 0..1. */
  uSeed: THREE.IUniform<number>;
  /** Pop: (local direction of the tap, progress 0..1+; < 0 = intact). */
  uBurst: THREE.IUniform<THREE.Vector4>;
  /** 0..1 — overall opacity (fades with reduced-motion pops). */
  uFade: THREE.IUniform<number>;
  /** The garden's reflection, shared by every bubble. */
  uEnv: THREE.IUniform<THREE.CubeTexture | null>;
  /** Idle shimmer of the shape. */
  uIdle: THREE.IUniform<number>;
}

export function createBubbleUniforms(seed: number, env: THREE.CubeTexture | null): BubbleUniforms {
  return {
    uModes: { value: Array.from({ length: MAX_MODES }, () => new THREE.Vector4(0, 1, 0, 0)) },
    uModeL: { value: new THREE.Vector4(2, 2, 2, 2) },
    uStretch: { value: new THREE.Vector4(1, 0, 0, 0) },
    uSeed: { value: seed },
    uBurst: { value: new THREE.Vector4(0, 1, 0, -1) },
    uFade: { value: 1 },
    uEnv: { value: env },
    uIdle: { value: 0.012 },
  };
}

const BUBBLE_UNIFORMS_GLSL = /* glsl */ `
uniform vec4 uModes[${MAX_MODES}];
uniform vec4 uModeL;
uniform vec4 uStretch;
uniform float uSeed;
uniform vec4 uBurst;
uniform float uFade;
uniform float uIdle;
`;

const vertex = /* glsl */ `
${WORLD_UNIFORMS_GLSL}
${BUBBLE_UNIFORMS_GLSL}
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec3 vDir;
varying vec3 vCenter;

float P2(float c) { return 0.5 * (3.0 * c * c - 1.0); }
float P3(float c) { return 0.5 * (5.0 * c * c * c - 3.0 * c); }

vec3 shape(vec3 n) {
  float r = 1.0;
  for (int i = 0; i < ${MAX_MODES}; i++) {
    float c = dot(n, uModes[i].xyz);
    r += uModes[i].w * (uModeL[i] < 2.5 ? P2(c) : P3(c));
  }
  // a faint idle shimmer: two slow modes on turning axes, so a resting bubble still breathes
  float t = uTime + uSeed * 40.0;
  vec3 a1 = normalize(vec3(sin(t * 0.31), 0.8, cos(t * 0.27)));
  vec3 a2 = normalize(vec3(cos(t * 0.23 + 1.0), sin(t * 0.19), 0.7));
  r += uIdle * (P2(dot(n, a1)) * sin(t * 2.1) + 0.7 * P3(dot(n, a2)) * sin(t * 2.9 + 1.0));
  vec3 p = n * r;
  // a slight stretch along the direction of motion, volume-preserving
  float along = dot(p, uStretch.xyz);
  p += uStretch.xyz * along * uStretch.w - (p - uStretch.xyz * along) * uStretch.w * 0.5;
  return p;
}

void main() {
  vec3 n = normalize(position);
  vec3 p = shape(n);
  // normal from two nearby points on the shaped surface
  vec3 t1 = normalize(cross(n, abs(n.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 t2 = cross(n, t1);
  vec3 pa = shape(normalize(n + t1 * 0.02));
  vec3 pb = shape(normalize(n + t2 * 0.02));
  vec3 nl = normalize(cross(pa - p, pb - p));
  if (dot(nl, n) < 0.0) nl = -nl;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * nl);
  vDir = n;
  vCenter = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FILM_GLSL = /* glsl */ `
// film thickness in nanometres over the unit sphere direction n
float filmThickness(vec3 n) {
  float t = uTime;
  // drainage: thick and slow at the bottom, thinning toward a nearly black cap at the top
  float y = n.y;
  float drain = mix(780.0, 170.0, pow(clamp(y * 0.5 + 0.5, 0.0, 1.0), 1.25));
  // differential rotation winds the bands around the bubble; a warp makes swirling cells
  float spin = t * (0.11 + 0.09 * y) + uSeed * 6.283;
  float c = cos(spin), s = sin(spin);
  vec3 q = vec3(c * n.x - s * n.z, n.y, s * n.x + c * n.z);
  q += 0.42 * vec3(vnoise3(q * 1.6 + vec3(t * 0.05, 0.0, 0.0)) - 0.5, vnoise3(q * 1.6 + vec3(5.2, t * 0.04, 1.3)) - 0.5, vnoise3(q * 1.6 + vec3(2.1, 7.7, t * 0.05)) - 0.5);
  float swirl = fbm3(q * 2.1 + vec3(0.0, -t * 0.035, uSeed * 13.0));
  // fresh film rises in plumes from the thick bottom
  float plume = vnoise3(vec3(q.x * 3.0, q.y * 1.2 - t * 0.08, q.z * 3.0));
  return max(30.0, drain + (swirl - 0.47) * 520.0 + (plume - 0.5) * 140.0 * smoothstep(0.3, -0.6, y));
}

// interference of a soap film (index 1.33) for red, green and blue light
vec3 interference(float h, float cosI) {
  float sinT2 = (1.0 - cosI * cosI) / (1.33 * 1.33);
  float cosT = sqrt(max(0.0, 1.0 - sinT2));
  vec3 lambda = vec3(640.0, 535.0, 455.0);
  vec3 ph = 6.2831853 * 1.33 * h * cosT / lambda;
  vec3 s = sin(ph);
  return s * s;
}

// painted, not photographic: soft-quantised bands lifted toward a chalky white
vec3 filmPaint(vec3 n, float cosI, out float thin) {
  float h = filmThickness(n);
  float stepNm = 46.0;
  float k = h / stepNm;
  float hq = (floor(k) + smoothstep(0.3, 0.7, fract(k))) * stepNm;
  vec3 c = interference(hq, cosI);
  // push the bands toward the magenta / gold / cyan / green gouache family, then chalk them
  float l = dot(c, vec3(0.333));
  c = mix(vec3(l), c, 1.5);
  c = clamp(c, 0.0, 1.0);
  c = mix(c, vec3(1.0, 0.98, 0.99), 0.28);
  thin = smoothstep(150.0, 70.0, h);
  return c;
}

// the opening hole when the bubble pops: 0 where the film is gone, a bright ring at the retreating edge
float burstMask(vec3 n, out float ring) {
  ring = 0.0;
  if (uBurst.w < 0.0) return 1.0;
  float theta = acos(clamp(dot(n, uBurst.xyz), -1.0, 1.0)) / 3.14159;
  float front = uBurst.w * 1.12 - 0.04;
  float edge = theta - front + (vnoise3(n * 9.0) - 0.5) * 0.05;
  ring = smoothstep(0.12, 0.0, edge) * step(0.0, edge);
  return step(0.0, edge);
}
`;

const fragmentHeader = /* glsl */ `
${WORLD_UNIFORMS_GLSL}
${BUBBLE_UNIFORMS_GLSL}
${NOISE_GLSL}
uniform samplerCube uEnv;
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec3 vDir;
varying vec3 vCenter;
${FILM_GLSL}
`;

/** The far side of the film, from inside. */
const backFragment = /* glsl */ `
${fragmentHeader}
void main() {
  float ring;
  if (burstMask(vDir, ring) < 0.5) discard;
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 N = -normalize(vNormalW);
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float thin;
  vec3 film = filmPaint(vDir, ndv, thin);
  float rim = pow(1.0 - ndv, 2.0);
  vec3 env = textureCube(uEnv, reflect(-V, N)).rgb;
  float a = (0.012 + 0.2 * rim) * (1.0 - thin * 0.7);
  vec3 rgb = film * a * 0.8 + env * film * (0.05 + 0.3 * rim) * 0.5;
  a += ring * 0.4;
  rgb += film * ring * 0.5;
  gl_FragColor = vec4(rgb * uFade, a * uFade);
}
`;

/** Multiply pass: what the film lets through. */
const tintFragment = /* glsl */ `
${fragmentHeader}
void main() {
  float ring;
  if (burstMask(vDir, ring) < 0.5) discard;
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 N = normalize(vNormalW);
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float thin;
  vec3 film = filmPaint(vDir, ndv, thin);
  // the complement of the reflected colour, very gentle, plus a breath of cool periwinkle
  vec3 through = mix(vec3(1.0), (vec3(1.0) - film * 0.55) * vec3(0.97, 0.98, 1.02), 0.16 + 0.22 * pow(1.0 - ndv, 2.0));
  through = mix(vec3(1.0), through, (1.0 - thin * 0.8) * uFade);
  gl_FragColor = vec4(through, 1.0);
}
`;

/** The near side of the film. */
const frontFragment = /* glsl */ `
${fragmentHeader}
void main() {
  float ring;
  if (burstMask(vDir, ring) < 0.5) discard;
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 N = normalize(vNormalW);
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float thin;
  vec3 film = filmPaint(vDir, ndv, thin);
  float rim = pow(1.0 - ndv, 2.2);

  // the garden, curved and squashed across the film
  vec3 R = reflect(-V, N);
  vec3 env = textureCube(uEnv, R).rgb;
  float fres = 0.05 + 0.95 * pow(1.0 - ndv, 3.0);
  vec3 refl = env * film * fres * 1.15;

  // the interference wash: strongest toward the rim, broken a little like a brush laid wet
  float wash = (0.055 + 0.52 * pow(rim, 0.9)) * (0.85 + 0.3 * vnoise3(vDir * 7.0 + uSeed * 9.0));
  wash *= 1.0 - thin * 0.75;
  // a thin painted outline where the film turns edge-on
  float line = smoothstep(0.2, 0.04, ndv) * (1.0 - thin * 0.5);
  vec3 lineCol = mix(film, pow(vec3(0.70, 0.72, 0.92), vec3(2.2)), 0.45);

  // the window highlight: four soft panes, up and to the left like the sun
  vec3 W = normalize(uSunDir + vec3(-0.35, 0.35, -0.55));
  vec3 U = normalize(cross(W, vec3(0.0, 1.0, 0.0)));
  vec3 Vv = cross(U, W);
  float rw = dot(R, W);
  float win = 0.0;
  if (rw > 0.0) {
    vec2 q = vec2(dot(R, U), dot(R, Vv)) / rw;
    vec2 box = abs(q) - vec2(0.2, 0.26);
    float d = length(max(box, 0.0)) + min(max(box.x, box.y), 0.0) - 0.03;
    float panes = 1.0 - smoothstep(-0.03, 0.015, d);
    float bars = smoothstep(0.012, 0.022, abs(q.x)) * smoothstep(0.012, 0.022, abs(q.y + 0.02));
    win = panes * bars;
  }
  // its echo, lower right: the light caught again on the inside of the far wall
  vec3 Hh = normalize(W + V);
  vec3 side = Hh - V * dot(Hh, V);
  vec3 H2 = normalize(V * 0.62 - normalize(side) * 0.78);
  float e2 = dot(N, H2);
  float echo = smoothstep(0.9935, 0.9985, e2) + smoothstep(0.975, 0.995, e2) * 0.25;
  // and a soft glow round the main window
  float glow = smoothstep(0.75, 0.98, dot(R, W)) * 0.25;

  float a = clamp(wash + line * 0.55 + ring * 0.6, 0.0, 0.95);
  vec3 rgb = film * wash + lineCol * line * 0.55 + refl;
  rgb += vec3(1.0, 0.99, 0.97) * (win * 1.25 + echo * 0.6 + glow);
  a = max(a, win * 0.85 + echo * 0.5);
  rgb += film * ring * 1.2;
  gl_FragColor = vec4(rgb * uFade, a * uFade);
}
`;

export type FilmPass = 'back' | 'tint' | 'front';

export function createFilmMaterial(world: WorldUniforms, bubble: BubbleUniforms, pass: FilmPass): THREE.ShaderMaterial {
  const fragmentShader = pass === 'back' ? backFragment : pass === 'tint' ? tintFragment : frontFragment;
  const m = new THREE.ShaderMaterial({
    uniforms: { ...world, ...bubble },
    vertexShader: vertex,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    side: pass === 'back' ? THREE.BackSide : THREE.FrontSide,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
  });
  if (pass === 'tint') {
    // dst * src: a multiply
    m.blendSrc = THREE.DstColorFactor;
    m.blendDst = THREE.ZeroFactor;
    m.blendSrcAlpha = THREE.ZeroFactor;
    m.blendDstAlpha = THREE.OneFactor;
  } else {
    // premultiplied: a wash of paint over what's behind, plus light
    m.blendSrc = THREE.OneFactor;
    m.blendDst = THREE.OneMinusSrcAlphaFactor;
    m.blendSrcAlpha = THREE.ZeroFactor;
    m.blendDstAlpha = THREE.OneFactor;
  }
  return m;
}

/** A finely divided unit sphere shared by every bubble (the wobble needs vertices to move). */
export const BUBBLE_GEOMETRY = new THREE.SphereGeometry(1, 96, 64);
