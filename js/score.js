// ── Score System ────────────────────────────────────────────────
// In-run score/combo state. Persistence (high scores, best combo)
// lives in save.js — this module delegates to it.
import * as Save from './save.js';

export let current = 0;
export let combo = 0;
export let bestCombo = 0; // best single combo point total (all-time)
export let mergeCount = 0; // merges this run — feeds the coin payout
let comboTimer = null;
let currentComboPoints = 0; // points accumulated in the current combo

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
      Save.submitBestCombo(bestCombo);
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
  return Save.getBestCombo();
}

export function getHighScore(mode = 'classic') {
  return Save.getHighScore(mode);
}

// Persists best combo and high score for the given mode. Returns true
// if this run set a new high score (used for the "NEW BEST!" celebration).
export function saveHighScore(mode = 'classic') {
  // Flush any in-progress combo before saving
  if (currentComboPoints > bestCombo) {
    bestCombo = currentComboPoints;
  }
  Save.submitBestCombo(bestCombo);
  return Save.submitScore(mode, current);
}

export function reset() {
  current = 0;
  combo = 0;
  mergeCount = 0;
  currentComboPoints = 0;
  // Reload best from storage so it persists across games
  bestCombo = Save.getBestCombo();
}
