// ── Ball Management & Merging ───────────────────────────────────
import {
  BALL_TIERS, RAINBOW_TIER, DROP_WEIGHTS, MAX_DROP_TIER, STARTING_TIERS,
  DANGER_LINE_Y, DANGER_DURATION_MS, DROP_Y, BOMB_RADIUS, mergeCountOf,
} from './config.js';
import * as Physics from './physics.js';
import * as Clock from './clock.js';

// All active balls: Map<body.id, { body, tierIndex, isBomb?, isGhost? }>
const activeBalls = new Map();

// Merge effects for renderer
export const mergeEffects = [];

// Tiers the player has unlocked (created via merge) this run
const unlockedTiers = new Set(STARTING_TIERS);

// ── Public API ──────────────────────────────────────────────────

// `y` defaults to the base drop line; main.js passes the effective
// one, which rises with cup extensions.
export function spawnBall(x, tierIndex, y = DROP_Y) {
  const body = Physics.createBallBody(x, y, tierIndex);
  activeBalls.set(body.id, { body, tierIndex });
  return body;
}

export function spawnBombBall(x, y = DROP_Y) {
  const body = Physics.createBombBody(x, y);
  activeBalls.set(body.id, { body, tierIndex: -1, isBomb: true });
  return body;
}

// Collision radius of any entry (bombs aren't a fruit tier)
export function radiusOf(entry) {
  return entry.isBomb ? BOMB_RADIUS : BALL_TIERS[entry.tierIndex].radius;
}

// ── Ghost Ball ─────────────────────────────────────────────────
let activeGhostBall = null;

export function spawnGhostBall(x, tierIndex, y = DROP_Y) {
  const body = Physics.createGhostBody(x, y, tierIndex);
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
  gathers.length = 0;
  recentDrops.length = 0;
  hintCooldownUntil = 0;
  unlockedTiers.clear();
  for (const t of STARTING_TIERS) unlockedTiers.add(t);
}

// ── Drop Tier Selection ─────────────────────────────────────────
// Last two tiers handed to the drop queue, newest first (anti-streak).
const recentDrops = [];
const dropPool = [];

export function getNextDropTier() {
  // Weighted pool from unlocked tiers that are allowed as drops. The
  // first three fruits always dominate; as the player unlocks more of
  // the chain, coconut's share fades a little and the mid fruits pick
  // it up, so a long run gets a slightly beefier mix without ever
  // flipping the order (a lemon never becomes likelier than an apple).
  const extra = Math.max(0, unlockedTiers.size - STARTING_TIERS.length);

  let totalWeight = 0;
  dropPool.length = 0;

  for (let i = 0; i <= MAX_DROP_TIER; i++) {
    if (!unlockedTiers.has(i) || !(DROP_WEIGHTS[i] > 0)) continue;
    let weight = DROP_WEIGHTS[i];

    if (i === 0) weight *= 1 - Math.min(extra * 0.05, 0.3);  // ≥ 21
    else if (i >= 3) weight *= 1 + Math.min(extra * 0.04, 0.3);

    // Anti-streak: the same tier twice in a row becomes much less
    // likely a third time, so drops feel varied rather than random-clumpy
    if (recentDrops.length >= 2 && recentDrops[0] === i && recentDrops[1] === i) {
      weight *= 0.3;
    }

    dropPool.push(i, weight);
    totalWeight += weight;
  }

  if (dropPool.length === 0) return 0;

  let roll = Math.random() * totalWeight;
  let picked = dropPool[dropPool.length - 2];
  for (let k = 0; k < dropPool.length; k += 2) {
    roll -= dropPool[k + 1];
    if (roll <= 0) {
      picked = dropPool[k];
      break;
    }
  }

  recentDrops.unshift(picked);
  if (recentDrops.length > 2) recentDrops.pop();
  return picked;
}

