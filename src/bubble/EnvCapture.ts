import * as THREE from 'three';
import type { WorldUniforms } from '../scene/world';

/**
 * One low-resolution capture of the garden from the middle of the air above
 * it, shared by every bubble as the reflection on its film. A pale sky dome
 * (seen only by this camera) gives the top half something to reflect; the
 * capture is refreshed rarely — when the garden fills up a little more.
 */

export const ENV_LAYER = 2;

const skyVertex = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}
`;

const skyFragment = /* glsl */ `
uniform vec3 uPaper;
varying vec3 vDir;
vec3 srgb(vec3 c) { return pow(c, vec3(2.2)); }
float h(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
float n2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  float y = vDir.y;
  vec3 zenith = srgb(vec3(0.72, 0.84, 0.96));
  vec3 horizon = srgb(vec3(0.97, 0.93, 0.92));
  vec3 c = mix(horizon, zenith, smoothstep(0.02, 0.75, y));
  // a few soft clouds, so reflections have shapes to curve
  vec2 p = vDir.xz / max(0.15, y) * 1.4;
  float cloud = smoothstep(0.55, 0.8, n2(p) * 0.65 + n2(p * 2.3) * 0.35) * smoothstep(0.05, 0.3, y);
  c = mix(c, srgb(vec3(1.0, 0.99, 0.98)), cloud * 0.8);
  // below the horizon: the paper the garden sits on
  c = mix(uPaper, c, smoothstep(-0.05, 0.03, y));
  gl_FragColor = vec4(c, 1.0);
}
`;

export class EnvCapture {
  readonly target: THREE.WebGLCubeRenderTarget;
  private readonly camera: THREE.CubeCamera;
  private readonly sky: THREE.Mesh;
  private dirty = true;
  private cooldown = 0;

  constructor(scene: THREE.Scene, world: WorldUniforms, size = 128) {
    this.target = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    this.camera = new THREE.CubeCamera(0.3, 120, this.target);
    this.camera.position.set(0, 2.6, 0.8);
    this.camera.layers.enable(ENV_LAYER);
    for (const c of this.camera.children) c.layers.enable(ENV_LAYER);
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(80, 32, 16),
      new THREE.ShaderMaterial({ uniforms: { uPaper: world.uPaper }, vertexShader: skyVertex, fragmentShader: skyFragment, side: THREE.BackSide, depthWrite: false }),
    );
    this.sky.layers.set(ENV_LAYER);
    this.sky.frustumCulled = false;
    scene.add(this.sky);
    scene.add(this.camera);
  }

  get texture(): THREE.CubeTexture {
    return this.target.texture;
  }

  /** Ask for a fresh capture (throttled). */
  invalidate(): void {
    this.dirty = true;
  }

  /** Re-capture if asked to and not done in the last few seconds. Hidden objects are skipped. */
  update(renderer: THREE.WebGLRenderer, scene: THREE.Scene, dt: number, hide: THREE.Object3D[] = []): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (!this.dirty || this.cooldown > 0) return;
    this.dirty = false;
    this.cooldown = 3;
    const shown = hide.map((o) => o.visible);
    for (const o of hide) o.visible = false;
    const prev = renderer.getRenderTarget();
    this.camera.update(renderer, scene);
    renderer.setRenderTarget(prev);
    hide.forEach((o, i) => (o.visible = shown[i]));
  }

  dispose(): void {
    this.target.dispose();
    this.sky.geometry.dispose();
    (this.sky.material as THREE.Material).dispose();
  }
}
