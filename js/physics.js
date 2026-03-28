// ── Physics Engine (Matter.js) ──────────────────────────────────
import {
  GAME_WIDTH, GAME_HEIGHT, GRAVITY,
  CUP_WALL_THICKNESS, CUP_BOTTOM_Y, CUP_TOP_Y,
  CUP_LEFT_X, CUP_RIGHT_X,
  BALL_RESTITUTION, BALL_FRICTION, BALL_DENSITY,
  BALL_TIERS,
} from './config.js';

const { Engine, World, Bodies, Body, Events, Composite } = Matter;

let engine;
let collisionCallback = null;

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
    wallOptions
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

  Composite.add(engine.world, [leftWall, rightWall, floor, leftCeiling, rightCeiling]);
}

// ── Ball Creation ───────────────────────────────────────────────
export function createBallBody(x, y, tierIndex) {
  const tier = BALL_TIERS[tierIndex];
  const body = Bodies.circle(x, y, tier.radius, {
    restitution: BALL_RESTITUTION,
    friction: BALL_FRICTION,
    density: BALL_DENSITY,
    label: 'ball',
  });

  // Custom properties
  body.tierIndex = tierIndex;
  body.isMerging = false;
  body.createdAt = performance.now();
  body.aboveDangerSince = null;

  Composite.add(engine.world, body);
  return body;
}

export function removeBody(body) {
  Composite.remove(engine.world, body);
}

// ── Collision Handling ──────────────────────────────────────────
function registerCollisionHandler() {
  Events.on(engine, 'collisionStart', (event) => {
    if (!collisionCallback) return;
    for (const pair of event.pairs) {
      if (pair.bodyA.label === 'ball' && pair.bodyB.label === 'ball') {
        collisionCallback(pair.bodyA, pair.bodyB);
      }
    }
  });
}

export function onCollision(callback) {
  collisionCallback = callback;
}

// ── Step ────────────────────────────────────────────────────────
export function step(delta) {
  Engine.update(engine, delta);
}
