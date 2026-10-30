# BUBBLES — case study

## The brief, kept small

Draw a circle; it becomes a soap bubble with someone tiny asleep inside; it floats away; tap it and it pops, and the passenger drifts down on a petal and stays. One gesture, one thing it makes, one thing to do to it. Everything that was tempting and not that — a wand, a passenger picker, colours, a score for popping — was left out, and the time went into the bubble itself.

## Where it came from

BUBBLES is forked from **DUCKLINGS**' engine, not from LANTERNS or SKY. DUCKLINGS already had what a daylight garden needs: a painted tile in MEADOW's style with a sun shadow map over the whole tile, a worker that meshes soft signed-distance characters once per kind, and the family's interaction, document and UI layers. The pond, the bridge and the ducks came out; a garden layout (`src/scene/garden.ts`, with a GLSL twin in `terrain.ts`) and the bubble system went in. `docs/SIBLINGS.md` lists every adapted piece.

## The bubble

**The film** (`src/bubble/film.ts`) is a thin-film interference shader. Thickness is a field over the unit sphere: it *drains* (≈780 nm at the bottom down to ≈170 nm at the top, where a real bubble turns black just before it pops), it *swirls* with differential rotation (the bands wind around the bubble faster at the top than the bottom), a domain warp makes slow swirling cells, and plumes of fresh film rise from the thick bottom. Thickness becomes colour by computing the interference of a 1.33-index film for three wavelengths. Then it is *painted*: the thickness is soft-quantised into 46 nm steps so the colours lie in washes with soft edges rather than a photographic gradient, the bands are pushed a little toward the magenta–gold–cyan–green family and lifted toward chalky white.

**Three passes per bubble**, back to front among bubbles:

1. *Back* — the far wall of film seen from inside: a faint wash and a weak reflection, depth-tested so a passenger hides it.
2. *Tint* — a true multiply (`DstColor × src`) by the light the film lets through, which is the complement of what it reflects, kept very gentle. This is what makes a passenger look like it's *behind* film rather than pasted on top.
3. *Front* — the interference wash, strongest toward the Fresnel rim and broken a little like a wet brush; a thin painted outline where the film turns edge-on; the garden's reflection; a soft four-pane window highlight; and its echo, small and low on the opposite side.

**The reflection** is one low-resolution cube capture of the garden from the middle of the air, with a pale sky dome only that camera sees, shared by every bubble and refreshed only when the garden changes (throttled to once every three seconds). Bubbles and their riders are hidden from it.

**The wobble** (`src/bubble/wobble.ts`) is a handful of zonal Legendre modes (l = 2 squash/stretch, l = 3 pear) about the axis each was struck along, ringing at a Rayleigh-like frequency (ω ∝ 1/r^1.5, so small bubbles quiver faster) and decaying over ~1.7 s. Drawing, bumping and merging each strike modes; a merge strikes three (a double wobble). The vertex shader evaluates the same modes, rebuilds the normal from two neighbouring shaped points, and adds a slight volume-preserving stretch along the velocity.

**The shadow** is not in the shadow map — a soap film stops almost no light, and a real-time shadow of a sphere is a dark disc. Instead the ground shader computes, for each of up to sixteen bubbles, how far its sun-ray passes from the bubble's centre, and paints a faint periwinkle ring with a bright caustic dot, softer and fainter the higher the bubble floats. It's exact on the uneven lawn and costs nothing per bubble outside the ring.

**The pop** sweeps a hole across the film from the tap point (in the direction on the sphere, in 0.17 s) with a bright retreating ring of colour; a spray of droplets flies outward. With reduced motion it fades instead, without droplets.

## The float

`src/bubble/sim.ts` is a fixed-step (1/60 s) deterministic simulation. Each bubble is buoyant toward a cruising height that wanders slowly (so it sinks a little and rises again), carried by a breeze that turns over minutes (smaller bubbles answer it faster), and held inside an invisible dome over the tile by soft springs. Touching bubbles either **bump** (equal and opposite, massed by volume, with a wobble each) or, meeting slowly, **cling**: their velocities blend to a common one and after 0.45 s in contact they **merge** — volume, momentum and the centre of volume conserved, the bigger one keeping its identity, both passengers inside. A faint pull across the last half metre lets bubbles that drift near each other find each other. After about two minutes (seeded) a bubble pops by itself, near the top where the film is thinnest.

Two things went wrong first. The cling originally *pulled* the bubbles together, which accelerated them past the merge threshold so they bounced forever; it now damps their relative motion instead. And `advance()` caps each call at a quarter-second to survive frame hitches — which silently made unit tests that called `advance(3)` simulate only 0.25 s. The tests step frame by frame now.

## The passengers

