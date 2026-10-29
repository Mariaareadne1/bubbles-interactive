/**
 * A bubble's wobble: a few low spherical-harmonic modes, each a zonal
 * Legendre shape (l = 2 squash/stretch, l = 3 pear) about the axis it was
 * struck along, ringing at a size-dependent frequency and decaying slowly.
 * Pure data and pure functions of time, so a fixed-step simulation and the
 * shader always agree.
 */

export interface Mode {
  /** Unit axis the mode is symmetric about. */
  ax: number;
  ay: number;
  az: number;
  /** Peak radial amplitude, as a fraction of the radius (negative = flattened along the axis). */
  amp: number;
  /** Legendre degree: 2 or 3. */
  l: 2 | 3;
  /** Time it was excited (simulation seconds). */
  t0: number;
}

export const MAX_MODES = 4;
/** Seconds for a mode to ring down to 1/e. */
export const DECAY = 1.7;

/** Angular frequency for degree l on a bubble of radius r (Rayleigh: ω ∝ √((l−1)l(l+2)) / r^1.5). */
export function modeOmega(l: 2 | 3, r: number): number {
  const base = 9.5 * Math.pow(0.8 / Math.max(0.2, r), 1.5);
  return l === 2 ? base : base * Math.sqrt(30 / 8);
}

/** Current coefficient of a mode: a damped cosine, so a mode starts at its full shape. */
export function modeCoefficient(m: Mode, r: number, t: number): number {
  const dt = t - m.t0;
  if (dt < 0) return 0;
  return m.amp * Math.exp(-dt / DECAY) * Math.cos(modeOmega(m.l, r) * dt);
}

/** Add a mode, replacing the one with the least energy left when full. Returns a new list. */
export function excite(modes: readonly Mode[], m: Mode, r: number, t: number): Mode[] {
  const live = modes.filter((x) => Math.abs(x.amp) * Math.exp(-(t - x.t0) / DECAY) > 0.002);
  if (live.length < MAX_MODES) return [...live, m];
  let weakest = 0;
  let least = Infinity;
  live.forEach((x, i) => {
    const e = Math.abs(x.amp) * Math.exp(-(t - x.t0) / DECAY);
    if (e < least) {
      least = e;
      weakest = i;
    }
  });
  void r;
  return live.map((x, i) => (i === weakest ? m : x));
}

const p2 = (c: number) => 0.5 * (3 * c * c - 1);
const p3 = (c: number) => 0.5 * (5 * c * c * c - 3 * c);

/** Radius multiplier along unit direction (nx, ny, nz) — the CPU twin of the vertex shader. */
export function radiusAt(modes: readonly Mode[], r: number, t: number, nx: number, ny: number, nz: number): number {
  let k = 1;
  for (const m of modes) {
    const c = nx * m.ax + ny * m.ay + nz * m.az;
    k += modeCoefficient(m, r, t) * (m.l === 2 ? p2(c) : p3(c));
  }
  return k;
}
