import * as THREE from 'three';
import type { Engine } from '../engine/Engine';
import type { Store } from '../state/store';
import {
  addBubble, bubbleUp, emptyDoc, findGarden, MAX_BUBBLES, moveGarden, newId, newSeed, popBubble, removeGarden,
  renameGarden, replaceBubbles, withPositions, type BubblesDoc,
} from '../state/document';
import { saveDoc } from '../state/persistence';
import { analyzeLoop, type Pt } from '../interaction/stroke';
import { distanceAtHeight, groundAt, raycaster, rayFromClient } from '../interaction/rays';
import { containPoint, R_MAX, R_MIN } from '../bubble/sim';

/**
 * Application commands. The UI and pointer input call these; they turn intent
 * into document edits (undoable: drawing, popping, bubbling up, removing,
 * renaming, moving) or world events the document follows without an undo
 * step (a merge, a bubble that popped by itself, where bubbles drifted to).
 */

export type StrokeResult = { ok: true; id: string } | { ok: false; message: string };

export const MESSAGES = {
  small: 'Draw a bigger circle — that one’s too small to hold anyone.',
  open: 'Close the circle — round and round, back to where you started.',
  thin: 'Draw a rounder loop — bubbles are round.',
  paper: 'Draw over the garden.',
  full: 'The air is full of bubbles — pop one first.',
} as const;

/** How far above the ground a new bubble's lowest point sits (m). */
const LIFT = 0.35;

export class BubblesApp {
  private drag: string | null = null;
  private saveTimer = 0;
  private positionTimer = 0;
  private readonly unsub: (() => void)[] = [];
  hoverId: string | null = null;
  /** Who will be asleep in the next drawn bubbles (scripted demos); random when empty. */
  readonly nextSeeds: number[] = [];

  constructor(readonly engine: Engine, readonly store: Store) {}

  get field() {
    return this.engine.bubbles;
  }

  start(): void {
    let prevDoc: BubblesDoc | null = null;
    const onChange = () => {
      const doc = this.store.doc;
      if (doc === prevDoc) return;
      prevDoc = doc;
      this.field.sync(doc);
      window.clearTimeout(this.saveTimer);
      this.saveTimer = window.setTimeout(() => saveDoc(this.store.doc), 250);
    };
    this.unsub.push(this.store.subscribe(onChange));
    onChange();
    this.field.onMerged = (gone, into) => this.store.amend(replaceBubbles(this.store.doc, gone, into));
    this.field.onExpired = (id, result) => this.store.amend(popBubble(this.store.doc, id, result.landed));
    this.field.onGardenChanged = () => this.engine.env.invalidate();
    this.field.onReady = () => this.store.set({ loading: false });
    this.field.onError = (message) => this.store.set({ fatal: `The passengers could not be made: ${message}` });
    this.field.preload();
    this.unsub.push(this.engine.onFrame((dt) => {
      this.field.setHighlight(this.store.get().selectedId, this.hoverId);
      // every couple of seconds, note where the bubbles have drifted (saved, not undoable)
      this.positionTimer += dt;
      if (this.positionTimer > 2) {
        this.positionTimer = 0;
        const next = withPositions(this.store.doc, this.field.positions());
        if (next !== this.store.doc) this.store.amend(next);
      }
    }));
  }

  get rect(): DOMRect {
    return this.engine.canvas.getBoundingClientRect();
  }

  isOnTile(clientX: number, clientY: number): boolean {
    return groundAt(this.engine.camera, this.rect, clientX, clientY).onTile;
  }

  // --- drawing ---------------------------------------------------------------------------------

