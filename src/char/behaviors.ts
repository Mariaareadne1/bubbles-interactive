import type { Kind } from './shapes';

/**
 * Pure poses: what a passenger is doing at a time, from its kind, its seed
 * and the moment it started. No state — the same arguments always give the
 * same pose — so reloads, recordings and tests line up, as in MEADOW.
 */

export interface Pose {
  /** Offset from home on the ground (m) — a bunny's hops, a chick's shuffle. */
  dx: number;
  dz: number;
  /** Height above where it sits (m). */
  lift: number;
  /** Turn from its resting heading (rad). */
  turn: number;
  /** + squashed down and out, − stretched up. */
  squash: number;
  /** Long stretch forward (the kitten's). */
  stretch: number;
  pitch: number;
  roll: number;
  headPitch: number;
  headYaw: number;
  headRoll: number;
  /** 0 ears up .. 1 laid back. */
  ears: number;
  /** Ear twitch, −1..1. */
  earTwitch: number;
  tail: number;
  pawL: number;
  pawR: number;
  /** 0 closed .. 1 open. */
  eyes: number;
  /** 0..1 curled up asleep. */
  curl: number;
  /** Extra twirl about the vertical (the flower, strawberry and star float down spinning). */
  spin: number;
  /** 0..1 the star's twinkle. */
  twinkle: number;
  /** 0..1 holding the petal overhead. */
  parasol: number;
  /** Wing flutter (the chick). */
  wing: number;
}

export const restPose = (): Pose => ({
  dx: 0, dz: 0, lift: 0, turn: 0, squash: 0, stretch: 0, pitch: 0, roll: 0, headPitch: 0, headYaw: 0, headRoll: 0,
  ears: 0, earTwitch: 0, tail: 0, pawL: 0, pawR: 0, eyes: 1, curl: 0, spin: 0, twinkle: 0, parasol: 0, wing: 0,
});

/** Does this kind float down on a petal (the animals) or twirl down on its own? */
export const usesParasol = (kind: Kind) => kind === 'bunny' || kind === 'chick' || kind === 'kitten';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
/** A bump 0→1→0 over [a, b]. */
const bump = (a: number, b: number, x: number) => (x <= a || x >= b ? 0 : Math.sin(((x - a) / (b - a)) * Math.PI));

function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** 0..1 blink pulses every few seconds. */
export function blink(t: number, seed: number): number {
  const period = 3.2 + hash(seed) * 2.5;
  const ph = ((t + seed * 7) % period) / period;
  return bump(0, 0.035, ph);
}

// --- in the bubble ---------------------------------------------------------------------

/** Curled up asleep, breathing slowly. */
export function asleepPose(t: number, seed: number): Pose {
  const p = restPose();
  const breath = Math.sin(t * 1.5 + seed * 6.28);
  p.curl = 1;
  p.eyes = 0;
  p.ears = 0.85;
  p.squash = 0.08 + breath * 0.025;
  p.headPitch = 0.32 + breath * 0.02;
  p.headRoll = 0.18;
  p.tail = 0.2;
  return p;
}

// --- popped: waking, descending, landing ------------------------------------------------------

/** Seconds of the little start before the passenger takes hold of its petal. */
export const WAKE_TIME = 0.7;
/** Descent speed under a petal (m/s). */
export const FALL_SPEED = 0.55;

export function descentDuration(height: number): number {
  return Math.max(1.4, height / FALL_SPEED);
}

/**
 * From the pop until it lands: wake with a start, then drift down. `height` is
 * how far above its landing spot the bubble burst. The sideways sway dies away
 * so it lands exactly under where it was.
 */
export function fallPose(kind: Kind, since: number, height: number, seed: number): Pose {
  const p = restPose();
  const dur = descentDuration(height);
  if (since < WAKE_TIME) {
    // eyes snap open, a jolt, ears up
    const u = since / WAKE_TIME;
    p.eyes = since < 0.08 ? 0 : 1;
    p.curl = 1 - smooth(0, 0.35, u);
    p.squash = -0.28 * bump(0.05, 0.45, u) + 0.12 * bump(0.45, 0.9, u);
    p.ears = 0.85 * (1 - smooth(0.05, 0.3, u));
    p.headPitch = -0.25 * bump(0.1, 0.6, u);
    p.wing = bump(0.1, 0.9, u) * (0.5 + 0.5 * Math.sin(since * 40));
    p.lift = height;
    p.parasol = usesParasol(kind) ? smooth(0.4, 1, u) : 0;
    p.spin = 0;
    return p;
  }
  const f = since - WAKE_TIME;
  const u = clamp01(f / dur);
  // ease in to the fall, settle softly at the end
  const fallen = u < 1 ? u * u * (3 - 2 * u) * 0.6 + u * 0.4 : 1;
  p.lift = height * (1 - fallen);
  const fade = 1 - u;
  const sway = Math.sin(f * 2.1 + seed * 6.28);
  p.dx = sway * 0.22 * fade;
  p.dz = Math.cos(f * 1.6 + seed * 3.1) * 0.12 * fade;
  p.roll = sway * 0.28 * fade;
  p.eyes = 1 - blink(f, seed);
  p.ears = 0.2;
  if (usesParasol(kind)) {
    p.parasol = 1;
    p.pitch = 0.06 * Math.sin(f * 1.3);
    p.pawL = p.pawR = 0.9;
    p.wing = kind === 'chick' ? 0.5 + 0.5 * Math.sin(f * 14) : 0;
    p.tail = 0.4 * Math.sin(f * 2.4);
  } else {
    p.spin = f * 2.6 * (0.6 + 0.8 * fade);
    p.pitch = 0.2 * Math.sin(f * 1.9);
  }
  return p;
}

