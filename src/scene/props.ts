import * as THREE from 'three';
import { meshSDF, sdEllipsoid } from '../char/sdf';
import { woolField } from '../char/wool';
import { BIRDBATH, BUSHES, GATE, TREES, WALL, groundHeight } from './garden';
import { LIGHTING_GLSL, NOISE_GLSL, WORLD_UNIFORMS_GLSL } from './shaderChunks';
import type { WorldUniforms } from './world';

/**
 * The garden's furniture: a round lilac tree and a pink blossom tree, mint
 * puff bushes and the drifting clouds (MEADOW's fleece generator, so they
 * share the passengers' soft silhouettes), the pale peach wall with its
 * cream coping, the white picket gate standing a little ajar and the
 * sky-blue birdbath. Everything casts the soft periwinkle shadows.
 */

export const PROP_SHADOW_LAYER = 1;

const vertex = /* glsl */ `
attribute float aAO;
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec3 vLocal;
varying float vAO;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vLocal = position;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vAO = aAO;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const fragment = /* glsl */ `
${WORLD_UNIFORMS_GLSL}
${NOISE_GLSL}
${LIGHTING_GLSL}
uniform vec3 uColor;
uniform vec3 uShadeTint;
uniform float uKind; // 0 puff (tree, bush), 1 cloud, 2 hard (wall, wood, stone), 3 water
uniform float uSeed;
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec3 vLocal;
varying float vAO;
void main() {
  vec3 N = normalize(vNormalW);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(cameraPosition - vWorld);
  // dry-brush silhouette on the puffs: the paint breaks up where the form turns away
  if (uKind < 1.5) {
    float facing = max(dot(N, V), 0.0);
    float speck = hash13(floor(vWorld * 22.0) + uSeed);
    if (speck > smoothstep(0.0, 0.28, facing) * 1.1) discard;
  }
  float grain = vnoise3(vLocal * 9.0 + uSeed) * 0.6 + vnoise3(vLocal * 26.0) * 0.4;
  vec3 albedo = uColor * (0.92 + 0.14 * grain);
  if (uKind > 1.5 && uKind < 2.5) albedo = uColor * (0.96 + 0.06 * vnoise3(vWorld * 14.0 + uSeed));
  if (uKind > 2.5) {
    // the birdbath's water: a still pale-blue wash with a soft lighter ring and a sparkle
    float r = length(vLocal.xz);
    albedo = uColor * (0.96 + 0.06 * vnoise(vWorld.xz * 8.0 + uTime * 0.1));
    albedo = mix(albedo, albedo * 1.12, smoothstep(0.05, 0.0, abs(r - 0.18 - 0.02 * sin(uTime * 0.7))));
  }
  float ao = mix(0.4, 1.0, vAO);
  float sunVis = uKind > 0.5 && uKind < 1.5 ? 1.0 : castLight(vWorld, 0.06);
  vec3 col = paintLight(albedo, N, sunVis, ao, uKind > 0.5 && uKind < 1.5 ? 0.35 : 0.15);
  // a dab of sunlit highlight on the side facing the sun
  float hi = smoothstep(0.55, 0.9, dot(N, uSunDir)) * sunVis;
  col = mix(col, col * vec3(1.08, 1.07, 1.0) + vec3(0.02, 0.02, 0.015), hi * step(uKind, 0.5) * 0.8);
  // cooler, periwinkle shade inside canopies and under clouds
  float shade = 1.0 - smoothstep(-0.2, 0.5, dot(N, uSunDir));
  col = mix(col, col * uShadeTint, shade * 0.55);
  gl_FragColor = vec4(col, 1.0);
}
`;

export function propMaterial(world: WorldUniforms, color: string, shadeTint: string, kind: number, seed: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...world,
      uColor: { value: new THREE.Color(color) },
      uShadeTint: { value: new THREE.Color(shadeTint) },
      uKind: { value: kind },
      uSeed: { value: seed },
    },
    vertexShader: vertex,
    fragmentShader: fragment,
  });
}

function puff(seed: number, rx: number, ry: number, rz: number, counts: [number, number] = [34, 50]): THREE.BufferGeometry {
  const r = Math.max(rx, ry, rz);
  const base = (x: number, y: number, z: number) => sdEllipsoid(x, y, z, 0, 0, 0, rx, ry, rz);
  const ext = r * 1.35;
  return meshSDF(
    woolField(base, {
      seed,
      min: [-ext, -ext, -ext],
      max: [ext, ext, ext],
      inset: r * 0.14,
      layers: [{ count: counts[0], rMin: r * 0.26, rMax: r * 0.4 }, { count: counts[1], rMin: r * 0.14, rMax: r * 0.22 }],
      blend: r * 0.12,
      curl: 0.004,
    }),
    { min: [-ext, -ext, -ext], max: [ext, ext, ext], cell: r / 14, ao: true },
  );
}

function cloudShape(seed: number): THREE.BufferGeometry {
  const base = (x: number, y: number, z: number) =>
    Math.min(
      sdEllipsoid(x, y, z, 0, 0, 0, 2.1, 0.75, 1.4),
      sdEllipsoid(x, y, z, 0.9, 0.35, 0.3, 1.1, 0.75, 0.95),
      sdEllipsoid(x, y, z, -1.0, 0.2, -0.3, 0.95, 0.6, 0.9),
    );
  return meshSDF(
    woolField(base, {
      seed,
      min: [-3.2, -1.2, -2.3],
      max: [3.2, 1.6, 2.3],
      inset: 0.22,
      layers: [{ count: 40, rMin: 0.45, rMax: 0.75 }, { count: 70, rMin: 0.22, rMax: 0.38 }],
      blend: 0.25,
      curl: 0.01,
    }),
    { min: [-3.8, -1.6, -2.8], max: [3.8, 2.3, 2.8], cell: 0.09, ao: true },
  );
}

function withAO(g: THREE.Object3D, cast = true): void {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const n = m.geometry.getAttribute('position').count;
    if (!m.geometry.getAttribute('aAO')) m.geometry.setAttribute('aAO', new THREE.BufferAttribute(new Float32Array(n).fill(1), 1));
    if (cast) m.layers.enable(PROP_SHADOW_LAYER);
  });
}

/** The garden wall: pale peach stucco with a cream coping, softly uneven, in two runs either side of the gate. */
function wall(world: WorldUniforms): THREE.Group {
  const g = new THREE.Group();
  const stucco = propMaterial(world, '#f5d1bf', '#bfb6e6', 2, 71);
  const coping = propMaterial(world, '#fae6d9', '#c3bfe9', 2, 72);
  const runs: [number, number][] = [[WALL.x0, GATE.x - GATE.width / 2 - 0.12], [GATE.x + GATE.width / 2 + 0.12, WALL.x1]];
  for (const [a, b] of runs) {
    // short blocks so the top line wanders a little, like a hand-laid wall
    const blocks = Math.max(1, Math.round((b - a) / 0.9));
    for (let i = 0; i < blocks; i++) {
      const x0 = a + ((b - a) * i) / blocks;
      const x1 = a + ((b - a) * (i + 1)) / blocks;
      const h = WALL.height * (0.97 + 0.05 * Math.sin(i * 2.7 + a));
      const y = groundHeight((x0 + x1) / 2, WALL.z) - 0.04;
      const block = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0 + 0.01, h, WALL.thick), stucco);
      block.position.set((x0 + x1) / 2, y + h / 2, WALL.z);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0 + 0.02, 0.07, WALL.thick + 0.07), coping);
      cap.position.set((x0 + x1) / 2, y + h + 0.03, WALL.z);
      g.add(block, cap);
    }
  }
  // the gate posts: a touch taller, capped with round finials
  for (const s of [-1, 1]) {
    const x = GATE.x + s * (GATE.width / 2 + 0.06);
    const y = groundHeight(x, WALL.z) - 0.04;
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.24, WALL.height + 0.18, WALL.thick + 0.06), stucco);
    post.position.set(x, y + (WALL.height + 0.18) / 2, WALL.z);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.1, 14, 10), coping);
    ball.position.set(x, y + WALL.height + 0.28, WALL.z);
    g.add(post, ball);
  }
  withAO(g);
  return g;
}

/** A white picket gate, hinged on the right post and standing a little ajar. */
function gate(world: WorldUniforms): THREE.Group {
  const paint = propMaterial(world, '#fbf7f0', '#b7c0ea', 2, 81);
  const g = new THREE.Group();
  const hingeX = GATE.x + GATE.width / 2 - 0.02;
  g.position.set(hingeX, groundHeight(GATE.x, WALL.z) + 0.04, WALL.z + 0.02);
  g.rotation.y = -0.55;
  const w = GATE.width - 0.06;
  const pickets = 7;
  for (let i = 0; i < pickets; i++) {
    const x = -w + (i + 0.5) * (w / pickets);
    const h = 0.62 + 0.06 * Math.cos(((i + 0.5) / pickets - 0.5) * Math.PI);
    const picket = new THREE.Mesh(new THREE.BoxGeometry(0.075, h, 0.03), paint);
    picket.position.set(x, h / 2, 0);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.054, 0.08, 4).rotateY(Math.PI / 4), paint);
    tip.scale.z = 0.4;
    tip.position.set(x, h + 0.035, 0);
    g.add(picket, tip);
  }
  for (const y of [0.16, 0.48]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, 0.035), paint);
    rail.position.set(-w / 2, y, -0.03);
    g.add(rail);
  }
  withAO(g);
  return g;
}

/** The birdbath: a round sky-blue bowl on a fluted pedestal, still water inside. */
function birdbath(world: WorldUniforms): THREE.Group {
  const g = new THREE.Group();
  g.position.set(BIRDBATH.x, groundHeight(BIRDBATH.x, BIRDBATH.z) - 0.02, BIRDBATH.z);
  const stone = propMaterial(world, '#bfe0f1', '#aab6e8', 2, 91);
  const pale = propMaterial(world, '#e2f0f6', '#b7c0ea', 2, 92);
  const water = propMaterial(world, '#a7d4ec', '#b3c3ec', 3, 93);
  const profile = [
    [0.0, 0.0], [0.26, 0.0], [0.27, 0.05], [0.16, 0.1], [0.11, 0.2], [0.09, 0.45], [0.1, 0.62], [0.14, 0.68],
    [0.38, 0.74], [0.47, 0.8], [0.48, 0.86], [0.43, 0.87], [0.0, 0.8],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const body = new THREE.Mesh(new THREE.LatheGeometry(profile, 36), stone);
  const lip = new THREE.Mesh(new THREE.TorusGeometry(0.455, 0.028, 8, 40).rotateX(Math.PI / 2), pale);
  lip.position.y = 0.865;
  const surface = new THREE.Mesh(new THREE.CircleGeometry(0.43, 40).rotateX(-Math.PI / 2), water);
  surface.position.y = 0.84;
  g.add(body, lip, surface);
  withAO(g);
  surface.layers.disable(PROP_SHADOW_LAYER);
  return g;
}

interface Cloud { mesh: THREE.Mesh; speed: number; size: number; axis: 'x' | 'z'; span: number }

export interface Props {
  group: THREE.Group;
  update(dt: number): void;
}

export function createProps(world: WorldUniforms): Props {
  const group = new THREE.Group();
  group.name = 'props';

  const trunkGeo = new THREE.CylinderGeometry(0.08, 0.12, 1, 8);
  trunkGeo.translate(0, 0.5, 0);
  const trunkMat = propMaterial(world, '#a88a7e', '#a9a6dc', 0, 0);
  trunkGeo.setAttribute('aAO', new THREE.BufferAttribute(new Float32Array(trunkGeo.getAttribute('position').count).fill(1), 1));
  for (const t of TREES) {
    const y = groundHeight(t.x, t.z);
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.set(t.x, y - 0.05, t.z);
    trunk.scale.set(t.trunk / 0.1, t.r * 1.15, t.trunk / 0.1);
    const crown = new THREE.Mesh(puff(t.seed, t.r, t.r * 0.9, t.r), propMaterial(world, t.color, t.shade, 0, t.seed));
    crown.position.set(t.x, y + t.r * 1.8, t.z);
    for (const m of [trunk, crown]) {
      m.layers.enable(PROP_SHADOW_LAYER);
      group.add(m);
    }
  }
  for (const b of BUSHES) {
    const mesh = new THREE.Mesh(puff(b.seed, b.r, b.r * 0.78, b.r, [16, 26]), propMaterial(world, '#b6e1c6', '#a8b6e6', 0, b.seed));
    mesh.position.set(b.x, groundHeight(b.x, b.z) + b.r * 0.55, b.z);
    mesh.layers.enable(PROP_SHADOW_LAYER);
    group.add(mesh);
  }
  group.add(wall(world), gate(world), birdbath(world));

  const clouds: Cloud[] = [];
  const cloudDefs = [
    // they travel along the edges of the tile, so they never hide a bubble for long
    { x: -3, y: 5.6, z: -6.4, s: 0.52, seed: 11, speed: 0.12, axis: 'x' as const, span: 8.5 },
    { x: 8.4, y: 5.2, z: 1.0, s: 0.42, seed: 12, speed: -0.1, axis: 'z' as const, span: 6 },
  ];
  for (const c of cloudDefs) {
    const mesh = new THREE.Mesh(cloudShape(c.seed), propMaterial(world, '#fdfbf8', '#e6e2f6', 1, c.seed));
    mesh.position.set(c.x, c.y, c.z);
    mesh.scale.setScalar(c.s);
    mesh.layers.enable(PROP_SHADOW_LAYER);
    group.add(mesh);
    clouds.push({ mesh, speed: c.speed, size: c.s, axis: c.axis, span: c.span });
  }

  return {
    group,
    update(dt: number) {
      // clouds drift along the edge of the tile and dissolve as they reach its corner, then return
      for (const c of clouds) {
        const p = c.mesh.position;
        p[c.axis] += c.speed * dt;
        if (p[c.axis] > c.span) p[c.axis] = -c.span;
        if (p[c.axis] < -c.span) p[c.axis] = c.span;
        const fade = Math.min(1, (c.span - Math.abs(p[c.axis])) / 3);
        c.mesh.scale.setScalar(c.size * Math.max(0.001, fade * fade * (3 - 2 * fade)));
      }
    },
  };
}
