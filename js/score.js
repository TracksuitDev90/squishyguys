// ── Score System ────────────────────────────────────────────────
// In-run score/combo state. Persistence (high scores, best combo)
// lives in save.js — this module delegates to it, keyed by the mode
// set via setMode at the start of each run.
import * as Save from './save.js';

export let current = 0;
export let combo = 0;
export let bestCombo = 0; // best single combo point total (this mode, all-time)
export let mergeCount = 0; // merges this run — feeds the coin payout
let mode = 'classic';
let comboTimer = null;
let currentComboPoints = 0; // points accumulated in the current combo

// Called by startGame so combo/high-score records land on the right mode.
export function setMode(m) {
  mode = m;
}

export function addPoints(points) {
  combo++;
  mergeCount++;
  const comboMultiplier = Math.min(combo, 5);
  const earned = points * comboMultiplier;
  current += earned;
  currentComboPoints += earned;

  // Reset combo after 1 second of no merges
  clearTimeout(comboTimer);
  comboTimer = setTimeout(() => {
    // Combo ended — check if this was the best single combo
    if (currentComboPoints > bestCombo) {
      bestCombo = currentComboPoints;
      Save.submitBestCombo(mode, bestCombo);
    }
    // Zen runs never reach the game-over save path, so bank the high
    // score here too — combo end is a natural, throttled save point.
    if (mode === 'zen') {
      Save.submitScore('zen', current);
    }
    currentComboPoints = 0;
    combo = 0;
  }, 1000);
}

// Module namespace properties are read-only from the outside,
// so spending must go through here.
export function spend(amount) {
  current = Math.max(0, current - amount);
}

export function getBestCombo() {
  return Save.getBestCombo(mode);
}

export function getHighScore(m = 'classic') {
  return Save.getHighScore(m);
}

// Persists best combo and high score for the given mode. Returns true
// if this run set a new high score (used for the "NEW BEST!" celebration).
export function saveHighScore(m = 'classic') {
  // Flush any in-progress combo before saving
  if (currentComboPoints > bestCombo) {
    bestCombo = currentComboPoints;
  }
  Save.submitBestCombo(m, bestCombo);
  return Save.submitScore(m, current);
}

export function reset() {
  current = 0;
  combo = 0;
  mergeCount = 0;
  currentComboPoints = 0;
  clearTimeout(comboTimer);
  // Reload best from storage so it persists across games
  bestCombo = Save.getBestCombo(mode);
}
