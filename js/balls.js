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

// ── Ghost Ball ─────────────────────────────────────────────────
let activeGhostBall = null;

export function spawnGhostBall(x, tierIndex) {
  const body = Physics.createGhostBody(x, DROP_Y, tierIndex);
  const entry = { body, tierIndex, isGhost: true };
  activeBalls.set(body.id, entry);
  activeGhostBall = { id: body.id, body, tierIndex };
  return body;
}

export function getActiveGhost() {
  if (activeGhostBall && activeBalls.has(activeGhostBall.id)) {
    const entry = activeBalls.get(activeGhostBall.id);
    if (entry.isGhost) return activeGhostBall;
  }
  activeGhostBall = null;
  return null;
}

export function activateGhost() {
  if (!activeGhostBall) return;
  const entry = activeBalls.get(activeGhostBall.id);
  if (entry && entry.isGhost) {
    Physics.activateGhostBody(entry.body);
    entry.isGhost = false;
  }
  activeGhostBall = null;
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
  activeGhostBall = null;
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
// When a bomb hits a ball, suck in ALL balls of that color then merge.
let activeBombEffect = null;

export function getActiveBombEffect() {
  return activeBombEffect;
}

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

  // Calculate center point
  const midX = targets.reduce((s, t) => s + t.body.position.x, 0) / targets.length;
  const midY = targets.reduce((s, t) => s + t.body.position.y, 0) / targets.length;

  // Mark all targets as merging so normal collisions won't touch them
  for (const t of targets) {
    t.body.isMerging = true;
    // Store original positions for lerping
    t.startX = t.body.position.x;
    t.startY = t.body.position.y;
  }

  // Set up the async suck-in effect
  activeBombEffect = {
    targetTier,
    targets,
    centerX: midX,
    centerY: midY,
    startTime: performance.now(),
    suckDuration: 450, // ms to suck in
  };

  return 0; // Points awarded later when suck-in completes
}

// Called each frame from game loop. Returns { points, tier, x, y } when merge happens.
export function updateBombEffect() {
  if (!activeBombEffect) return null;

  const now = performance.now();
  const elapsed = now - activeBombEffect.startTime;
  const progress = Math.min(elapsed / activeBombEffect.suckDuration, 1);
  const { targets, centerX, centerY, targetTier } = activeBombEffect;

  // Ease-in: slow start, fast end (cubic)
  const eased = progress * progress * progress;

  // Pull all target balls toward center
  for (const t of targets) {
    if (!activeBalls.has(t.id)) continue;
    const body = t.body;
    const newX = t.startX + (centerX - t.startX) * eased;
    const newY = t.startY + (centerY - t.startY) * eased;
    Physics.setBodyPosition(body, { x: newX, y: newY });
    Physics.setBodyVelocity(body, { x: 0, y: 0 });
  }

  // When suck-in is complete, merge all pairs
  if (progress >= 1) {
    const pairs = Math.floor(targets.length / 2);
    let totalPoints = 0;

    for (let i = 0; i < pairs; i++) {
      const a = targets[i * 2];
      const b = targets[i * 2 + 1];
      if (!activeBalls.has(a.id) || !activeBalls.has(b.id)) continue;
      totalPoints += performMerge([a.body, b.body], targetTier);
    }

    // Odd ball left over — unmark it
    if (targets.length % 2 === 1) {
      const odd = targets[targets.length - 1];
      if (activeBalls.has(odd.id)) {
        odd.body.isMerging = false;
      }
    }

    // Big merge effect at center
    if (totalPoints > 0) {
      mergeEffects.push({
        x: centerX,
        y: centerY,
        tierIndex: targetTier + 1,
        startTime: performance.now(),
        duration: 800,
      });
    }

    const result = {
      points: totalPoints,
      tier: targetTier + 1,
      x: centerX,
      y: centerY,
    };
    activeBombEffect = null;
    return result;
  }

  return null; // Still sucking in
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
    if (entry.isGhost) continue; // ghost balls don't cause game over

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
