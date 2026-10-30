// The six passengers awake in the garden from four angles, and asleep in their bubbles:
// node scripts/passengers.mjs <prefix>   ->  artifacts/<prefix>.png (a 6 × 5 sheet)   (needs the dev server)
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';

const [prefix = 'pass'] = process.argv.slice(2);
const KINDS = ['bunny', 'chick', 'kitten', 'flower', 'strawberry', 'star'];
const S = 300;
mkdirSync('artifacts', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: S, height: S } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:5398/?empty');
await page.waitForFunction(() => window.__bubbles && !window.__bubbles.store.get().loading, null, { timeout: 200000 });
await page.evaluate((kinds) => {
  const d = window.__bubbles;
  d.engine.stop();
  d.engine.fixedStep = 1 / 60;
  d.store.set({ uiHidden: true });
  d.app.loadDoc({
    version: 1,
    garden: kinds.map((kind, i) => ({ id: `p${i}`, kind, seed: i + 6 * 9, x: -4.5 + i * 1.8, z: 2.2, heading: -Math.PI / 2 })),
    bubbles: [],
  });
  for (let i = 0; i < 90; i++) d.engine.tick(1 / 60);
}, KINDS);
const files = [];
const shot = async (target, yaw, dist, fov, tick) => {
  await page.evaluate(([target, yaw, dist, fov, tick]) => {
    const d = window.__bubbles;
    for (let i = 0; i < tick; i++) d.engine.tick(1 / 60);
    let c;
    if (target.startsWith('q')) c = d.engine.bubbles.views.get(target).root.position.clone();
    else { const s = d.engine.bubbles.snapshot().garden.find((g) => g.id === target); c = d.engine.camera.position.clone().set(s.x, s.y + 0.4, s.z); }
    const el = 0.5;
    d.engine.debugView({ x: c.x + Math.sin(yaw) * Math.cos(el) * dist, y: c.y + Math.sin(el) * dist, z: c.z + Math.cos(yaw) * Math.cos(el) * dist }, c, fov);
    d.engine.render();
  }, [target, yaw, dist, fov, tick]);
  const f = `artifacts/${prefix}-${files.length}.png`;
  await page.screenshot({ path: f });
  files.push(f);
};
for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) for (let i = 0; i < 6; i++) await shot(`p${i}`, yaw, 8, 12, i === 0 ? 20 : 0);
// asleep: now the bubbles, away from the friends on the lawn
await page.evaluate((kinds) => {
  const d = window.__bubbles;
  d.app.loadDoc({ version: 1, garden: [], bubbles: kinds.map((_, i) => ({ id: `q${i}`, r: 0.7, passengers: [i + 6 * 9], born: d.engine.now, x: -4.5 + i * 1.8, y: 2.4, z: 1.0 })) });
  for (let i = 0; i < 60; i++) d.engine.tick(1 / 60);
}, KINDS);
for (let i = 0; i < 6; i++) await shot(`q${i}`, 0, 12, 12, 0);
const layout = files.map((_, i) => `${(i % 6) * S}_${Math.floor(i / 6) * S}`).join('|');
execFileSync(ffmpeg, ['-y', '-loglevel', 'error', ...files.flatMap((f) => ['-i', f]), '-filter_complex', `xstack=inputs=${files.length}:layout=${layout}`, `artifacts/${prefix}.png`]);
console.log(`artifacts/${prefix}.png`);
await browser.close();
