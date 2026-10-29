import { fbm2, noise2 } from './noise';

/**
 * The garden: a 14 × 10.5 m painted tile — a mint and pistachio lawn, a
 * butter-yellow path from the front edge to a white picket gate in a pale
 * peach wall, a round paved circle with a sky-blue birdbath, a blush bed and
 * a lilac bed, a border along the wall, a lilac tree and a pink blossom tree.
 * World units are metres, y up, the camera on the +z side looking toward -z.
 *
 * Every shape here has a GLSL twin in terrain.ts written as the same
 * expression, so painted ground, placement and raycasts agree.
 */

export const TILE = { halfX: 7, halfZ: 5.25 };

// --- small SDF helpers ---------------------------------------------------------------

export function ellipseSDF(x: number, z: number, cx: number, cz: number, a: number, b: number): number {
  const px = x - cx;
  const pz = z - cz;
  const k0 = Math.hypot(px / a, pz / b);
  const k1 = Math.hypot(px / (a * a), pz / (b * b));
  return k1 === 0 ? -Math.min(a, b) : (k0 * (k0 - 1)) / k1;
}

function segDistance(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const pax = x - ax, paz = z - az, bax = bx - ax, baz = bz - az;
  const h = Math.max(0, Math.min(1, (pax * bax + paz * baz) / (bax * bax + baz * baz)));
  return Math.hypot(pax - bax * h, paz - baz * h);
}

function boxSDF(x: number, z: number, cx: number, cz: number, hx: number, hz: number): number {
  const qx = Math.abs(x - cx) - hx;
  const qz = Math.abs(z - cz) - hz;
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
}

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// --- the wall and the gate -------------------------------------------------------------

export const WALL = { z: -4.5, x0: -6.35, x1: 6.35, height: 0.78, thick: 0.3 };
export const GATE = { x: -2.0, width: 1.05 };

export function wallSDF(x: number, z: number): number {
  const half = (WALL.x1 - WALL.x0) / 2;
  const wall = boxSDF(x, z, (WALL.x0 + WALL.x1) / 2, WALL.z, half, WALL.thick / 2);
  const gap = boxSDF(x, z, GATE.x, WALL.z, GATE.width / 2, WALL.thick);
  return Math.max(wall, -gap);
}

// --- the path ----------------------------------------------------------------------------

export const BIRDBATH = { x: 2.55, z: -0.55, paved: 1.0 };

const PATH_CONTROL: [number, number][] = [
  [2.4, 6.0], [1.75, 4.0], [1.6, 2.4], [2.0, 1.1], [BIRDBATH.x - 0.3, BIRDBATH.z + 0.6],
  [1.2, -1.6], [-0.6, -2.6], [-1.65, -3.5], [GATE.x, -4.4], [GATE.x, -5.6],
];

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/** The path sampled as a polyline (shared with the shader as a constant array). */
export const PATH_POINTS: [number, number][] = (() => {
  const out: [number, number][] = [];
  const P = PATH_CONTROL;
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
    const steps = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 0.5));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      out.push([catmull(p0[0], p1[0], p2[0], p3[0], t), catmull(p0[1], p1[1], p2[1], p3[1], t)]);
    }
  }
  out.push(P[P.length - 1]);
  return out;
})();

export const PATH_HALF_WIDTH = 0.36;

/** Distance (m) from the path's centre line. */
export function pathDistance(x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i < PATH_POINTS.length - 1; i++) {
    const [ax, az] = PATH_POINTS[i];
    const [bx, bz] = PATH_POINTS[i + 1];
    best = Math.min(best, segDistance(x, z, ax, az, bx, bz));
  }
  return best;
}

/** Signed distance to the paved circle round the birdbath. */
export function pavedSDF(x: number, z: number): number {
  return Math.hypot(x - BIRDBATH.x, z - BIRDBATH.z) - BIRDBATH.paved;
}

// --- planting ------------------------------------------------------------------------------

export interface BedDef { x: number; z: number; rx: number; rz: number; palette: 'blush' | 'lilac' }
export const BEDS: BedDef[] = [
  { x: -4.05, z: 2.55, rx: 1.75, rz: 0.82, palette: 'blush' },
  { x: 4.85, z: 2.75, rx: 1.35, rz: 0.78, palette: 'lilac' },
];

/** The border bed along the foot of the wall (both sides of the gate). */
export const BORDER = { z: -3.95, half: 0.36 };

