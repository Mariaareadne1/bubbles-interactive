import * as THREE from 'three';
import { BubbleSim, containPoint, idHash, INFLATE, lifeFor, type SimBubble, type SimEvent } from './sim';
import { BubbleView } from './BubbleView';
import { CharView, heightOf } from '../char/CharView';
import { loadShapes, type ShapeSet } from '../char/cache';
import { asleepPose, fallPose, gardenPose, landingTime, leavePose, LEAVE_TIME, restPose, type Pose } from '../char/behaviors';
import type { Kind } from '../char/shapes';
import { groundHeight, isOpenGround, nearestOpen } from '../scene/garden';
import { MAX_BUBBLE_SHADOWS, type WorldUniforms } from '../scene/world';
import type { GardenLife } from '../scene/life';
import { kindOf, newId, type BubbleRecord, type BubblesDoc, type GardenRecord } from '../state/document';

/**
 * Everything alive above and on the garden: the float simulation, a view for
 * every bubble (with whoever is asleep inside), the painted shadows, and the
 * passengers in the garden — falling under their petals, at home doing their
 * little things, being carried, or waving goodbye. The document says *what*
 * exists; this keeps it moving and tells the app when the world changes it
 * (a merge, a bubble popping by itself).
 */

/** World metres per local unit for passengers on the ground. */
export const CHAR_SCALE = 1.9;

interface Rider {
  view: CharView;
  seed: number;
  name: string;
}

interface LiveBubble {
  view: BubbleView;
  riders: Rider[];
}

type GardenMode =
  | { kind: 'falling'; t0: number; height: number; fromScale: number; x: number; z: number }
  | { kind: 'home'; t0: number }
  | { kind: 'held'; t0: number }
  | { kind: 'leaving'; t0: number };

interface LiveGarden {
  rec: GardenRecord;
  view: CharView;
  mode: GardenMode;
  x: number;
  z: number;
}

/** What a pop hands the app to commit. */
export interface PopResult {
  landed: GardenRecord[];
}

export interface Snapshot {
  bubbles: { id: string; x: number; y: number; z: number; r: number; inflate: number; passengers: number[]; popping: boolean }[];
  garden: { id: string; kind: Kind; mode: GardenMode['kind']; x: number; y: number; z: number }[];
  time: number;
}

const tmp = new THREE.Vector3();

export class BubbleField {
  readonly group = new THREE.Group();
  /** The bubbles and their riders: hidden from the reflection capture. */
  readonly air = new THREE.Group();
  readonly sim: BubbleSim;
  readonly views = new Map<string, BubbleView>();
  private readonly live = new Map<string, LiveBubble>();
  private readonly dying: LiveBubble[] = [];
  private readonly garden = new Map<string, LiveGarden>();
  private readonly fresh = new Set<string>();
  /** Riders already falling from a pop, waiting for their garden records. */
  private readonly pendingFalls = new Map<string, { view: CharView; mode: GardenMode }>();
  /** Garden passengers that were wrapped in a new bubble (they ride up rather than wave goodbye). */
  private readonly lifting = new Map<string, Rider>();
  private shapes: ShapeSet | null = null;
  private doc: BubblesDoc | null = null;
  private selected: string | null = null;
  private hovered: string | null = null;
  onMerged: ((gone: [string, string], into: BubbleRecord) => void) | null = null;
  onExpired: ((id: string, result: PopResult) => void) | null = null;
  onReady: (() => void) | null = null;
  onError: ((message: string) => void) | null = null;
  /** The garden changed enough to refresh the reflections. */
  onGardenChanged: (() => void) | null = null;

  constructor(
    private readonly world: WorldUniforms,
    private readonly life: GardenLife,
    private readonly clock: { now: number },
    readonly reducedMotion: boolean,
  ) {
    this.group.name = 'bubbles';
    this.group.add(this.air);
    this.sim = new BubbleSim({ motion: reducedMotion ? 0.45 : 1 });
  }

  env: THREE.CubeTexture | null = null;

  get ready(): boolean {
    return this.shapes !== null;
  }

  get time(): number {
    return this.sim.time;
  }

  preload(): void {
    loadShapes()
      .then((s) => {
        this.shapes = s;
        if (this.doc) this.sync(this.doc);
        this.onReady?.();
      })
      .catch((e: unknown) => this.onError?.(e instanceof Error ? e.message : String(e)));
  }