/** Total seconds from the pop to standing on the ground. */
export function landingTime(height: number): number {
  return WAKE_TIME + descentDuration(height);
}

// --- in the garden ---------------------------------------------------------------------------

/** One hop target near home for hop cycle k (bunny) — within about half a metre. */
export function hopTarget(seed: number, k: number): [number, number] {
  if (k <= 0) return [0, 0];
  const a = hash(seed * 13.7 + k * 3.1) * Math.PI * 2;
  const r = 0.15 + hash(seed * 5.3 + k * 7.7) * 0.32;
  return [Math.cos(a) * r, Math.sin(a) * r];
}

/** A passenger at home in the garden, `t` seconds after it landed (or was placed). */
export function gardenPose(kind: Kind, t: number, seed: number): Pose {
  const p = restPose();
  // the first moment on the ground: a squash as it lands
  const land = Math.max(0, 1 - t / 0.35);
  p.squash = 0.3 * land * land;
  p.eyes = 1 - blink(t, seed);
  switch (kind) {
    case 'bunny': return bunny(p, t, seed);
    case 'chick': return chick(p, t, seed);
    case 'kitten': return kitten(p, t, seed);
    case 'flower': {
      p.headPitch = Math.sin(t * 1.1 + seed * 6) * 0.16;
      p.headRoll = Math.sin(t * 0.8 + seed * 3) * 0.1;
      p.roll = Math.sin(t * 0.7 + seed) * 0.05;
      return p;
    }
    case 'strawberry': {
      // now and then a happy little wiggle
      const ph = (t + seed * 11) % 7;
      p.roll = Math.sin(ph * 14) * 0.09 * bump(0, 0.9, ph);
      p.squash += 0.06 * bump(0.9, 1.3, ph);
      return p;
    }
    case 'star': {
      const tw = Math.pow(0.5 + 0.5 * Math.sin(t * 2.2 + seed * 6), 6);
      p.twinkle = tw;
      p.pitch = -0.22;
      p.lift = 0.015 * Math.sin(t * 1.3 + seed);
      p.squash -= tw * 0.03;
      return p;
    }
  }
}

const BUNNY_CYCLE = 9;

function bunny(p: Pose, t: number, seed: number): Pose {
  const off = seed * BUNNY_CYCLE;
  const k = Math.floor((t + off) / BUNNY_CYCLE);
  const ph = (t + off) % BUNNY_CYCLE;
  const [ax, az] = hopTarget(seed, k);
  const [bx, bz] = hopTarget(seed, k + 1);
  if (ph < 4.4) {
    // sits and nibbles the grass, nose busy, an ear flicking
    p.dx = ax; p.dz = az;
    p.headPitch = 0.4 * smooth(0.2, 0.7, ph) * (1 - smooth(3.8, 4.3, ph)) + 0.04 * Math.sin(t * 22) * bump(0.7, 3.8, ph);
    p.earTwitch = bump(1.6, 1.9, ph) - bump(3.0, 3.25, ph);
  } else if (ph < 6.2) {
    // three hops toward the next spot
    const u = (ph - 4.4) / 1.8;
    const hop = Math.min(2, Math.floor(u * 3));
    const hu = u * 3 - hop;
    const along = (hop + smooth(0, 1, hu)) / 3;
    p.dx = ax + (bx - ax) * along;
    p.dz = az + (bz - az) * along;
    p.lift = 0.11 * Math.sin(hu * Math.PI);
    p.squash = hu < 0.15 ? 0.25 * (1 - hu / 0.15) : hu > 0.85 ? 0.25 * ((hu - 0.85) / 0.15) : -0.18 * Math.sin(hu * Math.PI);
    p.pitch = -0.25 * Math.sin(hu * Math.PI);
    p.ears = 0.3 * Math.sin(hu * Math.PI);
    p.turn = Math.atan2(-(bz - az), bx - ax);
  } else {
    // sits up tall and looks about
    p.dx = bx; p.dz = bz;
    p.squash = -0.08 * smooth(6.2, 6.6, ph) * (1 - smooth(8.5, 9, ph));
    p.headYaw = 0.5 * Math.sin((ph - 6.2) * 1.6);
    p.earTwitch = bump(7.2, 7.5, ph);
  }
  if (ph >= 4.4 && ph < 6.2) return p;
  // facing: where it last hopped to
  const [px, pz] = ph < 4.4 ? hopTarget(seed, k - 1) : [ax, az];
  const [qx, qz] = ph < 4.4 ? [ax, az] : [bx, bz];
  p.turn = qx === px && qz === pz ? 0 : Math.atan2(-(qz - pz), qx - px);
  return p;
}

