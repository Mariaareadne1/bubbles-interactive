// Close-up of a bubble (or any world point) from the app's own camera direction:
// node scripts/closeup.mjs <name> [bubbleId] [fov] [frames] [every]   (needs the dev server)
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const [name = 'close', id = 'a', fov = '9', frames = '1', every = '0.5'] = process.argv.slice(2);
mkdirSync('artifacts', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: Number(process.env.W ?? 900), height: Number(process.env.H ?? 700) }, deviceScaleFactor: Number(process.env.DPR ?? 1) });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${process.env.BUBBLES_URL ?? 'http://localhost:5398/'}?${process.env.QUERY ?? ''}`);
await page.waitForFunction(() => (window.__engine && window.__views) || (window.__bubbles && !window.__bubbles.store.get().loading), null, { timeout: 90000 });
await page.waitForTimeout(1500);
await page.evaluate(() => {
  const e = window.__engine ?? window.__bubbles.engine;
  e.stop();
  e.fixedStep = 1 / 60;
  window.__e = e;
});
for (let f = 0; f < Number(frames); f++) {
  await page.evaluate(([id, fov, every, first]) => {
    const e = window.__e;
    for (let i = 0; i < (first ? 2 : Math.round(every * 60)); i++) e.tick(1 / 60);
    const views = window.__views ?? window.__bubbles.engine.bubbles.views;
    const v = views.get(id) ?? [...views.values()][0];
    const c = v.root.position;
    const cam = e.camera;
    const off = cam.position.clone().sub(c).normalize().multiplyScalar(26);
    e.debugView({ x: c.x + off.x, y: c.y + off.y, z: c.z + off.z }, c, fov);
    e.render();
  }, [id, Number(fov), Number(every), f === 0]);
  await page.screenshot({ path: `artifacts/${name}${Number(frames) > 1 ? `-${f}` : ''}.png` });
}
console.log(`artifacts/${name}.png`);
await browser.close();
