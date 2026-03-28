// ── Squishy Guys — Main Game Loop ───────────────────────────────
import { GAME_WIDTH, GAME_HEIGHT, DROP_COOLDOWN_MS, BALL_TIERS } from './config.js';
import * as Physics from './physics.js';
import * as Balls from './balls.js';
import * as Renderer from './renderer.js';
import * as Input from './input.js';
import * as Score from './score.js';

// ── State ───────────────────────────────────────────────────────
let gameState = 'playing'; // 'playing' | 'gameover'
let currentDropTier = 0;
let nextDropTier = Balls.getNextDropTier();
let lastDropTime = 0;
let won = false;

// ── Init ────────────────────────────────────────────────────────
function setup() {
  const canvas = document.getElementById('game');
  Physics.init();
  Renderer.init(canvas);
  Input.init(canvas, GAME_WIDTH, GAME_HEIGHT);

  // Wire collision → merge
  Physics.onCollision((bodyA, bodyB) => {
    const points = Balls.handleCollision(bodyA, bodyB);
    if (points > 0) {
      Score.addPoints(points);
    }
  });

  currentDropTier = Balls.getNextDropTier();
  nextDropTier = Balls.getNextDropTier();

  requestAnimationFrame(loop);
}

// ── Game Loop ───────────────────────────────────────────────────
let lastTime = 0;

function loop(timestamp) {
  requestAnimationFrame(loop);

  const delta = lastTime ? Math.min(timestamp - lastTime, 32) : 16.67;
  lastTime = timestamp;

  if (gameState === 'playing') {
    // Handle drop
    if (Input.state.dropRequested) {
      Input.state.dropRequested = false;
      const now = performance.now();
      if (now - lastDropTime >= DROP_COOLDOWN_MS) {
        Balls.spawnBall(Input.state.pointerX, currentDropTier);
        currentDropTier = nextDropTier;
        nextDropTier = Balls.getNextDropTier();
        lastDropTime = now;
      }
    }

    // Step physics
    Physics.step(delta);

    // Check win (rainbow created)
    if (Balls.hasRainbow()) {
      gameState = 'gameover';
      won = true;
      Score.addPoints(500); // Bonus for rainbow
      Score.saveHighScore();
    }
    // Check game over
    else if (Balls.checkGameOver()) {
      gameState = 'gameover';
      won = false;
      Score.saveHighScore();
    }
  } else if (gameState === 'gameover') {
    // Still step physics for visual effect
    Physics.step(delta);

    if (Input.state.dropRequested) {
      Input.state.dropRequested = false;
      resetGame();
    }
  }

  // Cleanup old effects
  Balls.cleanupEffects();

  // Render
  Renderer.render({
    gameState,
    balls: Balls.getAll(),
    previewX: Input.state.pointerX,
    previewTier: currentDropTier,
    score: Score.current,
    highScore: Score.getHighScore(),
    combo: Score.combo,
    mergeEffects: Balls.mergeEffects,
    won,
  });
}

function resetGame() {
  Balls.reset();
  Score.reset();
  currentDropTier = Balls.getNextDropTier();
  nextDropTier = Balls.getNextDropTier();
  gameState = 'playing';
  won = false;
  lastDropTime = 0;
}

// ── Start ───────────────────────────────────────────────────────
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setup);
} else {
  setup();
}
