import { describe, expect, it } from 'vitest';
import { riderSlot } from '../../src/bubble/riders';

const slots = (n: number, r = 1.2, h = 0.4, max = 1.9) => Array.from({ length: n }, (_, i) => riderSlot(i, n, r, h, max));

describe('everyone fits in the bubble', () => {
  it('one passenger sits in the middle at full size if it fits', () => {
    const [s] = slots(1);
    expect(Math.hypot(s.x, s.z)).toBe(0);
    expect(s.scale).toBe(1.9);
  });

  for (const n of [2, 4, 5, 9, 16, 24, 40]) {
    it(`${n} riders all stay inside the film and don't pile onto each other`, () => {
      const r = 1.2, h = 0.4;
      const all = slots(n, r, h);
      for (const s of all) {
        // the rider's middle is well inside the bubble
        const mid = Math.hypot(s.x, s.y + (h * s.scale) / 2, s.z);
        expect(mid + (h * s.scale) / 2).toBeLessThan(r);
      }
      // nobody's middle sits on top of anybody else's
      const size = h * all[0].scale;
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        const d = Math.hypot(all[i].x - all[j].x, all[i].y - all[j].y, all[i].z - all[j].z);
        expect(d).toBeGreaterThan(size * 0.45);
      }
    });
  }

  it('a crowd shrinks as it grows, but there is no limit', () => {
    const sizes = [5, 10, 20, 40, 100].map((n) => slots(n)[0].scale);
    for (let i = 1; i < sizes.length; i++) expect(sizes[i]).toBeLessThan(sizes[i - 1]);
    expect(sizes.at(-1)).toBeGreaterThan(0);
  });
});
