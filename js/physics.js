// ── Physics Engine (Matter.js) ──────────────────────────────────
import {
  GAME_WIDTH, GAME_HEIGHT, GRAVITY,
  CUP_WALL_THICKNESS, CUP_BOTTOM_Y, CUP_TOP_Y,
  CUP_LEFT_X, CUP_RIGHT_X, CUP_BASE_EXTRA,
  BALL_RESTITUTION, BALL_FRICTION, BALL_DENSITY,
  BALL_TIERS,
} from './config.js';

const { Engine, World, Bodies, Body, Events, Composite } = Matter;

// Collision filter categories
const COL_WALL = 0x0001;
const COL_BALL = 0x0002;
const COL_GHOST = 0x0004;

let engine;
let collisionCallback = null;
let wallCollisionCallback = null;
let floorCollisionCallback = null;
let cupBodies = [];

export function init() {
  engine = Engine.create({
    gravity: { x: 0, y: GRAVITY },
    // Extra solver iterations keep tall stacks of circles stable
    // (less micro-jitter → balls read as calm and heavy, not buzzy)
    positionIterations: 10,
    velocityIterations: 8,
  });

  buildCup();
  registerCollisionHandler();

  return engine;
}

export function getEngine() {
  return engine;
}

// ── Cup Construction ────────────────────────────────────────────
// A static rectangle whose long axis runs along the segment
// (x1,y1)→(x2,y2). Used for the slanted side walls: the cup flares
// outward so the base is CUP_BASE_EXTRA wider per side than the rim.
function wallFromSegment(x1, y1, x2, y2, options) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  return Bodies.rectangle(
    (x1 + x2) / 2, (y1 + y2) / 2,
    CUP_WALL_THICKNESS, len,
    { ...options, angle: Math.atan2(-dx, dy) }
  );
}

function buildCup(totalExtendPx = 0) {
  const wallOptions = {
    isStatic: true,
    friction: 0.3,
    restitution: 0.2,
    render: { visible: false },
    label: 'cup-wall',
  };

  const effectiveTopY = CUP_TOP_Y - totalExtendPx;
  const rimY = effectiveTopY - 20;   // where the drawn walls start
  const wallTopY = rimY - 40;        // physics walls extend past the rim
  const baseY = CUP_BOTTOM_Y;

  // Inner wall face x at a given y — walls lean outward toward the base
  const flare = (y) => CUP_BASE_EXTRA * (y - rimY) / (baseY - rimY);
  const half = CUP_WALL_THICKNESS / 2;

  const leftWall = wallFromSegment(
    CUP_LEFT_X - flare(wallTopY) - half, wallTopY,
    CUP_LEFT_X - CUP_BASE_EXTRA - half, baseY + half,
    wallOptions
  );
  const rightWall = wallFromSegment(
    CUP_RIGHT_X + flare(wallTopY) + half, wallTopY,
    CUP_RIGHT_X + CUP_BASE_EXTRA + half, baseY + half,
    wallOptions
  );

  // Floor spans the widened base
  const floor = Bodies.rectangle(
    (CUP_LEFT_X + CUP_RIGHT_X) / 2,
    CUP_BOTTOM_Y + CUP_WALL_THICKNESS / 2,
    CUP_RIGHT_X - CUP_LEFT_X + CUP_BASE_EXTRA * 2 + CUP_WALL_THICKNESS * 2,
    CUP_WALL_THICKNESS,
    { ...wallOptions, label: 'cup-floor' }
  );

  // Invisible ceiling walls to keep things from flying out sideways
  const leftCeiling = Bodies.rectangle(
    CUP_LEFT_X / 2,
    effectiveTopY - 80,
    CUP_LEFT_X,
    20,
    { ...wallOptions, label: 'boundary' }
  );

  const rightCeiling = Bodies.rectangle(
    CUP_RIGHT_X + (GAME_WIDTH - CUP_RIGHT_X) / 2,
    effectiveTopY - 80,
    GAME_WIDTH - CUP_RIGHT_X,
    20,
    { ...wallOptions, label: 'boundary' }
  );

  cupBodies = [leftWall, rightWall, floor, leftCeiling, rightCeiling];
  Composite.add(engine.world, cupBodies);
}

function removeCupBodies() {
  for (const b of cupBodies) {
    Composite.remove(engine.world, b);
  }
  cupBodies = [];
}

// ── Cup Extension (rebuild walls taller) ────────────────────────
export function extendCup(totalExtendPx) {
  removeCupBodies();
  buildCup(totalExtendPx);
}

export function resetCup() {
  // Remove extended cup and rebuild default
  removeCupBodies();
  buildCup();
}

// ── Ball Creation ───────────────────────────────────────────────
export function createBallBody(x, y, tierIndex) {
  const tier = BALL_TIERS[tierIndex];

  // Smaller balls are bouncier and squishier, larger balls feel heavier/fluid
  // Bounce: coconut=0.6, gradually decreasing to 0.11 for the biggest balls
  const restitution = Math.max(0.11, 0.60 - tierIndex * 0.06);
  // Friction: smaller balls slide more easily between others
  let friction = BALL_FRICTION;
  if (tierIndex <= 3) {
    const squishiness = 1 - (tierIndex / 3);
    friction = BALL_FRICTION * (0.4 + 0.6 * (1 - squishiness)); // coconut=0.02, orange=0.05
  }

  const body = Bodies.circle(x, y, tier.radius, {
    restitution,
    friction,
    density: BALL_DENSITY,
    label: 'ball',
    collisionFilter: { category: COL_BALL, mask: COL_WALL | COL_BALL },
  });

  // Custom properties
  body.tierIndex = tierIndex;
  body.isMerging = false;
  body.createdAt = performance.now();
  body.aboveDangerSince = null;

  Composite.add(engine.world, body);
  return body;
}

