import { describe, expect, it } from 'vitest';
import {
  addBubble, bubbleUp, captureIntoBubble, cleanName, crowdedOut, defaultDoc, emptyDoc, kindOf, MAX_BUBBLES, MAX_GARDEN, moveGarden, parseDoc,
  popBubble, removeGarden, renameGarden, replaceBubbles, showcaseDoc, suggestName, withPositions, type BubblesDoc, type GardenRecord,
} from '../../src/state/document';
import { amend, canRedo, canUndo, commit, createHistory, redo, undo } from '../../src/state/history';
import { KINDS } from '../../src/char/shapes';
import { R_MAX, R_MIN } from '../../src/bubble/sim';

const rec = (id: string, extra: Partial<GardenRecord> = {}): GardenRecord => ({ id, kind: 'bunny', seed: 0, x: 0, z: 1, heading: 0, ...extra });

describe('the document', () => {
  it('every seed is one of the six passengers', () => {
    const seen = new Set(Array.from({ length: 60 }, (_, i) => kindOf(i)));
    expect([...seen].sort()).toEqual([...KINDS].sort());
  });

  it('popping takes the bubble out of the air and puts its passengers in the garden', () => {
    const doc = addBubble(emptyDoc(), { id: 'b1', r: 0.6, passengers: [3, 9], born: 0, x: 1, y: 2, z: 0 });
    const landed = [rec('g1', { seed: 3, x: 1.2 }), rec('g2', { seed: 9, x: 0.8 })];
    const next = popBubble(doc, 'b1', landed);
    expect(next.bubbles).toEqual([]);
    expect(next.garden.map((g) => g.seed)).toEqual([3, 9]);
    expect(doc.bubbles).toHaveLength(1); // immutable
  });

  it('a full garden makes room: the longest-standing passengers leave first', () => {
    let doc: BubblesDoc = { ...emptyDoc(), garden: Array.from({ length: MAX_GARDEN }, (_, i) => rec(`old${i}`)) };
    doc = addBubble(doc, { id: 'b', r: 0.5, passengers: [1, 2], born: 0, x: 0, y: 2, z: 0 });
    expect(crowdedOut(doc, 2)).toEqual(['old0', 'old1']);
    const next = popBubble(doc, 'b', [rec('n1'), rec('n2')]);
    expect(next.garden).toHaveLength(MAX_GARDEN);
    expect(next.garden.at(-1)!.id).toBe('n2');
    expect(next.garden.some((g) => g.id === 'old0')).toBe(false);
  });

  it('caps bubbles in the air', () => {
    let doc = emptyDoc();
    for (let i = 0; i < MAX_BUBBLES + 3; i++) doc = addBubble(doc, { id: `b${i}`, r: 0.5, passengers: [i], born: 0, x: 0, y: 2, z: 0 });
    expect(doc.bubbles).toHaveLength(MAX_BUBBLES);
  });

  it('a merge replaces two bubbles with one', () => {
    let doc = addBubble(emptyDoc(), { id: 'a', r: 0.5, passengers: [1], born: 0, x: 0, y: 2, z: 0 });
    doc = addBubble(doc, { id: 'b', r: 0.5, passengers: [2], born: 0, x: 1, y: 2, z: 0 });
    const next = replaceBubbles(doc, ['a', 'b'], { id: 'a', r: 0.63, passengers: [1, 2], born: 0, x: 0.5, y: 2, z: 0 });
    expect(next.bubbles).toHaveLength(1);
    expect(next.bubbles[0].passengers).toEqual([1, 2]);
  });

  it('bubbling up wraps a passenger, keeping its name', () => {
    const doc = { ...emptyDoc(), garden: [rec('g', { seed: 42, name: 'Mochi' })] };
    const next = bubbleUp(doc, 'g', { id: 'nb', r: 0.62, born: 5, x: 0, y: 1, z: 1 });
    expect(next.garden).toEqual([]);
    expect(next.bubbles[0]).toMatchObject({ id: 'nb', passengers: [42], names: ['Mochi'] });
  });

  it('a loop drawn round friends catches them all in one bubble, names and all, up to four', () => {
    const doc = { ...emptyDoc(), garden: ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => rec(id, { seed: 10 + i, ...(i === 1 ? { name: 'Pip' } : {}) })) };
    const next = captureIntoBubble(doc, ['b', 'a', 'c', 'd', 'e'], { id: 'nb', r: 1, born: 5, x: 0, y: 1.5, z: 1 });
    expect(next.bubbles).toHaveLength(1);
    expect(next.bubbles[0].passengers).toEqual([11, 10, 12, 13]);
    expect(next.bubbles[0].names).toEqual(['Pip', '', '', '']);
    expect(next.garden.map((g) => g.id)).toEqual(['e', 'f']);
    expect(captureIntoBubble(doc, ['nobody'], { id: 'x', r: 1, born: 5, x: 0, y: 1.5, z: 1 })).toBe(doc);
  });

  it('renames, moves and removes immutably, and is a no-op when nothing changes', () => {
    const doc = { ...emptyDoc(), garden: [rec('g')] };
    const named = renameGarden(doc, 'g', '  Bun<b>  ');
    expect(named.garden[0].name).toBe('Bunb');
    expect(renameGarden(named, 'g', 'Bunb')).toBe(named);
    expect(renameGarden(named, 'g', '').garden[0]).not.toHaveProperty('name');
    expect(moveGarden(doc, 'g', 0, 1)).toBe(doc);
    expect(moveGarden(doc, 'g', 2, 3).garden[0]).toMatchObject({ x: 2, z: 3 });
    expect(removeGarden(doc, 'g').garden).toEqual([]);
    expect(cleanName('a\u0007b'.repeat(20))).toHaveLength(16);
  });

  it('writes drifted positions back without touching unmoved bubbles', () => {
    const doc = addBubble(emptyDoc(), { id: 'a', r: 0.5, passengers: [1], born: 0, x: 0, y: 2, z: 0 });
    expect(withPositions(doc, new Map([['a', { x: 0, y: 2, z: 0, r: 0.5 }]]))).toBe(doc);
    expect(withPositions(doc, new Map([['a', { x: 1.23456, y: 2, z: 0, r: 0.5 }]])).bubbles[0].x).toBe(1.235);
  });

  it('suggests names not already taken', () => {
    expect(suggestName(['Bun'], () => 0)).not.toBe('Bun');
  });
});