  /** The next bubble with this id was just drawn: inflate it from nothing. */
  expectFresh(id: string): void {
    this.fresh.add(id);
  }

  // --- document → live ------------------------------------------------------------------------

  sync(doc: BubblesDoc): void {
    this.doc = doc;
    if (!this.shapes) return;
    const wanted = new Set(doc.bubbles.map((b) => b.id));
    for (const [id, lb] of [...this.live]) {
      if (wanted.has(id)) continue;
      // gone from the document (undo, clear, bubbled-up undo): deflate quietly
      this.sim.remove(id);
      this.live.delete(id);
      this.views.delete(id);
      lb.view.shrink();
      this.dying.push(lb);
    }
    for (const rec of doc.bubbles) {
      if (this.live.has(rec.id)) continue;
      this.createBubble(rec);
    }

    const keep = new Set(doc.garden.map((g) => g.id));
    let changed = false;
    for (const [id, g] of [...this.garden]) {
      if (keep.has(id)) {
        g.rec = doc.garden.find((r) => r.id === id)!;
        if (g.mode.kind === 'home' && (Math.abs(g.rec.x - g.x) > 1e-3 || Math.abs(g.rec.z - g.z) > 1e-3)) {
          g.x = g.rec.x;
          g.z = g.rec.z;
          g.mode = { kind: 'home', t0: this.time };
        }
        continue;
      }
      changed = true;
      const rider = this.lifting.get(id);
      if (rider) {
        // it is riding up in a new bubble: the view moved there already
        this.garden.delete(id);
        continue;
      }
      if (g.mode.kind !== 'leaving') g.mode = { kind: 'leaving', t0: this.time };
    }
    this.lifting.clear();
    for (const rec of doc.garden) {
      if (this.garden.has(rec.id)) continue;
      changed = true;
      const pending = this.pendingFalls.get(rec.id);
      this.pendingFalls.delete(rec.id);
      const view = pending?.view ?? this.makeChar(rec.id, rec.kind, rec.seed);
      view.setInBubble(0);
      view.setFade(1);
      if (!pending) {
        view.root.scale.setScalar(CHAR_SCALE);
        this.group.add(view.root);
      }
      this.garden.set(rec.id, { rec, view, mode: pending?.mode ?? { kind: 'home', t0: this.time - 2 }, x: rec.x, z: rec.z });
    }
    if (changed) this.onGardenChanged?.();
  }

  private makeChar(id: string, kind: Kind, seed: number): CharView {
    const s = this.shapes!;
    return new CharView(id, kind, seed, s[kind], s.props, this.world);
  }

  private createBubble(rec: BubbleRecord): void {
    const seed = idHash(rec.id);
    const fresh = this.fresh.delete(rec.id);
    const [x, y, z] = containPoint(rec.x, rec.y, rec.z, rec.r);
    const life = lifeFor(seed);
    let age = Math.max(0, (this.clock.now - rec.born) / 1000);
    // reloaded long after it was blown: it pops by itself a few seconds in, not all at once
    if (age > life - 4) age = life - 4 - seed * 10;
    const sb: SimBubble = {
      id: rec.id, x, y, z, vx: 0, vy: 0, vz: 0, r: rec.r, age, life, seed,
      passengers: [...rec.passengers], names: rec.passengers.map((_, i) => rec.names?.[i] ?? ''),
      modes: [], inflate: fresh ? 0 : 1,
    };
    this.sim.add(sb);
    if (fresh) {
      // a wobble-pop into shape: a squash and a pear, ringing down
      this.sim.strike(sb, 0, 1, 0, 0.14, 2);
      this.sim.strike(sb, 0.6, 0.3, 0.7, 0.06, 3);
    }
    const view = new BubbleView(rec.id, seed, this.world, this.env);
    this.views.set(rec.id, view);
    const riders: Rider[] = rec.passengers.map((p, i) => {
      const lifted = [...this.lifting.values()].find((r) => r.seed === p);
      const rider = lifted ?? { view: this.makeChar(`${rec.id}-${i}`, kindOf(p), p), seed: p, name: rec.names?.[i] ?? '' };
      rider.view.setFade(1);
      view.inside.add(rider.view.root);
      return rider;
    });
    this.live.set(rec.id, { view, riders });
    this.air.add(view.root);
    view.apply(sb, this.sim.time, this.reducedMotion, 1);
  }

  // --- the frame -------------------------------------------------------------------------------