// ── Collision → Merge ───────────────────────────────────────────
// Returns what the touch did, or null:
//   { type: 'merge', points, tierIndex, x, y, seamAngle, sourceTier, sourceRadius }
//   { type: 'gather', kind: 'bomb' | 'triple', tierIndex, x, y }
//       — fruit are flying together; the merge lands a moment later
//         through updateGathers()
//   { type: 'hint', tierIndex, x, y } — a pair that needs a third
export function handleCollision(bodyA, bodyB) {
  const ballA = activeBalls.get(bodyA.id);
  const ballB = activeBalls.get(bodyB.id);

  if (!ballA || !ballB) return null;

  // Merge bomb: pulls in every fruit matching whatever it touched
  if (ballA.isBomb || ballB.isBomb) {
    // Two bombs bumping is just a bump — nothing to pull in
    if (ballA.isBomb && ballB.isBomb) return null;
    const bomb = ballA.isBomb ? ballA : ballB;
    const target = ballA.isBomb ? ballB : ballA;
    return triggerBomb(bomb, target);
  }

  if (ballA.tierIndex !== ballB.tierIndex) return null;
  if (bodyA.isMerging || bodyB.isMerging) return null;
  if (ballA.isGhost || ballB.isGhost) return null;

  const tierIndex = ballA.tierIndex;

  // Rainbow can't merge further
  if (tierIndex >= RAINBOW_TIER) return null;

  // Dragonfruit and blackberry need THREE: when a pair touches, the
  // nearest third one anywhere in the cup flies over to join them.
  // Without a third, the pair just squishes together and waits.
  if (mergeCountOf(tierIndex) === 3) {
    const mx = (bodyA.position.x + bodyB.position.x) / 2;
    const my = (bodyA.position.y + bodyB.position.y) / 2;
    let third = null;
    let best = Infinity;
    for (const entry of activeBalls.values()) {
      if (entry.tierIndex !== tierIndex) continue;
      if (entry.isGhost || entry.isBomb) continue;
      if (entry.body.isMerging) continue;
      if (entry.body === bodyA || entry.body === bodyB) continue;
      const dx = entry.body.position.x - mx;
      const dy = entry.body.position.y - my;
      const d2 = dx * dx + dy * dy;
      if (d2 < best) { best = d2; third = entry.body; }
    }
    if (!third) return maybeHint(tierIndex, mx, my);
    startGather('triple', tierIndex, [bodyA, bodyB, third], [false, false, true], mx, my, TRIPLE_GATHER_MS);
    return { type: 'gather', kind: 'triple', tierIndex, x: mx, y: my };
  }

  return { type: 'merge', ...performMerge([bodyA, bodyB], tierIndex) };
}

// "Needs 3" nudge — at most one every few seconds of game time, so a
// pair resting against each other doesn't spam it every step
const HINT_COOLDOWN_MS = 5000;
let hintCooldownUntil = 0;

function maybeHint(tierIndex, x, y) {
  const now = Clock.now();
  if (now < hintCooldownUntil) return null;
  hintCooldownUntil = now + HINT_COOLDOWN_MS;
  return { type: 'hint', tierIndex, x, y };
}

// ── Gathers (bomb suck-in, triple merges) ───────────────────────
// Fruit flying together before a merge. Flyers are taken out of the
// collision world for the trip (they'd otherwise plough through the
// pile) and eased in on game time; the merge lands when they arrive.
// Any number can run at once — each owns its own fruit.
const BOMB_GATHER_MS = 450;
const TRIPLE_GATHER_MS = 260;
const gathers = [];
const finishedGathers = [];

function startGather(kind, tierIndex, bodies, flies, cx, cy, durationMs) {
  const targets = bodies.map((body, i) => ({
    id: body.id,
    body,
    fly: flies[i],
    startX: body.position.x,
    startY: body.position.y,
  }));
  for (const t of targets) {
    t.body.isMerging = true;
    if (t.fly) Physics.setBodyGhosted(t.body, true);
  }
  gathers.push({
    kind, tierIndex, targets,
    // A bomb pulls everything to one fixed point; a triple flies the
    // third fruit to wherever the touching pair is now
    centerX: cx, centerY: cy,
    pair: kind === 'triple' ? [targets[0], targets[1]] : null,
    startTime: Clock.now(),
    duration: durationMs,
  });
}