describe('loading untrusted scenes', () => {
  it('round-trips the default and showcase scenes', () => {
    for (const d of [defaultDoc(1000), showcaseDoc(1000)]) expect(parseDoc(JSON.parse(JSON.stringify(d)), 1000)).toEqual(d);
  });

  it('rejects things that are not BUBBLES scenes', () => {
    for (const bad of [null, 3, 'x', {}, { version: 2, bubbles: [], garden: [] }, { version: 1, bubbles: {}, garden: [] }]) expect(parseDoc(bad)).toBeNull();
  });

  it('clamps, caps, drops and de-duplicates', () => {
    const doc = parseDoc({
      version: 1,
      bubbles: [
        { id: 'x', r: 99, passengers: [1, 2, 3, 4, 5, 6], born: 1e15, x: 1e3, y: -4, z: 0 },
        { id: 'x', r: 0.01, passengers: [7], born: 0, x: 0, y: 2, z: 0 },
        { id: 'nopass', r: 0.5, passengers: [], born: 0, x: 0, y: 2, z: 0 },
        { id: 'nan', r: NaN, passengers: [1], born: 0, x: 0, y: 2, z: 0 },
        ...Array.from({ length: 30 }, (_, i) => ({ id: `m${i}`, r: 0.5, passengers: [i], born: 0, x: 0, y: 2, z: 0 })),
      ],
      garden: [
        { id: '<script>', kind: 'dragon', seed: 8, x: 0, z: 0, heading: 99, name: 'A'.repeat(50) },
        { id: 'ok', kind: 'star', seed: -5.5, x: 0, z: 0 },
        { id: 'bad', kind: 'star', x: 0, z: 0 },
      ],
    }, 1000)!;
    expect(doc.bubbles).toHaveLength(MAX_BUBBLES);
    const [a, b] = doc.bubbles;
    expect(a.r).toBe(R_MAX);
    expect(a.passengers).toHaveLength(4);
    expect(a.born).toBe(1000);
    expect(a.y).toBe(0);
    expect(b.id).not.toBe('x');
    expect(b.r).toBe(R_MIN);
    expect(doc.garden).toHaveLength(2);
    expect(doc.garden[0].id).not.toBe('<script>');
    expect(doc.garden[0].kind).toBe(kindOf(8));
    expect(doc.garden[0].name).toHaveLength(16);
    expect(Math.abs(doc.garden[0].heading)).toBeLessThanOrEqual(Math.PI);
    expect(doc.garden[1].seed).toBe(5);
  });
});

describe('undo and redo', () => {
  it('steps back and forward through snapshots; amend makes no step', () => {
    const a = emptyDoc();
    const b = addBubble(a, { id: 'b', r: 0.5, passengers: [1], born: 0, x: 0, y: 2, z: 0 });
    const c = withPositions(b, new Map([['b', { x: 1, y: 2, z: 0, r: 0.5 }]]));
    let h = commit(createHistory(a), b);
    h = amend(h, c);
    expect(canUndo(h)).toBe(true);
    h = undo(h);
    expect(h.present).toBe(a);
    expect(canRedo(h)).toBe(true);
    h = redo(h);
    expect(h.present).toBe(c);
    expect(canRedo(h)).toBe(false);
  });
});