export function createBombBody(x, y) {
  const body = Bodies.circle(x, y, 16, {
    restitution: 0.2,
    friction: 0.03,
    density: BALL_DENSITY,
    label: 'ball',
    collisionFilter: { category: COL_BALL, mask: COL_WALL | COL_BALL },
  });

  body.isBomb = true;
  body.tierIndex = -1;
  body.isMerging = false;
  body.createdAt = performance.now();
  body.aboveDangerSince = null;

  Composite.add(engine.world, body);
  return body;
}

export function createGhostBody(x, y, tierIndex) {
  const tier = BALL_TIERS[tierIndex];
  const body = Bodies.circle(x, y, tier.radius, {
    restitution: 0.2,
    friction: 0.03,
    density: BALL_DENSITY,
    frictionAir: 0.04, // falls slower than normal balls
    label: 'ball',
    collisionFilter: { category: COL_GHOST, mask: COL_WALL },
  });
  body.tierIndex = tierIndex;
  body.isMerging = false;
  body.isGhost = true;
  body.createdAt = performance.now();
  body.aboveDangerSince = null;
  Composite.add(engine.world, body);
  return body;
}

export function activateGhostBody(body) {
  body.collisionFilter.category = COL_BALL;
  body.collisionFilter.mask = COL_WALL | COL_BALL;
  body.isGhost = false;
  body.frictionAir = 0.01; // reset to normal air friction
}

export function removeBody(body) {
  Composite.remove(engine.world, body);
}

export function setBodyPosition(body, pos) {
  Body.setPosition(body, pos);
}

export function setBodyVelocity(body, vel) {
  Body.setVelocity(body, vel);
}

export function setBodyStatic(body, isStatic) {
  Body.setStatic(body, isStatic);
}

// ── Collision Handling ──────────────────────────────────────────
function registerCollisionHandler() {
  Events.on(engine, 'collisionStart', (event) => {
    for (const pair of event.pairs) {
      const { bodyA, bodyB } = pair;

      // Ball-ball collision
      if (bodyA.label === 'ball' && bodyB.label === 'ball') {
        if (collisionCallback) collisionCallback(bodyA, bodyB);
      }

      // Ball-wall collision (for bounce sounds)
      const isWallA = bodyA.label === 'cup-wall' || bodyA.label === 'cup-floor' || bodyA.label === 'boundary';
      const isWallB = bodyB.label === 'cup-wall' || bodyB.label === 'cup-floor' || bodyB.label === 'boundary';

      if (wallCollisionCallback) {
        let ball = null;
        if (bodyA.label === 'ball' && isWallB) {
          ball = bodyA;
        } else if (bodyB.label === 'ball' && isWallA) {
          ball = bodyB;
        }
        if (ball) {
          const speed = Math.sqrt(ball.velocity.x ** 2 + ball.velocity.y ** 2);
          wallCollisionCallback(ball, speed);
        }
      }

      // Floor collision (for ghost ball activation)
      if (floorCollisionCallback) {
        let ball = null;
        if (bodyA.label === 'ball' && bodyB.label === 'cup-floor') {
          ball = bodyA;
        } else if (bodyB.label === 'ball' && bodyA.label === 'cup-floor') {
          ball = bodyB;
        }
        if (ball && ball.isGhost) {
          floorCollisionCallback(ball);
        }
      }
    }
  });

  // Safety net: collisionStart alone misses pairs that were already
  // touching when they became mergeable (e.g. the odd ball left over
  // after a bomb, or a pair overlapping while flagged isMerging).
  // Re-check resting same-tier contacts every step.
  Events.on(engine, 'collisionActive', (event) => {
    if (!collisionCallback) return;
    for (const pair of event.pairs) {
      const { bodyA, bodyB } = pair;
      if (bodyA.label !== 'ball' || bodyB.label !== 'ball') continue;
      if (bodyA.isMerging || bodyB.isMerging) continue;
      const mergeable = bodyA.tierIndex === bodyB.tierIndex && bodyA.tierIndex >= 0;
      const bombTouch = bodyA.isBomb || bodyB.isBomb;
      if (mergeable || bombTouch) {
        collisionCallback(bodyA, bodyB);
      }
    }
  });
}

export function onCollision(callback) {
  collisionCallback = callback;
}

export function onWallCollision(callback) {
  wallCollisionCallback = callback;
}

export function onFloorCollision(callback) {
  floorCollisionCallback = callback;
}

// ── Step ────────────────────────────────────────────────────────
// Matter.js wants a fixed timestep — feeding it raw frame deltas makes
// stacks jittery and behavior framerate-dependent. Accumulate real time
// and step in fixed 60 Hz slices instead.
const FIXED_DT = 1000 / 60;
let accumulator = 0;

export function step(delta) {
  accumulator = Math.min(accumulator + delta, FIXED_DT * 4);
  while (accumulator >= FIXED_DT) {
    Engine.update(engine, FIXED_DT);
    accumulator -= FIXED_DT;
  }
}
