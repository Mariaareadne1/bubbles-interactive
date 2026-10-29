import * as THREE from 'three';
import { LIGHTING_GLSL, NOISE_GLSL, WORLD_UNIFORMS_GLSL } from './shaderChunks';
import { PROP_SHADOW_LAYER } from './props';
import { BEDS, TREES, edgeDistance, groundHeight } from './garden';
import { seededRandom } from './noise';
import type { WorldUniforms } from './world';

/**
 * Small garden life that never competes with the bubbles: blossom petals
 * that slip off the pink tree and see-saw down to the lawn, two butterflies
 * over the beds, a bee bumbling between flowers, and the spray of droplets a
 * popping bubble throws. Instanced and painted with the same light.
 */

const dabVertex = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec3 vColor;
void main() {
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  vColor = instanceColor;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const dabFragment = /* glsl */ `
${WORLD_UNIFORMS_GLSL}
${NOISE_GLSL}
${LIGHTING_GLSL}
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec3 vColor;
uniform float uLit;
void main() {
  vec3 N = normalize(vNormalW);
  if (!gl_FrontFacing) N = -N;
  vec3 col = uLit > 0.5 ? paintLight(vColor, N, castLight(vWorld, 0.03), 1.0, 0.5) : vColor;
  gl_FragColor = vec4(col, 1.0);
}
`;

function dabMesh(world: WorldUniforms, geo: THREE.BufferGeometry, count: number, lit = true): THREE.InstancedMesh {
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...world, uLit: { value: lit ? 1 : 0 } },
    vertexShader: dabVertex,
    fragmentShader: dabFragment,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
  mesh.frustumCulled = false;
  mesh.count = 0;
  return mesh;
}

const linear = (hex: string) => new THREE.Color(hex);
const dummy = new THREE.Object3D();

interface Drop { x: number; y: number; z: number; vx: number; vy: number; vz: number; s: number; life: number }
interface Petal { x: number; y: number; z: number; spin: number; phase: number; s: number; rest: number; seed: number }

const MAX_DROPS = 160;
const BLOSSOM = TREES.find((t) => t.blossom) ?? TREES[0];

export class GardenLife {
  readonly group = new THREE.Group();
  private readonly dropMesh: THREE.InstancedMesh;
  private readonly petalMesh: THREE.InstancedMesh;
  readonly butterflies: Butterfly[];
  private readonly bee: Bee;
  private drops: Drop[] = [];
  private readonly petals: Petal[] = [];
  private time = 0;
  private readonly rand = seededRandom(404);
  /** Calmer life with reduced motion. */
  calm = false;

  constructor(world: WorldUniforms, density = 1) {
    this.group.name = 'garden-life';
    this.dropMesh = dabMesh(world, new THREE.SphereGeometry(0.022, 6, 4), MAX_DROPS, false);
    const petal = new THREE.CircleGeometry(0.055, 10).scale(1, 0.6, 1).rotateX(-Math.PI / 2);
    const n = Math.round(10 * density);
    this.petalMesh = dabMesh(world, petal, n);
    this.group.add(this.dropMesh, this.petalMesh);
    const tints = ['#f7d3dc', '#fbe7eb', '#f4c3d0'];
    for (let i = 0; i < n; i++) {
      this.petals.push(this.newPetal(i, true));
      this.petalMesh.setColorAt(i, linear(tints[i % tints.length]));
    }
    this.petalMesh.count = n;
    this.butterflies = [new Butterfly(world, 5, '0.99,0.93,0.66', BEDS[0]), new Butterfly(world, 9, '0.82,0.86,0.99', BEDS[1])];
    this.bee = new Bee(world, 3);
    for (const b of this.butterflies) this.group.add(b.group);
    this.group.add(this.bee.group);
  }

  private newPetal(seed: number, anywhere: boolean): Petal {
    const a = this.rand() * Math.PI * 2;
    const r = Math.sqrt(this.rand()) * BLOSSOM.r * 0.9;
    const y = groundHeight(BLOSSOM.x, BLOSSOM.z) + BLOSSOM.r * 1.6;
    return {
      x: BLOSSOM.x + Math.cos(a) * r,
      z: BLOSSOM.z + Math.sin(a) * r * 0.8,
      y: anywhere ? 0.2 + this.rand() * y : y,
      spin: (this.rand() - 0.5) * 2,
      phase: this.rand() * 6.28,
      s: 0.8 + this.rand() * 0.5,
      rest: anywhere ? this.rand() * 4 : 0,
      seed,
    };
  }

