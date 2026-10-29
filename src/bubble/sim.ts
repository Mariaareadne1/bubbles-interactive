import { TILE, WALL, groundHeight } from '../scene/garden';
import { excite, type Mode } from './wobble';

/**
 * The float: a small fixed-step, deterministic simulation of every bubble in
 * the air. Bubbles are buoyant toward a slowly wandering cruising height,
 * carried by a soft breeze that turns over minutes, contained by an invisible
 * dome over the tile, and they bump (with a wobble) or — meeting slowly —
 * merge into one bigger bubble, volume conserved. After about two minutes a
 * bubble pops by itself. No randomness beyond each bubble's seed, so the same
 * inputs play back the same way in tests and recordings.
 */

export const STEP = 1 / 60;
export const R_MIN = 0.32;
export const R_MAX = 1.6;
export const MAX_PASSENGERS = 4;
/** Approach speed (m/s) below which touching bubbles cling and then merge. */
export const V_MERGE = 0.22;
/** How long two bubbles must stay touching before they merge (s). */
export const MERGE_AFTER = 0.45;
export const LIFE = 120;
/** The faint pull between nearby bubbles (m/s²) and how far it reaches (m). */
export const PULL = 0.08;
export const PULL_RANGE = 0.5;
/** Seconds a fresh bubble takes to inflate. */
export const INFLATE = 0.4;

export interface SimBubble {
  readonly id: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  r: number;
  /** Seconds since it was drawn. */
  age: number;
  /** Seconds until it pops by itself (from birth). */
  life: number;
  /** 0..1 — this bubble's own phase for the bob and its lifetime (from its id). */
  readonly seed: number;
  passengers: number[];
  names: string[];
  modes: Mode[];
  /** 0..1 — inflating after being drawn. */
  inflate: number;
}

export type SimEvent =
  | { type: 'merge'; a: string; b: string; into: SimBubble }
  | { type: 'bump'; a: string; b: string; speed: number }
  | { type: 'expire'; id: string };

export interface SimOptions {
  /** 0..1 — scales the breeze and the bob (reduced motion uses less). */
  motion?: number;
}

/** Deterministic hash of a string id to [0, 1). */
export function idHash(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}

/** Radius of the bubble two others make together, volume conserved. */
export const mergedRadius = (a: number, b: number) => Math.cbrt(a * a * a + b * b * b);

/** The soft breeze at a point: a slowly turning prevailing drift plus gentle eddies. */
export function breeze(x: number, z: number, t: number): [number, number] {
  const heading = 0.4 + 0.9 * Math.sin(t * 0.021) + 0.5 * Math.sin(t * 0.0083 + 1.3);
  const speed = 0.13 + 0.06 * Math.sin(t * 0.047 + 0.4);
  const ex = 0.05 * Math.sin(z * 0.55 + t * 0.11) + 0.03 * Math.sin(x * 0.9 - t * 0.07);
  const ez = 0.05 * Math.cos(x * 0.5 - t * 0.09) + 0.03 * Math.cos(z * 0.8 + t * 0.13);
  return [Math.cos(heading) * speed + ex, Math.sin(heading) * speed * 0.7 + ez];
}

/** The lowest and highest centre a bubble of radius r may have over (x, z). */
export function heightBand(x: number, z: number, r: number): [number, number] {
  const lo = groundHeight(x, z) + r + 0.3;
  const dome = 4.9 - 1.5 * ((x / TILE.halfX) ** 2 + (z / TILE.halfZ) ** 2);
  return [lo, Math.max(lo + 0.2, dome - r * 0.6)];
}

/** Where a bubble's centre may be horizontally: over the tile, in front of the wall. */
export function horizontalBounds(r: number): { x0: number; x1: number; z0: number; z1: number } {
  const m = 0.35 + r * 0.85;
  return { x0: -TILE.halfX + m, x1: TILE.halfX - m, z0: WALL.z + 0.2 + r * 0.6, z1: TILE.halfZ - m };
}

/** Pull a point inside the dome (used for new and loaded bubbles). */
export function containPoint(x: number, y: number, z: number, r: number): [number, number, number] {
  const b = horizontalBounds(r);
  const cx = Math.min(b.x1, Math.max(b.x0, x));
  const cz = Math.min(b.z1, Math.max(b.z0, z));
  const [lo, hi] = heightBand(cx, cz, r);
  return [cx, Math.min(hi, Math.max(lo, y)), cz];
}

/** The cruising height a bubble drifts toward: it sinks a little and rises again. */
export function cruiseHeight(seed: number, t: number): number {
  return 2.2 + 0.7 * Math.sin(t * 0.09 + seed * 6.283) + 0.35 * Math.sin(t * 0.23 + seed * 17.0);
}

