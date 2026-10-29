/** Pure 2D stroke processing: smoothing, decimation and reading intent from a doodle. */

export interface Pt {
  x: number;
  y: number;
}

export const MIN_STROKE_LENGTH = 36;
export const MIN_STROKE_SIZE = 14;

export function strokeLength(pts: readonly Pt[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return len;
}

/** Drop points closer than minDist to the last kept one (keeps the final point). */
export function decimate(pts: readonly Pt[], minDist: number): Pt[] {
  if (pts.length < 3) return pts.slice();
  const out: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const last = out[out.length - 1];
    if (Math.hypot(pts[i].x - last.x, pts[i].y - last.y) >= minDist) out.push(pts[i]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Centred moving average; endpoints stay fixed so the line does not shrink. */
export function smooth(pts: readonly Pt[], radius = 2): Pt[] {
  if (pts.length < 3) return pts.slice();
  return pts.map((p, i) => {
    if (i === 0 || i === pts.length - 1) return p;
    let sx = 0, sy = 0, n = 0;
    for (let k = Math.max(0, i - radius); k <= Math.min(pts.length - 1, i + radius); k++) {
      sx += pts[k].x;
      sy += pts[k].y;
      n++;
    }
    return { x: sx / n, y: sy / n };
  });
}

export interface LoopAnalysis {
  ok: boolean;
  reason?: 'short' | 'small' | 'open' | 'thin';
  length: number;
  /** Area centroid of the loop (screen px). */
  centre: Pt;
  /** Radius of the circle with the loop's area (px) — a lumpy circle still makes a round bubble. */
  radius: number;
  /** 4πA/P²: 1 for a circle, small for a squiggle. */
  roundness: number;
  closed: boolean;
}

/** Smallest bubble a loop may make, in screen pixels of radius. */
export const MIN_LOOP_RADIUS = 16;

/**
 * Read a drawn loop as a bubble: is it closed, big enough and round enough,
 * where is its middle, and how big a circle does it hold? Non-round shapes
 * are accepted and rounded off (they're bubbles); only squiggles, open lines
 * and tiny loops are turned away.
 */
export function analyzeLoop(pts: readonly Pt[]): LoopAnalysis {
  const length = strokeLength(pts);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const span = Math.max(maxX - minX, maxY - minY, 1);
  const first = pts[0] ?? { x: 0, y: 0 };
  const last = pts[pts.length - 1] ?? first;
  const gap = Math.hypot(last.x - first.x, last.y - first.y);
  const closed = pts.length > 3 && gap < Math.max(20, 0.35 * span);
  // shoelace over the loop closed back to its start
  let a2 = 0, cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    const c = p.x * q.y - q.x * p.y;
    a2 += c;
    cx += (p.x + q.x) * c;
    cy += (p.y + q.y) * c;
  }
  const area = Math.abs(a2) / 2;
  const centre = Math.abs(a2) > 1e-6 ? { x: cx / (3 * a2), y: cy / (3 * a2) } : { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  const perimeter = length + gap;
  const roundness = perimeter > 0 ? (4 * Math.PI * area) / (perimeter * perimeter) : 0;
  const radius = Math.sqrt(area / Math.PI);
  let reason: LoopAnalysis['reason'];
  if (length < MIN_STROKE_LENGTH) reason = 'short';
  else if (!closed) reason = 'open';
  else if (roundness < 0.28) reason = 'thin';
  else if (radius < MIN_LOOP_RADIUS) reason = 'small';
  return { ok: !reason, reason, length, centre, radius, roundness, closed };
}
