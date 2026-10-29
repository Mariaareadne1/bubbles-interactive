import * as THREE from 'three';
import { meshSDF, sdCapsule, sdEllipsoid, smin, type SDF } from './sdf';
import { noise3 } from '../scene/noise';

/**
 * The six passengers' shapes, in metres in each one's own frame: x forward
 * (the face), y up, z to its right, the origin on the ground under it. Soft
 * signed-distance unions meshed with surface nets; the bunny, chick and
 * kitten wear soft plush bodies that the material's fur shells fluff up.
 * Built once per kind in a Web Worker and shared by every passenger of that
 * kind (variety comes from paint, size and pose), so no DOM or WebGL here.
 */

export interface PartGeometries {
  [part: string]: THREE.BufferGeometry;
}

export const KINDS = ['bunny', 'chick', 'kitten', 'flower', 'strawberry', 'star'] as const;
export type Kind = (typeof KINDS)[number];

const mesh = (sdf: SDF, min: [number, number, number], max: [number, number, number], cell: number) =>
  meshSDF(sdf, { min, max, cell, ao: true });

function withAO(g: THREE.BufferGeometry): THREE.BufferGeometry {
  g.setAttribute('aAO', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count).fill(1), 1));
  return g;
}

/** Round cone from a (radius ra) to b (radius rb). */
function sdRoundCone(x: number, y: number, z: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, ra: number, rb: number): number {
  // sample along the segment: a cheap, smooth approximation of a tapered capsule
  const bax = bx - ax, bay = by - ay, baz = bz - az;
  const l2 = bax * bax + bay * bay + baz * baz;
  const h = Math.max(0, Math.min(1, ((x - ax) * bax + (y - ay) * bay + (z - az) * baz) / l2));
  const r = ra + (rb - ra) * h;
  return Math.hypot(x - ax - bax * h, y - ay - bay * h, z - az - baz * h) - r;
}

/**
 * Plush, not fleece: a smooth body with the faintest soft lumpiness. The fur
 * itself is the material's two shells, so silhouettes stay picture-book round.
 */
const fluff = (base: SDF, seed: number, _min: [number, number, number], _max: [number, number, number], r: number, curl = 0.0008) => {
  const o = seed * 7.31;
  const lump = r * 0.06;
  return (x: number, y: number, z: number) =>
    base(x, y, z) + lump * noise3(x * 38 + o, y * 38, z * 38) + curl * noise3(x * 120, y * 120 + o, z * 120);
};

// shared bits ----------------------------------------------------------------------------

function eye(): THREE.BufferGeometry {
  return withAO(new THREE.SphereGeometry(0.021, 14, 10));
}

function cheek(): THREE.BufferGeometry {
  return withAO(new THREE.SphereGeometry(0.02, 10, 6).scale(0.35, 0.7, 1));
}

/** A big curved petal held overhead like a parasol (and a little leaf version). */
function parasol(rx: number, rz: number, cup: number): THREE.BufferGeometry {
  const g = new THREE.CircleGeometry(1, 28, 0, Math.PI * 2);
  g.rotateX(-Math.PI / 2);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const d = Math.hypot(x, z);
    // heart-ish petal: a notch at the front, a soft point at the back
    const a = Math.atan2(z, x);
    const notch = 1 - 0.12 * Math.exp(-((a - 0) ** 2) * 18);
    p.setXYZ(i, x * rx * notch, -cup * d * d, z * rz * notch);
  }
  g.computeVertexNormals();
  return withAO(g);
}

// --- bunny --------------------------------------------------------------------------------

