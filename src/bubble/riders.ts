/**
 * Where everyone asleep in a bubble sits, in the bubble's own (slowly turning)
 * frame. A few snuggle in a ring facing each other; a crowd fills a ball —
 * points spread evenly over a sphere (a golden-angle spiral), with an inner
 * shell once it's busy — and everyone shrinks to fit. There's no limit to
 * how many can share a bubble; they just get smaller. Pure, so it can be tested.
 */

export interface Slot {
  x: number;
  y: number;
  z: number;
  /** World metres per local unit for this rider. */
  scale: number;
  /** Turn about the vertical. */
  yaw: number;
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/**
 * Slot for rider i of n in a bubble of radius r. `height` is the rider's
 * height in local units; `maxScale` is its size on the lawn.
 */
export function riderSlot(i: number, n: number, r: number, height: number, maxScale: number): Slot {
  if (n <= 4) {
    // a snug ring, everyone facing in a little
    const fit = (r * (n > 1 ? 0.95 : 1.25)) / height;
    const scale = Math.max(0.05, Math.min(maxScale, fit));
    const a = (i / n) * Math.PI * 2;
    const spread = n > 1 ? r * 0.32 : 0;
    return { x: Math.cos(a) * spread, y: -height * scale * 0.45, z: Math.sin(a) * spread, scale, yaw: n > 1 ? -a + Math.PI + 0.6 : 0.4 };
  }
  // a crowd: each gets an even share of a ball 60 % of the bubble's radius
  const ball = r * 0.6;
  const size = (2 * ball * 0.9) / Math.cbrt(n);
  const scale = Math.max(0.03, Math.min(maxScale, (r * 0.95) / height, size / height));
  // past fourteen, about a third sit on an inner shell; each shell has its own even spiral
  const outerCount = n > 14 ? Math.round(n * 0.72) : n;
  const inner = i >= outerCount;
  const k = inner ? i - outerCount : i;
  const count = inner ? n - outerCount : outerCount;
  const shell = Math.max(0, ball - size * 0.5) * (inner ? 0.42 : 1);
  const y = 1 - (2 * (k + 0.5)) / count;
  const ring = Math.sqrt(Math.max(0, 1 - y * y));
  const a = k * GOLDEN + (inner ? 1.3 : 0);
  return {
    x: Math.cos(a) * ring * shell,
    y: y * shell * 0.85 - height * scale * 0.45,
    z: Math.sin(a) * ring * shell,
    scale,
    yaw: -a + Math.PI,
  };
}
