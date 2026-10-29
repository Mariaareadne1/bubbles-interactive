import { deserializeSet, type PackedSet } from './serialize';
import { SHAPE_GROUPS, type PartGeometries } from './shapes';

/**
 * Every passenger shape is built once, off the main thread — one worker per
 * kind, in parallel — and shared by every passenger of that kind (variety
 * comes from paint, size and pose).
 */

export type ShapeSet = Record<string, PartGeometries>;

let promise: Promise<ShapeSet> | null = null;
let ready: ShapeSet | null = null;

function buildGroup(group: string): Promise<ShapeSet> {
  return new Promise<ShapeSet>((resolve, reject) => {
    const worker = new Worker(new URL('./shapes.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<{ packed?: PackedSet; error?: string }>) => {
      worker.terminate();
      if (event.data.packed) resolve(deserializeSet(event.data.packed));
      else reject(new Error(event.data.error ?? 'Passenger shapes failed to build'));
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || 'The shape worker crashed'));
    };
    worker.postMessage(group);
  });
}

export function loadShapes(): Promise<ShapeSet> {
  if (promise) return promise;
  promise = Promise.all(SHAPE_GROUPS.map(buildGroup)).then((sets) => {
    ready = Object.assign({}, ...sets) as ShapeSet;
    return ready;
  });
  promise.catch(() => (promise = null));
  return promise;
}

export function shapesReady(): ShapeSet | null {
  return ready;
}
