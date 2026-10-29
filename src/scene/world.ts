import * as THREE from 'three';

/**
 * One light rig shared by every material. The look is painted rather than
 * photographic: a warm sun over a soft two-tone ramp, with shade that turns
 * soft periwinkle instead of simply darker. Colours are linear-light.
 */

// the sun sits high to the upper-left and a little in front, so what the camera
// sees is lit and shadows fall to the lower right
export const SUN_DIR = new THREE.Vector3(-0.6, 0.76, 0.26).normalize();

// THREE.Color parses hex as sRGB and stores linear values (ColorManagement is on).
const linear = (hex: string) => new THREE.Color(hex);

export const PAPER_HEX = '#f7f0e3';

export interface WorldUniforms {
  [name: string]: THREE.IUniform;
  uTime: THREE.IUniform<number>;
  uSunDir: THREE.IUniform<THREE.Vector3>;
  uSunColor: THREE.IUniform<THREE.Color>;
  uShadeColor: THREE.IUniform<THREE.Color>;
  uPaper: THREE.IUniform<THREE.Color>;
  uShadowMap: THREE.IUniform<THREE.Texture | null>;
  uShadowMatrix: THREE.IUniform<THREE.Matrix4>;
  uShadowUvPerMeter: THREE.IUniform<number>;
  uShadowDepthRange: THREE.IUniform<number>;
  uShadowEnabled: THREE.IUniform<number>;
  /** 0..1 — how much things sway (calmer with reduced motion). */
  uWind: THREE.IUniform<number>;
  /** Bubbles in the air, for their painted shadows: (centre, radius; 0 = none). */
  uBubbles: THREE.IUniform<THREE.Vector4[]>;
  /** How strongly each bubble's shadow shows (0..1). */
  uBubbleFade: THREE.IUniform<number[]>;
}

export const MAX_BUBBLE_SHADOWS = 16;

export function createWorldUniforms(): WorldUniforms {
  return {
    uTime: { value: 0 },
    uSunDir: { value: SUN_DIR.clone() },
    // multipliers on albedo: lit paint a touch warm, shade a soft periwinkle
    uSunColor: { value: linear('#fff6ee') },
    uShadeColor: { value: linear('#b8c2ec') },
    uPaper: { value: linear(PAPER_HEX) },
    uShadowMap: { value: null },
    uShadowMatrix: { value: new THREE.Matrix4() },
    uShadowUvPerMeter: { value: 0.02 },
    uShadowDepthRange: { value: 40 },
    uShadowEnabled: { value: 0 },
    uWind: { value: 1 },
    uBubbles: { value: Array.from({ length: MAX_BUBBLE_SHADOWS }, () => new THREE.Vector4(0, -100, 0, 0)) },
    uBubbleFade: { value: new Array(MAX_BUBBLE_SHADOWS).fill(0) },
  };
}
