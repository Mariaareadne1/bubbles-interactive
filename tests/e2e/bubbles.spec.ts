import { expect, test } from '@playwright/test';
import {
  advance, bubbleIds, bubbleScreen, circle, drawBubble, drawStroke, exportPixels, friendScreen, gardenIds, openGarden, pageErrors,
  setTool, snapshot, toast, toScreen,
} from './helpers';

test.describe('BUBBLES', () => {
  test('the garden renders on paper', async ({ page }) => {
    await openGarden(page, '');
    const [paper, lawn] = await exportPixels(page, [[0.02, 0.5], [0.5, 0.55]]);
    // warm paper at the edge, a pastel green lawn in the middle
    expect(paper[0]).toBeGreaterThan(215);
    expect(paper[2]).toBeLessThan(paper[0]);
    expect(lawn[1]).toBeGreaterThan(lawn[0]);
    expect(lawn[1]).toBeGreaterThan(lawn[2]);
    expect(pageErrors(page)).toEqual([]);
  });

  test('a drawn circle becomes a bubble of that size, there, with someone asleep inside — and it floats up', async ({ page }) => {
    await openGarden(page);
    const c = await toScreen(page, 0.5, 0.05, 1.5);
    const id = await drawBubble(page, c, 70);
    expect(id).not.toBeNull();
    await advance(page, 0.6); // inflated
    const s = await bubbleScreen(page, id!);
    expect(Math.abs(s!.x - c.x)).toBeLessThan(25);
    expect(Math.abs(s!.y - c.y)).toBeLessThan(35);
    expect(s!.r).toBeGreaterThan(70 * 0.75);
    expect(s!.r).toBeLessThan(70 * 1.3);
    const doc = await page.evaluate(() => window.__bubbles!.store.doc.bubbles[0]);
    expect(doc.passengers).toHaveLength(1);
    const y0 = (await snapshot(page)).bubbles[0].y;
    await advance(page, 6);
    expect((await snapshot(page)).bubbles[0].y).toBeGreaterThan(y0 + 0.3);
    expect(pageErrors(page)).toEqual([]);
  });

  test('open, tiny, squiggly and off-tile strokes are turned away gently', async ({ page }) => {
    await openGarden(page);
    const c = await toScreen(page, 0, 0.05, 1);
    await drawStroke(page, circle(c, 70).slice(0, 18));
    expect(await toast(page)).toContain('Close the circle');
    await drawStroke(page, circle(c, 9));
    expect(await toast(page)).toMatch(/bigger/);
    await drawStroke(page, [...Array(30)].map((_, i) => ({ x: 30 + (i % 2) * 4, y: 300 + i * 6 })).concat([{ x: 30, y: 300 }]));
    expect(await toast(page)).toMatch(/rounder|Close/);
    await drawStroke(page, circle({ x: 70, y: 820 }, 50));
    expect(await toast(page)).toContain('over the garden');
    expect(await bubbleIds(page)).toEqual([]);
  });

  test('tapping a bubble pops it and its passenger drifts down and lands under it', async ({ page }) => {
    await openGarden(page);
    const id = await drawBubble(page, await toScreen(page, -1, 0.05, 1), 70);
    await advance(page, 3);
    const before = (await snapshot(page)).bubbles[0];
    const s = await bubbleScreen(page, id!);
    await page.mouse.click(s!.x, s!.y);
    expect(await bubbleIds(page)).toEqual([]);
    const garden = await page.evaluate(() => window.__bubbles!.store.doc.garden);
    expect(garden).toHaveLength(1);
    expect(Math.hypot(garden[0].x - before.x, garden[0].z - before.z)).toBeLessThan(0.6);
    let snap = await snapshot(page);
    expect(snap.garden[0].mode).toBe('falling');
    await advance(page, 10);
    snap = await snapshot(page);
    expect(snap.garden[0].mode).toBe('home');
    expect(pageErrors(page)).toEqual([]);
  });

  test('Pop mode: one swipe pops every bubble it crosses', async ({ page }) => {
    await openGarden(page);
    for (const x of [-3, 0, 3]) await drawBubble(page, await toScreen(page, x, 0.05, 2.2), 55);
    expect(await bubbleIds(page)).toHaveLength(3);
    await advance(page, 0.8);
    const pts = [];
    for (const id of await bubbleIds(page)) pts.push((await bubbleScreen(page, id))!);
    await setTool(page, 'pop');
    pts.sort((a, b) => a.x - b.x);
    await page.mouse.move(pts[0].x - 80, pts[0].y);
    await page.mouse.down();
    for (const p of pts) await page.mouse.move(p.x, p.y, { steps: 8 });
    await page.mouse.move(pts[2].x + 80, pts[2].y, { steps: 4 });
    await page.mouse.up();
    expect(await bubbleIds(page)).toEqual([]);
    expect(await gardenIds(page)).toHaveLength(3);
  });

  test('two bubbles that meet slowly merge into one bigger bubble carrying both passengers', async ({ page }) => {
    await openGarden(page);
    await page.evaluate(() => {
      const d = window.__bubbles!;
      d.app.loadDoc({
        version: 1,
        garden: [],
        bubbles: [
          { id: 'ma', r: 0.6, passengers: [6], born: d.engine.now, x: -0.62, y: 2.4, z: 0.5 },
          { id: 'mb', r: 0.6, passengers: [13], born: d.engine.now, x: 0.62, y: 2.4, z: 0.5 },
        ],
      });
    });
    await advance(page, 4);
    const doc = await page.evaluate(() => window.__bubbles!.store.doc.bubbles);
    expect(doc).toHaveLength(1);
    expect([...doc[0].passengers].sort()).toEqual([13, 6]);
    expect(doc[0].r).toBeCloseTo(Math.cbrt(2 * 0.6 ** 3), 2);
  });

  test('a passenger in the garden: name, bubble up, remove, undo and redo', async ({ page }) => {
    await openGarden(page, 'showcase');
    await advance(page, 1);
    const id = (await gardenIds(page))[0];
    const p = await friendScreen(page, id);
    await page.mouse.click(p.x, p.y);
    await expect(page.locator('.creature-bar')).toBeVisible();
    await page.locator('.friend-name input').fill('Mochi');
    expect(await page.evaluate((i) => window.__bubbles!.store.doc.garden.find((g) => g.id === i)?.name, id)).toBe('Mochi');
    const bubblesBefore = (await bubbleIds(page)).length;
    await page.locator('[data-action="bubble-up"]').click();
    expect(await gardenIds(page)).not.toContain(id);
    expect(await bubbleIds(page)).toHaveLength(bubblesBefore + 1);
    const up = await page.evaluate(() => window.__bubbles!.store.doc.bubbles.at(-1));
    expect(up?.names).toEqual(['Mochi']);
    await page.keyboard.press('Meta+z');
    expect(await gardenIds(page)).toContain(id);
    await page.keyboard.press('Meta+Shift+z');
    expect(await gardenIds(page)).not.toContain(id);
    await page.keyboard.press('Meta+z');
    // select by keyboard and remove
    await page.keyboard.press('Tab');
    const sel = await page.evaluate(() => window.__bubbles!.store.get().selectedId);
    expect(sel).not.toBeNull();
    await page.keyboard.press('Delete');
    expect(await gardenIds(page)).not.toContain(sel);
    await advance(page, 1.5);
    expect(pageErrors(page)).toEqual([]);
  });

  test('a circle drawn round friends on the lawn catches them in one bubble; undo lets them go', async ({ page }) => {
    await openGarden(page);
    await page.evaluate(() => {
      window.__bubbles!.app.loadDoc({
        version: 1,
        bubbles: [],
        garden: [
          { id: 'c1', kind: 'bunny', seed: 6, x: -0.5, z: 1.6, heading: -1.5, name: 'Bun' },
          { id: 'c2', kind: 'chick', seed: 13, x: 0.5, z: 1.7, heading: -1.5 },
          { id: 'far', kind: 'star', seed: 5, x: 4, z: 2.5, heading: -1.5 },
        ],
      });
    });
    await advance(page, 0.5);
    const a = await friendScreen(page, 'c1');
    const b = await friendScreen(page, 'c2');
    const id = await drawBubble(page, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, Math.hypot(a.x - b.x, a.y - b.y) / 2 + 45);
    expect(id).not.toBeNull();
    const doc = await page.evaluate(() => window.__bubbles!.store.doc);
    expect([...doc.bubbles[0].passengers].sort()).toEqual([13, 6]);
    expect(doc.bubbles[0].names).toContain('Bun');
    expect(doc.garden.map((g) => g.id)).toEqual(['far']);
    // they rise off the lawn into it, then sleep
    await advance(page, 1.5);
    expect((await snapshot(page)).bubbles[0].passengers).toHaveLength(2);
    await page.keyboard.press('Meta+z');
    expect(await gardenIds(page)).toEqual(expect.arrayContaining(['c1', 'c2', 'far']));
    expect(await bubbleIds(page)).toEqual([]);
    expect(pageErrors(page)).toEqual([]);
  });

  test('dragging a passenger moves it', async ({ page }) => {
    await openGarden(page, 'showcase');
    await advance(page, 0.5);
    const id = (await gardenIds(page))[3];
    const p = await friendScreen(page, id);
    const to = await toScreen(page, 0.8, 0.05, 2.0);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await page.mouse.up();
    const g = await page.evaluate((i) => window.__bubbles!.store.doc.garden.find((r) => r.id === i)!, id);
    expect(Math.hypot(g.x - 0.8, g.z - 2.0)).toBeLessThan(0.6);
  });

  test('clear, undo, and the garden comes back after a reload', async ({ page }) => {
    await openGarden(page, '');
    await drawBubble(page, await toScreen(page, 0, 0.05, 2), 60);
    const n = (await page.evaluate(() => window.__bubbles!.store.doc)).bubbles.length;
    await page.evaluate(() => window.__bubbles!.app.reset());
    expect(await bubbleIds(page)).toEqual([]);
    await page.evaluate(() => window.__bubbles!.app.undo());
    expect(await bubbleIds(page)).toHaveLength(n);
    await page.waitForTimeout(400);
    const saved = await page.evaluate(() => window.__bubbles!.store.doc);
    await page.reload();
    await page.waitForFunction(() => window.__bubbles && !window.__bubbles.store.get().loading, null, { timeout: 200_000 });
    const loaded = await page.evaluate(() => window.__bubbles!.store.doc);
    expect(loaded.bubbles.map((b) => b.id)).toEqual(saved.bubbles.map((b) => b.id));
    expect(loaded.garden.map((g) => g.id)).toEqual(saved.garden.map((g) => g.id));
  });

  test('saves a PNG of the garden', async ({ page }) => {
    await openGarden(page, 'showcase');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save image' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^bubbles-.*\.png$/);
  });

  test('sixteen bubbles and twenty-four friends without errors or a collapsing frame rate', async ({ page }) => {
    await openGarden(page);
    await page.evaluate(() => {
      const d = window.__bubbles!;
      const now = d.engine.now;
      d.app.loadDoc({
        version: 1,
        bubbles: Array.from({ length: 16 }, (_, i) => ({ id: `s${i}`, r: 0.4 + (i % 4) * 0.18, passengers: [i], born: now, x: -5 + (i % 4) * 3.2, y: 1.6 + (i % 3), z: -3 + Math.floor(i / 4) * 2 })),
        garden: Array.from({ length: 24 }, (_, i) => ({ id: `f${i}`, kind: ['bunny', 'chick', 'kitten', 'flower', 'strawberry', 'star'][i % 6] as 'bunny', seed: i, x: -5.5 + (i % 6) * 2.1, z: -2.6 + Math.floor(i / 6) * 1.9, heading: -1.5 })),
      });
    });
    await advance(page, 2);
    const ms = await page.evaluate(() => {
      const d = window.__bubbles!;
      const gl = d.engine.renderer.getContext();
      const px = new Uint8Array(4);
      const t0 = performance.now();
      for (let i = 0; i < 20; i++) {
        d.engine.tick(1 / 60);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      }
      return (performance.now() - t0) / 20;
    });
    expect((await snapshot(page)).bubbles.length).toBe(16);
    expect(ms).toBeLessThan(80);
    expect(pageErrors(page)).toEqual([]);
  });

  test('reduced motion: drifting slower, pops without droplets', async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await openGarden(page);
    expect(await page.evaluate(() => window.__bubbles!.engine.reducedMotion)).toBe(true);
    const id = await drawBubble(page, await toScreen(page, 0, 0.05, 1.5), 60);
    await advance(page, 1);
    const s = await bubbleScreen(page, id!);
    await page.mouse.click(s!.x, s!.y);
    expect(await gardenIds(page)).toHaveLength(1);
    await advance(page, 10);
    expect(pageErrors(page)).toEqual([]);
    await ctx.close();
  });
});

test.describe('BUBBLES on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('touch draws a bubble and a tap pops it', async ({ page }) => {
    await openGarden(page);
    const c = await toScreen(page, 0, 0.05, 0.5);
    const pts = circle(c, 50);
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', p?: { x: number; y: number }) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p.x, y: p.y }] : [] });
    await touch('touchStart', pts[0]);
    for (const p of pts.slice(1)) await touch('touchMove', p);
    await touch('touchEnd');
    const ids = await bubbleIds(page);
    expect(ids).toHaveLength(1);
    await advance(page, 1);
    const s = await bubbleScreen(page, ids[0]);
    await page.touchscreen.tap(s!.x, s!.y);
    expect(await bubbleIds(page)).toEqual([]);
    expect(pageErrors(page)).toEqual([]);
  });
});
