import * as THREE from 'three';
import {
  BEDS, BIRDBATH, BORDER, GATE, PATH_HALF_WIDTH, PATH_POINTS, TILE, TREES, WALL, groundHeight, groundNormal,
} from './garden';
import { LIGHTING_GLSL, NOISE_GLSL, WORLD_UNIFORMS_GLSL } from './shaderChunks';
import type { WorldUniforms } from './world';

/**
 * The painted ground: a pastel lawn laid in like MEADOW's fields (soft mint
 * and pistachio patches, faint mowing bands, long dry-brush strokes, stipple
 * and flecks), a butter-yellow path with warm specks, a paved circle round
 * the birdbath, rosy soil under the beds and the border, and sea-glass shade
 * pooled under the trees. The ragged dry-brush edge is MEADOW's `paintEdge`.
 */

const f = (n: number) => n.toFixed(3);
const vec2s = (pts: [number, number][]) => pts.map(([x, z]) => `vec2(${f(x)}, ${f(z)})`).join(', ');

/** GLSL twin of garden.ts; shared with the tufts and flowers. */
export const GROUND_GLSL = /* glsl */ `
const float HALF_X = ${f(TILE.halfX)};
const float HALF_Z = ${f(TILE.halfZ)};
const int PATH_N = ${PATH_POINTS.length};
const vec2 PATH[${PATH_POINTS.length}] = vec2[](${vec2s(PATH_POINTS)});
const vec4 TREE0 = vec4(${f(TREES[0].x)}, ${f(TREES[0].z)}, ${f(TREES[0].r)}, 0.0);
const vec4 TREE1 = vec4(${f(TREES[1].x)}, ${f(TREES[1].z)}, ${f(TREES[1].r)}, 0.0);
const vec3 BATH = vec3(${f(BIRDBATH.x)}, ${f(BIRDBATH.z)}, ${f(BIRDBATH.paved)});

vec3 srgb(vec3 c) { return pow(c, vec3(2.2)); }

float ellipseSDF(vec2 p, vec2 c, vec2 r) {
  vec2 w = p - c;
  float k0 = length(w / r);
  float k1 = length(w / (r * r));
  return k1 < 1e-6 ? -min(r.x, r.y) : k0 * (k0 - 1.0) / k1;
}
float segSDF(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}
float boxSDF(vec2 p, vec2 c, vec2 h) {
  vec2 q = abs(p - c) - h;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
}

float pathDistance(vec2 xz) {
  float d = 1e3;
  for (int i = 0; i < PATH_N - 1; i++) d = min(d, segSDF(xz, PATH[i], PATH[i + 1]));
  return d;
}

float bedSDF(vec2 xz, out float lilac) {
  float a = ellipseSDF(xz, vec2(${f(BEDS[0].x)}, ${f(BEDS[0].z)}), vec2(${f(BEDS[0].rx)}, ${f(BEDS[0].rz)}));
  float b = ellipseSDF(xz, vec2(${f(BEDS[1].x)}, ${f(BEDS[1].z)}), vec2(${f(BEDS[1].rx)}, ${f(BEDS[1].rz)}));
  lilac = step(b, a);
  return min(a, b);
}

float borderSDF(vec2 xz) {
  float band = boxSDF(xz, vec2(0.0, ${f(BORDER.z)}), vec2(${f(WALL.x1 - 0.2)}, ${f(BORDER.half)}));
  float gap = boxSDF(xz, vec2(${f(GATE.x)}, ${f(BORDER.z)}), vec2(${f(GATE.width / 2 + 0.25)}, 1.0));
  return max(band, -gap);
}

/** The ground's base paint, before light. grassy = 0 on paving and soil. */
vec3 lawnPaint(vec2 xz, out float grassy) {
  // soft mint and pistachio patches, with warm glaze-like pools of light
  float patchN = fbm2lite(xz * 0.17 + 7.0);
  vec3 mint = srgb(vec3(0.725, 0.886, 0.753));
  vec3 pistachio = srgb(vec3(0.80, 0.90, 0.69));
  vec3 c = mix(mint, pistachio, smoothstep(0.38, 0.68, patchN));
  c = mix(c, srgb(vec3(0.66, 0.85, 0.72)), smoothstep(0.6, 0.85, fbm2lite(xz * 0.13 - 4.0)) * 0.55);
  float glow = fbm2lite(xz * 0.1 + 1.5);
  c = mix(c, c * vec3(1.05, 1.04, 0.95) + srgb(vec3(0.05, 0.04, 0.02)), smoothstep(0.45, 0.8, glow) * 0.5);
  // faint mowing bands
  float band = sin((xz.x * 0.6 + xz.y * 0.3) * 2.4 + (vnoise(xz * 0.4) - 0.5) * 0.9);
  c *= 0.98 + 0.03 * smoothstep(-0.3, 0.3, band);
  // long dry-brush strokes
  float a = 0.5 + (vnoise(xz * 0.22) - 0.5) * 0.7;
  vec2 uv = mat2(cos(a), sin(a), -sin(a), cos(a)) * xz;
  float stroke = vnoise(vec2(uv.x * 0.7, uv.y * 8.0)) * 0.65 + vnoise(vec2(uv.x * 2.0, uv.y * 18.0)) * 0.35;
  c *= 0.95 + 0.1 * stroke;
  // sea-glass shade pooled under the trees and along the wall
  float under = smoothstep(TREE0.z * 1.3, TREE0.z * 0.4, length(xz - TREE0.xy - vec2(0.45, 0.25)))
              + smoothstep(TREE1.z * 1.3, TREE1.z * 0.4, length(xz - TREE1.xy - vec2(0.45, 0.25)))
              + smoothstep(0.9, 0.0, xz.y - ${f(WALL.z)}) * 0.6;
  c = mix(c, srgb(vec3(0.64, 0.83, 0.72)), clamp(under, 0.0, 1.0) * 0.4);
  grassy = 1.0;

  // the beds and the border: rosy, crumbly soil inside a cream edging
  float lilac;
  float bd = min(bedSDF(xz, lilac), borderSDF(xz)) + (vnoise(xz * 3.0) - 0.5) * 0.06;
  vec3 soil = mix(srgb(vec3(0.82, 0.69, 0.64)), srgb(vec3(0.88, 0.76, 0.70)), vnoise(xz * 6.0)) * (0.93 + 0.1 * vnoise(xz * 22.0));
  soil = mix(soil, soil * vec3(0.96, 0.95, 1.03), lilac);
  float inBed = smoothstep(0.02, -0.04, bd);
  c = mix(c, soil, inBed);
  float edging = smoothstep(0.08, 0.03, abs(bd - 0.03));
  c = mix(c, srgb(vec3(0.97, 0.93, 0.86)) * (0.92 + 0.1 * step(0.5, fract((xz.x + xz.y) * 2.6))), edging * 0.85);
  grassy *= 1.0 - max(inBed, edging);

  // the butter-yellow path and the paved circle: speckled, with frayed edges
  float pd = pathDistance(xz) + (vnoise(xz * 2.4) - 0.5) * 0.1;
  float onPath = 1.0 - smoothstep(${f(PATH_HALF_WIDTH - 0.07)}, ${f(PATH_HALF_WIDTH + 0.04)}, pd);
  float rd = length(xz - BATH.xy) - BATH.z + (vnoise(xz * 2.6) - 0.5) * 0.08;
  float onPave = 1.0 - smoothstep(-0.06, 0.03, rd);
  float paving = max(onPath, onPave);
  vec3 butter = mix(srgb(vec3(0.96, 0.886, 0.63)), srgb(vec3(0.98, 0.93, 0.74)), smoothstep(0.3, 0.0, pd));
  float speck = step(0.83, hash12(floor(xz * 32.0)));
  butter = mix(butter, srgb(vec3(0.9, 0.79, 0.53)), speck * 0.45);
  // the paved circle is laid in soft rings of flagstones
  float ring = smoothstep(0.03, 0.0, abs(fract((length(xz - BATH.xy)) * 2.4) - 0.5) - 0.46);
  butter = mix(butter, butter * 0.93, onPave * ring * 0.8);
  butter *= 0.965 + 0.06 * vnoise(xz * 11.0);
  c = mix(c, butter, paving);
  grassy *= 1.0 - paving;
  return c;
}

/** Signed distance inside the tile's rounded edge, roughened like dry-brush paint. */
float paintEdge(vec2 xz) {
  vec2 q = abs(xz) - vec2(HALF_X, HALF_Z) + 0.8;
  float box = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 0.8;
  float rough = (vnoise(xz * 1.1) - 0.5) * 0.6 + (vnoise(xz * 3.8) - 0.5) * 0.3;
  return -box + rough;
}
`;

