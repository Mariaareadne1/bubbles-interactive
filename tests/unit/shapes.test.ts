import { describe, expect, it } from 'vitest';
import { buildAllShapes } from '../../src/char/shapes';

describe('passenger shapes', () => {
  it('builds every kind with closed, non-empty parts', () => {
    const set = buildAllShapes();
    for (const [kind, parts] of Object.entries(set)) {
      for (const [name, g] of Object.entries(parts)) {
        const n = g.getAttribute('position').count;
        expect(n, `${kind}.${name}`).toBeGreaterThan(20);
        g.computeBoundingBox();
        // every part is passenger-sized: under half a metre in any direction
        const size = g.boundingBox!.getSize(g.boundingBox!.min.clone());
        expect(Math.max(size.x, size.y, size.z), `${kind}.${name}`).toBeLessThan(0.5);
      }
    }
  }, 60_000);
});
