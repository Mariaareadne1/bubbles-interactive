# What BUBBLES took from its siblings

BUBBLES is self-contained (no imports across repos); these parts were copied and adapted from the family's MIT-licensed code. The base fork is **DUCKLINGS** — a daylight park tile with fluffy SDF creatures — which itself descends from POND, SKY, HIVE and MEADOW.

| From | What | Where it lives here |
|---|---|---|
| DUCKLINGS (MEADOW lineage) | Engine: renderer, frame loop, fixed-step override, dynamic resolution, context loss, PNG capture | `src/engine/Engine.ts` (adds the bubble pass, the environment capture and a wall-clock `now`) |
| MEADOW / DUCKLINGS | Post pass: PBR-Neutral tone curve, grade, grain, dither | `src/engine/post.ts` |
| MEADOW | `paintLight` two-tone light, `castLight` contact-hardening shadows | `src/scene/shaderChunks.ts` (shade turned periwinkle) |
| MEADOW / DUCKLINGS | Sun shadow map over the whole tile | `src/engine/shadows.ts` |
| MEADOW / DUCKLINGS | Painted ground: soft patches, dry-brush strokes, stipple, flecks, `paintEdge` | `src/scene/terrain.ts` (a garden instead of a park) |
| MEADOW | Puff trees and clouds from the fleece generator | `src/scene/props.ts` |
| DUCKLINGS | Grass tufts and flower rosettes, instanced | `src/scene/details.ts` (pastel, and the flowers nod) |
| DUCKLINGS | Small life (droplets, a butterfly) | `src/scene/life.ts` (petals in the air, a bee, two butterflies) |
| MEADOW / DUCKLINGS | SDF helpers, surface-nets mesher, wool puffs, worker-built shared shapes | `src/char/*` (six passengers) |
| MEADOW | Pure time-based idles with squash-and-stretch | `src/char/behaviors.ts` |
| SKY / DUCKLINGS | Pointer state machine, SVG ink overlay with shiver-away rejection, stroke smoothing | `src/interaction/*` |
| SKY / DUCKLINGS | Immutable document, undo/redo with `amend`, external store, versioned validated persistence, import/export | `src/state/*` |
| MEADOW | `cleanName`, the 🎲 name suggestion | `src/state/document.ts` |
| SKY / LANTERNS | Recorder that composites the ink | `src/capture/recorder.ts` |
| SKY / DUCKLINGS | Selection box + contextual bar, toolbar, help/menu, toasts, UI tokens | `src/app/ui/*`, `src/app/styles.css` (pastel accents) |
| LANTERNS | Wall-clock time so objects reload where they were; objects floating above a tile with a painted ground mark as the depth cue | `src/engine/Engine.ts`, `src/bubble/BubbleShadows.ts` |
| SKY / DUCKLINGS | Playwright with Metal ANGLE, QA scripts | `playwright.config.ts`, `scripts/*` |

Lessons carried over: `new THREE.Color('#hex')` is already linear (ColorManagement on); things mid-reveal stay pickable; record with the ink composited in; benchmark with back-to-back frames and a GPU sync on a loaded machine; a deterministic fixed-step simulation makes tests and recordings line up.
