// ── Persistent Save System ──────────────────────────────────────
// Single versioned JSON document in localStorage. Everything that
// survives across runs lives here: coins, unlocks, per-mode high
// scores, settings. Legacy keys (pre-save-system high score/combo)
// are migrated on first load but left in place for rollback safety.

const SAVE_KEY = 'squishyfruit_save_v1';
// Keys from before the game was renamed from Squishy Guys — the save
// doc migrates on first load, older keys stay put for rollback safety.
const LEGACY_SAVE_KEY = 'squishyguys_save_v1';
const LEGACY_SCORE_KEY = 'squishyguys_highscore';
const LEGACY_COMBO_KEY = 'squishyguys_bestcombo';

const DEFAULT_SAVE = {
  version: 1,
  coins: 0,
  totalCoinsEarned: 0,
  gamesPlayed: 0,
  unlockedSkins: ['classic'],
  selectedSkin: 'classic',
  upgrades: { startCup: 0, discount: 0 },
  highScores: { classic: 0, rush: 0, zen: 0 },
  bestCombo: 0, // legacy single-value combo — migrated into bestCombos
  bestCombos: { classic: 0, rush: 0, zen: 0 },
  muted: false,
};

let save = null;

// Merge a (possibly partial or corrupt) stored doc into the defaults
// so missing fields from older versions never crash the game.
function mergeWithDefaults(base, patch) {
  const out = {};
  for (const key of Object.keys(base)) {
    const b = base[key];
    const p = patch ? patch[key] : undefined;
    if (Array.isArray(b)) {
      out[key] = Array.isArray(p) ? p.slice() : b.slice();
    } else if (b !== null && typeof b === 'object') {
      out[key] = mergeWithDefaults(b, p);
    } else {
      out[key] = typeof p === typeof b ? p : b;
    }
  }
  return out;
}

function load() {
  if (save) return save;

  let stored = null;
  try {
    stored = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (!stored) {
      stored = JSON.parse(localStorage.getItem(LEGACY_SAVE_KEY));
    }
  } catch {
    stored = null;
  }

  if (stored && typeof stored === 'object') {
    save = mergeWithDefaults(DEFAULT_SAVE, stored);
    persist(); // re-home saves loaded from the pre-rename key
  } else {
    save = mergeWithDefaults(DEFAULT_SAVE, null);
    // First run (or corrupt doc): pull in the legacy high score/combo
    try {
      save.highScores.classic = parseInt(localStorage.getItem(LEGACY_SCORE_KEY)) || 0;
      save.bestCombo = parseInt(localStorage.getItem(LEGACY_COMBO_KEY)) || 0;
    } catch {
      // localStorage unavailable
    }
    persist();
  }

  // Older saves tracked one global best combo; seed the per-mode
  // records with it (classic was the only mode when it existed).
  if (save.bestCombo > save.bestCombos.classic) {
    save.bestCombos.classic = save.bestCombo;
    persist();
  }

  // The default skin must always be owned
  if (!save.unlockedSkins.includes('classic')) {
    save.unlockedSkins.unshift('classic');
  }
  return save;
}

function persist() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch {
    // localStorage unavailable (private browsing, quota) — play on in-memory
  }
}

// ── Coins ───────────────────────────────────────────────────────
export function getCoins() {
  return load().coins;
}

export function addCoins(n) {
  const doc = load();
  doc.coins += n;
  doc.totalCoinsEarned += n;
  persist();
}

export function spendCoins(n) {
  const doc = load();
  if (doc.coins < n) return false;
  doc.coins -= n;
  persist();
  return true;
}

// ── Skins ───────────────────────────────────────────────────────
export function isSkinUnlocked(id) {
  return load().unlockedSkins.includes(id);
}

export function unlockSkin(id) {
  const doc = load();
  if (!doc.unlockedSkins.includes(id)) {
    doc.unlockedSkins.push(id);
    persist();
  }
}

export function getSelectedSkin() {
  return load().selectedSkin;
}

export function setSelectedSkin(id) {
  const doc = load();
  doc.selectedSkin = id;
  persist();
}

// ── Upgrades ────────────────────────────────────────────────────
export function getUpgradeLevel(id) {
  return load().upgrades[id] || 0;
}

export function incrementUpgrade(id) {
  const doc = load();
  doc.upgrades[id] = (doc.upgrades[id] || 0) + 1;
  persist();
}

// ── High Scores (per mode) ──────────────────────────────────────
export function getHighScore(mode) {
  return load().highScores[mode] || 0;
}

// Returns true if this run set a new best for the mode (drives the
// "NEW BEST!" celebration).
export function submitScore(mode, score) {
  const doc = load();
  const prev = doc.highScores[mode] || 0;
  const isNewBest = score > 0 && score > prev;
  if (isNewBest) {
    doc.highScores[mode] = score;
    persist();
  }
  return isNewBest;
}

// Best combos are tracked per mode — zen runs never hit a game-over
// screen, so its record is submitted live as each combo ends.
export function getBestCombo(mode = 'classic') {
  return load().bestCombos[mode] || 0;
}

export function submitBestCombo(mode, value) {
  const doc = load();
  if (value > (doc.bestCombos[mode] || 0)) {
    doc.bestCombos[mode] = value;
    // Keep the legacy field at the all-mode max for rollback safety
    doc.bestCombo = Math.max(doc.bestCombo, value);
    persist();
  }
}

// ── Settings & Stats ────────────────────────────────────────────
export function getMuted() {
  return load().muted;
}

export function setMuted(muted) {
  const doc = load();
  doc.muted = !!muted;
  persist();
}

export function getGamesPlayed() {
  return load().gamesPlayed;
}

export function incrementGamesPlayed() {
  const doc = load();
  doc.gamesPlayed++;
  persist();
}