function triggerBomb(bombEntry, targetEntry) {
  const targetTier = targetEntry.tierIndex;

  // Can't bomb rainbows, ghosts, or fruit already on their way to a merge
  if (targetTier < 0 || targetTier >= RAINBOW_TIER) return null;
  if (targetEntry.isGhost || targetEntry.body.isMerging) return null;

  const bodies = [];
  for (const entry of activeBalls.values()) {
    if (entry.isBomb || entry.isGhost) continue;
    if (entry.tierIndex === targetTier && !entry.body.isMerging) {
      bodies.push(entry.body);
    }
  }

  // Not enough of that fruit to make even one merge — the bomb stays
  // put (unspent) and waits to touch something else
  if (bodies.length < mergeCountOf(targetTier)) return null;

  activeBalls.delete(bombEntry.body.id);
  Physics.removeBody(bombEntry.body);

  let cx = 0;
  let cy = 0;
  for (const b of bodies) { cx += b.position.x; cy += b.position.y; }
  cx /= bodies.length;
  cy /= bodies.length;

  startGather('bomb', targetTier, bodies, bodies.map(() => true), cx, cy, BOMB_GATHER_MS);
  return { type: 'gather', kind: 'bomb', tierIndex: targetTier, x: cx, y: cy };
}

// Called once per frame from the game loop. Returns the merges that
// landed this frame (a reused array — read it before the next call):
//   { kind, points, merges, tierIndex, x, y, seamAngle, sourceTier, sourceRadius }
export function updateGathers() {
  finishedGathers.length = 0;
  if (!gathers.length) return finishedGathers;
  const now = Clock.now();

  for (let g = gathers.length - 1; g >= 0; g--) {
    const ga = gathers[g];
    // A fruit can vanish mid-flight (zen pop, run reset); a pair that
    // lost a member has nothing left to merge into
    const lost = ga.targets.some((t) => !activeBalls.has(t.id));
    if (lost && ga.kind === 'triple') {
      releaseTargets(ga.targets);
      gathers.splice(g, 1);
      continue;
    }

    if (ga.pair) {
      ga.centerX = (ga.pair[0].body.position.x + ga.pair[1].body.position.x) / 2;
      ga.centerY = (ga.pair[0].body.position.y + ga.pair[1].body.position.y) / 2;
    }

    const progress = Math.min((now - ga.startTime) / ga.duration, 1);
    // Ease-in (cubic): a slow tug that snaps home at the end
    const eased = progress * progress * progress;
    for (const t of ga.targets) {
      if (!t.fly || !activeBalls.has(t.id)) continue;
      Physics.setBodyPosition(t.body, {
        x: t.startX + (ga.centerX - t.startX) * eased,
        y: t.startY + (ga.centerY - t.startY) * eased,
      });
      Physics.setBodyVelocity(t.body, { x: 0, y: 0 });
    }

    if (progress >= 1) {
      gathers.splice(g, 1);
      const result = finishGather(ga);
      if (result) finishedGathers.push(result);
    }
  }
  return finishedGathers;
}

function finishGather(ga) {
  const live = ga.targets.filter((t) => activeBalls.has(t.id));
  const group = mergeCountOf(ga.tierIndex);
  const groups = Math.floor(live.length / group);
  let points = 0;
  let merged = 0;
  let last = null;

  for (let i = 0; i < groups; i++) {
    const members = live.slice(i * group, (i + 1) * group);
    for (const t of members) Physics.setBodyGhosted(t.body, false);
    // Several fruits born at one point would be stuck inside each other;
    // fan a bomb's results out around the center
    let at = null;
    if (ga.kind === 'bomb') {
      const a = i * 2.4;
      const d = groups > 1 ? BALL_TIERS[ga.tierIndex].radius * 0.6 : 0;
      at = { x: ga.centerX + Math.cos(a) * d, y: ga.centerY + Math.sin(a) * d };
    } else if (ga.kind === 'triple') {
      at = { x: ga.centerX, y: ga.centerY };
    }
    last = performMerge(members.map((t) => t.body), ga.tierIndex, at);
    points += last.points;
    merged++;
  }

  // The odd fruit out goes back to normal play — never leave a ball
  // ghosted or flagged isMerging, or it could never merge again
  releaseTargets(live.slice(groups * group));

  if (!last) return null;
  if (ga.kind === 'bomb') {
    mergeEffects.push({
      x: ga.centerX, y: ga.centerY, tierIndex: last.tierIndex,
      startTime: performance.now(), duration: 800,
    });
  }
  return {
    kind: ga.kind,
    points,
    merges: merged,
    tierIndex: last.tierIndex,
    x: ga.centerX,
    y: ga.centerY,
    // A bomb has no single pinch — spray anywhere
    seamAngle: ga.kind === 'bomb' ? Math.random() * Math.PI : last.seamAngle,
    sourceTier: ga.tierIndex,
    sourceRadius: BALL_TIERS[ga.tierIndex].radius,
  };
}

