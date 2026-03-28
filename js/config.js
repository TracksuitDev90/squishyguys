// ── Game Configuration ──────────────────────────────────────────
export const GAME_WIDTH = 400;
export const GAME_HEIGHT = 700;

// Cup geometry
export const CUP_WALL_THICKNESS = 12;
export const CUP_BOTTOM_Y = GAME_HEIGHT - 20;
export const CUP_TOP_Y = 160;
export const CUP_LEFT_X = 50;
export const CUP_RIGHT_X = GAME_WIDTH - 50;
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
// Merge rule: 2 of same → 1 of next (except chrome → rainbow needs 3)
export const BALL_TIERS = [
  { name: 'white',   radius: 14, color: '#F5F5F5', stroke: '#CCCCCC', points: 1,  mergeCount: 1 },
  { name: 'red',     radius: 19, color: '#E74C3C', stroke: '#C0392B', points: 3,  mergeCount: 2 },
  { name: 'yellow',  radius: 25, color: '#F1C40F', stroke: '#D4AC0D', points: 6,  mergeCount: 2 },
  { name: 'orange',  radius: 32, color: '#E67E22', stroke: '#CA6F1E', points: 10, mergeCount: 2 },
  { name: 'green',   radius: 40, color: '#2ECC71', stroke: '#27AE60', points: 15, mergeCount: 2 },
  { name: 'blue',    radius: 48, color: '#3498DB', stroke: '#2980B9', points: 21, mergeCount: 2 },
  { name: 'indigo',  radius: 57, color: '#6C3483', stroke: '#5B2C6F', points: 28, mergeCount: 2 },
  { name: 'violet',  radius: 67, color: '#A569BD', stroke: '#8E44AD', points: 36, mergeCount: 2 },
  { name: 'chrome',  radius: 78, color: '#BDC3C7', stroke: '#95A5A6', points: 45, mergeCount: 3 },
  { name: 'rainbow', radius: 90, color: 'rainbow', stroke: '#888888', points: 100, mergeCount: 0 },
];

// Drop weights (index → relative weight). Only unlocked tiers are eligible.
// Weight decreases as tier increases.
export const DROP_WEIGHTS = [50, 30, 15, 8, 4, 0, 0, 0, 0, 0];

// Maximum tier index that can appear as a drop (the rest must be earned)
export const MAX_INITIAL_DROP_TIER = 4; // green

// Squish visual settings
export const SQUISH_FACTOR = 0.15; // how much velocity affects squish visual
export const SQUISH_RECOVERY = 0.1; // how fast squish recovers
