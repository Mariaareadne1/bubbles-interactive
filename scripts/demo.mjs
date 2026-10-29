// Scripted ~19 s demo, recorded by the app's own compositing recorder (pen line included):
// a quiet garden -> a big bubble with a sleeping bunny -> two small ones drift together and merge ->
// pop the bunny's bubble, it floats down on a petal and hops off -> three more, swipe-popped in Pop mode ->
// the merged one pops too -> a garden full of little friends.
// node scripts/demo.mjs [width] [height]  ->  artifacts/bubbles-demo.(mp4|webm)
import { chromium } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';

const [W = '1600', H = '900'] = process.argv.slice(2);
const w = Number(W), h = Number(H);
mkdirSync('artifacts', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: w, height: h } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:5398/?empty');
await page.evaluate(() => localStorage.clear());
await page.waitForFunction(() => window.__bubbles && !window.__bubbles.store.get().loading, null, { timeout: 120000 });
const sleep = (ms) => page.waitForTimeout(ms);
const screen = (x, y, z) => page.evaluate(([x, y, z]) => {
  const p = window.__bubbles, v = p.engine.camera.position.clone().set(x, y, z).project(p.engine.camera);
  return [((v.x + 1) / 2) * innerWidth, ((1 - v.y) / 2) * innerHeight];
}, [x, y, z]);
const k = h / 900; // drawings scale with the viewport
// seeds by kind: seed % 6 -> bunny, chick, kitten, flower, strawberry, star
const seed = (kind, n) => ['bunny', 'chick', 'kitten', 'flower', 'strawberry', 'star'].indexOf(kind) + 6 * (n + 11);

const circle = (cx, cy, r, n = 34) => Array.from({ length: n + 1 }, (_, i) => {
  const a = -Math.PI / 2 + (i / n) * Math.PI * 2.04;
  const kk = r * (1 + 0.05 * Math.sin(a * 3 + 1) + 0.02 * Math.sin(a * 7));
  return [cx + Math.cos(a) * kk, cy + Math.sin(a) * kk * 0.97];
});
async function trace(pts, ms) {
  await page.mouse.move(...pts[0]);
  await page.mouse.down();
  for (const p of pts.slice(1)) {
    await page.mouse.move(...p);
    await sleep(ms / pts.length);
  }
  await page.mouse.up();
}
const bubbleAt = (id) => page.evaluate((id) => {
  const p = window.__bubbles, v = p.engine.bubbles.views.get(id);
  if (!v) return null;
  const q = v.root.position.clone().project(p.engine.camera);
  return [((q.x + 1) / 2) * innerWidth, ((1 - q.y) / 2) * innerHeight];
}, id);
const lastBubble = () => page.evaluate(() => window.__bubbles.store.doc.bubbles.at(-1)?.id);

// a few friends are already about, quietly
await page.evaluate((s) => {
  const p = window.__bubbles;
  p.app.loadDoc({ version: 1, bubbles: [], garden: [
    { id: 'd1', kind: 'flower', seed: s[0], x: -3.0, z: 1.2, heading: -1.3 },
    { id: 'd2', kind: 'strawberry', seed: s[1], x: 3.7, z: 1.0, heading: -1.9 },
    { id: 'd3', kind: 'chick', seed: s[2], x: 0.9, z: 3.2, heading: -1.6 },
  ] });
  p.store.set({ uiHidden: true, hasDrawn: true });
  p.engine.adaptive = false;
  window.__demoDone = new Promise((r) => (window.__finishDemo = r));
  window.__demo = import('/src/capture/recorder.ts').then(({ recordCanvas }) =>
    recordCanvas(p.engine.canvas, { seconds: 40, ink: document.querySelector('svg.ink'), until: window.__demoDone }),
  );
}, [seed('flower', 1), seed('strawberry', 2), seed('chick', 3)]);
await sleep(1200);

// a big bubble, a sleeping bunny inside
await page.evaluate((s) => window.__bubbles.app.nextSeeds.push(s), seed('bunny', 4));
let [x, y] = await screen(-1.2, 0.05, 1.4);
await trace(circle(x, y, 96 * k), 1100);
const bunnyBubble = await lastBubble();
await sleep(1500);

// two small ones, side by side: they drift together and become one
await page.evaluate((s) => window.__bubbles.app.nextSeeds.push(...s), [seed('kitten', 5), seed('star', 6)]);
[x, y] = await screen(2.6, 0.05, 1.2);
await trace(circle(x - 40 * k, y, 40 * k, 26), 650);
await trace(circle(x + 40 * k, y + 4 * k, 38 * k, 26), 650);
await sleep(2200);

// pop the bunny's bubble: it wakes and floats down on a petal
let p = await bubbleAt(bunnyBubble);
if (p) await page.mouse.click(p[0] - 30 * k, p[1] - 30 * k);
await sleep(2400);

// three more, quickly, in a row along the front
await page.evaluate((s) => window.__bubbles.app.nextSeeds.push(...s), [seed('chick', 7), seed('flower', 8), seed('bunny', 9)]);
const row = [];
for (const wx of [-3.6, -1.0, 1.6]) {
  [x, y] = await screen(wx, 0.05, 3.3);
  await trace(circle(x, y, 44 * k, 26), 450);
  row.push(await lastBubble());
}
await sleep(900);
// Pop mode: one swipe pops all three
await page.evaluate(() => window.__bubbles.store.set({ tool: 'pop' }));
const pts = [];
for (const id of row) { const q = await bubbleAt(id); if (q) pts.push(q); }
if (pts.length) {
  pts.sort((a, b) => a[0] - b[0]);
  await page.mouse.move(pts[0][0] - 90 * k, pts[0][1] + 10 * k);
  await page.mouse.down();
  for (const q of pts) await page.mouse.move(q[0], q[1], { steps: 7 });
  await page.mouse.move(pts.at(-1)[0] + 90 * k, pts.at(-1)[1] - 10 * k, { steps: 4 });
  await page.mouse.up();
}
await sleep(1700);
// and the merged one, with both inside
const merged = await page.evaluate(() => window.__bubbles.store.doc.bubbles.find((b) => b.passengers.length > 1)?.id ?? window.__bubbles.store.doc.bubbles.at(-1)?.id);
p = merged ? await bubbleAt(merged) : null;
if (p) await page.mouse.click(p[0], p[1]);
await sleep(4200); // a garden full of little friends
await page.evaluate(() => window.__finishDemo());
const out = await page.evaluate(async () => {
  const rec = await window.__demo;
  const buf = new Uint8Array(await rec.blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { b64: btoa(bin), ext: rec.extension, ms: rec.durationMs, type: rec.type, doc: window.__bubbles.store.doc };
});
const file = `artifacts/bubbles-demo.${out.ext}`;
writeFileSync(file, Buffer.from(out.b64, 'base64'));
console.log(file, out.type, (out.ms / 1000).toFixed(1), 's', `garden ${out.doc.garden.length}, air ${out.doc.bubbles.length}`);
await browser.close();
