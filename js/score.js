// ── Score System ────────────────────────────────────────────────
const COMBO_KEY = 'squishyguys_bestcombo';
const SCORE_KEY = 'squishyguys_highscore';

export let current = 0;
export let combo = 0;
export let bestCombo = 0; // best single combo point total this session
let comboTimer = null;
let currentComboPoints = 0; // points accumulated in the current combo

export function addPoints(points) {
  combo++;
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
      saveBestCombo();
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
  try {
    return parseInt(localStorage.getItem(COMBO_KEY)) || 0;
  } catch {
    return 0;
  }
}

export function getHighScore() {
  try {
    return parseInt(localStorage.getItem(SCORE_KEY)) || 0;
  } catch {
    return 0;
  }
}

function saveBestCombo() {
  try {
    const best = Math.max(bestCombo, getBestCombo());
    localStorage.setItem(COMBO_KEY, best.toString());
  } catch {
    // localStorage unavailable
  }
}

// Persists best combo and high score. Returns true if this run set a
// new high score (used for the "NEW BEST!" celebration).
export function saveHighScore() {
  // Flush any in-progress combo before saving
  if (currentComboPoints > bestCombo) {
    bestCombo = currentComboPoints;
  }
  saveBestCombo();

  const isNewBest = current > 0 && current > getHighScore();
  if (isNewBest) {
    try {
      localStorage.setItem(SCORE_KEY, current.toString());
    } catch {
      // localStorage unavailable
    }
  }
  return isNewBest;
}

export function reset() {
  current = 0;
  combo = 0;
  currentComboPoints = 0;
  // Reload best from storage so it persists across games
  bestCombo = getBestCombo();
}
