// ── Game Configuration ──────────────────────────────────────────
export const GAME_WIDTH = 400;
export const GAME_HEIGHT = 700;

// Cup geometry
export const CUP_WALL_THICKNESS = 12;
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

// Ball tiers — index 0 is smallest. Every squishy guy is a fruit
// (except chrome + rainbow, which stay special).
// Merge rule: 2 of same → 1 of next tier
export const BALL_TIERS = [
  { name: 'coconut',    radius: 12, color: '#F7EFDC', stroke: '#D3C29E', points: 1  },
  { name: 'cherry',     radius: 17, color: '#E8394F', stroke: '#B02439', points: 3  },
  { name: 'banana',     radius: 22, color: '#F7D14E', stroke: '#D2A517', points: 6  },
  { name: 'orange',     radius: 28, color: '#F5921E', stroke: '#C96F10', points: 10 },
  { name: 'watermelon', radius: 35, color: '#2ECC71', stroke: '#1E8449', points: 15 },
  { name: 'blueberry',  radius: 42, color: '#5578DE', stroke: '#3A55AD', points: 21 },
  { name: 'grape',      radius: 50, color: '#7D3C98', stroke: '#5B2C6F', points: 28 },
  { name: 'plum',       radius: 59, color: '#A569BD', stroke: '#8E44AD', points: 36 },
  { name: 'chrome',     radius: 69, color: '#BDC3C7', stroke: '#95A5A6', points: 45 },
  { name: 'rainbow',    radius: 79, color: 'rainbow', stroke: '#888888', points: 100 },
];

// Drop weights (index → relative weight). Only unlocked tiers are eligible.
// Higher tiers drop less frequently.
export const DROP_WEIGHTS = [46, 28, 15, 8, 3];

// Maximum tier that can ever appear as a drop (watermelon = 4).
// Everything larger must be earned through merging.
export const MAX_DROP_TIER = 4;
