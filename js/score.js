// ── Score System ────────────────────────────────────────────────
const STORAGE_KEY = 'squishyguys_bestcombo';

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

export function getBestCombo() {
  try {
    return parseInt(localStorage.getItem(STORAGE_KEY)) || 0;
  } catch {
    return 0;
  }
}

function saveBestCombo() {
  try {
    const best = Math.max(bestCombo, getBestCombo());
    localStorage.setItem(STORAGE_KEY, best.toString());
  } catch {
    // localStorage unavailable
  }
}

export function saveHighScore() {
  // Flush any in-progress combo before saving
  if (currentComboPoints > bestCombo) {
    bestCombo = currentComboPoints;
  }
  saveBestCombo();
}

export function reset() {
  current = 0;
  combo = 0;
  currentComboPoints = 0;
  // Reload best from storage so it persists across games
  bestCombo = getBestCombo();
}
