// ── Adaptive Quality ────────────────────────────────────────────
// Phones vary wildly. Rather than picking one fidelity for everyone,
// watch real frame times and step the render load down (or back up)
// so the game holds a smooth frame rate on whatever it's running on.
//
// Levels trade the least visible things first: backing-store
// resolution (a 3x iPhone canvas is 2.5M pixels to fill every frame),
// then particle counts, then ambient dust. The chosen level is saved
// so the next launch starts where the last one settled instead of
// stuttering through the first few seconds again.

const LEVELS = [
  // maxScale: cap on devicePixelRatio for the canvas backing store
  // particles: multiplier on cosmetic particle counts
  // juice: cap on live juice droplets
  // dust: ambient background motes on/off
  { maxScale: 3,   particles: 1.0,  juice: 220, dust: true  },
  { maxScale: 2,   particles: 0.85, juice: 170, dust: true  },
  { maxScale: 1.5, particles: 0.6,  juice: 120, dust: false },
  { maxScale: 1,   particles: 0.4,  juice: 70,  dust: false },
];

const STORAGE_KEY = 'squishyfruit_quality_v1';

// Frame budget: step down when frames are consistently slower than a
// solid 45 fps; step back up after a long stretch of holding the
// display's refresh. UP_MS sits just above a 60 Hz frame (16.7 ms):
// it used to be 14 ms, which only a 120 Hz screen can ever reach, so a
// 60 Hz phone that dropped a level once (Low Power Mode, a hot phone,
// a busy background app) stayed blurry forever — the level is saved.
const DOWN_MS = 22;
const UP_MS = 17.8;
const DOWN_WINDOW_MS = 2500;  // a single confetti-heavy merge is shorter than this
const UP_WINDOW_MS = 20000;
const MIN_CHANGE_GAP_MS = 5000;
// Stepping back up is capped per session: each change re-renders every
// sprite and re-sizes the canvas, and a phone that keeps bouncing
// between two levels looks worse than one that just stays put.
const MAX_UPGRADES = 2;

let level = 0;
let listeners = [];
let slowAccum = 0;
let fastAccum = 0;
let lastChangeAt = 0;
let ema = 16.7;
let frozenUntil = 0; // ignore samples until then (screen transitions)
let upgradesLeft = MAX_UPGRADES;
// Never climb back to a level this session already had to leave — that
// would just bounce between the two
let upgradeCeiling = 0;

export function init() {
  try {
    const stored = parseInt(localStorage.getItem(STORAGE_KEY));
    if (stored >= 0 && stored < LEVELS.length) level = stored;
  } catch {
    // localStorage unavailable — start at full quality
  }
  lastChangeAt = performance.now();
}

export function getLevel() {
  return level;
}

export function getSettings() {
  return LEVELS[level];
}

export function onChange(fn) {
  listeners.push(fn);
}

function setLevel(next) {
  next = Math.max(0, Math.min(LEVELS.length - 1, next));
  if (next === level) return;
  if (next > level) upgradeCeiling = Math.max(upgradeCeiling, level + 1);
  level = next;
  lastChangeAt = performance.now();
  slowAccum = 0;
  fastAccum = 0;
  try { localStorage.setItem(STORAGE_KEY, String(level)); } catch { /* ignore */ }
  for (const fn of listeners) fn(level, LEVELS[level]);
}

// Ignore frame times for a moment (screen change, sprite cache warmup)
// (Overlapping calls extend the window; the old boolean + timeout let
// the first timeout unfreeze a later, longer settle early.)
export function settle(ms = 800) {
  frozenUntil = Math.max(frozenUntil, performance.now() + ms);
  slowAccum = 0;
}

// Call once per frame with the raw (uncapped) frame delta in ms.
export function sample(rawDelta) {
  if (performance.now() < frozenUntil) return;
  // Tab switches and debugger pauses produce huge deltas — not our problem
  if (rawDelta > 250 || rawDelta <= 0) return;
  ema = ema * 0.9 + rawDelta * 0.1;

  const now = performance.now();
  if (now - lastChangeAt < MIN_CHANGE_GAP_MS) return;

  if (ema > DOWN_MS) {
    slowAccum += rawDelta;
    fastAccum = 0;
    if (slowAccum > DOWN_WINDOW_MS) setLevel(level + 1);
  } else if (ema < UP_MS) {
    fastAccum += rawDelta;
    slowAccum = 0;
    if (fastAccum > UP_WINDOW_MS && level > upgradeCeiling && upgradesLeft > 0) {
      upgradesLeft--;
      setLevel(level - 1);
    }
  } else {
    // In between: bleed off slowness, and just pause the healthy-time
    // count — resetting it here meant any real phone's odd dropped
    // frame restarted the 20 s window, so it could never climb back
    slowAccum = Math.max(0, slowAccum - rawDelta * 0.5);
  }
}

export function getFrameTimeEma() {
  return ema;
}
