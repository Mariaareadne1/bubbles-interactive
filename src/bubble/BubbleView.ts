import * as THREE from 'three';
import { BUBBLE_GEOMETRY, createBubbleUniforms, createFilmMaterial, type BubbleUniforms } from './film';
import { modeCoefficient } from './wobble';
import type { SimBubble } from './sim';
import type { WorldUniforms } from '../scene/world';

/**
 * One bubble on screen: the three film passes on a shared set of uniforms,
 * a group at its centre that holds whoever is asleep inside, and the pop —
 * the film bursting open from the tap point in a fraction of a second.
 */

/** Seconds for the hole to sweep across the film. */
export const BURST_TIME = 0.17;
export const SOFT_POP_TIME = 0.45;

const SHRINK_TIME = 0.35;

export class BubbleView {
  readonly root = new THREE.Group();
  /** Passengers ride here: at the centre, not scaled with the film. */
  readonly inside = new THREE.Group();
  readonly uniforms: BubbleUniforms;
  private readonly film = new THREE.Group();
  private readonly meshes: THREE.Mesh[] = [];
  private readonly materials: THREE.ShaderMaterial[] = [];
  /** Seconds since the pop began (null while whole). */
  popping: number | null = null;
  /** Seconds since it began deflating (an undo, a clear). */
  shrinking: number | null = null;
  private soft = false;
  /** Current visual radius (m). */
  radius = 0;
  private size = 0;

  constructor(readonly id: string, seed: number, world: WorldUniforms, env: THREE.CubeTexture | null) {
    this.uniforms = createBubbleUniforms(seed, env);
    this.root.name = `bubble-${id}`;
    (['back', 'tint', 'front'] as const).forEach((pass) => {
      const m = createFilmMaterial(world, this.uniforms, pass);
      const mesh = new THREE.Mesh(BUBBLE_GEOMETRY, m);
      mesh.userData.bubbleId = id;
      mesh.frustumCulled = false;
      this.materials.push(m);
      this.meshes.push(mesh);
      this.film.add(mesh);
    });
    this.root.add(this.film, this.inside);
  }

  /** Back-to-front order among bubbles: rank 0 is farthest. */
  setOrder(rank: number): void {
    this.meshes.forEach((m, i) => (m.renderOrder = 10 + rank * 3 + i));
  }

  /** Place and shape the film from the simulation. */
  apply(b: SimBubble, simTime: number, reduced: boolean, dt: number): void {
    const u = b.inflate;
    // a quick wobble-pop into shape: grows fast, overshoots a touch, settles
    const grow = u >= 1 ? 1 : 1 - Math.pow(1 - u, 3) + Math.sin(u * Math.PI) * 0.1;
    // after a merge the film swells to its new size rather than jumping
    this.size = this.size === 0 ? b.r : this.size + (b.r - this.size) * Math.min(1, dt * 9);
    let r = this.size * Math.max(0.05, grow);
    if (this.shrinking !== null) r *= Math.max(0.001, 1 - this.shrinking / SHRINK_TIME);
    this.radius = r;
    this.root.position.set(b.x, b.y, b.z);
    this.film.scale.setScalar(r);
    const modes = this.uniforms.uModes.value;
    const ls = this.uniforms.uModeL.value;
    const damp = reduced ? 0.3 : 1;
    for (let i = 0; i < modes.length; i++) {
      const m = b.modes[i];
      if (!m) {
        modes[i].w = 0;
        continue;
      }
      modes[i].set(m.ax, m.ay, m.az, modeCoefficient(m, b.r, simTime) * damp);
      ls.setComponent(i, m.l);
    }
    // a slight stretch along the direction of motion
    const speed = Math.hypot(b.vx, b.vy, b.vz);
    const st = this.uniforms.uStretch.value;
    if (speed > 1e-4) st.set(b.vx / speed, b.vy / speed, b.vz / speed, Math.min(0.08, speed * 0.25) * damp);
    else st.w = 0;
    this.uniforms.uIdle.value = reduced ? 0.004 : 0.012;
  }

  /** Begin the pop from a world point on (or near) the film. */
  pop(at: THREE.Vector3 | null, soft: boolean): void {
    if (this.popping !== null) return;
    this.popping = 0;
    this.soft = soft;
    const dir = at ? at.clone().sub(this.root.position) : new THREE.Vector3(0.3, 1, 0.5);
    if (dir.lengthSq() < 1e-6) dir.set(0, 1, 0);
    dir.normalize();
    this.uniforms.uBurst.value.set(dir.x, dir.y, dir.z, soft ? -1 : 0);
  }

  /** Deflate quietly (undo, clear). */
  shrink(): void {
    if (this.shrinking === null) this.shrinking = 0;
  }

  /** Advance the pop; returns true when there is nothing left to draw. */
  tick(dt: number): boolean {
    if (this.shrinking !== null) {
      this.shrinking += dt;
      if (this.shrinking >= SHRINK_TIME) return true;
    }
    if (this.popping === null) return false;
    this.popping += dt;
    if (this.soft) {
      const f = 1 - this.popping / SOFT_POP_TIME;
      this.uniforms.uFade.value = Math.max(0, f);
      return f <= 0;
    }
    const p = this.popping / BURST_TIME;
    this.uniforms.uBurst.value.w = p;
    return p >= 1.05;
  }

  /** Ray–sphere test against the current film (for taps and swipes). Distance along the ray, or null. */
  intersect(ray: THREE.Ray): number | null {
    if (this.popping !== null || this.shrinking !== null) return null;
    const c = this.root.position;
    const oc = ray.origin.clone().sub(c);
    const b = oc.dot(ray.direction);
    const r = Math.max(this.radius, 0.2);
    const disc = b * b - (oc.lengthSq() - r * r);
    if (disc < 0) return null;
    const t = -b - Math.sqrt(disc);
    return t > 0 ? t : null;
  }

  dispose(): void {
    for (const m of this.materials) m.dispose();
    this.root.removeFromParent();
  }
}
