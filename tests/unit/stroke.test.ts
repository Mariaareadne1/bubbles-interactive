import { describe, expect, it } from 'vitest';
import { analyzeLoop, insideLoop, MIN_LOOP_RADIUS, type Pt } from '../../src/interaction/stroke';

const circle = (cx: number, cy: number, r: number, n = 48, wob = 0): Pt[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    const k = r * (1 + wob * Math.sin(a * 3));
    return { x: cx + Math.cos(a) * k, y: cy + Math.sin(a) * k };
  });

describe('a drawn loop becomes a bubble', () => {
  it('a circle: closed, round, centred where it was drawn, radius from its size', () => {
    const a = analyzeLoop(circle(400, 300, 80));
    expect(a.ok).toBe(true);
    expect(a.centre.x).toBeCloseTo(400, 0);
    expect(a.centre.y).toBeCloseTo(300, 0);
    expect(a.radius).toBeGreaterThan(78);
    expect(a.radius).toBeLessThan(81);
    expect(a.roundness).toBeGreaterThan(0.95);
  });

  it('is the same whichever way round it was drawn', () => {
    const cw = analyzeLoop(circle(200, 200, 60));
    const ccw = analyzeLoop(circle(200, 200, 60).reverse());
    expect(ccw.radius).toBeCloseTo(cw.radius, 6);
    expect(ccw.centre.x).toBeCloseTo(cw.centre.x, 6);
  });

  it('a lumpy egg is gently rounded off, not refused', () => {
    const pts = circle(300, 300, 70, 48, 0.12).map((p) => ({ x: p.x, y: 300 + (p.y - 300) * 0.7 }));
    const a = analyzeLoop(pts);
    expect(a.ok).toBe(true);
    // the bubble holds the egg's area
    expect(a.radius).toBeGreaterThan(70 * Math.sqrt(0.7) * 0.9);
    expect(a.radius).toBeLessThan(70 * Math.sqrt(0.7) * 1.15);
  });

  it('an almost-closed loop counts as closed', () => {
    expect(analyzeLoop(circle(300, 300, 70).slice(0, 46)).ok).toBe(true);
  });

  it('turns away open arcs, tiny loops, thin squiggles and dabs', () => {
    expect(analyzeLoop(circle(300, 300, 70).slice(0, 25)).reason).toBe('open');
    expect(analyzeLoop(circle(300, 300, MIN_LOOP_RADIUS - 4)).reason).toBe('small');
    const zigzag = [...Array(40)].map((_, i) => ({ x: 100 + (i % 2) * 6, y: 100 + i * 4 }));
    zigzag.push({ x: 100, y: 104 });
    expect(analyzeLoop(zigzag).ok).toBe(false);
    expect(analyzeLoop([{ x: 0, y: 0 }, { x: 3, y: 2 }]).reason).toBe('short');
  });
});

describe('what a loop catches', () => {
  it('knows what is inside a drawn loop, even an unclosed, lumpy one', () => {
    const loop = circle(300, 300, 80, 48, 0.1).slice(0, 46);
    expect(insideLoop({ x: 300, y: 300 }, loop)).toBe(true);
    expect(insideLoop({ x: 350, y: 320 }, loop)).toBe(true);
    expect(insideLoop({ x: 395, y: 300 }, loop)).toBe(false);
    expect(insideLoop({ x: 300, y: 100 }, loop)).toBe(false);
  });

  it('works for a kidney shape drawn round two friends but not the one in its dent', () => {
    // a C-shape closed across its mouth: the dent is outside
    const pts: Pt[] = [];
    for (let i = 0; i <= 40; i++) {
      const a = 0.6 + (i / 40) * (Math.PI * 2 - 1.2);
      pts.push({ x: 300 + Math.cos(a) * 100, y: 300 + Math.sin(a) * 100 });
    }
    for (let i = 0; i <= 20; i++) {
      const a = Math.PI * 2 - 0.6 - (i / 20) * (Math.PI * 2 - 1.2);
      pts.push({ x: 300 + Math.cos(a) * 40, y: 300 + Math.sin(a) * 40 });
    }
    expect(insideLoop({ x: 230, y: 300 }, pts)).toBe(true);
    expect(insideLoop({ x: 300, y: 230 }, pts)).toBe(true);
    expect(insideLoop({ x: 330, y: 300 }, pts)).toBe(false);
  });
});