const vertex = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormal;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormal = normal;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const fragment = /* glsl */ `
${WORLD_UNIFORMS_GLSL}
${NOISE_GLSL}
${LIGHTING_GLSL}
${GROUND_GLSL}
varying vec3 vWorld;
varying vec3 vNormal;

void main() {
  vec2 xz = vWorld.xz;
  // dry-brush edge: paint thins, then breaks into specks on the paper
  float edge = paintEdge(xz);
  float cover = smoothstep(-0.1, 0.8, edge);
  if (hash12(floor(xz * 22.0)) > cover * 1.08) discard;

  vec3 N = normalize(vNormal);
  float grassy;
  vec3 albedo = lawnPaint(xz, grassy);
  albedo *= 0.955 + 0.09 * vnoise(xz * 30.0);
  float fleck = step(0.986, hash12(floor(xz * 14.0))) * grassy;
  albedo = mix(albedo, albedo * 1.12 + srgb(vec3(0.06, 0.05, 0.04)), fleck * 0.8);
  float sunVis = castLight(vWorld, 0.04);
  vec3 col = paintLight(albedo, N, sunVis, 1.0, 0.2) * bubbleShade(vWorld);
  col = mix(uPaper, col, 0.55 + 0.45 * smoothstep(0.0, 1.0, edge));
  gl_FragColor = vec4(col, 1.0);
}
`;

function buildGeometry(): THREE.BufferGeometry {
  const step = 0.07;
  const cols = Math.round((TILE.halfX * 2) / step);
  const rows = Math.round((TILE.halfZ * 2) / step);
  const positions = new Float32Array((cols + 1) * (rows + 1) * 3);
  const normals = new Float32Array(positions.length);
  let k = 0;
  for (let r = 0; r <= rows; r++) {
    const z = -TILE.halfZ + r * step;
    for (let c = 0; c <= cols; c++) {
      const x = -TILE.halfX + c * step;
      const [nx, ny, nz] = groundNormal(x, z);
      positions.set([x, groundHeight(x, z), z], k);
      normals.set([nx, ny, nz], k);
      k += 3;
    }
  }
  const index = new Uint32Array(cols * rows * 6);
  let o = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = r * (cols + 1) + c;
      const b = a + cols + 1;
      index.set([a, b, a + 1, a + 1, b, b + 1], o);
      o += 6;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeBoundingSphere();
  return geo;
}

export function createTerrain(world: WorldUniforms): THREE.Mesh {
  const material = new THREE.ShaderMaterial({ uniforms: world, vertexShader: vertex, fragmentShader: fragment });
  const mesh = new THREE.Mesh(buildGeometry(), material);
  mesh.name = 'terrain';
  return mesh;
}