export class BubbleSim {
  readonly bubbles = new Map<string, SimBubble>();
  time = 0;
  private acc = 0;
  private readonly contact = new Map<string, number>();
  private readonly motion: number;

  constructor(options: SimOptions = {}) {
    this.motion = options.motion ?? 1;
  }

  add(b: SimBubble): void {
    this.bubbles.set(b.id, b);
  }

  remove(id: string): SimBubble | undefined {
    const b = this.bubbles.get(id);
    this.bubbles.delete(id);
    for (const k of [...this.contact.keys()]) if (k.includes(id)) this.contact.delete(k);
    return b;
  }

  /** Strike a bubble's film along an axis (a draw, a bump, a merge). */
  strike(b: SimBubble, ax: number, ay: number, az: number, amp: number, l: 2 | 3 = 2): void {
    const n = Math.hypot(ax, ay, az) || 1;
    b.modes = excite(b.modes, { ax: ax / n, ay: ay / n, az: az / n, amp: amp * this.motion, l, t0: this.time }, b.r, this.time);
  }

  /** Advance by dt in fixed steps; returns what happened. */
  advance(dt: number): SimEvent[] {
    const events: SimEvent[] = [];
    this.acc += Math.min(dt, 0.25);
    while (this.acc >= STEP - 1e-9) {
      this.acc -= STEP;
      this.step(events);
    }
    return events;
  }

  private step(events: SimEvent[]): void {
    const h = STEP;
    this.time += h;
    const t = this.time;
    const k = this.motion;
    for (const b of this.bubbles.values()) {
      b.age += h;
      b.inflate = Math.min(1, b.inflate + h / INFLATE);
      const [wx, wz] = breeze(b.x, b.z, t);
      // carried by the breeze: smaller bubbles answer it faster
      const grip = 0.5 / Math.sqrt(Math.max(0.3, b.r));
      let ax = (wx * k - b.vx) * grip;
      let az = (wz * k - b.vz) * grip;
      const [lo, hi] = heightBand(b.x, b.z, b.r);
      const target = Math.min(hi - 0.2, Math.max(lo + 0.3, cruiseHeight(b.seed, t)));
      let ay = (target - b.y) * 0.05 * (0.5 + 0.5 * k) - b.vy * 0.5;
      // the invisible dome: soft springs a little inside the bounds, firm ones past them
      const bounds = horizontalBounds(b.r);
      ax += wall(b.x - bounds.x0) - wall(bounds.x1 - b.x);
      az += wall(b.z - bounds.z0) - wall(bounds.z1 - b.z);
      ay += wall(b.y - lo) * 1.5 - wall(hi - b.y);
      b.vx += ax * h;
      b.vy += ay * h;
      b.vz += az * h;
      b.x += b.vx * h;
      b.y += b.vy * h;
      b.z += b.vz * h;
      // never through the ground
      if (b.y < lo - 0.15) {
        b.y = lo - 0.15;
        if (b.vy < 0) b.vy *= -0.3;
      }
    }
    this.collide(events);
    for (const b of [...this.bubbles.values()]) {
      if (b.age >= b.life) {
        this.remove(b.id);
        events.push({ type: 'expire', id: b.id });
      }
    }
  }