The first passengers used MEADOW's wool (hundreds of rounded puffs unioned over a body). At this size it read as sponge or cauliflower, not as a bunny. They are now smooth plush signed-distance bodies with the faintest lumpiness, and the fluff is the material's two fur shells — picture-book round silhouettes with a soft edge. Each kind builds in its own worker, in parallel (the tests on a heavily loaded machine showed a single worker could take far too long). Paint is one material with a part id: a cream (or lilac-grey, or butter) bunny with blush inner ears, a butter chick, a striped peach (or lilac, or cream) kitten, a pink / periwinkle / butter flower, a dusty-rose strawberry with pale seeds and a clear face, a softly glowing butter star that twinkles. Everyone has dot eyes that close to a line when asleep, and blush cheeks.

Poses are pure functions of kind, seed and time (`src/char/behaviors.ts`), like MEADOW's: asleep (curled, breathing), the fall (a start, then the petal parasol or a twirl, a sway that dies away so it lands exactly under where it popped), and the garden idles — the bunny's nibble / three hops / sit-up-and-look cycle around its home, the chick's three pecks and a peep, the kitten's sit / long stretch / batting the air / nap, and the plants' nods and wiggles. Squash-and-stretch throughout.

## Document and undo

The document is `{ version: 1, bubbles: [{ id, r, passengers: [seed…], names?, born, x, y, z }], garden: [{ id, kind, seed, x, z, heading, name? }] }`, validated on load (clamped, capped at 16 and 24, ids de-duplicated, untrusted names cleaned). Drawing, popping, bubbling up, removing, renaming and moving are undoable commits. World events — a merge, a bubble that popped by itself, where bubbles have drifted to — *amend* the present without an undo step. `born` is wall-clock time, so a bubble reloads as old as it is; one that is already past its life pops a few seconds after the page opens, staggered, rather than all at once. A pop that overflows the garden lets the longest-standing friends wave goodbye.

The one addition to the spec's document: `names` on a bubble, parallel to its passengers, so a friend you named keeps its name when you bubble it back up.

## Testing

- Unit (Vitest): stroke → bubble (centre, radius from area, either direction, lumpy eggs accepted, open/small/squiggle rejected), the float (determinism, dome containment, rising, slow merges conserving volume with both passengers, fast bumps, size cap, two-minute expiry), the wobble ringing down, the document (pop → landed passengers, garden overflow, merges, bubble-up keeps names, rename/move/remove), validation of hostile input, undo/redo with amend.
- End-to-end (Playwright, real Chromium on Metal): the garden renders on paper; a drawn circle becomes a bubble of the drawn size at the drawn place and floats up; rejections; a tap pops it and the passenger falls and lands under it; a Pop-mode swipe pops three; a slow meeting merges; name / bubble up / remove / undo / redo / keyboard; drag; clear / undo / reload; PNG export; 16 bubbles + 24 friends with a GPU-synced frame budget; reduced motion; touch on a phone viewport. Dev and production builds.
- Visual QA: `scripts/closeup.mjs` (bubbles over light and dark ground, the film over time), `scripts/pop.mjs` (the pop frame by frame and the fall), `scripts/passengers.mjs` (each passenger awake from four angles and asleep), phone portrait, and the demo's contact sheet.

The machine this was built on was running at a load average of 60–150 from other work (an iOS Simulator, Docker, another session's test suite). The first navigation of a fresh browser sometimes took many minutes; tests that failed only on that load timeout passed on re-run, and the timeouts were raised.

## What's incomplete

- The "refraction" of passengers seen through the film is a gentle tint (the transmission multiply), not a true screen-space refraction — physically a soap film barely refracts, and a screen copy pass would have doubled the cost of overlapping bubbles.
- Bubbles that bump only wobble; they don't deform against each other into the flat shared wall two touching real bubbles make (they merge before that would be needed).
- The kitten bats at the air above it, not at the real butterfly's position.
- An undo after a bubble has popped by itself can bring that bubble back (world events amend the present; earlier snapshots still hold it).
- The demo in `docs/media` ran long (31 s, ~24 fps) because the machine was overloaded while recording; `scripts/demo.mjs` is paced for about 19 s and should be re-recorded on a quiet machine. The film-over-time filmstrip from `scripts/gallery.mjs` wasn't generated for the same reason, and the passenger sheet's "from behind" row is blocked by test bubbles (the script is fixed; the image predates the fix).
- The end-to-end suite has passed test by test across dev and production runs, but never in a single clean pass: on this machine (load 60–150) some runs timed out on the first page load or on the 16-bubble frame-time budget (287 ms frames at load ~90).
- Not deployed — waiting for the owner's go-ahead (`npx vercel --prod`).
