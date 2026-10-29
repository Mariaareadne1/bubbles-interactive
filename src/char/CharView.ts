import * as THREE from 'three';
import { createCharUniforms, createPartMaterial, PART, shellGeometry, type CharUniforms } from './materials';
import { PROP_SHADOW_LAYER } from '../scene/props';
import type { Kind, PartGeometries } from './shapes';
import type { Pose } from './behaviors';
import type { WorldUniforms } from '../scene/world';

/**
 * A passenger's 3D view: a root at its position and heading, a body that
 * squashes from its base, a head that tilts, ears, tail and paws, dot eyes
 * that close to a line when it sleeps, blush cheeks, the petal it floats down
 * under, an invisible proxy for picking, and the selection highlight.
 */

type V3 = [number, number, number];

interface Rig {
  /** Head pivot on the body, and the head geometry's offset from that pivot. */
  head?: { pivot: V3; offset: V3 };
  eyes: { at: V3; spread: number; onHead: boolean; scale: number };
  cheeks: { at: V3; spread: number; onHead: boolean };
  /** Approximate height (m) — for fitting inside a bubble and the parasol. */
  height: number;
  proxy: { scale: V3; position: V3 };
}

const RIGS: Record<Kind, Rig> = {
  bunny: {
    head: { pivot: [0.06, 0.24, 0], offset: [0.025, 0.05, 0] },
    eyes: { at: [0.094, 0.014, 0.05], spread: 1, onHead: true, scale: 1 },
    cheeks: { at: [0.094, -0.034, 0.07], spread: 1, onHead: true },
    height: 0.5,
    proxy: { scale: [0.2, 0.24, 0.17], position: [0.0, 0.2, 0] },
  },
  chick: {
    head: { pivot: [0.03, 0.2, 0], offset: [0, 0, 0] },
    eyes: { at: [0.085, 0.045, 0.046], spread: 1, onHead: true, scale: 1 },
    cheeks: { at: [0.083, 0.012, 0.07], spread: 1, onHead: true },
    height: 0.34,
    proxy: { scale: [0.17, 0.18, 0.16], position: [0, 0.16, 0] },
  },
  kitten: {
    head: { pivot: [0.11, 0.2, 0], offset: [0.025, 0.03, 0] },
    eyes: { at: [0.075, 0.012, 0.04], spread: 1, onHead: true, scale: 1.05 },
    cheeks: { at: [0.074, -0.03, 0.06], spread: 1, onHead: true },
    height: 0.38,
    proxy: { scale: [0.22, 0.18, 0.15], position: [0.02, 0.15, 0] },
  },
  flower: {
    head: { pivot: [0, 0.24, 0], offset: [0, 0.04, 0] },
    eyes: { at: [0.028, 0.012, 0.016], spread: 1, onHead: true, scale: 0.75 },
    cheeks: { at: [0.026, -0.012, 0.03], spread: 1, onHead: true },
    height: 0.42,
    proxy: { scale: [0.12, 0.22, 0.14], position: [0, 0.21, 0] },
  },
  strawberry: {
    eyes: { at: [0.1, 0.125, 0.034], spread: 1, onHead: false, scale: 0.9 },
    cheeks: { at: [0.096, 0.095, 0.06], spread: 1, onHead: false },
    height: 0.28,
    proxy: { scale: [0.13, 0.14, 0.13], position: [0, 0.13, 0] },
  },
  star: {
    eyes: { at: [0.058, 0.17, 0.03], spread: 1, onHead: false, scale: 0.85 },
    cheeks: { at: [0.055, 0.145, 0.055], spread: 1, onHead: false },
    height: 0.3,
    proxy: { scale: [0.1, 0.15, 0.15], position: [0, 0.16, 0] },
  },
};

export const heightOf = (kind: Kind) => RIGS[kind].height;

const STALK = new THREE.CylinderGeometry(0.004, 0.004, 0.2, 5).translate(0, 0.1, 0);

