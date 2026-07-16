// ── Game Configuration ──────────────────────────────────────────
export const GAME_WIDTH = 400;
export const GAME_HEIGHT = 700;

// Cup geometry — the walls flare outward so the base sits slightly
// wider than the rim (CUP_LEFT_X/RIGHT_X describe the rim).
export const CUP_WALL_THICKNESS = 12;
export const CUP_BASE_EXTRA = 14;
export const CUP_BOTTOM_Y = GAME_HEIGHT - 20;
export const CUP_TOP_Y = 320;
export const CUP_LEFT_X = 60;
export const CUP_RIGHT_X = GAME_WIDTH - 60;
export const CUP_FLOOR_Y = CUP_BOTTOM_Y;

// Danger line — balls above this for too long = game over
export const DANGER_LINE_Y = CUP_TOP_Y + 30;
export const DANGER_DURATION_MS = 2000;

// Drop mechanics
export const DROP_Y = CUP_TOP_Y - 40;
export const DROP_COOLDOWN_MS = 400;

// Physics
export const GRAVITY = 1.2;
export const BALL_RESTITUTION = 0.3;
export const BALL_FRICTION = 0.05;
export const BALL_DENSITY = 0.002;

// Hand-drawn doodle style — every outline uses the same dark-navy ink,
// and leaves share one flat teal green (matches the sticker-art look).
export const INK = '#1e2f4f';
export const LEAF_GREEN = '#3aa98f';

// Ball tiers — index 0 is smallest. Every squishy ball is a fruit
// (except rainbow, which stays special).
// Merge rule: 2 of same → 1 of next tier
export const BALL_TIERS = [
  { name: 'coconut',     radius: 12, color: '#8B5A33', stroke: '#5C3A1E', points: 1  },
  { name: 'cherry',      radius: 17, color: '#E8394F', stroke: '#B02439', points: 3  },
  { name: 'lemon',       radius: 22, color: '#F4D735', stroke: '#C0A312', points: 6  },
  { name: 'orange',      radius: 28, color: '#F5921E', stroke: '#C96F10', points: 10 },
  { name: 'watermelon',  radius: 35, color: '#2ECC71', stroke: '#1E8449', points: 15 },
  { name: 'blueberry',   radius: 42, color: '#5578DE', stroke: '#3A55AD', points: 21 },
  { name: 'grape',       radius: 50, color: '#7D3C98', stroke: '#5B2C6F', points: 28 },
  { name: 'plum',        radius: 59, color: '#A569BD', stroke: '#8E44AD', points: 36 },
  { name: 'dragonfruit', radius: 69, color: '#E44D8D', stroke: '#B03068', points: 45 },
  { name: 'rainbow',     radius: 79, color: 'rainbow', stroke: '#888888', points: 100 },
];

// Game modes. `danger` off means the run can't end by overflow (zen);
// `timeLimitMs` set means the run ends when the clock runs out (rush).
export const MODES = {
  classic: {
    id: 'classic', label: 'CLASSIC', desc: 'fill the cup, chase the rainbow',
    timeLimitMs: null, danger: true,
  },
  rush: {
    id: 'rush', label: 'TIMED RUSH', desc: '2 minutes on the clock — go!',
    timeLimitMs: 120000, danger: true,
  },
  zen: {
    id: 'zen', label: 'ZEN', desc: 'no game over, just squish',
    timeLimitMs: null, danger: false,
  },
};

// Coin economy — persistent currency earned at the end of every run:
// floor(score / COIN_SCORE_DIVISOR) + floor(merges / COIN_MERGE_DIVISOR)
// (+ win bonus). Zen runs are unbounded, so they earn at half rate
// with a hard cap to keep them from being the optimal coin farm.
export const COIN_SCORE_DIVISOR = 25;
export const COIN_MERGE_DIVISOR = 2;
export const COIN_WIN_BONUS = 100;
export const ZEN_COIN_SCALE = 0.5;
export const ZEN_COIN_CAP = 200;

// Fever system — chained merges fill a meter; at full it triggers a
// short frenzy window with double points and faster drops. Roughly
// 8-11 merges with modest combos to fill; decays when idle.
export const FEVER_FILL_BASE = 0.07;        // meter gain per merge
export const FEVER_FILL_COMBO_BONUS = 0.02; // extra gain per combo step
export const FEVER_GRACE_MS = 1500;         // no decay this long after a merge
export const FEVER_DECAY_PER_SEC = 0.06;    // ~17s to fully drain from full
export const FEVER_DURATION_MS = 9000;      // frenzy window length
export const FEVER_SCORE_MULT = 2;          // point multiplier while active
export const FEVER_COOLDOWN_SCALE = 0.5;    // drop cooldown scale while active

// Drop weights (index → relative weight). Only unlocked tiers are eligible.
// Higher tiers drop less frequently.
export const DROP_WEIGHTS = [46, 28, 15, 8, 3];

// Maximum tier that can ever appear as a drop (watermelon = 4).
// Everything larger must be earned through merging.
export const MAX_DROP_TIER = 4;