function bunnyShapes(): PartGeometries {
  const bodyBase: SDF = (x, y, z) => {
    let d = sdEllipsoid(x, y, z, -0.02, 0.13, 0, 0.15, 0.13, 0.125);
    d = smin(d, sdEllipsoid(x, y, z, -0.08, 0.09, 0, 0.1, 0.09, 0.12), 0.06);
    return d;
  };
  const headBase: SDF = (x, y, z) => smin(sdEllipsoid(x, y, z, 0, 0, 0, 0.108, 0.098, 0.112), sdEllipsoid(x, y, z, 0.04, -0.035, 0, 0.065, 0.052, 0.08), 0.04);
  const ear: SDF = (x, y, z) => sdEllipsoid(x, y, z, 0, 0.075, 0, 0.032, 0.085, 0.018);
  const tail: SDF = (x, y, z) => sdEllipsoid(x, y, z, 0, 0, 0, 0.045, 0.045, 0.045);
  const foot: SDF = (x, y, z) => sdEllipsoid(x, y, z, 0, 0, 0, 0.055, 0.025, 0.035);
  const nose: SDF = (x, y, z) => sdEllipsoid(x, y, z, 0, 0, 0, 0.012, 0.01, 0.016);
  return {
    body: mesh(fluff(bodyBase, 3, [-0.22, -0.01, -0.16], [0.16, 0.28, 0.16], 0.022), [-0.24, -0.02, -0.18], [0.17, 0.29, 0.18], 0.0055),
    head: mesh(fluff(headBase, 5, [-0.12, -0.11, -0.12], [0.12, 0.11, 0.12], 0.016), [-0.13, -0.12, -0.13], [0.13, 0.11, 0.13], 0.0045),
    ear: mesh(ear, [-0.04, -0.02, -0.03], [0.04, 0.17, 0.03], 0.003),
    tail: mesh(fluff(tail, 9, [-0.06, -0.06, -0.06], [0.06, 0.06, 0.06], 0.013), [-0.07, -0.07, -0.07], [0.07, 0.07, 0.07], 0.004),
    foot: mesh(foot, [-0.07, -0.03, -0.045], [0.07, 0.03, 0.045], 0.004),
    nose: mesh(nose, [-0.02, -0.02, -0.02], [0.02, 0.02, 0.02], 0.002),
    eye: eye(),
    cheek: cheek(),
  };
}

// --- chick --------------------------------------------------------------------------------

function chickShapes(): PartGeometries {
  const bodyBase: SDF = (x, y, z) => {
    let d = sdEllipsoid(x, y, z, 0, 0.12, 0, 0.135, 0.12, 0.125);
    d = smin(d, sdEllipsoid(x, y, z, 0.03, 0.22, 0, 0.09, 0.085, 0.09), 0.06);
    d = smin(d, sdEllipsoid(x, y, z, -0.13, 0.15, 0, 0.035, 0.025, 0.03), 0.03);
    return d;
  };
  const beak: SDF = (x, y, z) => sdRoundCone(x, y, z, 0, 0, 0, 0.03, -0.004, 0, 0.014, 0.003);
  const wing: SDF = (x, y, z) => sdEllipsoid(x, y, z, -0.03, 0, 0, 0.06, 0.04, 0.016);
  const foot: SDF = (x, y, z) => {
    let d = sdCapsule(x, y, z, 0, 0, 0, 0.035, 0, 0, 0.006);
    d = Math.min(d, sdCapsule(x, y, z, 0, 0, 0, 0.028, 0, 0.018, 0.006));
    d = Math.min(d, sdCapsule(x, y, z, 0, 0, 0, 0.028, 0, -0.018, 0.006));
    return d;
  };
  const tuft: SDF = (x, y, z) => {
    let d = sdCapsule(x, y, z, 0, 0, 0, -0.01, 0.04, 0, 0.007);
    d = smin(d, sdCapsule(x, y, z, 0.004, 0, 0.007, 0.014, 0.03, 0.014, 0.005), 0.005);
    d = smin(d, sdCapsule(x, y, z, -0.004, 0, -0.007, -0.02, 0.028, -0.012, 0.005), 0.005);
    return d;
  };
  return {
    body: mesh(fluff(bodyBase, 7, [-0.19, -0.01, -0.15], [0.15, 0.32, 0.15], 0.02), [-0.2, -0.02, -0.16], [0.16, 0.33, 0.16], 0.005),
    beak: mesh(beak, [-0.02, -0.02, -0.02], [0.04, 0.02, 0.02], 0.0022),
    wing: mesh(wing, [-0.1, -0.05, -0.025], [0.04, 0.05, 0.025], 0.0035),
    foot: mesh(foot, [-0.01, -0.01, -0.03], [0.045, 0.01, 0.03], 0.0022),
    tuft: mesh(tuft, [-0.035, -0.015, -0.025], [0.03, 0.055, 0.025], 0.0022),
    eye: eye(),
    cheek: cheek(),
  };
}

// --- kitten --------------------------------------------------------------------------------