export class CharView {
  readonly root = new THREE.Group();
  readonly uniforms: CharUniforms;
  readonly proxy: THREE.Mesh;
  /** Squashes from the base. */
  private readonly body = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly ears: THREE.Object3D[] = [];
  private readonly eyes: THREE.Mesh[] = [];
  private readonly paws: THREE.Object3D[] = [];
  private readonly wings: THREE.Object3D[] = [];
  private tail: THREE.Object3D | null = null;
  private readonly parasol = new THREE.Group();
  private readonly materials: THREE.Material[] = [];
  private readonly casters = new Set<THREE.Mesh>();
  private casting = true;
  private readonly rig: Rig;
  private eyeScale = 1;

  constructor(readonly id: string, readonly kind: Kind, readonly seed: number, geo: PartGeometries, props: PartGeometries, private readonly world: WorldUniforms) {
    this.rig = RIGS[kind];
    const variant = ((seed * 2654435761) >>> 0) / 4294967296;
    this.uniforms = createCharUniforms(seed, variant);
    this.root.name = `${kind}-${id}`;
    this.root.add(this.body);
    const r = this.rig;
    const headParent = r.head ? this.head : this.body;
    if (r.head) {
      this.head.position.set(...r.head.pivot);
      this.head.rotation.order = 'YZX';
      this.body.add(this.head);
    }
    const onHead = (o: THREE.Object3D, at: V3) => {
      const off = r.head?.offset ?? [0, 0, 0];
      o.position.set(at[0] + off[0], at[1] + off[1], at[2] + off[2]);
      headParent.add(o);
    };

    switch (kind) {
      case 'bunny': {
        this.part(this.body, geo.body, PART.bunnyBody, { shell: true });
        const head = this.part(this.head, geo.head, PART.bunnyHead, { shell: true });
        head.position.set(...r.head!.offset);
        for (const s of [-1, 1]) {
          const ear = new THREE.Group();
          onHead(ear, [-0.025, 0.065, 0.042 * s]);
          ear.rotation.order = 'YXZ';
          this.part(ear, geo.ear, PART.bunnyEar);
          this.ears.push(ear);
          const foot = this.part(this.body, geo.foot, PART.bunnyFoot);
          foot.position.set(0.11, 0.022, 0.065 * s);
          this.paws.push(foot);
        }
        const nose = this.part(headParent, geo.nose, PART.bunnyNose, { cast: false });
        onHead(nose, [0.112, -0.026, 0]);
        const tail = this.part(this.body, geo.tail, PART.bunnyTail, { shell: true });
        tail.position.set(-0.2, 0.1, 0);
        this.tail = tail;
        break;
      }
      case 'chick': {
        this.part(this.body, geo.body, PART.chickBody, { shell: true });
        const beak = this.part(this.head, geo.beak, PART.chickBeak);
        beak.position.set(0.095, 0.018, 0);
        const tuft = this.part(this.head, geo.tuft, PART.chickTuft, { cast: false });
        tuft.position.set(0.0, 0.115, 0);
        tuft.rotation.z = 0.2;
        for (const s of [-1, 1]) {
          const wing = new THREE.Group();
          wing.position.set(0.0, 0.14, 0.118 * s);
          wing.rotation.order = 'YXZ';
          const m = this.part(wing, geo.wing, PART.chickWing);
          m.scale.z = s;
          this.body.add(wing);
          this.wings.push(wing);
          const foot = this.part(this.body, geo.foot, PART.chickFoot, { cast: false });
          foot.position.set(0.03, 0.004, 0.05 * s);
          this.paws.push(foot);
        }
        break;
      }
      case 'kitten': {
        this.part(this.body, geo.body, PART.kittenBody, { shell: true });
        const head = this.part(this.head, geo.head, PART.kittenHead, { shell: true });
        head.position.set(...r.head!.offset);
        for (const s of [-1, 1]) {
          const ear = new THREE.Group();
          onHead(ear, [-0.012, 0.062, 0.05 * s]);
          ear.rotation.order = 'YXZ';
          this.part(ear, geo.ear, PART.kittenEar);
          this.ears.push(ear);
          const paw = this.part(this.body, geo.paw, PART.kittenPaw);
          paw.position.set(0.15, 0.022, 0.05 * s);
          this.paws.push(paw);
        }
        const nose = this.part(headParent, geo.nose, PART.kittenNose, { cast: false });
        onHead(nose, [0.093, -0.018, 0]);
        const tail = new THREE.Group();
        tail.position.set(-0.16, 0.05, -0.02);
        this.part(tail, geo.tail, PART.kittenTail);
        this.body.add(tail);
        this.tail = tail;
        break;
      }
      case 'flower': {
        this.part(this.body, geo.stem, PART.flowerStem);
        for (const [y, s, a] of [[0.07, 1, 0.3], [0.12, -1, -0.4]] as const) {
          const leaf = this.part(this.body, geo.leaf, PART.flowerLeaf, { doubleSided: true });
          leaf.position.set(0, y, 0);
          leaf.rotation.set(0, a, 0);
          leaf.scale.z = s;
        }
        const bloom = this.part(this.head, geo.bloom, PART.flowerBloom, { doubleSided: true });
        bloom.position.set(...r.head!.offset);
        const centre = this.part(this.head, geo.centre, PART.flowerCentre);
        centre.position.set(r.head!.offset[0] + 0.004, r.head!.offset[1], 0);
        break;
      }
      case 'strawberry': {
        this.part(this.body, geo.berry, PART.berry);
        const calyx = this.part(this.body, geo.calyx, PART.calyx, { doubleSided: true });
        calyx.position.set(0, 0.222, 0);
        break;
      }
      case 'star':
        this.part(this.body, geo.star, PART.star);
        break;
    }

    for (const s of [-1, 1]) {
      const eye = this.part(headParent, geo.eye, PART.eye, { cast: false });
      onHead(eye, [r.eyes.at[0], r.eyes.at[1], r.eyes.at[2] * s]);
      if (!r.head) eye.position.set(r.eyes.at[0], r.eyes.at[1], r.eyes.at[2] * s);
      this.eyes.push(eye);
      const cheek = this.part(headParent, geo.cheek, PART.cheek, { cast: false });
      onHead(cheek, [r.cheeks.at[0], r.cheeks.at[1], r.cheeks.at[2] * s]);
      if (!r.head) cheek.position.set(r.cheeks.at[0], r.cheeks.at[1], r.cheeks.at[2] * s);
      cheek.rotation.y = -0.5 * s;
    }
    this.eyeScale = r.eyes.scale;

    // the petal parasol: a stalk in the paws, the petal overhead
    const petal = this.part(this.parasol, props.petal, PART.petal, { doubleSided: true });
    petal.position.y = 0.2;
    petal.rotation.y = seed;
    this.part(this.parasol, STALK, PART.leaf, { cast: false });
    this.parasol.position.set(0.03, r.height * 0.75, 0);
    this.parasol.visible = false;
    this.root.add(this.parasol);

    this.proxy = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ visible: false }));
    this.proxy.userData.charId = id;
    this.proxy.scale.set(...r.proxy.scale);
    this.proxy.position.set(...r.proxy.position);
    this.root.add(this.proxy);
  }

  private part(parent: THREE.Object3D, geo: THREE.BufferGeometry, part: number, options: { doubleSided?: boolean; cast?: boolean; shell?: boolean } = {}): THREE.Mesh {
    if (!geo.getAttribute('aAO')) geo.setAttribute('aAO', new THREE.BufferAttribute(new Float32Array(geo.getAttribute('position').count).fill(1), 1));
    const material = createPartMaterial(this.world, this.uniforms, part, { doubleSided: options.doubleSided });
    const mesh = new THREE.Mesh(geo, material);
    this.materials.push(material);
    if (options.cast !== false) {
      mesh.layers.enable(PROP_SHADOW_LAYER);
      this.casters.add(mesh);
    }
    parent.add(mesh);
    if (options.shell && !location.search.includes('noshell')) {
      const shellMat = createPartMaterial(this.world, this.uniforms, part, { shell: true });
      this.materials.push(shellMat);
      const shells = new THREE.Mesh(shellGeometry(geo), shellMat);
      shells.renderOrder = 1;
      mesh.add(shells);
    }
    return mesh;
  }

  get height(): number {
    return this.rig.height;
  }

  /** Pose the passenger. Root placement (position, heading, scale) is the caller's. */
  apply(p: Pose): void {
    const sq = p.squash;
    const curl = p.curl;
    // squash keeps volume: down and out, or up and in; curl tucks into a ball
    const sy = (1 - sq) * (1 - curl * 0.12);
    const sxz = 1 + sq * 0.45 + curl * 0.06;
    this.body.scale.set(sxz * (1 + p.stretch * 0.22), sy * (1 - p.stretch * 0.12), sxz);
    this.body.rotation.set(p.roll, p.spin, -p.pitch - curl * 0.1, 'YXZ');
    this.body.position.y = p.lift;
    if (this.rig.head) this.head.rotation.set(p.headRoll + curl * 0.15, p.headYaw, -(p.headPitch + curl * 0.35));
    for (const [i, ear] of this.ears.entries()) {
      const s = i === 0 ? -1 : 1;
      const back = p.ears * 1.1 + (this.kind === 'kitten' ? 0 : 0.08);
      ear.rotation.set(s * (0.18 + p.ears * 0.3 + (i === 1 ? p.earTwitch : -p.earTwitch) * 0.3), 0, back * (this.kind === 'bunny' ? 1 : 0.6));
    }
    const open = Math.max(0.12, p.eyes);
    for (const e of this.eyes) e.scale.set(this.eyeScale * (p.eyes < 0.2 ? 1.15 : 1), this.eyeScale * open, this.eyeScale * 0.55);
    for (const [i, w] of this.wings.entries()) {
      const s = i === 0 ? -1 : 1;
      w.rotation.set(s * (0.15 + p.wing * 0.9), 0, 0);
    }
    if (this.paws.length === 2) {
      const [l, r] = this.paws;
      const lift = (o: THREE.Object3D, v: number, base: number) => {
        o.position.y = base + v * 0.07;
        o.rotation.z = v * 0.8;
      };
      const base = this.kind === 'chick' ? 0.004 : 0.022;
      lift(l, p.pawL, base);
      lift(r, p.pawR, base);
    }
    if (this.tail) {
      this.tail.rotation.set(0, p.tail * 0.5, p.tail * 0.4 + curl * 0.3);
    }
    this.uniforms.uLook.value.y = p.twinkle;
    this.parasol.visible = p.parasol > 0.02;
    this.parasol.scale.setScalar(Math.max(0.001, p.parasol));
    this.parasol.position.y = this.rig.height * 0.62 + p.lift;
    this.parasol.rotation.set(p.roll * 0.4, 0, -p.pitch * 0.4);
  }

  setFade(v: number): void {
    this.uniforms.uLook.value.w = v;
    this.setCasting(v > 0.5);
  }

  /** Inside a bubble: a breath of the film's tint. */
  setInBubble(v: number): void {
    this.uniforms.uLook.value.z = v;
  }

  setHighlight(v: number): void {
    this.uniforms.uHighlight.value = v;
  }

  setCasting(casting: boolean): void {
    if (casting === this.casting) return;
    this.casting = casting;
    for (const m of this.casters) {
      if (casting) m.layers.enable(PROP_SHADOW_LAYER);
      else m.layers.disable(PROP_SHADOW_LAYER);
    }
  }

  /** World-space bounds of the painted parts (for the selection box and tests). */
  bounds(target = new THREE.Box3()): THREE.Box3 {
    this.root.updateMatrixWorld(true);
    target.makeEmpty();
    for (const mesh of this.casters) {
      if (!mesh.parent?.visible || mesh.parent === this.parasol) continue;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      target.union(mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld));
    }
    return target;
  }

  dispose(): void {
    for (const m of this.materials) m.dispose();
    this.proxy.geometry.dispose();
    (this.proxy.material as THREE.Material).dispose();
    this.root.removeFromParent();
  }
}
