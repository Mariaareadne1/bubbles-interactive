import type { Page } from '@playwright/test';

export interface Pt { x: number; y: number }

export async function openGarden(page: Page, query = 'empty'): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  (page as Page & { errors?: string[] }).errors = errors;
  await page.goto(query ? `/?${query}` : '/');
  await page.waitForFunction(() => window.__bubbles && !window.__bubbles.store.get().loading, null, { timeout: 200_000 });
  // drive time by hand: deterministic, and quick
  await page.evaluate(() => {
    const d = window.__bubbles!;
    d.engine.stop();
    d.engine.fixedStep = 1 / 60;
    d.engine.tick(1 / 60);
  });
}

export const pageErrors = (page: Page) => (page as Page & { errors?: string[] }).errors ?? [];

/** Advance the simulation by `seconds` of fixed steps. */
export async function advance(page: Page, seconds: number): Promise<void> {
  await page.evaluate((s) => {
    const d = window.__bubbles!;
    for (let i = 0; i < Math.round(s * 60); i++) d.engine.tick(1 / 60);
  }, seconds);
}

/** Where a world point is on screen (CSS px). */
export async function toScreen(page: Page, x: number, y: number, z: number): Promise<Pt> {
  return page.evaluate(([x, y, z]) => {
    const d = window.__bubbles!;
    const v = d.engine.camera.position.clone().set(x, y, z).project(d.engine.camera);
    const r = d.engine.canvas.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }, [x, y, z] as const);
}

/** A hand-drawn, slightly wobbly circle around a screen point. */
export function circle(c: Pt, r = 60, n = 40): Pt[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    const k = r * (1 + 0.04 * Math.sin(a * 3 + 1));
    return { x: c.x + Math.cos(a) * k, y: c.y + Math.sin(a) * k };
  });
}

export async function drawStroke(page: Page, pts: Pt[]): Promise<void> {
  await page.mouse.move(pts[0].x, pts[0].y);
  await page.mouse.down();
  for (const p of pts.slice(1)) await page.mouse.move(p.x, p.y, { steps: 2 });
  await page.mouse.up();
}

export const bubbleIds = (page: Page) => page.evaluate(() => window.__bubbles!.store.doc.bubbles.map((b) => b.id));
export const gardenIds = (page: Page) => page.evaluate(() => window.__bubbles!.store.doc.garden.map((g) => g.id));
export const snapshot = (page: Page) => page.evaluate(() => window.__bubbles!.engine.bubbles.snapshot());

/** Draw a bubble round a screen point; returns its id (or null). */
export async function drawBubble(page: Page, c: Pt, r = 60): Promise<string | null> {
  const before = await bubbleIds(page);
  await drawStroke(page, circle(c, r));
  const after = await bubbleIds(page);
  return after.find((id) => !before.includes(id)) ?? null;
}

/** Screen position and radius (px) of a live bubble. */
export async function bubbleScreen(page: Page, id: string): Promise<{ x: number; y: number; r: number } | null> {
  return page.evaluate((i) => {
    const d = window.__bubbles!;
    const v = d.engine.bubbles.views.get(i);
    if (!v) return null;
    const cam = d.engine.camera;
    const c = v.root.position.clone();
    const p = c.clone().project(cam);
    const right = new (c.constructor as new (x: number, y: number, z: number) => typeof c)(1, 0, 0).applyQuaternion(cam.quaternion);
    const e = c.clone().addScaledVector(right, v.radius).project(cam);
    const rect = d.engine.canvas.getBoundingClientRect();
    const sx = rect.left + ((p.x + 1) / 2) * rect.width;
    const sy = rect.top + ((1 - p.y) / 2) * rect.height;
    const ex = rect.left + ((e.x + 1) / 2) * rect.width;
    return { x: sx, y: sy, r: Math.abs(ex - sx) };
  }, id);
}

/** Screen point over a garden passenger. */
export async function friendScreen(page: Page, id: string): Promise<Pt> {
  const p = await page.evaluate((i) => {
    const s = window.__bubbles!.engine.bubbles.snapshot().garden.find((g) => g.id === i)!;
    return { x: s.x, y: s.y, z: s.z };
  }, id);
  return toScreen(page, p.x, p.y + 0.35, p.z);
}

export async function setTool(page: Page, tool: 'draw' | 'pop'): Promise<void> {
  await page.evaluate((t) => window.__bubbles!.store.set({ tool: t }), tool);
}

export async function toast(page: Page): Promise<string> {
  return (await page.locator('.toast').last().textContent()) ?? '';
}

/** Read back a PNG export's pixel at fractional (u, v). */
export async function exportPixels(page: Page, points: [number, number][]): Promise<number[][]> {
  return page.evaluate(async (pts) => {
    const blob = await window.__bubbles!.engine.capturePNG(1);
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext('2d')!;
    g.drawImage(bmp, 0, 0);
    return pts.map(([u, v]) => Array.from(g.getImageData(Math.floor(u * bmp.width), Math.floor(v * bmp.height), 1, 1).data));
  }, points);
}
