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

// Ball tiers — index 0 is smallest
// Merge rule: 2 of same → 1 of next tier
export const BALL_TIERS = [
  { name: 'white',   radius: 12, color: '#F5F5F5', stroke: '#CCCCCC', points: 1  },
  { name: 'red',     radius: 17, color: '#E74C3C', stroke: '#C0392B', points: 3  },
  { name: 'yellow',  radius: 22, color: '#F1C40F', stroke: '#D4AC0D', points: 6  },
  { name: 'orange',  radius: 28, color: '#E67E22', stroke: '#CA6F1E', points: 10 },
  { name: 'green',   radius: 35, color: '#2ECC71', stroke: '#27AE60', points: 15 },
  { name: 'blue',    radius: 42, color: '#3498DB', stroke: '#2980B9', points: 21 },
  { name: 'indigo',  radius: 50, color: '#6C3483', stroke: '#5B2C6F', points: 28 },
  { name: 'violet',  radius: 59, color: '#A569BD', stroke: '#8E44AD', points: 36 },
  { name: 'chrome',  radius: 69, color: '#BDC3C7', stroke: '#95A5A6', points: 45 },
  { name: 'rainbow', radius: 79, color: 'rainbow', stroke: '#888888', points: 100 },
];

// Drop weights (index → relative weight). Only unlocked tiers are eligible.
// Higher tiers drop less frequently. Violet+ are too large to drop.
export const DROP_WEIGHTS = [50, 30, 15, 8, 4, 2, 1, 0, 0, 0];

// Maximum tier that can ever appear as a drop (indigo = 6). Violet+ must be earned.
export const MAX_DROP_TIER = 6;

// Squish visual settings
export const SQUISH_FACTOR = 0.15; // how much velocity affects squish visual
export const SQUISH_RECOVERY = 0.1; // how fast squish recovers