  update(dt: number, camera: THREE.Camera): void {
    const events = this.sim.advance(dt);
    for (const e of events) this.handle(e);
    const t = this.sim.time;

    for (const [id, lb] of this.live) {
      const b = this.sim.bubbles.get(id);
      if (!b) continue;
      lb.view.apply(b, t, this.reducedMotion, dt);
      this.placeRiders(lb, b, t);
    }
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const d = this.dying[i];
      if (d.view.tick(dt)) {
        for (const r of d.riders) if (r.view.root.parent === d.view.inside) r.view.dispose();
        d.view.dispose();
        this.dying.splice(i, 1);
      }
    }

    // back to front among bubbles, each with its three passes
    const order = [...this.live.values(), ...this.dying].map((lb) => lb.view);
    order.sort((a, b) => b.root.position.distanceToSquared(camera.position) - a.root.position.distanceToSquared(camera.position));
    order.forEach((v, i) => v.setOrder(i));

    // painted shadows for whatever is in the air
    const sh = this.world.uBubbles.value;
    const fade = this.world.uBubbleFade.value;
    for (let i = 0; i < MAX_BUBBLE_SHADOWS; i++) {
      const v = order[i];
      if (!v) {
        sh[i].w = 0;
        continue;
      }
      sh[i].set(v.root.position.x, v.root.position.y, v.root.position.z, v.radius);
      fade[i] = v.popping !== null ? Math.max(0, 1 - v.popping / 0.15) : v.shrinking !== null ? 0 : 1;
    }

