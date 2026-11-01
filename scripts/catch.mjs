// Filmstrip: a circle drawn round friends on the lawn scoops them all into one bubble.
// node scripts/catch.mjs <prefix> [count]   (needs the dev server)
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';

const [prefix = 'catch', count = '3'] = process.argv.slice(2);
mkdirSync('artifacts', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:5398/?empty');
await page.waitForFunction(() => window.__bubbles && !window.__bubbles.store.get().loading, null, { timeout: 240000 });
await page.evaluate((n) => (window.__count = n), Number(count));
const c = await page.evaluate(() => {
  const d = window.__bubbles;
  d.engine.stop();
  d.engine.fixedStep = 1 / 60;
  d.store.set({ uiHidden: true });
  const n = Number(window.__count);
  const kinds = ['bunny', 'chick', 'kitten', 'flower', 'strawberry', 'star'];
  // a little crowd in a sunflower spiral round the middle of the lawn
  d.app.loadDoc({ version: 1, bubbles: [], garden: Array.from({ length: n }, (_, i) => {
    const r = n > 1 ? 0.3 * Math.sqrt(i + 0.5) : 0, a = i * 2.4;
    return { id: `k${i}`, kind: kinds[(i * 5 + 1) % 6], seed: 60 + i * 7, x: -0.1 + Math.cos(a) * r, z: 2.0 + Math.sin(a) * r * 0.8, heading: -1.5 + Math.sin(i) * 0.4 };
  }) });
  for (let i = 0; i < 60; i++) d.engine.tick(1 / 60);
  const v = d.engine.camera.position.clone().set(-0.1, 0.4, 2.0).project(d.engine.camera);
  return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight };
});
const k = Math.max(1, Math.sqrt(Number(count) / 3));
const clip = { x: c.x - 210 * k, y: c.y - 250 * k, width: 420 * k, height: 330 * k };
const files = [];
const snap = async () => { const f = `artifacts/${prefix}-${files.length}.png`; await page.screenshot({ path: f, clip }); files.push(f); };
// draw round them, a frame mid-stroke
const R = 105 * Math.max(1, Math.sqrt(Number(count) / 3));
await page.mouse.move(c.x + R, c.y);
await page.mouse.down();
for (let i = 1; i <= 44; i++) {
  const a = (i / 44) * Math.PI * 2.03;
  await page.mouse.move(c.x + Math.cos(a) * R, c.y + Math.sin(a) * R * 0.86);
  if (i === 36) await snap();
}
await page.mouse.up();
for (const dt of [0.1, 0.2, 0.25, 0.3, 0.6, 1.5]) {
  await page.evaluate((s) => { const d = window.__bubbles; for (let i = 0; i < Math.round(s * 60); i++) d.engine.tick(1 / 60); }, dt);
  await snap();
}
// and pop it: they all come down again, spread round the spot
await page.evaluate(() => { const d = window.__bubbles; d.app.pop(d.store.doc.bubbles[0].id); for (let i = 0; i < 60 * 9; i++) d.engine.tick(1 / 60); });
await snap();
console.log(JSON.stringify(await page.evaluate(() => window.__bubbles.store.doc.bubbles.map((b) => b.passengers))));
const layout = files.map((_, i) => `${(i % 4) * Math.round(clip.width * 2)}_${Math.floor(i / 4) * Math.round(clip.height * 2)}`).join('|');
execFileSync(ffmpeg, ['-y', '-loglevel', 'error', ...files.flatMap((f) => ['-i', f]), '-filter_complex', `xstack=inputs=${files.length}:layout=${layout}:fill=white,scale=iw/2:-1`, `artifacts/${prefix}.png`]);
console.log(`artifacts/${prefix}.png`);
await browser.close();