  /** A burst of tiny droplets thrown out from a popping film (centre, radius). */
  spray(x: number, y: number, z: number, radius: number, count = 14): void {
    const tint = linear('#f2f8fb');
    for (let i = 0; i < count && this.drops.length < MAX_DROPS; i++) {
      // from points on the sphere, flung outward
      const u = this.rand() * 2 - 1;
      const a = this.rand() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const nx = Math.cos(a) * s, ny = u, nz = Math.sin(a) * s;
      const v = 0.6 + this.rand() * 1.1;
      this.drops.push({
        x: x + nx * radius, y: y + ny * radius, z: z + nz * radius,
        vx: nx * v, vy: ny * v + 0.6, vz: nz * v,
        s: 0.5 + this.rand() * 0.8,
        life: 0.5 + this.rand() * 0.5,
      });
    }
    for (let i = 0; i < MAX_DROPS; i++) this.dropMesh.setColorAt(i, tint);
    if (this.dropMesh.instanceColor) this.dropMesh.instanceColor.needsUpdate = true;
  }

  update(dt: number): void {
    this.time += dt;
    const t = this.time;

    this.drops = this.drops.filter((d) => {
      d.vy -= 6 * dt;
      d.vx *= 1 - 1.5 * dt;
      d.vz *= 1 - 1.5 * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.z += d.vz * dt;
      d.life -= dt;
      return d.life > 0 && d.y > groundHeight(d.x, d.z);
    });
    this.drops.forEach((d, i) => {
      dummy.position.set(d.x, d.y, d.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(d.s * Math.min(1, d.life * 3));
      dummy.updateMatrix();
      this.dropMesh.setMatrixAt(i, dummy.matrix);
    });
    this.dropMesh.count = this.drops.length;
    this.dropMesh.instanceMatrix.needsUpdate = true;

    // petals see-saw down from the blossom tree, lie on the lawn a while, then the tree lets go of another
    this.petals.forEach((p, i) => {
      const floor = groundHeight(p.x, p.z) + 0.01;
      if (p.y > floor) {
        p.phase += dt * 1.7;
        const fall = this.calm ? 0.12 : 0.22;
        p.y = Math.max(floor, p.y - fall * dt * (0.7 + 0.5 * Math.abs(Math.sin(p.phase))));
        p.x += (Math.cos(p.phase) * 0.35 + 0.12) * dt;
        p.z += Math.sin(p.phase * 0.7) * 0.12 * dt;
      } else {
        p.rest += dt;
        if (p.rest > 9 || edgeDistance(p.x, p.z) < 0.3) Object.assign(p, this.newPetal(p.seed, false));
      }
      const landed = p.y <= floor + 1e-3;
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(landed ? 0 : Math.sin(p.phase) * 0.9, p.seed + t * (landed ? 0 : p.spin * 0.6), landed ? 0 : Math.cos(p.phase * 1.3) * 0.5);
      dummy.scale.setScalar(p.s * (landed ? Math.max(0.001, Math.min(1, (9 - p.rest) / 1.5)) : 1));
      dummy.updateMatrix();
      this.petalMesh.setMatrixAt(i, dummy.matrix);
    });
    this.petalMesh.instanceMatrix.needsUpdate = true;

    for (const b of this.butterflies) b.update(dt, t);
    this.bee.update(dt, t);
  }

  dispose(): void {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    });
  }
}

function flatMaterial(world: WorldUniforms, rgb: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...world },
    vertexShader: `varying vec3 vWorld; varying vec3 vN; void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vWorld = wp.xyz; vN = normalize(mat3(modelMatrix)*normal); gl_Position = projectionMatrix*viewMatrix*wp; }`,
    fragmentShader: `${WORLD_UNIFORMS_GLSL}${NOISE_GLSL}${LIGHTING_GLSL} varying vec3 vWorld; varying vec3 vN; void main(){ vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N; gl_FragColor = vec4(paintLight(pow(vec3(${rgb}),vec3(2.2)), N, 1.0, 1.0, 0.4), 1.0); }`,
    side: THREE.DoubleSide,
  });
}

/** A small pastel butterfly that bobs about over one bed and the lawn near it. */
export class Butterfly {
  readonly group = new THREE.Group();
  private readonly wings: THREE.Mesh[] = [];

  constructor(world: WorldUniforms, private readonly seed: number, rgb: string, private readonly bed: { x: number; z: number; rx: number; rz: number }) {
    const wingMat = flatMaterial(world, rgb);
    const wingGeo = new THREE.CircleGeometry(0.06, 10).scale(0.8, 1, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.055);
    for (const s of [1, -1]) {
      const w = new THREE.Mesh(wingGeo, wingMat);
      w.scale.z = s;
      this.wings.push(w);
      this.group.add(w);
    }
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.009, 0.06, 3, 6).rotateZ(Math.PI / 2), flatMaterial(world, '0.52,0.45,0.48'));
    this.group.add(body);
    this.group.traverse((o) => o.layers.enable(PROP_SHADOW_LAYER));
  }

  get position(): THREE.Vector3 {
    return this.group.position;
  }

  update(_dt: number, t: number): void {
    const k = this.seed;
    // a lazy figure-of-eight over its bed, wandering wider now and then
    const a = t * 0.3 + k;
    const wide = 1 + 0.7 * Math.max(0, Math.sin(t * 0.06 + k));
    const x = this.bed.x + Math.sin(a) * this.bed.rx * 1.25 * wide + 0.3 * Math.sin(t * 1.7);
    const z = this.bed.z + Math.sin(a * 2) * this.bed.rz * 1.1 * wide + 0.2 * Math.sin(t * 2.3 + 1);
    const y = groundHeight(x, z) + 0.45 + 0.14 * Math.sin(t * 3.1) + 0.06 * Math.sin(t * 7.3);
    const p = this.group.position;
    const dx = x - p.x;
    const dz = z - p.z;
    if (Math.hypot(dx, dz) > 1e-4) this.group.rotation.y = Math.atan2(-dz, dx);
    p.set(x, y, z);
    const flap = Math.sin(t * 20 + k) * 0.9;
    this.wings[0].rotation.x = flap;
    this.wings[1].rotation.x = -flap;
  }
}