    for (const [id, g] of [...this.garden]) this.updateGarden(id, g, t);
    for (const g of this.garden.values()) {
      const h = g.rec.id === this.selected ? 1 : g.rec.id === this.hovered ? 0.45 : 0;
      g.view.setHighlight(h);
    }
  }

  private handle(e: SimEvent): void {
    if (e.type === 'merge') {
      const a = this.live.get(e.a);
      const b = this.live.get(e.b);
      const keepId = e.into.id;
      const keep = keepId === e.a ? a : b;
      const other = keepId === e.a ? b : a;
      if (!keep || !other) return;
      for (const r of other.riders) keep.view.inside.add(r.view.root);
      keep.riders = [...keep.riders, ...other.riders];
      other.view.dispose();
      const goneId = keepId === e.a ? e.b : e.a;
      this.live.delete(goneId);
      this.views.delete(goneId);
      this.onMerged?.([e.a, e.b], this.recordOf(e.into));
    } else if (e.type === 'expire') {
      const lb = this.live.get(e.id);
      if (!lb) return;
      // pops by itself from somewhere near the top, where the film is thinnest
      const p = lb.view.root.position.clone().add(new THREE.Vector3(0.3, 1, 0.2).normalize().multiplyScalar(lb.view.radius));
      const result = this.burst(e.id, p);
      if (result) this.onExpired?.(e.id, result);
    }
  }

  private recordOf(b: SimBubble): BubbleRecord {
    const names = b.passengers.map((_, i) => b.names[i] ?? '');
    return {
      id: b.id, r: Math.round(b.r * 1000) / 1000, passengers: [...b.passengers], ...(names.some(Boolean) ? { names } : {}),
      born: Math.round(this.clock.now - b.age * 1000), x: b.x, y: b.y, z: b.z,
    };
  }

  private placeRiders(lb: LiveBubble, b: SimBubble, t: number): void {
    const n = lb.riders.length;
    const r = lb.view.radius;
    lb.view.inside.rotation.y = t * 0.22 + b.seed * 6.283;
    lb.riders.forEach((rider, i) => {
      const kind = rider.view.kind;
      const h = heightOf(kind);
      const fit = (r * (n > 1 ? 0.95 : 1.25)) / h;
      const s = Math.max(0.05, Math.min(CHAR_SCALE, fit));
      const a = (i / n) * Math.PI * 2;
      const spread = n > 1 ? r * 0.32 : 0;
      const root = rider.view.root;
      root.position.set(Math.cos(a) * spread, -h * s * 0.45 + Math.sin(t * 0.9 + i) * 0.02, Math.sin(a) * spread);
      // they snuggle: facing each other a little
      root.rotation.set(0, n > 1 ? -a + Math.PI + 0.6 : 0.4, 0);
      root.scale.setScalar(s);
      rider.view.setInBubble(1);
      rider.view.apply(asleepPose(t + i * 1.3, idHash(String(rider.seed))));
    });
  }

  private updateGarden(id: string, g: LiveGarden, t: number): void {
    const v = g.view;
    const seed = (g.rec.seed % 1000) / 1000;
    let pose: Pose;
    let x = g.x, z = g.z;
    let scale = CHAR_SCALE;
    const m = g.mode;
    if (m.kind === 'falling') {
      const since = t - m.t0;
      const u = Math.min(1, since / landingTime(m.height));
      scale = m.fromScale + (CHAR_SCALE - m.fromScale) * Math.min(1, u * 1.5);
      pose = fallPose(g.rec.kind, since, m.height / scale, seed);
      // it was popped above its landing spot, a little off it if it shared the bubble
      x = m.x + (g.x - m.x) * u;
      z = m.z + (g.z - m.z) * u;
      if (since >= landingTime(m.height)) g.mode = { kind: 'home', t0: t };
    } else if (m.kind === 'held') {
      pose = restPose();
      pose.lift = 0.12;
      pose.pawL = pose.pawR = 0.7;
      pose.roll = Math.sin((t - m.t0) * 5) * 0.12;
      pose.squash = -0.1;
      pose.tail = Math.sin((t - m.t0) * 7) * 0.6;
    } else if (m.kind === 'leaving') {
      const lp = leavePose(g.rec.kind, t - m.t0, seed);
      pose = lp.pose;
      v.setFade(lp.fade);
      if (t - m.t0 >= LEAVE_TIME) {
        v.dispose();
        this.garden.delete(id);
        return;
      }
    } else {
      pose = gardenPose(g.rec.kind, t - m.t0, seed);
      const ox = pose.dx * scale, oz = pose.dz * scale;
      // hops stay on open ground
      if (isOpenGround(g.x + ox, g.z + oz, 0.15)) {
        x += ox;
        z += oz;
      }
    }
    pose.dx = pose.dz = 0;
    v.root.position.set(x, groundHeight(x, z), z);
    v.root.rotation.set(0, g.rec.heading + pose.turn, 0);
    v.root.scale.setScalar(scale);
    v.apply(pose);
  }

  // --- what the app asks for -------------------------------------------------------------------

  /** The nearest bubble a screen ray touches, and where on its film. */
  pickBubble(ray: THREE.Ray): { id: string; point: THREE.Vector3 } | null {
    let best: { id: string; t: number } | null = null;
    for (const [id, lb] of this.live) {
      const t = lb.view.intersect(ray);
      if (t !== null && (!best || t < best.t)) best = { id, t };
    }
    return best ? { id: best.id, point: ray.at(best.t, new THREE.Vector3()) } : null;
  }

  /** Which garden passenger is under a screen ray. */
  pickGarden(raycaster: THREE.Raycaster): string | null {
    const proxies: THREE.Object3D[] = [];
    for (const g of this.garden.values()) if (g.mode.kind !== 'leaving') proxies.push(g.view.proxy);
    const hit = raycaster.intersectObjects(proxies, false)[0];
    return (hit?.object.userData.charId as string | undefined) ?? null;
  }

  /**
   * Pop a bubble from a point on its film: the hole sweeps open, droplets fly,
   * the riders wake and start down under their petals. Returns the garden
   * records the app should commit (where each one will land).
   */
  pop(id: string, at: THREE.Vector3 | null): PopResult | null {
    const res = this.burst(id, at);
    if (res) this.sim.remove(id);
    return res;
  }

  private burst(id: string, at: THREE.Vector3 | null): PopResult | null {
    const lb = this.live.get(id);
    const b = this.sim.bubbles.get(id);
    if (!lb || !b) return null;
    this.live.delete(id);
    this.views.delete(id);
    lb.view.pop(at, this.reducedMotion);
    this.dying.push(lb);
    if (!this.reducedMotion) this.life.spray(b.x, b.y, b.z, lb.view.radius, Math.round(10 + lb.view.radius * 10));
    const landed: GardenRecord[] = [];
    const n = lb.riders.length;
    const t = this.sim.time;
    lb.riders.forEach((rider, i) => {
      const root = rider.view.root;
      root.updateMatrixWorld(true);
      const wp = root.getWorldPosition(new THREE.Vector3());
      const scale = root.getWorldScale(tmp).x;
      const a = (i / Math.max(1, n)) * Math.PI * 2 + 0.4;
      const spread = n > 1 ? 0.45 : 0;
      const [lx, lz] = nearestOpen(b.x + Math.cos(a) * spread, b.z + Math.sin(a) * spread, 0.3);
      const gid = newId('g');
      const heading = -Math.PI / 2 + (idHash(gid) - 0.5) * 1.4;
      const rec: GardenRecord = { id: gid, kind: rider.view.kind, seed: rider.seed, x: Math.round(lx * 1000) / 1000, z: Math.round(lz * 1000) / 1000, heading: Math.round(heading * 1000) / 1000, ...(rider.name ? { name: rider.name } : {}) };
      landed.push(rec);
      // the same little one, now out in the open air
      this.group.add(root);
      root.position.copy(wp);
      root.rotation.set(0, heading, 0);
      root.scale.setScalar(scale);
      rider.view.setInBubble(0);
      const height = Math.max(0.2, wp.y - groundHeight(lx, lz));
      this.pendingFalls.set(gid, { view: rider.view, mode: { kind: 'falling', t0: t, height, fromScale: scale, x: wp.x, z: wp.z } });
    });
    lb.riders = [];
    return { landed };
  }

  /** Wrap a garden passenger in a new bubble; returns the bubble record to commit. */
  bubbleUp(gardenId: string): BubbleRecord | null {
    const g = this.garden.get(gardenId);
    if (!g || g.mode.kind === 'leaving' || g.mode.kind === 'falling') return null;
    const r = 0.62;
    const p = g.view.root.position;
    const id = newId('b');
    this.lifting.set(gardenId, { view: g.view, seed: g.rec.seed, name: g.rec.name ?? '' });
    this.expectFresh(id);
    const [x, y, z] = containPoint(p.x, p.y + r + 0.1, p.z, r);
    return { id, r, passengers: [g.rec.seed], ...(g.rec.name ? { names: [g.rec.name] } : {}), born: Math.round(this.clock.now), x, y, z };
  }

  /** Carry a passenger (it dangles); returns the spot it will sit if let go here. */
  hold(id: string, x: number, z: number): [number, number] | null {
    const g = this.garden.get(id);
    if (!g || g.mode.kind === 'leaving' || g.mode.kind === 'falling') return null;
    const [px, pz] = nearestOpen(x, z, 0.25);
    g.x = px;
    g.z = pz;
    if (g.mode.kind !== 'held') g.mode = { kind: 'held', t0: this.time };
    return [px, pz];
  }

  release(id: string): [number, number] | null {
    const g = this.garden.get(id);
    if (!g || g.mode.kind !== 'held') return null;
    g.mode = { kind: 'home', t0: this.time };
    return [g.x, g.z];
  }

  setHighlight(selected: string | null, hovered: string | null): void {
    this.selected = selected;
    this.hovered = hovered;
  }

  /** World-space bounds of a garden passenger (selection box). */
  boundsOf(id: string, target = new THREE.Box3()): THREE.Box3 | null {
    const g = this.garden.get(id);
    return g ? g.view.bounds(target) : null;
  }

  rootOf(id: string): THREE.Object3D | null {
    return this.garden.get(id)?.view.root ?? null;
  }

  /** Live positions of the bubbles, for saving. */
  positions(): Map<string, { x: number; y: number; z: number; r: number }> {
    const out = new Map<string, { x: number; y: number; z: number; r: number }>();
    for (const b of this.sim.bubbles.values()) out.set(b.id, { x: b.x, y: b.y, z: b.z, r: b.r });
    return out;
  }

  snapshot(): Snapshot {
    return {
      time: this.sim.time,
      bubbles: [...this.sim.bubbles.values()].map((b) => ({ id: b.id, x: b.x, y: b.y, z: b.z, r: b.r, inflate: b.inflate, passengers: [...b.passengers], popping: false })),
      garden: [...this.garden.values()].map((g) => ({ id: g.rec.id, kind: g.rec.kind, mode: g.mode.kind, x: g.view.root.position.x, y: g.view.root.position.y, z: g.view.root.position.z })),
    };
  }

  /** Seconds a fresh bubble takes to inflate (for tests and the demo). */
  static readonly INFLATE = INFLATE;

  dispose(): void {
    for (const lb of [...this.live.values(), ...this.dying]) {
      for (const r of lb.riders) r.view.dispose();
      lb.view.dispose();
    }
    for (const g of this.garden.values()) g.view.dispose();
    for (const p of this.pendingFalls.values()) p.view.dispose();
    this.group.removeFromParent();
  }
}
