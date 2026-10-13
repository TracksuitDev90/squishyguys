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

// Drop mechanics. The drop point rises with cup extensions (see
// MAX_CUP_EXTENSIONS) but never above DROP_Y_MIN, which keeps the
// preview fruit clear of the store buttons at the top of the screen.
export const DROP_Y = CUP_TOP_Y - 40;
export const DROP_Y_MIN = 180;
export const DROP_COOLDOWN_MS = 400;

// Cup extension — each CUP+ (bought or granted by the TALL CUP upgrade)
// raises the walls by CUP_EXTEND_PX. Capped so the rim can never climb
// into the score/store UI and the drop point always stays above the
// danger line.
export const CUP_EXTEND_PX = 35;
export const MAX_CUP_EXTENSIONS = 4;

// Physics
export const GRAVITY = 1.2;
export const BALL_RESTITUTION = 0.3;
export const BALL_FRICTION = 0.05;
export const BALL_DENSITY = 0.002;

// Hand-drawn doodle style — every outline uses the same dark-navy ink,
// and leaves share one flat teal green (matches the sticker-art look).
export const INK = '#1e2f4f';
export const LEAF_GREEN = '#3aa98f';

// Ball tiers — index 0 is smallest, and every tier is bigger than the
// one before it. Every squishy ball is a fruit; the rainbow squishy at
// the end is all of them mixed together.
//
// Merge rule: `mergeCount` of the same fruit → 1 of the next tier
// (2 unless noted). The last two fruits before the rainbow need THREE:
// a pair that touches pulls a third from anywhere in the cup; without
// one it just squishes together and waits.
//
// Radii grow in shrinking steps so the whole chain still fits the cup:
// the endgame needs two blackberries and three dragonfruits in there
// at once, so the top tiers can't balloon the way they did when the
// chain was shorter.
export const BALL_TIERS = [
  { name: 'coconut',     label: 'COCONUT',     radius: 11,   color: '#8B5A33', stroke: '#5C3A1E', points: 1   },
  { name: 'peach',       label: 'PEACH',       radius: 14.5, color: '#FFA07A', stroke: '#D9704C', points: 3   },
  { name: 'apple',       label: 'RED APPLE',   radius: 18,   color: '#E8394F', stroke: '#B02439', points: 6   },
  { name: 'lemon',       label: 'LEMON',       radius: 21.5, color: '#F4D735', stroke: '#C0A312', points: 10  },
  { name: 'lime',        label: 'LIME',        radius: 25,   color: '#7BC043', stroke: '#4E8A22', points: 15  },
  { name: 'orange',      label: 'ORANGE',      radius: 29,   color: '#F5921E', stroke: '#C96F10', points: 21  },
  { name: 'watermelon',  label: 'WATERMELON',  radius: 33.5, color: '#2ECC71', stroke: '#1E8449', points: 28  },
  { name: 'blueberry',   label: 'BLUEBERRY',   radius: 38,   color: '#5578DE', stroke: '#3A55AD', points: 36  },
  { name: 'grape',       label: 'GRAPE',       radius: 42.5, color: '#8A4FB8', stroke: '#5B2C6F', points: 45  },
  { name: 'grapefruit',  label: 'GRAPEFRUIT',  radius: 47,   color: '#FFAE6B', stroke: '#D1583A', points: 55  },
  { name: 'plum',        label: 'PLUM',        radius: 51,   color: '#8C2F66', stroke: '#5E1C44', points: 66  },
  { name: 'dragonfruit', label: 'DRAGONFRUIT', radius: 55,   color: '#E44D8D', stroke: '#B03068', points: 78,  mergeCount: 3 },
  { name: 'blackberry',  label: 'BLACKBERRY',  radius: 59,   color: '#3B2150', stroke: '#1E0F2B', points: 120, mergeCount: 3 },
  { name: 'rainbow',     label: 'RAINBOW SQUISHY', radius: 64, color: 'rainbow', stroke: '#888888', points: 200 },
];

// Index of the final (rainbow) tier — shared so no module hardcodes it.
export const RAINBOW_TIER = BALL_TIERS.length - 1;

// How many of a tier merge into one of the next
export function mergeCountOf(tierIndex) {
  const t = BALL_TIERS[tierIndex];
  return (t && t.mergeCount) || 2;
}

// Fruit a run starts with — the only ones that can drop until the
// player merges their way to something bigger (and the only
// instruments in the band until then, see music.js).
export const STARTING_TIERS = [0, 1, 2];

// Game modes. `danger` off means the run can't end by overflow (zen);
// `timeLimitMs` set means the run ends when the clock runs out (rush);
// `dropCooldownMs` overrides DROP_COOLDOWN_MS (zen allows rapid taps).
export const MODES = {
  classic: {
    id: 'classic', label: 'CLASSIC', desc: 'fill the cup, chase the rainbow',
    timeLimitMs: null, danger: true, dropCooldownMs: null,
  },
  rush: {
    id: 'rush', label: 'TIMED RUSH', desc: '2 minutes on the clock — go!',
    timeLimitMs: 120000, danger: true, dropCooldownMs: null,
  },
  zen: {
    id: 'zen', label: 'ZEN', desc: 'no game over, just squish',
    timeLimitMs: null, danger: false, dropCooldownMs: 160,
  },
};

// The merge bomb (store power-up) — a small ball that doesn't count
// toward danger and merges every matching fruit at once
export const BOMB_RADIUS = 16;

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

// Juice squirt on merge — a burst of simulated fruit juice sprays out
// of the pinch where two fruits squish together. It fires randomly so
// it stays a treat rather than noise; bigger fruit are a little more
// likely to squirt, and the rainbow always does.
export const JUICE_SQUIRT_CHANCE = 0.32;
export const JUICE_SQUIRT_TIER_BONUS = 0.025; // added per tier index
export const MAX_JUICE_DROPLETS = 220;

// Per-fruit look variation — every fruit of a tier is unmistakably that
// fruit, but each individual drifts a touch in hue, lightness and
// texture so a cup of apples doesn't read as photocopies.
export const FRUIT_HUE_JITTER = 5;    // ± degrees
export const FRUIT_LIGHT_JITTER = 4;  // ± percent lightness
export const FRUIT_SAT_JITTER = 6;    // ± percent saturation

// Drop weights (index → relative weight). Only unlocked tiers are
// eligible, so a fruit can't fall from the sky until you've made one.
// Coconut, peach and apple are the bread and butter; every fruit after
// them is rarer than the last, down to the odd lucky blueberry.
export const DROP_WEIGHTS = [30, 26, 22, 10, 6, 3.5, 1.6, 0.6];

// Maximum tier that can ever appear as a drop (blueberry = 7).
// Everything larger must be earned through merging.
export const MAX_DROP_TIER = DROP_WEIGHTS.length - 1;