function releaseTargets(targets) {
  for (const t of targets) {
    if (!activeBalls.has(t.id)) continue;
    t.body.isMerging = false;
    if (t.fly) Physics.setBodyGhosted(t.body, false);
  }
}

// The run ended (or was abandoned) with fruit mid-flight: drop them
// back into the world where they are instead of leaving them ghosted
export function cancelGathers() {
  for (const ga of gathers) releaseTargets(ga.targets);
  gathers.length = 0;
}

export function isGathering() {
  return gathers.length > 0;
}

// `at` overrides where the new fruit appears (defaults to between the
// first two bodies — the pair that actually touched).
function performMerge(bodies, tierIndex, at = null) {
  const nextTier = tierIndex + 1;
  const nextTierData = BALL_TIERS[nextTier];

  for (const b of bodies) {
    b.isMerging = true;
  }

  const a = bodies[0];
  const b = bodies[1];
  const mx = at ? at.x : (a.position.x + b.position.x) / 2;
  const my = at ? at.y : (a.position.y + b.position.y) / 2;
  // Juice squirts out of the pinch, perpendicular to the line of centers
  const seamAngle = Math.atan2(b.position.y - a.position.y,
                               b.position.x - a.position.x) + Math.PI / 2;

  for (const body of bodies) {
    activeBalls.delete(body.id);
    Physics.removeBody(body);
  }

  const newBody = Physics.createBallBody(mx, my, nextTier);
  activeBalls.set(newBody.id, { body: newBody, tierIndex: nextTier });

  unlockedTiers.add(nextTier);

  mergeEffects.push({
    x: mx,
    y: my,
    tierIndex: nextTier,
    startTime: performance.now(),
    duration: 600,
  });

  return {
    points: nextTierData.points,
    tierIndex: nextTier,
    x: mx,
    y: my,
    seamAngle,
    sourceTier: tierIndex,
    sourceRadius: BALL_TIERS[tierIndex].radius,
  };
}

// ── Game Over Check ─────────────────────────────────────────────
// Scans for a ball that has lingered above the danger line too long,
// updating per-ball timers as it goes. Returns the offending entry
// (or null). Classic/rush end the run on it; zen pops it instead.
// dangerY can be passed in to account for cup extensions.
export function findExpiredDangerBall(dangerY) {
  const effectiveDangerY = dangerY != null ? dangerY : DANGER_LINE_Y;
  const now = Clock.now();
  for (const entry of activeBalls.values()) {
    const { body } = entry;
    if (body.isMerging) continue;
    if (entry.isBomb) continue; // bomb balls don't cause game over
    if (entry.isGhost) continue; // ghost balls don't cause game over

    // Ignore recently spawned balls (give them time to fall)
    if (now - body.createdAt < 1500) continue;

    if (body.position.y - BALL_TIERS[entry.tierIndex].radius < effectiveDangerY) {
      if (!body.aboveDangerSince) {
        body.aboveDangerSince = now;
      } else if (now - body.aboveDangerSince > DANGER_DURATION_MS) {
        return entry;
      }
    } else {
      body.aboveDangerSince = null;
    }
  }
  return null;
}

export function checkGameOver(dangerY) {
  return !!findExpiredDangerBall(dangerY);
}

// Remove a ball from play (zen overflow relief, rainbow consume).
// Returns its last position and tier for effects/points.
export function popBall(id) {
  const entry = activeBalls.get(id);
  if (!entry) return null;
  activeBalls.delete(id);
  Physics.removeBody(entry.body);
  if (activeGhostBall && activeGhostBall.id === id) activeGhostBall = null;
  return {
    x: entry.body.position.x,
    y: entry.body.position.y,
    tierIndex: entry.tierIndex,
  };
}

// Zen mode: the rainbow celebrates and leaves so play can continue.
export function consumeRainbow() {
  for (const [id, entry] of activeBalls) {
    if (entry.tierIndex === RAINBOW_TIER) {
      return popBall(id);
    }
  }
  return null;
}

// ── Rainbow Check ───────────────────────────────────────────────
export function hasRainbow() {
  for (const { tierIndex } of activeBalls.values()) {
    if (tierIndex === RAINBOW_TIER) return true;
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
