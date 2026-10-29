import * as THREE from 'three';
import { BEDS, BORDER, GATE, WALL, bedSDF, borderSDF, edgeDistance, groundHeight, obstacleSDF, pathDistance, pavedSDF } from './garden';
import { fbm2, seededRandom } from './noise';
import { LIGHTING_GLSL, NOISE_GLSL, WORLD_UNIFORMS_GLSL } from './shaderChunks';
import { GROUND_GLSL } from './terrain';
import type { WorldUniforms } from './world';

/**
 * Little hand-painted marks on the lawn: tufts of grass (three short strokes
 * fanning out) and pastel flowers — scattered drifts of white daisies and
 * butter-yellow buttercups on the lawn, and the beds and border packed with
 * blush, lilac, butter and white. The flowers nod on the breeze.
 */

function scatter(count: number, seed: number, accept: (x: number, z: number, r: number) => boolean) {
  const rand = seededRandom(seed);
  const out: [number, number][] = [];
  let attempts = 0;
  while (out.length < count && attempts < count * 30) {
    attempts++;
    const x = (rand() * 2 - 1) * 6.8;
    const z = (rand() * 2 - 1) * 5.1;
    if (edgeDistance(x, z) < 0.6 || z < WALL.z + 0.2) continue;
    if (pathDistance(x, z) < 0.5 || pavedSDF(x, z) < 0.12 || bedSDF(x, z) < 0.15 || borderSDF(x, z) < 0.12 || obstacleSDF(x, z) < 0.05) continue;
    if (!accept(x, z, rand())) continue;
    out.push([x, z]);
  }
  return out;
}

// --- tufts ------------------------------------------------------------------

