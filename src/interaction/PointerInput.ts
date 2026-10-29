import type { BubblesApp } from '../app/BubblesApp';
import { DrawingOverlay } from './DrawingOverlay';
import { analyzeLoop, smooth, type Pt } from './stroke';

/**
 * One pointer state machine for mouse, pen and touch:
 *   press a passenger -> select; move past a few pixels -> carry it
 *   press a bubble    -> a tap pops it; in Draw, moving on turns it into a loop
 *   press the garden  -> draw a loop (Draw tool) — or, with Pop, swipe across
 *                        bubbles and pop every one the pointer touches
 * A second finger, pointercancel or Escape abandons a gesture cleanly.
 */

type Gesture =
  | { kind: 'none' }
  | { kind: 'press-char'; id: string; x: number; y: number; pointerId: number }
  | { kind: 'drag'; id: string; pointerId: number }
  | { kind: 'press-bubble'; id: string; x: number; y: number; points: Pt[]; pointerId: number }
  | { kind: 'stroke'; points: Pt[]; pointerId: number }
  | { kind: 'swipe'; popped: number; last: Pt; pointerId: number };

const DRAG_THRESHOLD = 6;

export class PointerInput {
  private gesture: Gesture = { kind: 'none' };
  readonly overlay: DrawingOverlay;
  private readonly activePointers = new Set<number>();
  private hoverRaf = 0;
  lastHover: Pt | null = null;
  /** Feedback hook (toasts) for rejected strokes. */
  onMessage: ((text: string) => void) | null = null;

  constructor(private readonly el: HTMLElement, private readonly app: BubblesApp) {
    this.overlay = new DrawingOverlay(el);
    el.addEventListener('pointerdown', this.down);
    el.addEventListener('pointermove', this.move);
    el.addEventListener('pointerup', this.up);
    el.addEventListener('pointercancel', this.cancel);
    el.addEventListener('lostpointercapture', this.lost);
    el.addEventListener('contextmenu', this.noMenu);
  }

  get isDrawing(): boolean {
    return this.gesture.kind === 'stroke';
  }

  /** Only the canvas itself is drawable; the interface floats above it. */
  private onCanvas(e: Event): boolean {
    return (e.target as Element | null)?.tagName === 'CANVAS';
  }

