// Filmstrip: a circle drawn round three friends on the lawn scoops them into one bubble.
// node scripts/catch.mjs <prefix>   (needs the dev server)
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';

const [prefix = 'catch'] = process.argv.slice(2);
mkdirSync('artifacts', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:5398/?empty');
await page.waitForFunction(() => window.__bubbles && !window.__bubbles.store.get().loading, null, { timeout: 240000 });
const c = await page.evaluate(() => {
  const d = window.__bubbles;
  d.engine.stop();
  d.engine.fixedStep = 1 / 60;
  d.store.set({ uiHidden: true });
  d.app.loadDoc({ version: 1, bubbles: [], garden: [
    { id: 'k1', kind: 'bunny', seed: 60, x: -0.6, z: 1.7, heading: -1.3 },
    { id: 'k2', kind: 'chick', seed: 61, x: 0.4, z: 1.9, heading: -1.8 },
    { id: 'k3', kind: 'strawberry', seed: 64, x: -0.1, z: 2.5, heading: -1.6 },
  ] });
  for (let i = 0; i < 60; i++) d.engine.tick(1 / 60);
  const v = d.engine.camera.position.clone().set(-0.1, 0.4, 2.0).project(d.engine.camera);
  return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight };
});
const clip = { x: c.x - 210, y: c.y - 250, width: 420, height: 330 };
const files = [];
const snap = async () => { const f = `artifacts/${prefix}-${files.length}.png`; await page.screenshot({ path: f, clip }); files.push(f); };
// draw round them, a frame mid-stroke
await page.mouse.move(c.x + 105, c.y);
await page.mouse.down();
for (let i = 1; i <= 44; i++) {
  const a = (i / 44) * Math.PI * 2.03;
  await page.mouse.move(c.x + Math.cos(a) * 105, c.y + Math.sin(a) * 90);
  if (i === 36) await snap();
}
await page.mouse.up();
for (const dt of [0.1, 0.2, 0.25, 0.3, 0.6, 1.5]) {
  await page.evaluate((s) => { const d = window.__bubbles; for (let i = 0; i < Math.round(s * 60); i++) d.engine.tick(1 / 60); }, dt);
  await snap();
}
console.log(JSON.stringify(await page.evaluate(() => window.__bubbles.store.doc.bubbles.map((b) => b.passengers))));
const layout = files.map((_, i) => `${(i % 4) * 840}_${Math.floor(i / 4) * 660}`).join('|');
execFileSync(ffmpeg, ['-y', '-loglevel', 'error', ...files.flatMap((f) => ['-i', f]), '-filter_complex', `xstack=inputs=${files.length}:layout=${layout}:fill=white,scale=iw/2:-1`, `artifacts/${prefix}.png`]);
console.log(`artifacts/${prefix}.png`);
await browser.close();
