/// <reference lib="webworker" />
import { buildShapes } from './shapes';
import { serializeSet, transferables } from './serialize';

// Meshing the signed-distance bodies takes a moment of CPU; it runs here so the garden keeps rendering.
// Each worker builds one group (a kind of passenger, or the petals), so they build in parallel.
self.onmessage = (event: MessageEvent<string>) => {
  try {
    const packed = serializeSet({ [event.data]: buildShapes(event.data) });
    (self as unknown as Worker).postMessage({ packed }, transferables(packed));
  } catch (error) {
    (self as unknown as Worker).postMessage({ error: String(error) });
  }
};