  /** A finished loop: it becomes a bubble of the drawn size, where it was drawn, with someone asleep inside. */
  createFromStroke(points: readonly Pt[]): StrokeResult {
    const a = analyzeLoop(points);
    if (!a.ok) return { ok: false, message: MESSAGES[a.reason === 'short' ? 'small' : a.reason ?? 'small'] };
    if (this.store.doc.bubbles.length >= MAX_BUBBLES) return { ok: false, message: MESSAGES.full };
    const cam = this.engine.camera;
    const rect = this.rect;
    const hit = groundAt(cam, rect, a.centre.x, a.centre.y);
    if (!hit.onTile) return { ok: false, message: MESSAGES.paper };
    const ray = rayFromClient(cam, rect, a.centre.x, a.centre.y).clone();
    // the bubble sits on the line of sight through the circle's middle, just clear of the lawn,
    // at the depth where its radius on screen matches the drawn circle
    const perPx = (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2)) / rect.height;
    const radiusAt = (dist: number) => Math.min(R_MAX, Math.max(R_MIN, a.radius * perPx * dist));
    let d = hit.distance;
    for (let i = 0; i < 6; i++) {
      const t = distanceAtHeight(ray.origin, ray.direction, radiusAt(d) + LIFT, hit.distance);
      if (t === null) break;
      d = t;
    }
    const r = radiusAt(d);
    const c = ray.at(d, new THREE.Vector3());
    const [x, y, z] = containPoint(c.x, c.y, c.z, r);
    const id = newId('b');
    this.field.expectFresh(id);
    const round = (v: number) => Math.round(v * 1000) / 1000;
    this.store.commit(
      addBubble(this.store.doc, { id, r: round(r), passengers: [this.nextSeeds.shift() ?? newSeed()], born: Math.round(this.engine.now), x: round(x), y: round(y), z: round(z) }),
      { hasDrawn: true, selectedId: null },
    );
    return { ok: true, id };
  }

  // --- popping ---------------------------------------------------------------------------------

  /** The bubble under a screen point, and where on its film. */
  bubbleAt(clientX: number, clientY: number): { id: string; point: THREE.Vector3 } | null {
    return this.field.pickBubble(rayFromClient(this.engine.camera, this.rect, clientX, clientY).clone());
  }

  /** Pop whatever bubble is under the point. Returns its id. */
  popAt(clientX: number, clientY: number): string | null {
    const hit = this.bubbleAt(clientX, clientY);
    if (!hit) return null;
    return this.pop(hit.id, hit.point) ? hit.id : null;
  }

  pop(id: string, at: THREE.Vector3 | null = null): boolean {
    const result = this.field.pop(id, at);
    if (!result) return false;
    this.store.commit(popBubble(this.store.doc, id, result.landed), { hasDrawn: true });
    return true;
  }

  // --- garden passengers ---------------------------------------------------------------------

  pickAt(clientX: number, clientY: number): string | null {
    rayFromClient(this.engine.camera, this.rect, clientX, clientY);
    return this.field.pickGarden(raycaster);
  }

  select(id: string | null): void {
    if (this.store.get().selectedId !== id) this.store.set({ selectedId: id });
  }

  beginDrag(id: string): void {
    this.drag = id;
  }

  /** Returns false when the pointer is somewhere it can't go. */
  dragTo(clientX: number, clientY: number): boolean {
    if (!this.drag) return false;
    const hit = groundAt(this.engine.camera, this.rect, clientX, clientY);
    if (!hit.onTile) return false;
    const spot = this.field.hold(this.drag, hit.point.x, hit.point.z);
    return !!spot && Math.hypot(spot[0] - hit.point.x, spot[1] - hit.point.z) < 0.4;
  }

  endDrag(): void {
    const id = this.drag;
    this.drag = null;
    if (!id) return;
    const spot = this.field.release(id);
    if (spot) this.store.commit(moveGarden(this.store.doc, id, Math.round(spot[0] * 1000) / 1000, Math.round(spot[1] * 1000) / 1000));
  }

  get dragging(): boolean {
    return this.drag !== null;
  }

  /** A bubble forms round the selected passenger and it floats back up, asleep. */
  bubbleUp(id = this.store.get().selectedId): void {
    if (!id || !findGarden(this.store.doc, id)) return;
    if (this.store.doc.bubbles.length >= MAX_BUBBLES) {
      this.store.toast(MESSAGES.full);
      return;
    }
    const rec = this.field.bubbleUp(id);
    if (!rec) return;
    this.store.commit(bubbleUp(this.store.doc, id, rec), { selectedId: null });
  }

  remove(id = this.store.get().selectedId): void {
    if (!id || !findGarden(this.store.doc, id)) return;
    this.store.commit(removeGarden(this.store.doc, id), { selectedId: null });
  }

  rename(id: string, name: string): void {
    const next = renameGarden(this.store.doc, id, name);
    if (next === this.store.doc) return;
    // a burst of typing is one undo step
    const now = performance.now();
    if (this.lastRename.id === id && now - this.lastRename.at < 1500) this.store.amend(next);
    else this.store.commit(next);
    this.lastRename = { id, at: now };
  }

  private lastRename = { id: '', at: 0 };

  reset(): void {
    const d = this.store.doc;
    if (d.bubbles.length === 0 && d.garden.length === 0) return;
    this.store.commit(emptyDoc(), { selectedId: null });
    this.store.toast('The garden is quiet. Undo brings everyone back.');
  }

  loadDoc(doc: BubblesDoc): void {
    this.store.commit(doc, { selectedId: null });
  }

  undo(): void {
    this.store.undo();
  }

  redo(): void {
    this.store.redo();
  }

  dispose(): void {
    window.clearTimeout(this.saveTimer);
    for (const u of this.unsub) u();
  }
}
