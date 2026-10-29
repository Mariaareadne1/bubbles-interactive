import * as THREE from 'three';
import { edgeDistance, groundHeight } from '../scene/garden';

/** Exact screen-to-world placement against the garden's analytic ground. */

/** March the view ray until it dips under the ground, then bisect. Null if it never does. */
export function raycastGround(origin: THREE.Vector3, dir: THREE.Vector3, maxDistance = 300, target = new THREE.Vector3()): THREE.Vector3 | null {
  const above = (t: number) => origin.y + dir.y * t - groundHeight(origin.x + dir.x * t, origin.z + dir.z * t);
  let prev = 0;
  if (above(prev) < 0) return null;
  let t = 0.05;
  while (t < maxDistance) {
    if (above(t) < 0) {
      let lo = prev;
      let hi = t;
      for (let i = 0; i < 30; i++) {
        const mid = (lo + hi) / 2;
        if (above(mid) < 0) hi = mid;
        else lo = mid;
      }
      return target.copy(origin).addScaledVector(dir, hi);
    }
    prev = t;
    t += 0.04 + t * 0.012;
  }
  return null;
}

/**
 * Distance along the ray at which it is `height` above the ground beneath it
 * (searching only up to `limit`, where it meets the ground). Null if never.
 */
export function distanceAtHeight(origin: THREE.Vector3, dir: THREE.Vector3, height: number, limit: number): number | null {
  const f = (t: number) => origin.y + dir.y * t - groundHeight(origin.x + dir.x * t, origin.z + dir.z * t) - height;
  if (f(0) < 0 || f(limit) > 0) return null;
  let lo = 0;
  let hi = limit;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

type Rect = { left: number; top: number; width: number; height: number };

const ndc = new THREE.Vector2();
export const raycaster = new THREE.Raycaster();

export function rayFromClient(camera: THREE.PerspectiveCamera, rect: Rect, clientX: number, clientY: number): THREE.Ray {
  ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  return raycaster.ray;
}

export interface GroundHit {
  onTile: boolean;
  point: THREE.Vector3;
  distance: number;
}

/** Where a screen point meets the garden (or the paper around it). */
export function groundAt(camera: THREE.PerspectiveCamera, rect: Rect, clientX: number, clientY: number): GroundHit {
  const r = rayFromClient(camera, rect, clientX, clientY);
  const g = raycastGround(r.origin, r.direction);
  if (!g) return { onTile: false, point: new THREE.Vector3(), distance: Infinity };
  return { onTile: edgeDistance(g.x, g.z) > 0.3, point: g, distance: g.distanceTo(r.origin) };
}
