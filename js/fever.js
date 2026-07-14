// ── Fever System ────────────────────────────────────────────────
// Chained merges fill the meter; when it tops out, a short frenzy
// window starts: double points, half drop cooldown, escalated
// audio/visuals. Merges don't refill the meter mid-frenzy (no
// infinite fever), and it drains as the countdown display instead.
// All timing runs on frame delta — like the physics, it pauses with
// requestAnimationFrame when the tab is backgrounded.
import {
  FEVER_FILL_BASE, FEVER_FILL_COMBO_BONUS, FEVER_GRACE_MS,
  FEVER_DECAY_PER_SEC, FEVER_DURATION_MS, FEVER_SCORE_MULT,
  FEVER_COOLDOWN_SCALE,
} from './config.js';

let meter = 0; // 0-1; doubles as the remaining-time display while active
let active = false;
let remainingMs = 0;
let graceMs = 0;
let startedThisFrame = false;

// Returns true if this merge tipped the meter over and started frenzy.
export function onMerge(combo) {
  if (active) return false;
  meter = Math.min(meter + FEVER_FILL_BASE + combo * FEVER_FILL_COMBO_BONUS, 1);
  graceMs = FEVER_GRACE_MS;
  if (meter >= 1) {
    active = true;
    remainingMs = FEVER_DURATION_MS;
    startedThisFrame = true;
    return true;
  }
  return false;
}

// Call once per frame. Returns { started, ended } event flags so the
// game loop can fire stingers/shake exactly once per transition.
export function update(delta) {
  const events = { started: startedThisFrame, ended: false };
  startedThisFrame = false;

  if (active) {
    remainingMs -= delta;
    if (remainingMs <= 0) {
      active = false;
      meter = 0;
      graceMs = 0;
      events.ended = true;
    } else {
      meter = remainingMs / FEVER_DURATION_MS;
    }
  } else if (meter > 0) {
    if (graceMs > 0) {
      graceMs -= delta;
    } else {
      meter = Math.max(0, meter - FEVER_DECAY_PER_SEC * (delta / 1000));
    }
  }

  return events;
}

export function isActive() {
  return active;
}

export function getMeter() {
  return meter;
}

export function getMultiplier() {
  return active ? FEVER_SCORE_MULT : 1;
}

export function getCooldownScale() {
  return active ? FEVER_COOLDOWN_SCALE : 1;
}

export function reset() {
  meter = 0;
  active = false;
  remainingMs = 0;
  graceMs = 0;
  startedThisFrame = false;
}