function kittenShapes(): PartGeometries {
  const bodyBase: SDF = (x, y, z) => {
    let d = sdEllipsoid(x, y, z, -0.03, 0.1, 0, 0.17, 0.1, 0.115);
    d = smin(d, sdEllipsoid(x, y, z, 0.07, 0.13, 0, 0.08, 0.1, 0.1), 0.06);
    return d;
  };
  const headBase: SDF = (x, y, z) => {
    let d = sdEllipsoid(x, y, z, 0, 0, 0, 0.088, 0.078, 0.1);
    d = smin(d, sdEllipsoid(x, y, z, 0.04, -0.025, 0, 0.05, 0.04, 0.075), 0.04);
    return d;
  };
  const ear: SDF = (x, y, z) => sdRoundCone(x, y, z, 0, 0, 0, -0.008, 0.06, 0, 0.032, 0.006) * 1 + Math.max(0, Math.abs(x) - 0.012) * 0.6;
  // a tail curled round the body, in segments so it can lift and wave as a whole
  const tail: SDF = (x, y, z) => {
    let d = Infinity;
    const n = 8;
    let px = 0, py = 0, pz = 0;
    for (let i = 1; i <= n; i++) {
      const a = (i / n) * 1.9;
      const nx = -Math.sin(a) * 0.12, nz = (1 - Math.cos(a)) * 0.12, ny = 0.02 * Math.sin(a * 1.5);
      d = smin(d, sdCapsule(x, y, z, px, py, pz, nx, ny, nz, 0.026 - i * 0.0012), 0.01);
      px = nx; py = ny; pz = nz;
    }
    return d;
  };
  const paw: SDF = (x, y, z) => sdEllipsoid(x, y, z, 0, 0, 0, 0.04, 0.025, 0.032);
  const nose: SDF = (x, y, z) => sdEllipsoid(x, y, z, 0, 0, 0, 0.01, 0.009, 0.013);
  return {
    body: mesh(fluff(bodyBase, 11, [-0.22, -0.01, -0.14], [0.17, 0.25, 0.14], 0.016, 0.0006), [-0.23, -0.02, -0.15], [0.18, 0.26, 0.15], 0.005),
    head: mesh(fluff(headBase, 13, [-0.11, -0.1, -0.12], [0.11, 0.1, 0.12], 0.012, 0.0005), [-0.12, -0.11, -0.13], [0.12, 0.1, 0.13], 0.0042),
    ear: mesh(ear, [-0.04, -0.035, -0.04], [0.04, 0.075, 0.04], 0.0028),
    tail: mesh(tail, [-0.17, -0.04, -0.04], [0.04, 0.06, 0.25], 0.0042),
    paw: mesh(paw, [-0.05, -0.03, -0.04], [0.05, 0.03, 0.04], 0.0035),
    nose: mesh(nose, [-0.02, -0.02, -0.02], [0.02, 0.02, 0.02], 0.002),
    eye: eye(),
    cheek: cheek(),
  };
}

// --- flower --------------------------------------------------------------------------------

function flowerShapes(): PartGeometries {
  const stem = withAO(new THREE.CylinderGeometry(0.011, 0.014, 0.24, 8).translate(0, 0.12, 0));
  const leaf: SDF = (x, y, z) => {
    // a soft lanceolate leaf along +z, curling up at the tip
    const c = sdEllipsoid(x, y - z * z * 0.6, z, 0, 0, 0.065, 0.032, 0.008, 0.07);
    return c;
  };
  const bloom: SDF = (x, y, z) => {
    // five round petals in the y–z plane (facing +x), slightly cupped
    let d = Infinity;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + Math.PI / 2;
      const cy = Math.sin(a) * 0.068, cz = Math.cos(a) * 0.068;
      d = smin(d, sdEllipsoid(x + Math.hypot(y, z) * 0.18, y, z, 0, cy, cz, 0.014, 0.055, 0.055), 0.012);
    }
    return d;
  };
  const centre: SDF = (x, y, z) => sdEllipsoid(x, y, z, 0, 0, 0, 0.03, 0.048, 0.048);
  return {
    stem,
    leaf: mesh(leaf, [-0.04, -0.02, -0.01], [0.04, 0.03, 0.15], 0.0028),
    bloom: mesh(bloom, [-0.04, -0.14, -0.14], [0.03, 0.14, 0.14], 0.0035),
    centre: mesh(centre, [-0.04, -0.06, -0.06], [0.04, 0.06, 0.06], 0.0028),
    eye: eye(),
    cheek: cheek(),
  };
}