function chick(p: Pose, t: number, seed: number): Pose {
  const cycle = 6;
  const ph = (t + seed * cycle) % cycle;
  const k = Math.floor((t + seed * cycle) / cycle);
  // pecks at the ground three times, a shuffle round, then a peep with a flutter
  const peck = bump(0.3, 0.6, ph) + bump(0.9, 1.2, ph) + bump(1.5, 1.8, ph);
  p.headPitch = 0.55 * peck;
  p.pitch = 0.25 * peck;
  p.turn = (hash(seed + k) - 0.5) * 2.4 * smooth(2.2, 3.0, ph) + (hash(seed + k - 1) - 0.5) * 2.4 * (1 - smooth(2.2, 3.0, ph));
  p.lift = 0.03 * Math.abs(Math.sin(ph * 9)) * bump(2.2, 3.0, ph);
  const peep = bump(4.0, 4.5, ph);
  p.headPitch -= 0.35 * peep;
  p.squash -= 0.12 * peep;
  p.wing = peep * (0.5 + 0.5 * Math.sin(ph * 40));
  return p;
}

function kitten(p: Pose, t: number, seed: number): Pose {
  const cycle = 18;
  const ph = (t + seed * cycle) % cycle;
  p.tail = 0.5 * Math.sin(t * 1.3 + seed * 4);
  if (ph < 5) {
    p.headYaw = 0.35 * Math.sin(ph * 0.9);
  } else if (ph < 7.2) {
    // a long stretch: front low, back up, paws out
    const s = bump(5, 7.2, ph);
    p.stretch = s;
    p.pitch = 0.22 * s;
    p.headPitch = -0.2 * s;
    p.eyes = 1 - s * 0.9;
    p.ears = 0.3 * s;
  } else if (ph < 10.5) {
    // batting at a butterfly: up on its haunches, swiping the air
    const u = ph - 7.2;
    p.headPitch = -0.55 * smooth(0, 0.4, u) * (1 - smooth(2.9, 3.3, u));
    p.pitch = -0.28 * smooth(0, 0.4, u) * (1 - smooth(2.9, 3.3, u));
    p.pawL = bump(0.5, 0.9, u) + bump(1.5, 1.85, u) + bump(2.4, 2.75, u);
    p.pawR = bump(1.0, 1.35, u) + bump(2.0, 2.3, u);
    p.lift = 0.04 * (bump(1.4, 1.9, u) + bump(2.3, 2.8, u));
    p.tail = 0.9 * Math.sin(u * 8);
  } else if (ph < 17.4) {
    // a nap in a loaf, tail wrapped round
    const s = smooth(10.5, 11.3, ph) * (1 - smooth(16.8, 17.4, ph));
    p.curl = 0.75 * s;
    p.eyes *= 1 - s;
    p.headPitch = 0.3 * s;
    p.ears = 0.4 * s;
    p.squash = 0.06 * s + 0.02 * Math.sin(t * 1.4) * s;
    p.tail = 0.15 * s + p.tail * (1 - s);
  }
  return p;
}

/** Saying goodbye: a little wave (or a bow), then gone. Returns the fade too. */
export function leavePose(kind: Kind, since: number, seed: number): { pose: Pose; fade: number } {
  const p = gardenPose(kind, 10 + seed * 3, seed);
  p.dx = p.dz = 0;
  const wave = bump(0, 0.9, since);
  if (kind === 'flower' || kind === 'strawberry' || kind === 'star') {
    p.roll = Math.sin(since * 12) * 0.2 * wave;
    p.lift += 0.05 * wave;
  } else {
    p.pawR = wave * (0.8 + 0.3 * Math.sin(since * 16));
    p.headRoll = 0.25 * wave;
    p.wing = wave * (0.5 + 0.5 * Math.sin(since * 30));
  }
  p.eyes = 1;
  return { pose: p, fade: 1 - smooth(0.7, 1.3, since) };
}

export const LEAVE_TIME = 1.3;