function tuftGeometry(): THREE.InstancedBufferGeometry {
  const geo = new THREE.InstancedBufferGeometry();
  const pos: number[] = [];
  const blade: number[] = [];
  // three tapered blades fanned around the base
  for (let b = 0; b < 3; b++) {
    const a = (b / 3) * Math.PI + 0.3;
    const lean = (b - 1) * 0.35;
    const cx = Math.cos(a), cz = Math.sin(a);
    pos.push(-0.012 * cx, 0, -0.012 * cz, 0.012 * cx, 0, 0.012 * cz, lean * 0.08, 1, 0);
    blade.push(0, 0, 1);
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aTip', new THREE.Float32BufferAttribute(blade, 1));
  return geo;
}

const tuftVertex = /* glsl */ `
${WORLD_UNIFORMS_GLSL}
${NOISE_GLSL}
attribute vec4 aOffset; // xyz base, w yaw
attribute vec2 aSize;   // height, rand
attribute float aTip;
varying vec3 vWorld;
varying float vTip;
varying float vRand;
void main() {
  float c = cos(aOffset.w), s = sin(aOffset.w);
  vec3 p = position;
  p = vec3(c * p.x - s * p.z, p.y * aSize.x, s * p.x + c * p.z);
  float sway = (vnoise(aOffset.xz * 0.3 + uTime * 0.4) - 0.5) * 0.06 * uWind;
  p.x += sway * aTip;
  vec4 wp = vec4(aOffset.xyz + p, 1.0);
  vWorld = wp.xyz;
  vTip = aTip;
  vRand = aSize.y;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const tuftFragment = /* glsl */ `
${WORLD_UNIFORMS_GLSL}
${NOISE_GLSL}
${LIGHTING_GLSL}
${GROUND_GLSL}
varying vec3 vWorld;
varying float vTip;
varying float vRand;
void main() {
  float grassy;
  vec3 ground = lawnPaint(vWorld.xz, grassy);
  // a deeper sea-glass stroke at the root, catching pistachio light at the tip
  vec3 base = ground * srgb(vec3(0.74, 0.84, 0.78));
  vec3 tip = mix(ground * 1.08, srgb(vec3(0.88, 0.93, 0.68)), 0.3 + 0.2 * vRand);
  vec3 albedo = mix(base, tip, vTip);
  float sunVis = castLight(vWorld, 0.06);
  gl_FragColor = vec4(paintLight(albedo, vec3(0.0, 1.0, 0.0), sunVis, 1.0, 0.2) * bubbleShade(vWorld), 1.0);
}
`;

// --- flowers ----------------------------------------------------------------

function flowerGeometry(): THREE.InstancedBufferGeometry {
  // a five-petal rosette, flat, facing up, centre vertex first
  const geo = new THREE.InstancedBufferGeometry();
  const pos: number[] = [0, 0.012, 0];
  const petal: number[] = [0];
  const steps = 20;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const r = 0.028 + 0.009 * Math.cos(a * 5);
    pos.push(Math.cos(a) * r, 0, Math.sin(a) * r);
    petal.push(1);
  }
  const index: number[] = [];
  for (let i = 1; i <= steps; i++) index.push(0, i + 1, i);
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aPetal', new THREE.Float32BufferAttribute(petal, 1));
  geo.setIndex(index);
  return geo;
}

const flowerVertex = /* glsl */ `
uniform float uTime;
uniform float uWind;
attribute vec4 aOffset; // xyz, scale
attribute vec2 aKind;   // kind, rand
attribute float aPetal;
varying vec3 vWorld;
varying float vPetal;
varying float vKind;
void main() {
  // each head nods on its stem: a slow tilt that differs flower to flower
  float ph = aKind.y * 6.283 + aOffset.x * 0.7 + aOffset.z * 0.5;
  float nx = sin(uTime * (0.9 + aKind.y * 0.6) + ph) * 0.22 * uWind;
  float nz = cos(uTime * (0.7 + aKind.y * 0.5) + ph * 1.3) * 0.16 * uWind;
  vec3 p = position;
  p.y += p.x * nx + p.z * nz;
  vec3 stem = vec3(nx, 0.0, nz) * 0.05 * aOffset.w;
  vec4 wp = vec4(aOffset.xyz + p * aOffset.w + vec3(0.0, 0.05, 0.0) + stem, 1.0);
  vWorld = wp.xyz;
  vPetal = aPetal;
  vKind = aKind.x;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const flowerFragment = /* glsl */ `
${WORLD_UNIFORMS_GLSL}
${NOISE_GLSL}
${LIGHTING_GLSL}
vec3 srgb(vec3 c) { return pow(c, vec3(2.2)); }
varying vec3 vWorld;
varying float vPetal;
varying float vKind;
void main() {
  // 0 butter, 1 white, 2 blush, 3 lilac, 4 pale pink, 5 periwinkle
  vec3 petal = vKind > 4.5 ? srgb(vec3(0.76, 0.80, 0.95)) : vKind > 3.5 ? srgb(vec3(0.98, 0.86, 0.88))
             : vKind > 2.5 ? srgb(vec3(0.80, 0.72, 0.92)) : vKind > 1.5 ? srgb(vec3(0.96, 0.76, 0.81))
             : vKind > 0.5 ? srgb(vec3(0.99, 0.97, 0.94)) : srgb(vec3(0.97, 0.90, 0.63));
  vec3 eye = vKind > 0.5 && vKind < 1.5 ? srgb(vec3(0.97, 0.85, 0.45)) : vKind < 0.5 ? srgb(vec3(0.95, 0.78, 0.45)) : srgb(vec3(0.99, 0.93, 0.72));
  vec3 albedo = mix(eye, petal, smoothstep(0.25, 0.6, vPetal));
  float sunVis = castLight(vWorld, 0.06);
  gl_FragColor = vec4(paintLight(albedo, vec3(0.0, 1.0, 0.0), sunVis, 1.0, 0.2), 1.0);
}
`;

export function createDetails(world: WorldUniforms, density = 1): THREE.Group {
  const group = new THREE.Group();
  group.name = 'details';

  // tufts: thicker along hedges and field edges, sparse in open grass
  const tufts = scatter(Math.round(1000 * density), 31, (x, z, r) => r < 0.35 + 0.65 * Math.max(0, fbm2(x / 3.5, z / 3.5, 2) + 0.15));
  const rand = seededRandom(5);
  const tOffset = new Float32Array(tufts.length * 4);
  const tSize = new Float32Array(tufts.length * 2);
  tufts.forEach(([x, z], i) => {
    tOffset.set([x, groundHeight(x, z), z, rand() * Math.PI * 2], i * 4);
    tSize.set([0.1 + rand() * 0.1, rand()], i * 2);
  });
  const tg = tuftGeometry();
  tg.setAttribute('aOffset', new THREE.InstancedBufferAttribute(tOffset, 4));
  tg.setAttribute('aSize', new THREE.InstancedBufferAttribute(tSize, 2));
  tg.instanceCount = tufts.length;
  const tuftMesh = new THREE.Mesh(
    tg,
    new THREE.ShaderMaterial({ uniforms: world, vertexShader: tuftVertex, fragmentShader: tuftFragment, side: THREE.DoubleSide }),
  );
  tuftMesh.frustumCulled = false;
  group.add(tuftMesh);

  // flowers: drifts of daisies and buttercups on the lawn
  const lawn = scatter(Math.round(320 * density), 77, (x, z, r) => r < Math.max(0, fbm2(x / 3 + 9, z / 3 - 3, 2) - 0.12) * 4);
  // the beds and the border: packed with pastels
  const bed: [number, number, number][] = [];
  const brand = seededRandom(13);
  const perBed = Math.round(300 * density);
  for (const b of BEDS) {
    let n = 0;
    while (n < perBed) {
      const a = brand() * Math.PI * 2;
      const r = Math.sqrt(brand()) * 0.95;
      const x = b.x + Math.cos(a) * r * b.rx;
      const z = b.z + Math.sin(a) * r * b.rz;
      if (bedSDF(x, z) > -0.07) continue;
      const k = brand();
      bed.push([x, z, b.palette === 'blush' ? (k < 0.45 ? 2 : k < 0.75 ? 4 : k < 0.9 ? 1 : 0) : (k < 0.45 ? 3 : k < 0.7 ? 5 : k < 0.88 ? 0 : 1)]);
      n++;
    }
  }
  for (let n = 0; n < Math.round(420 * density); n++) {
    const x = (brand() * 2 - 1) * (WALL.x1 - 0.3);
    const z = BORDER.z + (brand() * 2 - 1) * (BORDER.half - 0.06);
    if (Math.abs(x - GATE.x) < GATE.width / 2 + 0.3 || borderSDF(x, z) > -0.05) continue;
    bed.push([x, z, Math.floor(brand() * 6)]);
  }
  const flowers = [...lawn.map(([x, z]) => [x, z, -1] as [number, number, number]), ...bed];
  const fOffset = new Float32Array(flowers.length * 4);
  const fKind = new Float32Array(flowers.length * 2);
  flowers.forEach(([x, z, k0], i) => {
    const inBed = k0 >= 0;
    const k = rand();
    const kind = inBed ? k0 : k < 0.55 ? 1 : k < 0.85 ? 0 : 4;
    fOffset.set([x, groundHeight(x, z) + (inBed ? 0.08 + rand() * 0.12 : 0), z, inBed ? 2.0 + rand() * 1.4 : 0.9 + rand() * 0.6], i * 4);
    fKind.set([kind, rand()], i * 2);
  });
  const fg = flowerGeometry();
  fg.setAttribute('aOffset', new THREE.InstancedBufferAttribute(fOffset, 4));
  fg.setAttribute('aKind', new THREE.InstancedBufferAttribute(fKind, 2));
  fg.instanceCount = flowers.length;
  const flowerMesh = new THREE.Mesh(fg, new THREE.ShaderMaterial({ uniforms: world, vertexShader: flowerVertex, fragmentShader: flowerFragment, side: THREE.DoubleSide }));
  flowerMesh.frustumCulled = false;
  group.add(flowerMesh);

  return group;
}
