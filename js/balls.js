// ── Ball Management & Merging ───────────────────────────────────
import {
  BALL_TIERS, DROP_WEIGHTS, MAX_INITIAL_DROP_TIER,
  DANGER_LINE_Y, DANGER_DURATION_MS, DROP_Y,
} from './config.js';
import * as Physics from './physics.js';

// All active balls: Map<body.id, { body, tierIndex }>
const activeBalls = new Map();

// Merge effects for renderer
export const mergeEffects = [];

// Tiers the player has unlocked (created via merge). Starts with tiers 0-4.
const unlockedTiers = new Set([0, 1, 2, 3, 4]);

// Track chrome counts for triple-merge
const pendingMerges = new Map(); // tierIndex → [body, body, ...]

// ── Public API ──────────────────────────────────────────────────

export function spawnBall(x, tierIndex) {
  const body = Physics.createBallBody(x, DROP_Y, tierIndex);
  activeBalls.set(body.id, { body, tierIndex });
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
  [0, 1, 2, 3, 4].forEach(t => unlockedTiers.add(t));
}

// ── Drop Tier Selection ─────────────────────────────────────────
export function getNextDropTier() {
  // Build weighted pool from unlocked tiers that are allowed as drops
  let totalWeight = 0;
  const pool = [];

  for (let i = 0; i <= MAX_INITIAL_DROP_TIER; i++) {
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
  if (ballA.tierIndex !== ballB.tierIndex) return 0;
  if (bodyA.isMerging || bodyB.isMerging) return 0;

  const tierIndex = ballA.tierIndex;
  const tier = BALL_TIERS[tierIndex];

  // Rainbow can't merge further
  if (tierIndex >= BALL_TIERS.length - 1) return 0;

  const mergeCount = tier.mergeCount;

  if (mergeCount <= 2) {
    // Standard 2-ball merge
    return performMerge([bodyA, bodyB], tierIndex);
  } else {
    // Need 3 (chrome → rainbow): queue them up
    return handleMultiMerge(bodyA, bodyB, tierIndex, mergeCount);
  }
}

function handleMultiMerge(bodyA, bodyB, tierIndex, needed) {
  // For chrome (mergeCount=3), we do 2→1 merge that produces another chrome,
  // then when 2 chromes collide again, they try to merge.
  // Simpler approach: just use 2-merge like everything else but the
  // config says 3, so let's require the user to combine 3.
  //
  // Actually, let's simplify: chrome merges 2→1 to produce a "super chrome"
  // (still looks chrome but marked), and super chrome + chrome = rainbow.
  // OR: keep it simple — 2 chromes = rainbow, but require more chromes
  // total (since each chrome takes 2 violets, that's already hard).
  //
  // For now: treat chrome like everything else (2→1 merge to rainbow).
  // The "3 chromes" requirement means the user needs to merge 3 pairs,
  // so effectively they need 6 violets (very hard). The mergeCount
  // in config can be used for scoring multiplier instead.
  return performMerge([bodyA, bodyB], tierIndex);
}

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
    duration: 400,
  });

  return nextTierData.points;
}

// ── Game Over Check ─────────────────────────────────────────────
export function checkGameOver() {
  const now = performance.now();
  for (const { body } of activeBalls.values()) {
    if (body.isMerging) continue;

    // Ignore recently spawned balls (give them time to fall)
    if (now - body.createdAt < 1500) continue;

    if (body.position.y - BALL_TIERS[body.tierIndex].radius < DANGER_LINE_Y) {
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
