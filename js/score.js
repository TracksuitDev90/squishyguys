// ── Score System ────────────────────────────────────────────────
const STORAGE_KEY = 'squishyguys_highscore';

export let current = 0;
export let combo = 0;
let comboTimer = null;

export function addPoints(points) {
  combo++;
  const comboMultiplier = Math.min(combo, 5);
  current += points * comboMultiplier;

  // Reset combo after 1 second of no merges
  clearTimeout(comboTimer);
  comboTimer = setTimeout(() => { combo = 0; }, 1000);
}

export function getHighScore() {
  try {
    return parseInt(localStorage.getItem(STORAGE_KEY)) || 0;
  } catch {
    return 0;
  }
}

export function saveHighScore() {
  try {
    const best = Math.max(current, getHighScore());
    localStorage.setItem(STORAGE_KEY, best.toString());
  } catch {
    // localStorage unavailable
  }
}

export function reset() {
  current = 0;
  combo = 0;
}
