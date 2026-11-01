import { TILE } from '../scene/garden';
import { KINDS, type Kind } from '../char/shapes';
import { R_MAX, R_MIN, MAX_PASSENGERS } from '../bubble/sim';

/**
 * The scene document: bubbles in the air and passengers in the garden.
 * Immutable — every edit returns a new document — so undo/redo is a list of
 * snapshots. A bubble's passengers are seeds (the seed chooses who it is);
 * `born` is wall-clock ms so a bubble reloads as old as it is.
 */

export const VERSION = 1;
export const MAX_BUBBLES = 16;
export const MAX_GARDEN = 24;
export const NAME_MAX = 16;

export interface BubbleRecord {
  readonly id: string;
  readonly r: number;
  readonly passengers: readonly number[];
  /** Names that travel with passengers who were bubbled back up (parallel to passengers; '' = none). */
  readonly names?: readonly string[];
  readonly born: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface GardenRecord {
  readonly id: string;
  readonly kind: Kind;
  readonly seed: number;
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  readonly name?: string;
}

export interface BubblesDoc {
  readonly version: 1;
  readonly bubbles: readonly BubbleRecord[];
  readonly garden: readonly GardenRecord[];
}

/** Who a seed is. */
export const kindOf = (seed: number): Kind => KINDS[Math.abs(Math.floor(seed)) % KINDS.length];

let counter = 0;
export function newId(prefix = 'b'): string {
  counter = (counter + 1) % 1e6;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

export const newSeed = () => Math.floor(Math.random() * 1e6);

export const emptyDoc = (): BubblesDoc => ({ version: VERSION, bubbles: [], garden: [] });

/** A passenger seed of a given kind (for the default and showcase scenes). */
const seedOf = (kind: Kind, n: number) => KINDS.indexOf(kind) + KINDS.length * (n + 7);

export function defaultDoc(now = Date.now()): BubblesDoc {
  return {
    version: VERSION,
    bubbles: [
      { id: 'hello1', r: 0.85, passengers: [seedOf('bunny', 3)], born: now - 8000, x: -1.6, y: 2.5, z: 0.6 },
      { id: 'hello2', r: 0.6, passengers: [seedOf('star', 1)], born: now - 20000, x: 2.4, y: 3.0, z: -1.6 },
    ],
    garden: [
      { id: 'g1', kind: 'chick', seed: seedOf('chick', 2), x: 0.4, z: 2.6, heading: -1.4 },
      { id: 'g2', kind: 'flower', seed: seedOf('flower', 4), x: -2.9, z: 1.3, heading: -1.2 },
      { id: 'g3', kind: 'strawberry', seed: seedOf('strawberry', 1), x: 3.6, z: 1.2, heading: -1.9 },
    ],
  };
}

export function showcaseDoc(now = Date.now()): BubblesDoc {
  const names = ['Bun', 'Mochi', 'Pip', 'Peaches', 'Clover', 'Dumpling', 'Biscuit', 'Bramble', 'Sugar'];
  const spots: [Kind, number, number, number][] = [
    ['bunny', -3.1, 0.6, -1.3], ['chick', -0.6, 3.3, -1.5], ['kitten', 3.3, 0.4, -1.8], ['flower', -1.4, 2.0, -1.1],
    ['strawberry', 0.9, 3.4, -1.6], ['star', 4.2, 1.6, -2.0], ['bunny', -4.9, 3.9, -0.9], ['chick', 3.2, 3.9, -2.2], ['flower', 5.6, 3.6, -1.8],
  ];
  return {
    version: VERSION,
    bubbles: [
      { id: 'show-b1', r: 1.0, passengers: [seedOf('kitten', 5)], born: now - 5000, x: -2.2, y: 2.6, z: -0.4 },
      { id: 'show-b2', r: 0.7, passengers: [seedOf('strawberry', 3)], born: now - 30000, x: 1.6, y: 3.2, z: -1.6 },
      { id: 'show-b3', r: 0.55, passengers: [seedOf('chick', 6)], born: now - 12000, x: 3.4, y: 2.2, z: 1.0 },
      { id: 'show-b4', r: 1.15, passengers: [seedOf('bunny', 8), seedOf('star', 4)], born: now - 40000, x: 0.3, y: 2.9, z: 1.2 },
    ],
    garden: spots.map(([kind, x, z, heading], i) => ({ id: `show${i}`, kind, seed: seedOf(kind, 20 + i), x, z, heading, name: names[i] })),
  };
}

export const findBubble = (doc: BubblesDoc, id: string | null) => (id ? doc.bubbles.find((b) => b.id === id) : undefined);
export const findGarden = (doc: BubblesDoc, id: string | null) => (id ? doc.garden.find((g) => g.id === id) : undefined);

export function addBubble(doc: BubblesDoc, b: BubbleRecord): BubblesDoc {
  if (doc.bubbles.length >= MAX_BUBBLES) return doc;
  return { ...doc, bubbles: [...doc.bubbles, b] };
}

export function removeBubble(doc: BubblesDoc, id: string): BubblesDoc {
  if (!doc.bubbles.some((b) => b.id === id)) return doc;
  return { ...doc, bubbles: doc.bubbles.filter((b) => b.id !== id) };
}

/** Two bubbles became one (or any replacement of bubbles by a new record). */
export function replaceBubbles(doc: BubblesDoc, gone: readonly string[], into: BubbleRecord): BubblesDoc {
  return { ...doc, bubbles: [...doc.bubbles.filter((b) => !gone.includes(b.id)), into] };
}

/**
 * A bubble pops: it leaves the air and its passengers land in the garden. If
 * the garden is full, the passengers who have been there longest make room.
 */
export function popBubble(doc: BubblesDoc, id: string, landed: readonly GardenRecord[]): BubblesDoc {
  const b = findBubble(doc, id);
  if (!b) return doc;
  const garden = [...doc.garden, ...landed];
  return { ...doc, bubbles: doc.bubbles.filter((x) => x.id !== id), garden: garden.slice(Math.max(0, garden.length - MAX_GARDEN)) };
}

/** Which garden passengers a pop with n newcomers will crowd out (oldest first). */
export function crowdedOut(doc: BubblesDoc, n: number): string[] {
  const over = doc.garden.length + n - MAX_GARDEN;
  return over > 0 ? doc.garden.slice(0, over).map((g) => g.id) : [];
}

export function removeGarden(doc: BubblesDoc, id: string): BubblesDoc {
  if (!doc.garden.some((g) => g.id === id)) return doc;
  return { ...doc, garden: doc.garden.filter((g) => g.id !== id) };
}

export function moveGarden(doc: BubblesDoc, id: string, x: number, z: number, heading?: number): BubblesDoc {
  const g = findGarden(doc, id);
  if (!g || (Math.abs(g.x - x) < 1e-4 && Math.abs(g.z - z) < 1e-4 && (heading === undefined || Math.abs(g.heading - heading) < 1e-4))) return doc;
  return { ...doc, garden: doc.garden.map((r) => (r.id === id ? { ...r, x, z, heading: heading ?? r.heading } : r)) };
}

/**
 * Garden passengers are wrapped in a fresh bubble and float back up, asleep —
 * one (Bubble up) or a whole group a loop was drawn around. Names travel with them.
 */
export function captureIntoBubble(doc: BubblesDoc, ids: readonly string[], bubble: Omit<BubbleRecord, 'passengers' | 'names'>): BubblesDoc {
  const caught = ids.map((id) => findGarden(doc, id)).filter((g): g is GardenRecord => !!g).slice(0, MAX_PASSENGERS);
  if (caught.length === 0 || doc.bubbles.length >= MAX_BUBBLES) return doc;
  const names = caught.map((g) => g.name ?? '');
  const rec: BubbleRecord = { ...bubble, passengers: caught.map((g) => g.seed), ...(names.some(Boolean) ? { names } : {}) };
  const gone = new Set(caught.map((g) => g.id));
  return { ...doc, garden: doc.garden.filter((x) => !gone.has(x.id)), bubbles: [...doc.bubbles, rec] };
}

/** A single garden passenger is bubbled back up. */
export function bubbleUp(doc: BubblesDoc, id: string, bubble: Omit<BubbleRecord, 'passengers' | 'names'>): BubblesDoc {
  return captureIntoBubble(doc, [id], bubble);
}

export function cleanName(raw: string): string {
  // eslint-disable-next-line no-control-regex -- strip control characters from names
  return raw.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
}

export function renameGarden(doc: BubblesDoc, id: string, raw: string): BubblesDoc {
  const name = cleanName(raw);
  const current = findGarden(doc, id);
  if (!current || (current.name ?? '') === name) return doc;
  return {
    ...doc,
    garden: doc.garden.map((g) => {
      if (g.id !== id) return g;
      const { name: _old, ...rest } = g;
      void _old;
      return name ? { ...rest, name } : rest;
    }),
  };
}

/** Write live positions back into the document (no undo step). */
export function withPositions(doc: BubblesDoc, live: ReadonlyMap<string, { x: number; y: number; z: number; r: number }>): BubblesDoc {
  let changed = false;
  const bubbles = doc.bubbles.map((b) => {
    const l = live.get(b.id);
    if (!l || (Math.abs(l.x - b.x) < 1e-3 && Math.abs(l.y - b.y) < 1e-3 && Math.abs(l.z - b.z) < 1e-3)) return b;
    changed = true;
    return { ...b, x: round(l.x), y: round(l.y), z: round(l.z) };
  });
  return changed ? { ...doc, bubbles } : doc;
}

const round = (v: number) => Math.round(v * 1000) / 1000;

const NAMES = [
  'Bun', 'Mochi', 'Pip', 'Peaches', 'Clover', 'Dumpling', 'Biscuit', 'Bramble', 'Sugar', 'Button', 'Marshmallow', 'Pudding',
  'Toffee', 'Pebble', 'Daisy', 'Honey', 'Sprinkle', 'Bluebell', 'Waffle', 'Custard', 'Nutmeg', 'Petal', 'Tuppence', 'Lulu',
];

/** A name for the 🎲 button, avoiding names already taken. */
export function suggestName(taken: readonly string[], rand: () => number = Math.random): string {
  const free = NAMES.filter((n) => !taken.includes(n));
  const pool = free.length ? free : NAMES;
  return pool[Math.floor(rand() * pool.length) % pool.length];
}

// --- untrusted input ----------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const ID = /^[\w-]{1,40}$/;

/**
 * Validate a document from storage or a file. Bad fields are dropped or
 * clamped, the lists are capped (16 bubbles, 24 in the garden), ids are made
 * unique; anything that isn't recognisably a BUBBLES scene is rejected (null).
 */
export function parseDoc(input: unknown, now = Date.now()): BubblesDoc | null {
  if (!isObj(input) || input.version !== VERSION) return null;
  if (!Array.isArray(input.bubbles) || !Array.isArray(input.garden)) return null;
  const seen = new Set<string>();
  const uid = (raw: unknown, prefix: string) => {
    const id = typeof raw === 'string' && ID.test(raw) && !seen.has(raw) ? raw : newId(prefix);
    seen.add(id);
    return id;
  };
  const seedOk = (v: unknown) => (finite(v) ? Math.floor(Math.abs(v)) % 1e9 : null);
  const bubbles: BubbleRecord[] = [];
  for (const raw of input.bubbles) {
    if (bubbles.length >= MAX_BUBBLES) break;
    if (!isObj(raw) || !finite(raw.r) || !finite(raw.x) || !finite(raw.y) || !finite(raw.z) || !Array.isArray(raw.passengers)) continue;
    const passengers = raw.passengers.map(seedOk).filter((s): s is number => s !== null).slice(0, MAX_PASSENGERS);
    if (passengers.length === 0) continue;
    const rawNames = Array.isArray(raw.names) ? raw.names : [];
    const names = passengers.map((_, i) => (typeof rawNames[i] === 'string' ? cleanName(rawNames[i] as string) : ''));
    const born = finite(raw.born) ? clamp(raw.born, now - 1000 * 60 * 60 * 24 * 365, now) : now;
    bubbles.push({
      id: uid(raw.id, 'b'),
      r: clamp(raw.r, R_MIN, R_MAX),
      passengers,
      ...(names.some(Boolean) ? { names } : {}),
      born,
      x: clamp(raw.x, -TILE.halfX, TILE.halfX),
      y: clamp(raw.y, 0, 8),
      z: clamp(raw.z, -TILE.halfZ, TILE.halfZ),
    });
  }
  const garden: GardenRecord[] = [];
  for (const raw of input.garden) {
    if (garden.length >= MAX_GARDEN) break;
    if (!isObj(raw) || !finite(raw.x) || !finite(raw.z)) continue;
    const seed = seedOk(raw.seed);
    if (seed === null) continue;
    const kind = typeof raw.kind === 'string' && (KINDS as readonly string[]).includes(raw.kind) ? (raw.kind as Kind) : kindOf(seed);
    const name = typeof raw.name === 'string' ? cleanName(raw.name) : '';
    const rec: GardenRecord = {
      id: uid(raw.id, 'g'),
      kind,
      seed,
      x: clamp(raw.x, -TILE.halfX + 0.5, TILE.halfX - 0.5),
      z: clamp(raw.z, -TILE.halfZ + 0.5, TILE.halfZ - 0.5),
      heading: !finite(raw.heading) ? 0 : Math.abs(raw.heading) <= Math.PI ? raw.heading : Math.atan2(Math.sin(raw.heading), Math.cos(raw.heading)),
    };
    garden.push(name ? { ...rec, name } : rec);
  }
  return { version: VERSION, bubbles, garden };
}
