// Frame-time benchmark: renders frames back-to-back with a GPU sync each frame.
// DPR=2 node scripts/perf.mjs   (empty garden, the showcase, and the full load: 16 bubbles + 24 friends)
import { chromium } from '@playwright/test';
import { loadavg } from 'node:os';

console.log('load average', loadavg().map((l) => l.toFixed(2)).join(' '));
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });
for (const [w, h, scene] of [[1440, 900, 'empty'], [1440, 900, 'showcase'], [1440, 900, 'full'], [1920, 1080, 'full']]) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: Number(process.env.DPR ?? 1) });
  await page.goto(`http://localhost:5398/?${scene === 'full' ? 'empty' : scene}`);
  await page.waitForFunction(() => window.__bubbles && !window.__bubbles.store.get().loading, null, { timeout: 120000 });
  const res = await page.evaluate(async (scene) => {
    const p = window.__bubbles;
    if (scene === 'full') {
      const now = p.engine.now;
      p.app.loadDoc({
        version: 1,
        bubbles: Array.from({ length: 16 }, (_, i) => ({ id: `s${i}`, r: 0.45 + (i % 4) * 0.2, passengers: [i], born: now, x: -5 + (i % 4) * 3.2, y: 1.8 + (i % 3), z: -3 + Math.floor(i / 4) * 2 })),
        garden: Array.from({ length: 24 }, (_, i) => ({ id: `f${i}`, kind: ['bunny', 'chick', 'kitten', 'flower', 'strawberry', 'star'][i % 6], seed: i, x: -5.5 + (i % 6) * 2.1, z: -2.6 + Math.floor(i / 6) * 1.9, heading: -1.5 })),
      });
    }
    await new Promise((r) => setTimeout(r, 1500));
    p.engine.stop();
    p.engine.adaptive = false;
    const gl = p.engine.renderer.getContext();
    for (let i = 0; i < 30; i++) p.engine.tick(1 / 60);
    gl.finish();
    const times = [];
    for (let i = 0; i < 120; i++) {
      const t0 = performance.now();
      p.engine.tick(1 / 60);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    return { median: times[60], p90: times[108], bubbles: p.store.doc.bubbles.length, garden: p.store.doc.garden.length };
  }, scene);
  console.log(`${w}x${h} dpr${process.env.DPR ?? 1} ${scene} (${res.bubbles} bubbles, ${res.garden} friends): median ${res.median.toFixed(1)} ms, p90 ${res.p90.toFixed(1)} ms`);
  await page.close();
}
await browser.close();
