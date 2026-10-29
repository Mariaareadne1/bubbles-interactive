import { describe, expect, it } from 'vitest';
import { BubbleSim, containPoint, heightBand, horizontalBounds, idHash, lifeFor, mergedRadius, R_MAX, type SimBubble } from '../../src/bubble/sim';
import { radiusAt, excite, MAX_MODES } from '../../src/bubble/wobble';
import { TILE } from '../../src/scene/garden';

function bubble(id: string, x: number, y: number, z: number, r: number, passengers = [1]): SimBubble {
  const seed = idHash(id);
  return { id, x, y, z, vx: 0, vy: 0, vz: 0, r, age: 0, life: lifeFor(seed), seed, passengers, names: [], modes: [], inflate: 1 };
}

/** Run the float for `seconds`, a frame at a time (advance caps each call at a quarter second). */
function run(s: BubbleSim, seconds: number) {
  const events = [];
  for (let i = 0; i < Math.round(seconds * 60); i++) events.push(...s.advance(1 / 60));
  return events;
}

describe('the float', () => {
  it('is deterministic: the same start plays back the same way', () => {
    const play = () => {
      const s = new BubbleSim();
      s.add(bubble('a', -1, 1.5, 0, 0.7));
      s.add(bubble('b', 2, 2.5, 1, 0.5));
      run(s, 20);
      return [...s.bubbles.values()].map((b) => [b.x, b.y, b.z].map((v) => v.toFixed(6)).join(','));
    };
    expect(play()).toEqual(play());
  });

  it('keeps every bubble inside the dome over the tile, however long it drifts', () => {
    const s = new BubbleSim();
    for (let i = 0; i < 8; i++) s.add(bubble(`d${i}`, -5 + i * 1.4, 1.2 + (i % 3), -2 + (i % 4), 0.4 + (i % 3) * 0.3));
    for (let t = 0; t < 100; t++) {
      run(s, 1);
      for (const b of s.bubbles.values()) {
        const bounds = horizontalBounds(b.r);
        expect(b.x).toBeGreaterThan(bounds.x0 - 0.3);
        expect(b.x).toBeLessThan(bounds.x1 + 0.3);
        expect(b.z).toBeGreaterThan(bounds.z0 - 0.3);
        expect(b.z).toBeLessThan(bounds.z1 + 0.3);
        const [lo, hi] = heightBand(b.x, b.z, b.r);
        expect(b.y).toBeGreaterThan(lo - 0.2);
        expect(b.y).toBeLessThan(hi + 0.4);
        expect(Math.abs(b.x)).toBeLessThan(TILE.halfX);
      }
    }
  });

  it('rises from where it was drawn toward its cruising height', () => {
    const s = new BubbleSim();
    s.add(bubble('rise', 0, 1.1, 1, 0.6));
    run(s, 10);
    expect(s.bubbles.get('rise')!.y).toBeGreaterThan(1.6);
  });

  it('merges two bubbles that meet slowly: volume conserved, both passengers inside', () => {
    const s = new BubbleSim();
    s.add(bubble('ma', -0.62, 2.4, 0.5, 0.6, [6]));
    s.add(bubble('mb', 0.62, 2.4, 0.5, 0.6, [13]));
    const events = run(s, 3);
    const merge = events.find((e) => e.type === 'merge');
    expect(merge).toBeTruthy();
    expect(s.bubbles.size).toBe(1);
    const [b] = [...s.bubbles.values()];
    expect(b.r).toBeCloseTo(mergedRadius(0.6, 0.6), 6);
    expect(b.r ** 3).toBeCloseTo(2 * 0.6 ** 3, 6);
    expect([...b.passengers].sort()).toEqual([13, 6]);
    expect(b.modes.length).toBeGreaterThan(1);
  });

  it('bubbles drifting near each other find each other', () => {
    const s = new BubbleSim();
    s.add(bubble('na', -0.8, 2.4, 0.5, 0.6, [6]));
    s.add(bubble('nb', 0.8, 2.4, 0.5, 0.6, [13]));
    run(s, 16);
    expect(s.bubbles.size).toBe(1);
  });

  it('bounces bubbles that meet fast, with a wobble, instead of merging', () => {
    const s = new BubbleSim();
    const a = bubble('fa', -0.9, 2.4, 0.5, 0.5);
    const b = bubble('fb', 0.9, 2.4, 0.5, 0.5);
    a.vx = 0.8;
    b.vx = -0.8;
    s.add(a);
    s.add(b);
    const events = run(s, 1.5);
    expect(events.some((e) => e.type === 'bump')).toBe(true);
    expect(events.some((e) => e.type === 'merge')).toBe(false);
    expect(s.bubbles.size).toBe(2);
    expect(s.bubbles.get('fa')!.modes.length).toBeGreaterThan(0);
  });

  it('never merges past the largest bubble', () => {
    const s = new BubbleSim();
    s.add(bubble('ba', -1.3, 3, 0, 1.4));
    s.add(bubble('bb', 1.3, 3, 0, 1.4));
    run(s, 6);
    expect(s.bubbles.size).toBe(2);
    for (const b of s.bubbles.values()) expect(b.r).toBeLessThanOrEqual(R_MAX);
  });

  it('pops a bubble by itself after about two minutes', () => {
    const s = new BubbleSim();
    s.add(bubble('old', 0, 2.5, 0, 0.5));
    const events = run(s, 140);
    expect(events.find((e) => e.type === 'expire')).toEqual({ type: 'expire', id: 'old' });
    expect(s.bubbles.size).toBe(0);
    expect(lifeFor(0)).toBeGreaterThanOrEqual(100);
    expect(lifeFor(0.999)).toBeLessThanOrEqual(140);
  });

  it('containPoint pulls a stray centre back over the tile', () => {
    const [x, y, z] = containPoint(30, -5, 30, 0.6);
    expect(Math.abs(x)).toBeLessThan(TILE.halfX);
    expect(Math.abs(z)).toBeLessThan(TILE.halfZ);
    expect(y).toBeGreaterThan(0.6);
  });
});

describe('the wobble', () => {
  it('rings down: a struck bubble returns to round', () => {
    const modes = excite([], { ax: 0, ay: 1, az: 0, amp: 0.15, l: 2, t0: 0 }, 0.6, 0);
    expect(Math.abs(radiusAt(modes, 0.6, 0, 0, 1, 0) - 1)).toBeCloseTo(0.15, 6);
    expect(Math.abs(radiusAt(modes, 0.6, 12, 0, 1, 0) - 1)).toBeLessThan(0.002);
  });

  it('keeps at most a few modes, replacing the faintest', () => {
    let modes = excite([], { ax: 1, ay: 0, az: 0, amp: 0.01, l: 2, t0: 0 }, 0.6, 0);
    for (let i = 0; i < 6; i++) modes = excite(modes, { ax: 0, ay: 1, az: 0, amp: 0.1 + i * 0.01, l: 3, t0: 0 }, 0.6, 0);
    expect(modes.length).toBe(MAX_MODES);
    expect(modes.every((m) => m.amp >= 0.1)).toBe(true);
  });
});