/** A round bumblebee in butter and soft cocoa stripes, bumbling from flower to flower. */
class Bee {
  readonly group = new THREE.Group();
  private readonly wings: THREE.Mesh[] = [];
  private readonly rand: () => number;
  private readonly from = new THREE.Vector3();
  private readonly to = new THREE.Vector3();
  private leg = 1;
  private legTime = 1;
  private hover = 0;

  constructor(world: WorldUniforms, seed: number) {
    this.rand = seededRandom(seed * 131);
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8).scale(1.3, 1, 1), new THREE.ShaderMaterial({
      uniforms: { ...world },
      vertexShader: `varying vec3 vL; varying vec3 vN; void main(){ vL = position; vN = normalize(mat3(modelMatrix)*normal); gl_Position = projectionMatrix*viewMatrix*modelMatrix*vec4(position,1.0); }`,
      fragmentShader: `${WORLD_UNIFORMS_GLSL}${NOISE_GLSL}${LIGHTING_GLSL} varying vec3 vL; varying vec3 vN; void main(){ float s = step(0.5, fract(vL.x * 30.0 + 0.25)); vec3 c = mix(pow(vec3(0.98,0.88,0.55),vec3(2.2)), pow(vec3(0.52,0.42,0.42),vec3(2.2)), s * step(-0.03, vL.x)); gl_FragColor = vec4(paintLight(c, normalize(vN), 1.0, 1.0, 0.4), 1.0); }`,
    }));
    this.group.add(body);
    const wingMat = new THREE.MeshBasicMaterial({ color: linear('#f5f8fc'), transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false });
    const wingGeo = new THREE.CircleGeometry(0.03, 10).scale(1, 0.6, 1).rotateX(-Math.PI / 2).translate(0, 0.03, 0.025);
    for (const s of [1, -1]) {
      const w = new THREE.Mesh(wingGeo, wingMat);
      w.scale.z = s;
      this.wings.push(w);
      this.group.add(w);
    }
    body.layers.enable(PROP_SHADOW_LAYER);
    this.pick(this.from);
    this.to.copy(this.from);
    this.group.position.copy(this.from);
  }

  private pick(out: THREE.Vector3): void {
    const b = BEDS[Math.floor(this.rand() * BEDS.length)];
    const a = this.rand() * Math.PI * 2;
    const r = Math.sqrt(this.rand()) * 0.8;
    const x = b.x + Math.cos(a) * r * b.rx;
    const z = b.z + Math.sin(a) * r * b.rz;
    out.set(x, groundHeight(x, z) + 0.28 + this.rand() * 0.15, z);
  }

  update(dt: number, t: number): void {
    for (const [i, w] of this.wings.entries()) w.rotation.x = (i ? -1 : 1) * Math.sin(t * 90) * 0.6;
    if (this.hover > 0) {
      this.hover -= dt;
      this.group.position.set(this.to.x + 0.02 * Math.sin(t * 6.1), this.to.y + 0.03 * Math.sin(t * 4.3), this.to.z + 0.02 * Math.cos(t * 5.3));
      if (this.hover <= 0) {
        this.from.copy(this.group.position);
        this.pick(this.to);
        this.leg = 0;
        this.legTime = Math.max(0.6, this.from.distanceTo(this.to) / (0.9 + this.rand() * 0.5));
      }
      return;
    }
    this.leg += dt / this.legTime;
    const u = Math.min(1, this.leg);
    const e = u * u * (3 - 2 * u);
    const lift = Math.sin(u * Math.PI) * 0.5;
    const wob = Math.sin(t * 9) * 0.04;
    const dx = this.to.x - this.from.x;
    const dz = this.to.z - this.from.z;
    this.group.position.set(this.from.x + dx * e + wob, this.from.y + (this.to.y - this.from.y) * e + lift, this.from.z + dz * e - wob);
    this.group.rotation.y = Math.atan2(-dz, dx);
    if (u >= 1) this.hover = 1 + this.rand() * 2.5;
  }
}