  private collide(events: SimEvent[]): void {
    const list = [...this.bubbles.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
    const touching = new Set<string>();
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!this.bubbles.has(a.id)) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (!this.bubbles.has(b.id) || !this.bubbles.has(a.id)) continue;
        const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
        const d = Math.hypot(dx, dy, dz) || 1e-6;
        const ra = a.r * a.inflate, rb = b.r * b.inflate;
        const nx = dx / d, ny = dy / d, nz = dz / d;
        if (d >= ra + rb) {
          // bubbles drifting close find each other: a faint pull across the last half metre
          const gap = d - ra - rb;
          if (gap < PULL_RANGE && a.inflate >= 1 && b.inflate >= 1) {
            const k = PULL * (1 - gap / PULL_RANGE) * STEP;
            a.vx += nx * k; a.vy += ny * k * 0.3; a.vz += nz * k;
            b.vx -= nx * k; b.vy -= ny * k * 0.3; b.vz -= nz * k;
          }
          continue;
        }
        const approach = -((b.vx - a.vx) * nx + (b.vy - a.vy) * ny + (b.vz - a.vz) * nz);
        const key = `${a.id}|${b.id}`;
        const canMerge = a.inflate >= 1 && b.inflate >= 1 && mergedRadius(a.r, b.r) <= R_MAX && a.passengers.length + b.passengers.length <= MAX_PASSENGERS;
        if (canMerge && approach < V_MERGE) {
          // meeting slowly: they cling, settle into each other, then become one
          touching.add(key);
          const held = (this.contact.get(key) ?? 0) + STEP;
          this.contact.set(key, held);
          // their films hold: they come to rest against each other and drift as one
          const va = a.r ** 3, vb = b.r ** 3;
          const mx = (a.vx * va + b.vx * vb) / (va + vb), my = (a.vy * va + b.vy * vb) / (va + vb), mz = (a.vz * va + b.vz * vb) / (va + vb);
          const hold = Math.min(1, 6 * STEP);
          a.vx += (mx - a.vx) * hold; a.vy += (my - a.vy) * hold; a.vz += (mz - a.vz) * hold;
          b.vx += (mx - b.vx) * hold; b.vy += (my - b.vy) * hold; b.vz += (mz - b.vz) * hold;
          if (held >= MERGE_AFTER) {
            const into = this.merge(a, b);
            events.push({ type: 'merge', a: a.id, b: b.id, into });
          }
          continue;
        }
        // a bump: equal and opposite, massed by volume, a little bounce, a wobble each
        const ma = ra ** 3, mb = rb ** 3;
        if (approach > 0) {
          const jn = (1.6 * approach) / (1 / ma + 1 / mb);
          a.vx -= (jn / ma) * nx; a.vy -= (jn / ma) * ny; a.vz -= (jn / ma) * nz;
          b.vx += (jn / mb) * nx; b.vy += (jn / mb) * ny; b.vz += (jn / mb) * nz;
          const amp = Math.min(0.12, 0.03 + approach * 0.3);
          this.strike(a, nx, ny, nz, -amp * (mb / (ma + mb)) * 2);
          this.strike(b, nx, ny, nz, -amp * (ma / (ma + mb)) * 2);
          events.push({ type: 'bump', a: a.id, b: b.id, speed: approach });
        }
        const overlap = ra + rb - d;
        const sa = mb / (ma + mb), sb = ma / (ma + mb);
        a.x -= nx * overlap * sa; a.y -= ny * overlap * sa; a.z -= nz * overlap * sa;
        b.x += nx * overlap * sb; b.y += ny * overlap * sb; b.z += nz * overlap * sb;
      }
    }
    for (const k of [...this.contact.keys()]) if (!touching.has(k)) this.contact.delete(k);
  }

  /** Two bubbles become one: volume, momentum and the centre of volume conserved; both passengers inside. */
  private merge(a: SimBubble, b: SimBubble): SimBubble {
    const va = a.r ** 3, vb = b.r ** 3;
    const w = va + vb;
    // the bigger, older one keeps its identity
    const keep = va >= vb ? a : b;
    const other = keep === a ? b : a;
    const into: SimBubble = {
      ...keep,
      x: (a.x * va + b.x * vb) / w,
      y: (a.y * va + b.y * vb) / w,
      z: (a.z * va + b.z * vb) / w,
      vx: (a.vx * va + b.vx * vb) / w,
      vy: (a.vy * va + b.vy * vb) / w,
      vz: (a.vz * va + b.vz * vb) / w,
      r: mergedRadius(a.r, b.r),
      age: Math.min(a.age, b.age),
      life: Math.max(a.life - a.age, b.life - b.age) + Math.min(a.age, b.age),
      passengers: [...keep.passengers, ...other.passengers],
      names: [...padNames(keep), ...padNames(other)],
      modes: [],
    };
    this.remove(a.id);
    this.remove(b.id);
    this.add(into);
    // a double wobble: along the line they joined on, and a pear shape across it
    const dx = other.x - keep.x, dy = other.y - keep.y, dz = other.z - keep.z;
    this.strike(into, dx, dy, dz, 0.16, 2);
    this.strike(into, dx, dy, dz, 0.07, 3);
    this.strike(into, -dz, 0.3, dx, -0.06, 2);
    return into;
  }
}

function padNames(b: SimBubble): string[] {
  return b.passengers.map((_, i) => b.names[i] ?? '');
}

/** Spring force pushing back once a coordinate is within 0.25 m of a bound (or past it). */
function wall(gap: number): number {
  if (gap > 0.25) return 0;
  const g = 0.25 - gap;
  return g * 1.2 + (gap < 0 ? -gap * 6 : 0);
}

/** Lifetime for a new bubble from its 0..1 seed: about two minutes. */
export const lifeFor = (seed: number) => LIFE + seed * 20 - 10;
