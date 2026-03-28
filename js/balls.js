// ── Ball Management & Merging ───────────────────────────────────
import {
  BALL_TIERS, DROP_WEIGHTS, MAX_DROP_TIER,
  DANGER_LINE_Y, DANGER_DURATION_MS, DROP_Y,
} from './config.js';
import * as Physics from './physics.js';

// All active balls: Map<body.id, { body, tierIndex }>
const activeBalls = new Map();

// Merge effects for renderer
export const mergeEffects = [];

// Tiers the player has unlocked (created via merge). Starts with 0-3.
const unlockedTiers = new Set([0, 1, 2, 3]);

// ── Public API ──────────────────────────────────────────────────

export function spawnBall(x, tierIndex) {
  const body = Physics.createBallBody(x, DROP_Y, tierIndex);
  activeBalls.set(body.id, { body, tierIndex });
  return body;
}

export function spawnBombBall(x) {
  // Bomb ball: small (radius ~16), special label
  const body = Physics.createBombBody(x, DROP_Y);
  activeBalls.set(body.id, { body, tierIndex: -1, isBomb: true });
  return body;
}

export function getAll() {
  return activeBalls;
}

export function getUnlockedTiers() {
  return unlockedTiers;
}

export function reset() {
  for (const { body } of activeBalls.values()) {
    Physics.removeBody(body);
  }
  activeBalls.clear();
  mergeEffects.length = 0;
  unlockedTiers.clear();
  [0, 1, 2, 3].forEach(t => unlockedTiers.add(t));
}

// ── Drop Tier Selection ─────────────────────────────────────────
export function getNextDropTier() {
  // Build weighted pool from unlocked tiers that are allowed as drops
  let totalWeight = 0;
  const pool = [];

  for (let i = 0; i <= MAX_DROP_TIER; i++) {
    if (unlockedTiers.has(i) && DROP_WEIGHTS[i] > 0) {
      pool.push({ tier: i, weight: DROP_WEIGHTS[i] });
      totalWeight += DROP_WEIGHTS[i];
    }
  }

  if (pool.length === 0) return 0;

  let roll = Math.random() * totalWeight;
  for (const entry of pool) {
    roll -= entry.weight;
    if (roll <= 0) return entry.tier;
  }
  return pool[pool.length - 1].tier;
}

// ── Collision → Merge ───────────────────────────────────────────
export function handleCollision(bodyA, bodyB) {
  const ballA = activeBalls.get(bodyA.id);
  const ballB = activeBalls.get(bodyB.id);

  if (!ballA || !ballB) return 0;

  // Check for bomb collision
  if (ballA.isBomb || ballB.isBomb) {
    const bomb = ballA.isBomb ? ballA : ballB;
    const target = ballA.isBomb ? ballB : ballA;
    return triggerBombEffect(bomb, target);
  }

  if (ballA.tierIndex !== ballB.tierIndex) return 0;
  if (bodyA.isMerging || bodyB.isMerging) return 0;

  const tierIndex = ballA.tierIndex;

  // Rainbow can't merge further
  if (tierIndex >= BALL_TIERS.length - 1) return 0;

  return performMerge([bodyA, bodyB], tierIndex);
}

// ── Bomb Effect ─────────────────────────────────────────────────
// When a bomb hits a ball, suck in and merge ALL balls of that color.
function triggerBombEffect(bombEntry, targetEntry) {
  const targetTier = targetEntry.tierIndex;

  // Can't bomb rainbows
  if (targetTier >= BALL_TIERS.length - 1) return 0;

  // Remove the bomb ball
  activeBalls.delete(bombEntry.body.id);
  Physics.removeBody(bombEntry.body);

  // Gather all balls of the target tier
  const targets = [];
  for (const [id, entry] of activeBalls) {
    if (entry.tierIndex === targetTier && !entry.body.isMerging) {
      targets.push({ id, body: entry.body });
    }
  }

  if (targets.length < 2) return 0;

  // Calculate center point for visual effect
  const midX = targets.reduce((s, t) => s + t.body.position.x, 0) / targets.length;
  const midY = targets.reduce((s, t) => s + t.body.position.y, 0) / targets.length;

  // Merge in pairs
  const pairs = Math.floor(targets.length / 2);
  let totalPoints = 0;

  for (let i = 0; i < pairs; i++) {
    const a = targets[i * 2];
    const b = targets[i * 2 + 1];

    const ballA = activeBalls.get(a.id);
    const ballB = activeBalls.get(b.id);
    if (!ballA || !ballB) continue;

    totalPoints += performMerge([a.body, b.body], targetTier);
  }
  // Odd ball remains untouched

  // Add a big merge effect at the center
  if (totalPoints > 0) {
    mergeEffects.push({
      x: midX,
      y: midY,
      tierIndex: targetTier + 1,
      startTime: performance.now(),
      duration: 800,
    });
  }

  return totalPoints;
}

// Expose for external use (returns the tier hit, for particles)
export let lastBombTier = -1;

function performMerge(bodies, tierIndex) {
  const nextTier = tierIndex + 1;
  const nextTierData = BALL_TIERS[nextTier];

  // Mark all as merging
  for (const b of bodies) {
    b.isMerging = true;
  }

  // Calculate midpoint
  let mx = 0, my = 0;
  for (const b of bodies) {
    mx += b.position.x;
    my += b.position.y;
  }
  mx /= bodies.length;
  my /= bodies.length;

  // Remove old balls
  for (const b of bodies) {
    activeBalls.delete(b.id);
    Physics.removeBody(b);
  }

  // Spawn new ball
  const newBody = Physics.createBallBody(mx, my, nextTier);
  activeBalls.set(newBody.id, { body: newBody, tierIndex: nextTier });

  // Unlock tier
  unlockedTiers.add(nextTier);

  // Add merge effect
  mergeEffects.push({
    x: mx,
    y: my,
    tierIndex: nextTier,
    startTime: performance.now(),
    duration: 600,
  });

  return nextTierData.points;
}

// ── Game Over Check ─────────────────────────────────────────────
// dangerY can be passed in to account for cup extensions
export function checkGameOver(dangerY) {
  const effectiveDangerY = dangerY != null ? dangerY : DANGER_LINE_Y;
  const now = performance.now();
  for (const [, entry] of activeBalls) {
    const { body } = entry;
    if (body.isMerging) continue;
    if (entry.isBomb) continue; // bomb balls don't cause game over

    // Ignore recently spawned balls (give them time to fall)
    if (now - body.createdAt < 1500) continue;

    const tierRadius = entry.tierIndex >= 0 ? BALL_TIERS[entry.tierIndex].radius : 16;
    if (body.position.y - tierRadius < effectiveDangerY) {
      if (!body.aboveDangerSince) {
        body.aboveDangerSince = now;
      } else if (now - body.aboveDangerSince > DANGER_DURATION_MS) {
        return true;
      }
    } else {
      body.aboveDangerSince = null;
    }
  }
  return false;
}

// ── Rainbow Check ───────────────────────────────────────────────
export function hasRainbow() {
  for (const { tierIndex } of activeBalls.values()) {
    if (tierIndex === BALL_TIERS.length - 1) return true;
  }
  return false;
}

// ── Cleanup old merge effects ───────────────────────────────────
export function cleanupEffects() {
  const now = performance.now();
  for (let i = mergeEffects.length - 1; i >= 0; i--) {
    if (now - mergeEffects[i].startTime > mergeEffects[i].duration) {
      mergeEffects.splice(i, 1);
    }
  }
}
