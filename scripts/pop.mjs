// Frame-by-frame look at a pop, close up, then the fall and landing:
// node scripts/pop.mjs <prefix> [kind seed] [fov] [frames: comma list of seconds after the pop]   (needs the dev server)
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';

const [prefix = 'pop', seed = '0', fov = '9', times = '-0.2,0,0.03,0.06,0.09,0.12,0.15,0.3,0.7,1.5,3,6'] = process.argv.slice(2);
mkdirSync('artifacts', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 520, height: 420 }, deviceScaleFactor: Number(process.env.DPR ?? 1) });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${process.env.BUBBLES_URL ?? 'http://localhost:5398/'}?empty`);
await page.waitForFunction(() => window.__bubbles && !window.__bubbles.store.get().loading, null, { timeout: 120000 });
await page.evaluate((seed) => {
  const d = window.__bubbles;
  d.engine.stop();
  d.engine.fixedStep = 1 / 60;
  d.app.loadDoc({ version: 1, garden: [], bubbles: [{ id: 'popme', r: 0.8, passengers: [Number(seed)], born: d.engine.now, x: 0.4, y: 2.2, z: 1.2 }] });
  for (let i = 0; i < 120; i++) d.engine.tick(1 / 60);
  window.__look = (fov, follow) => {
    const e = d.engine;
    const v = e.bubbles.views.get('popme');
    if (v) window.__c = v.root.position.clone();
    const c = window.__c.clone();
    if (follow) c.y = Math.max(0.4, c.y - follow);
    const off = e.camera.position.clone().sub(c).normalize().multiplyScalar(26);
    e.debugView({ x: c.x + off.x, y: c.y + off.y, z: c.z + off.z }, c, fov);
    e.render();
  };
}, seed);
const files = [];
let t = -0.2;
let popped = false;
for (const s of times.split(',').map(Number)) {
  await page.evaluate(([dt, doPop]) => {
    const d = window.__bubbles;
    for (let i = 0; i < Math.round(dt * 60); i++) d.engine.tick(1 / 60);
    if (doPop) {
      const v = d.engine.bubbles.views.get('popme');
      const p = v.root.position.clone();
      p.x -= v.radius * 0.5; p.y += v.radius * 0.6; p.z += v.radius * 0.6;
      d.app.pop('popme', p);
    }
  }, [Math.max(0, s - t), !popped && s >= 0]);
  if (s >= 0) popped = true;
  t = s;
  await page.evaluate(([fov, s]) => window.__look(fov, s > 0.5 ? Math.min(1.8, (s - 0.5) * 0.5) : 0), [Number(fov) * (s > 0.5 ? 1.6 : 1), s]);
  const f = `artifacts/${prefix}-${files.length}.png`;
  await page.screenshot({ path: f });
  files.push(f);
}
const cols = 4;
const layout = files.map((_, i) => `${(i % cols) * 520}_${Math.floor(i / cols) * 420}`).join('|');
execFileSync(ffmpeg, ['-y', '-loglevel', 'error', ...files.flatMap((f) => ['-i', f]), '-filter_complex', `xstack=inputs=${files.length}:layout=${layout}`, `artifacts/${prefix}.png`]);
console.log(`artifacts/${prefix}.png`, JSON.stringify(await page.evaluate(() => window.__bubbles.engine.bubbles.snapshot().garden)));
await browser.close();
