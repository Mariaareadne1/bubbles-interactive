# Art direction

**One idea:** you draw a circle over a pastel garden; it becomes a shimmering soap bubble with something tiny asleep inside, and it floats away. Tap it and it pops, and whatever was inside drifts down on a petal. Everything on the page serves that bubble.

BUBBLES is the family's first **pastel** piece. It keeps MEADOW's painting — the elevated three-quarter view of one tile floating on paper, the ragged dry-brush edge breaking into specks, gouache two-tone light, long dry-brush strokes, stipple and flecks in the ground, puff trees — and only sweetens the colours. Nothing neon, nothing candy-saturated: every colour should look like it has a little white mixed in and was laid on chalky paper.

## The page

A small garden tile (14 × 10.5 m) on warm paper (`#f7f0e3`, a touch warmer than MEADOW's `#f4efe4`). Wordmark top-left in Fraunces: **BUBBLES** / *draw one, pop it*.

## Palette, and how it maps to MEADOW's

| | MEADOW | BUBBLES (sRGB intent) |
|---|---|---|
| Paper | `#f4efe4` | `#f7f0e3` |
| Sunlit multiplier | warm cream `#fff7ea` | the same, a hair pinker `#fff6ee` |
| Shade multiplier | lavender `#bdb9e3` | soft periwinkle `#b8c2ec` |
| Grass, main | sap green fields | mint `#b9e2c0` and pistachio `#cfe5a6` patches |
| Grass, cool / under trees | deep green | sea-glass `#a3d3b6` |
| Paths | ochre farm track | butter yellow `#f5e2a0`, warmer specks `#e6c987` |
| Beds | brown plough | rosy soil `#c8a08f`; blush bed flowers `#f6c3ce` `#fadbe1`, lilac bed `#cdb9ea` `#e4d8f6`, butter `#f8e6a0`, white `#fdf8f0` |
| Water | POND's cornflower | birdbath sky-blue bowl `#bfe0f1`, water `#a7d4ec` |
| Walls | stone / timber | pale peach garden wall `#f5d1bf` with a cream coping `#fae5d8` |
| Woodwork | honey | white picket gate `#fbf7f0`, shade side periwinkle |
| Trees | green puffs | a round lilac tree `#c9b3e5`, a pink blossom tree `#f4c0cf`, trunks warm taupe `#a88a7e` |
| Clouds | white puffs | the same, very slightly pink in shade |

Shadows are soft periwinkle, never grey or black. Light from the upper left, so shadows fall to the lower right.

## The bubble (the hero)

- **Film**: a thin-film interference shader. Thickness varies over the surface: it drains — thicker at the bottom, thinning toward the top — and swirls slowly (advected noise, with differential rotation so bands wind around the bubble). Thickness maps to the interference colours (magenta → gold → cyan → green bands) computed from the film's optical path for three wavelengths. Then it is *painted*: the bands are softly quantised into washes and lifted toward white so they read as gouache, not as a photograph.
- **Mostly transparent**, with a strong Fresnel rim, a soft four-pane window highlight to the upper left, a smaller second highlight lower right, and a curved, squashed reflection of the garden and a pale sky (a low-resolution capture of the tile, shared by every bubble).
- **Transmission** is the complement of what the film reflects, applied as a very gentle multiply, so whatever is behind or inside a bubble is faintly tinted.
- **Wobble**: a few low spherical-harmonic modes (zonal l = 2, 3 about the axis of each bump), excited when a bubble is drawn, bumps, or merges, ringing down slowly; a slight stretch along the direction of motion.
- **Shadow**: a very faint periwinkle ring on the lawn with a bright caustic dot in the middle — the depth cue, painted and cheap.

## The passengers

Six, chosen by the seed: **bunny**, **chick**, **kitten**, **flower**, **strawberry**, **star**. Picture-book rounded, built from soft puffs (MEADOW's wool for the fluffy three), painted in pastel: a cream bunny with blush inner ears, a butter chick, a peach-and-cream kitten with soft stripes, a pink or periwinkle flower, a strawberry with a dusty-rose body and pale seeds, a butter star. Each has dot eyes; asleep they are closed little lines, curled up, slowly turning. Small blush cheeks on all of them.

## Motion

- Bubbles rise slowly, drift on a soft wandering breeze, sink a little and rise again; they never leave the air above the tile.
- Draw: the circle inflates into a bubble in ~0.4 s with a wobble-pop.
- Bump: a squash along the contact axis that rings down. Merge: one bigger bubble, double wobble, both passengers snuggled inside.
- Pop: the film bursts from the tap point outward — a quick ring of colour and a few droplets — the passenger wakes with a start and drifts down on a petal (flower, strawberry, star twirl down on their own).
- In the garden: bunny hops and nibbles; chick pecks and peeps; kitten stretches, bats at a butterfly and naps; flower plants itself and nods; strawberry sits; star settles and twinkles. All squash-and-stretch.
- Small life never competes: blossom petals drifting, two butterflies, a bee, flowers nodding.