export function bedSDF(x: number, z: number): number {
  let d = Infinity;
  for (const b of BEDS) d = Math.min(d, ellipseSDF(x, z, b.x, b.z, b.rx, b.rz));
  return d;
}

export function borderSDF(x: number, z: number): number {
  const band = boxSDF(x, z, 0, BORDER.z, WALL.x1 - 0.2, BORDER.half);
  const gap = boxSDF(x, z, GATE.x, BORDER.z, GATE.width / 2 + 0.25, 1);
  return Math.max(band, -gap);
}

export interface TreeDef { x: number; z: number; r: number; color: string; shade: string; seed: number; trunk: number; blossom: boolean }
export const TREES: TreeDef[] = [
  { x: -4.7, z: -1.45, r: 1.12, color: '#f4c0cf', shade: '#c4b2e2', seed: 3, trunk: 0.13, blossom: true },
  { x: 5.1, z: -2.25, r: 1.0, color: '#c9b3e5', shade: '#a9b2e6', seed: 7, trunk: 0.12, blossom: false },
];

export interface BushDef { x: number; z: number; r: number; seed: number }
export const BUSHES: BushDef[] = [
  { x: -6.05, z: -3.55, r: 0.48, seed: 21 },
  { x: 6.1, z: -3.45, r: 0.42, seed: 22 },
  { x: -6.15, z: 4.35, r: 0.4, seed: 23 },
  { x: 6.25, z: 1.0, r: 0.36, seed: 24 },
];

// --- the ground --------------------------------------------------------------------------------

/** The lawn's gentle rolls (beds and paving sit a touch proud). */
export function groundHeight(x: number, z: number): number {
  const lawn = 0.07 * fbm2(x / 5 + 2.1, z / 5 - 4.3, 3) + 0.01 * noise2(x / 1.2, z / 1.2);
  const bed = 0.05 * smoothstep(0.05, -0.15, Math.min(bedSDF(x, z), borderSDF(x, z)));
  return 0.05 + lawn + bed;
}

export function groundNormal(x: number, z: number, eps = 0.06): [number, number, number] {
  const hx = groundHeight(x + eps, z) - groundHeight(x - eps, z);
  const hz = groundHeight(x, z + eps) - groundHeight(x, z - eps);
  const nx = -hx;
  const ny = 2 * eps;
  const nz = -hz;
  const len = Math.hypot(nx, ny, nz);
  return [nx / len, ny / len, nz / len];
}

/** Distance (m) inside the tile's edge; negative outside. */
export function edgeDistance(x: number, z: number): number {
  return Math.min(TILE.halfX - Math.abs(x), TILE.halfZ - Math.abs(z));
}

/** Signed distance to the nearest solid thing a passenger must sit clear of. */
export function obstacleSDF(x: number, z: number): number {
  let d = Math.min(wallSDF(x, z), Math.hypot(x - BIRDBATH.x, z - BIRDBATH.z) - 0.38);
  for (const t of TREES) d = Math.min(d, Math.hypot(x - t.x, z - t.z) - t.trunk - 0.1);
  for (const b of BUSHES) d = Math.min(d, Math.hypot(x - b.x, z - b.z) - b.r * 0.9);
  return d;
}

/** Can a passenger sit here (on the tile, in front of the wall, clear of things)? */
export function isOpenGround(x: number, z: number, clearance = 0.2): boolean {
  return edgeDistance(x, z) > 0.55 + clearance && z > WALL.z + 0.35 + clearance && obstacleSDF(x, z) > clearance;
}

/** The nearest open spot to (x, z): a short outward spiral search. */
export function nearestOpen(x: number, z: number, clearance = 0.2): [number, number] {
  const cx = Math.max(-TILE.halfX + 0.8, Math.min(TILE.halfX - 0.8, x));
  const cz = Math.max(WALL.z + 0.6, Math.min(TILE.halfZ - 0.8, z));
  if (isOpenGround(cx, cz, clearance)) return [cx, cz];
  for (let ring = 1; ring <= 24; ring++) {
    const r = ring * 0.12;
    const n = 8 + ring * 2;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const px = cx + Math.cos(a) * r;
      const pz = cz + Math.sin(a) * r;
      if (isOpenGround(px, pz, clearance)) return [px, pz];
    }
  }
  return [0.5, 1.5];
}