  private down = (e: PointerEvent) => {
    if (!this.onCanvas(e)) return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    this.activePointers.add(e.pointerId);
    if (this.activePointers.size > 1) {
      this.abort(); // pinch / two-finger: not ours
      return;
    }
    e.preventDefault();
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      // the pointer is already gone (or synthetic); events still arrive on the element
    }
    const p = { x: e.clientX, y: e.clientY };
    const tool = this.app.store.get().tool;
    if (tool === 'pop') {
      // swipe-popping: everything the pointer touches goes
      this.app.select(null);
      const popped = this.app.popAt(p.x, p.y) ? 1 : 0;
      this.gesture = { kind: 'swipe', popped, last: p, pointerId: e.pointerId };
      this.overlay.mark(p.x, p.y);
      return;
    }
    const bubble = this.app.bubbleAt(p.x, p.y);
    const char = this.app.pickAt(p.x, p.y);
    if (char && !bubble) {
      this.app.select(char);
      this.gesture = { kind: 'press-char', id: char, x: p.x, y: p.y, pointerId: e.pointerId };
      this.setCursor('grabbing');
      return;
    }
    this.app.select(null);
    if (bubble) {
      this.gesture = { kind: 'press-bubble', id: bubble.id, x: p.x, y: p.y, points: [p], pointerId: e.pointerId };
      return;
    }
    this.gesture = { kind: 'stroke', points: [p], pointerId: e.pointerId };
    this.overlay.begin();
  };

  private move = (e: PointerEvent) => {
    const g = this.gesture;
    if (g.kind === 'none') {
      if (!this.onCanvas(e)) return;
      this.lastHover = { x: e.clientX, y: e.clientY };
      if (!this.hoverRaf) this.hoverRaf = requestAnimationFrame(this.hover);
      return;
    }
    if (g.pointerId !== e.pointerId) return;
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    const pts = (events.length ? events : [e]).map((c) => ({ x: c.clientX, y: c.clientY }));
    if (g.kind === 'press-char') {
      if (Math.hypot(e.clientX - g.x, e.clientY - g.y) > DRAG_THRESHOLD) {
        this.app.beginDrag(g.id);
        this.gesture = { kind: 'drag', id: g.id, pointerId: g.pointerId };
        this.app.dragTo(e.clientX, e.clientY);
      }
      return;
    }
    if (g.kind === 'drag') {
      const ok = this.app.dragTo(e.clientX, e.clientY);
      this.setCursor(ok ? 'grabbing' : 'not-allowed');
      return;
    }
    if (g.kind === 'swipe') {
      // sample along the motion so a quick flick still catches small bubbles
      for (const p of pts) {
        const steps = Math.max(1, Math.ceil(Math.hypot(p.x - g.last.x, p.y - g.last.y) / 8));
        for (let i = 1; i <= steps; i++) {
          const x = g.last.x + ((p.x - g.last.x) * i) / steps;
          const y = g.last.y + ((p.y - g.last.y) * i) / steps;
          if (this.app.popAt(x, y)) {
            g.popped++;
            this.overlay.mark(x, y);
          }
        }
        g.last = p;
      }
      return;
    }
    if (g.kind === 'press-bubble') {
      g.points.push(...pts);
      if (Math.hypot(e.clientX - g.x, e.clientY - g.y) > DRAG_THRESHOLD * 2) {
        // not a tap after all: it's the start of a loop drawn over the bubble
        this.gesture = { kind: 'stroke', points: g.points, pointerId: g.pointerId };
        this.overlay.begin();
        this.overlay.update(smooth(g.points, 1), false);
      }
      return;
    }
    g.points.push(...pts);
    const a = analyzeLoop(g.points);
    this.overlay.update(smooth(g.points, 1), a.closed && a.length > 60);
  };

  private up = (e: PointerEvent) => {
    this.activePointers.delete(e.pointerId);
    const g = this.gesture;
    if (g.kind === 'none' || g.pointerId !== e.pointerId) return;
    this.gesture = { kind: 'none' };
    if (g.kind === 'drag') this.app.endDrag();
    else if (g.kind === 'press-bubble') this.app.popAt(g.x, g.y);
    else if (g.kind === 'stroke') this.finishStroke(g.points);
    this.updateHover(e.clientX, e.clientY);
  };

  private finishStroke(points: Pt[]): void {
    const a = analyzeLoop(points);
    if (a.length < 6) {
      // a tap on the garden: just clears the selection
      this.overlay.settle(false);
      return;
    }
    const result = this.app.createFromStroke(points);
    this.overlay.settle(result.ok);
    if (!result.ok) this.onMessage?.(result.message);
  }

  private cancel = (e: PointerEvent) => {
    this.activePointers.delete(e.pointerId);
    this.abort();
  };

  private lost = (e: PointerEvent) => {
    const g = this.gesture;
    if (g.kind !== 'none' && g.pointerId === e.pointerId && !this.activePointers.has(e.pointerId)) this.abort();
  };

  /** Abandon whatever is in progress without creating anything. */
  abort(): void {
    const g = this.gesture;
    this.gesture = { kind: 'none' };
    if (g.kind === 'stroke') this.overlay.cancelLive();
    if (g.kind === 'drag') this.app.endDrag();
  }

  private noMenu = (e: Event) => e.preventDefault();

  private hover = () => {
    this.hoverRaf = 0;
    if (this.lastHover) this.updateHover(this.lastHover.x, this.lastHover.y);
  };

  private updateHover(x: number, y: number): void {
    const tool = this.app.store.get().tool;
    const bubble = this.app.bubbleAt(x, y);
    const id = bubble ? null : this.app.pickAt(x, y);
    this.app.hoverId = id;
    if (tool === 'pop') this.setCursor(bubble ? 'pop' : 'pin');
    else if (bubble) this.setCursor('pop');
    else if (id) this.setCursor('grab');
    else if (this.app.isOnTile(x, y)) this.setCursor('draw');
    else this.setCursor('default');
  }

  private setCursor(c: 'grab' | 'grabbing' | 'draw' | 'pop' | 'pin' | 'default' | 'not-allowed'): void {
    this.el.dataset.cursor = c;
  }

  dispose(): void {
    cancelAnimationFrame(this.hoverRaf);
    this.el.removeEventListener('pointerdown', this.down);
    this.el.removeEventListener('pointermove', this.move);
    this.el.removeEventListener('pointerup', this.up);
    this.el.removeEventListener('pointercancel', this.cancel);
    this.el.removeEventListener('lostpointercapture', this.lost);
    this.el.removeEventListener('contextmenu', this.noMenu);
    this.overlay.dispose();
  }
}