// --- strawberry ----------------------------------------------------------------------------

function strawberryShapes(): PartGeometries {
  const berry: SDF = (x, y, z) => {
    // round shoulders, tapering to a soft point below
    const t = Math.min(1, Math.max(0, (0.2 - y) / 0.2));
    const s = 1 - 0.42 * t * t;
    return sdEllipsoid(x / s, y, z / s, 0, 0.115, 0, 0.115, 0.115, 0.12) * s;
  };
  const calyx: SDF = (x, y, z) => {
    let d = sdEllipsoid(x, y, z, 0, 0.004, 0, 0.03, 0.01, 0.03);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.3;
      const ex = Math.cos(a) * 0.045, ez = Math.sin(a) * 0.045;
      d = smin(d, sdEllipsoid(x, y + Math.hypot(x, z) * 0.25, z, ex, 0, ez, 0.04 * Math.abs(Math.cos(a)) + 0.014, 0.006, 0.04 * Math.abs(Math.sin(a)) + 0.014), 0.008);
    }
    d = Math.min(d, sdCapsule(x, y, z, 0, 0, 0, -0.008, 0.04, 0.004, 0.006));
    return d;
  };
  return {
    berry: mesh(berry, [-0.14, -0.01, -0.14], [0.14, 0.25, 0.14], 0.004),
    calyx: mesh(calyx, [-0.075, -0.03, -0.075], [0.075, 0.05, 0.075], 0.0026),
    eye: eye(),
    cheek: cheek(),
  };
}

// --- star ------------------------------------------------------------------------------------

/** Inigo Quilez's 2D five-pointed star (r outer radius, rf inner ratio). */
function sdStar5(px: number, py: number, r: number, rf: number): number {
  const k1x = 0.809016994375, k1y = -0.587785252292;
  const k2x = -k1x, k2y = k1y;
  px = Math.abs(px);
  let d = 2 * Math.max(k1x * px + k1y * py, 0);
  px -= d * k1x; py -= d * k1y;
  d = 2 * Math.max(k2x * px + k2y * py, 0);
  px -= d * k2x; py -= d * k2y;
  px = Math.abs(px);
  py -= r;
  const bax = rf * -k1y - 0, bay = rf * k1x - 1;
  const h = Math.max(0, Math.min(r, (px * bax + py * bay) / (bax * bax + bay * bay)));
  const hx = px - bax * h, hy = py - bay * h;
  return Math.hypot(hx, hy) * Math.sign(py * bax - px * bay);
}

function starShapes(): PartGeometries {
  const star: SDF = (x, y, z) => {
    // a puffy star standing in the y–z plane, its face toward +x
    const s2 = sdStar5(z, y - 0.15, 0.135, 0.52);
    const thick = 0.026 + Math.sqrt(Math.max(0, -s2)) * 0.11;
    return Math.max(s2 + 0.012, Math.abs(x) - thick) - 0.008;
  };
  return {
    star: mesh(star, [-0.08, -0.01, -0.16], [0.08, 0.31, 0.16], 0.0035),
    eye: eye(),
    cheek: cheek(),
  };
}

const BUILDERS: Record<string, () => PartGeometries> = {
  bunny: bunnyShapes,
  chick: chickShapes,
  kitten: kittenShapes,
  flower: flowerShapes,
  strawberry: strawberryShapes,
  star: starShapes,
  props: () => ({ petal: parasol(0.17, 0.14, 0.09), leaf: parasol(0.13, 0.08, 0.05) }),
};

/** The groups of shapes the workers build (one worker each, in parallel). */
export const SHAPE_GROUPS = Object.keys(BUILDERS);

export function buildShapes(group: string): PartGeometries {
  const build = BUILDERS[group];
  if (!build) throw new Error(`No shapes called ${group}`);
  return build();
}

/** Every shape, by kind, built in one go. */
export function buildAllShapes(): Record<string, PartGeometries> {
  return Object.fromEntries(SHAPE_GROUPS.map((g) => [g, buildShapes(g)]));
}
