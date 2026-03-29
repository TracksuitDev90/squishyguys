// ── Physics Engine (Matter.js) ──────────────────────────────────
import {
  GAME_WIDTH, GAME_HEIGHT, GRAVITY,
  CUP_WALL_THICKNESS, CUP_BOTTOM_Y, CUP_TOP_Y,
  CUP_LEFT_X, CUP_RIGHT_X,
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
  });

  buildCup();
  registerCollisionHandler();

  return engine;
}

export function getEngine() {
  return engine;
}

// ── Cup Construction ────────────────────────────────────────────
function buildCup() {
  const wallOptions = {
    isStatic: true,
    friction: 0.3,
    restitution: 0.2,
    render: { visible: false },
    label: 'cup-wall',
  };

  const wallHeight = CUP_BOTTOM_Y - CUP_TOP_Y + 60;
  const wallCenterY = CUP_TOP_Y + wallHeight / 2 - 30;

  // Left wall
  const leftWall = Bodies.rectangle(
    CUP_LEFT_X - CUP_WALL_THICKNESS / 2,
    wallCenterY,
    CUP_WALL_THICKNESS,
    wallHeight,
    wallOptions
  );

  // Right wall
  const rightWall = Bodies.rectangle(
    CUP_RIGHT_X + CUP_WALL_THICKNESS / 2,
    wallCenterY,
    CUP_WALL_THICKNESS,
    wallHeight,
    wallOptions
  );

  // Floor
  const floor = Bodies.rectangle(
    (CUP_LEFT_X + CUP_RIGHT_X) / 2,
    CUP_BOTTOM_Y + CUP_WALL_THICKNESS / 2,
    CUP_RIGHT_X - CUP_LEFT_X + CUP_WALL_THICKNESS * 2,
    CUP_WALL_THICKNESS,
    { ...wallOptions, label: 'cup-floor' }
  );

  // Invisible ceiling walls to keep things from flying out sideways
  const leftCeiling = Bodies.rectangle(
    CUP_LEFT_X / 2,
    CUP_TOP_Y - 80,
    CUP_LEFT_X,
    20,
    { ...wallOptions, label: 'boundary' }
  );

  const rightCeiling = Bodies.rectangle(
    CUP_RIGHT_X + (GAME_WIDTH - CUP_RIGHT_X) / 2,
    CUP_TOP_Y - 80,
    GAME_WIDTH - CUP_RIGHT_X,
    20,
    { ...wallOptions, label: 'boundary' }
  );

  cupBodies = [leftWall, rightWall, floor, leftCeiling, rightCeiling];
  Composite.add(engine.world, cupBodies);
}

// ── Cup Extension (rebuild walls taller) ────────────────────────
export function extendCup(totalExtendPx) {
  // Remove old cup bodies
  for (const b of cupBodies) {
    Composite.remove(engine.world, b);
  }
  cupBodies = [];

  const wallOptions = {
    isStatic: true,
    friction: 0.3,
    restitution: 0.2,
    render: { visible: false },
    label: 'cup-wall',
  };

  const effectiveTopY = CUP_TOP_Y - totalExtendPx;
  const wallHeight = CUP_BOTTOM_Y - effectiveTopY + 60;
  const wallCenterY = effectiveTopY + wallHeight / 2 - 30;

  const leftWall = Bodies.rectangle(
    CUP_LEFT_X - CUP_WALL_THICKNESS / 2, wallCenterY,
    CUP_WALL_THICKNESS, wallHeight, wallOptions
  );
  const rightWall = Bodies.rectangle(
    CUP_RIGHT_X + CUP_WALL_THICKNESS / 2, wallCenterY,
    CUP_WALL_THICKNESS, wallHeight, wallOptions
  );
  const floor = Bodies.rectangle(
    (CUP_LEFT_X + CUP_RIGHT_X) / 2,
    CUP_BOTTOM_Y + CUP_WALL_THICKNESS / 2,
    CUP_RIGHT_X - CUP_LEFT_X + CUP_WALL_THICKNESS * 2,
    CUP_WALL_THICKNESS, { ...wallOptions, label: 'cup-floor' }
  );
  const leftCeiling = Bodies.rectangle(
    CUP_LEFT_X / 2, effectiveTopY - 80,
    CUP_LEFT_X, 20,
    { ...wallOptions, label: 'boundary' }
  );
  const rightCeiling = Bodies.rectangle(
    CUP_RIGHT_X + (GAME_WIDTH - CUP_RIGHT_X) / 2, effectiveTopY - 80,
    GAME_WIDTH - CUP_RIGHT_X, 20,
    { ...wallOptions, label: 'boundary' }
  );

  cupBodies = [leftWall, rightWall, floor, leftCeiling, rightCeiling];
  Composite.add(engine.world, cupBodies);
}

export function resetCup() {
  // Remove extended cup and rebuild default
  for (const b of cupBodies) {
    Composite.remove(engine.world, b);
  }
  cupBodies = [];
  buildCup();
}

// ── Ball Creation ───────────────────────────────────────────────
export function createBallBody(x, y, tierIndex) {
  const tier = BALL_TIERS[tierIndex];

  // Smaller balls (white, red, yellow, orange) are squishier/gooier —
  // slightly less friction so they slide between others better
  let friction = BALL_FRICTION;
  let restitution = BALL_RESTITUTION;
  if (tierIndex <= 3) {
    const squishiness = 1 - (tierIndex / 3); // 1.0 for white, 0 for orange
    friction = BALL_FRICTION * (0.4 + 0.6 * (1 - squishiness)); // white=0.02, orange=0.05
    restitution = BALL_RESTITUTION + squishiness * 0.15; // white=0.45, orange=0.3
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
export function step(delta) {
  Engine.update(engine, delta);
}
