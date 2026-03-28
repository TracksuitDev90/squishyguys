// ── Squishy Guys — Main Game Loop ───────────────────────────────
import {
  GAME_WIDTH, GAME_HEIGHT, DROP_COOLDOWN_MS,
  BALL_TIERS, DANGER_LINE_Y, DANGER_DURATION_MS,
} from './config.js';
import * as Physics from './physics.js';
import * as Balls from './balls.js';
import * as Renderer from './renderer.js';
import * as Input from './input.js';
import * as Score from './score.js';
import * as Particles from './particles.js';
import * as Audio from './audio.js';

// ── State ───────────────────────────────────────────────────────
let gameState = 'playing'; // 'playing' | 'gameover'
let currentDropTier = 0;
let nextDropTier = 0;
let lastDropTime = 0;
let won = false;
let dangerLevel = 0; // 0-1, how close to game over
let previouslyUnlocked = new Set([0, 1, 2, 3, 4]);

// ── Init ────────────────────────────────────────────────────────
function setup() {
  const canvas = document.getElementById('game');
  Physics.init();
  Renderer.init(canvas);
  Input.init(canvas, GAME_WIDTH, GAME_HEIGHT);

  // Wire collision → merge + effects
  Physics.onCollision((bodyA, bodyB) => {
    const points = Balls.handleCollision(bodyA, bodyB);
    if (points > 0) {
      Score.addPoints(points);

      // Find which tier was just created
      const mergeX = (bodyA.position.x + bodyB.position.x) / 2;
      const mergeY = (bodyA.position.y + bodyB.position.y) / 2;
      const newTier = findNewTier(bodyA, bodyB);

      // Particles
      Particles.emitMerge(mergeX, mergeY, newTier, Score.combo);
      Particles.emitScorePopup(mergeX, mergeY, points, Score.combo);

      // Sound
      Audio.playMerge(newTier, Score.combo);

      // Haptic
      Input.hapticMerge(newTier);

      // Check for new unlock
      checkNewUnlocks();
    }
  });

  // Wall/floor collision sounds
  Physics.onWallCollision((body, speed) => {
    Audio.playBounce(speed);
  });

  currentDropTier = Balls.getNextDropTier();
  nextDropTier = Balls.getNextDropTier();

  // Handle mute button clicks
  canvas.addEventListener('mousedown', handleMuteClick);
  canvas.addEventListener('touchstart', handleMuteTouch, { passive: false });

  requestAnimationFrame(loop);
}

function findNewTier(bodyA, bodyB) {
  // After merge, the new tier is one above what was merged
  // Since the bodies may already be removed, use the last merge effect
  const effects = Balls.mergeEffects;
  if (effects.length > 0) {
    return effects[effects.length - 1].tierIndex;
  }
  return 1;
}

function checkNewUnlocks() {
  const unlocked = Balls.getUnlockedTiers();
  for (const tier of unlocked) {
    if (!previouslyUnlocked.has(tier)) {
      previouslyUnlocked.add(tier);
      Particles.emitUnlockFlash(tier);
    }
  }
}

// ── Mute Button ─────────────────────────────────────────────────
function handleMuteClick(e) {
  const rect = e.target.getBoundingClientRect();
  const scaleX = GAME_WIDTH / rect.width;
  const scaleY = GAME_HEIGHT / rect.height;
  const x = (e.clientX - rect.left) * scaleX;
  const y = (e.clientY - rect.top) * scaleY;
  checkMuteHit(x, y);
}

function handleMuteTouch(e) {
  const touch = e.touches[0];
  const rect = e.target.getBoundingClientRect();
  const scaleX = GAME_WIDTH / rect.width;
  const scaleY = GAME_HEIGHT / rect.height;
  const x = (touch.clientX - rect.left) * scaleX;
  const y = (touch.clientY - rect.top) * scaleY;
  if (checkMuteHit(x, y)) {
    e.stopImmediatePropagation();
  }
}

function checkMuteHit(x, y) {
  const btn = Renderer.MUTE_BTN;
  const dist = Math.sqrt((x - btn.x) ** 2 + (y - btn.y) ** 2);
  if (dist < btn.size) {
    Audio.toggleMute();
    return true;
  }
  return false;
}

// ── Danger Level Tracking ───────────────────────────────────────
function updateDangerLevel() {
  const now = performance.now();
  let maxDanger = 0;

  for (const { body } of Balls.getAll().values()) {
    if (body.isMerging) continue;
    if (now - body.createdAt < 1500) continue;

    const tierRadius = BALL_TIERS[body.tierIndex].radius;
    if (body.position.y - tierRadius < DANGER_LINE_Y) {
      if (body.aboveDangerSince) {
        const elapsed = now - body.aboveDangerSince;
        maxDanger = Math.max(maxDanger, elapsed / DANGER_DURATION_MS);
      }
    }
  }

  dangerLevel = Math.min(maxDanger, 1);
  Particles.setDangerLevel(dangerLevel);
  Audio.updateDangerHum(dangerLevel);
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
        Particles.emitSpawnPop(Input.state.pointerX, 120, currentDropTier);
        Audio.playDrop(currentDropTier);

        currentDropTier = nextDropTier;
        nextDropTier = Balls.getNextDropTier();
        lastDropTime = now;
      }
    }

    // Step physics
    Physics.step(delta);

    // Update danger
    updateDangerLevel();

    // Check win
    if (Balls.hasRainbow()) {
      gameState = 'gameover';
      won = true;
      Score.addPoints(500);
      Score.saveHighScore();
      Audio.playWin();
      Input.hapticWin();
      Audio.stopDangerHum();

      // Big celebration particles
      const cx = GAME_WIDTH / 2;
      const cy = GAME_HEIGHT / 2;
      Particles.emitMerge(cx, cy, 9, 5);
    }
    // Check game over
    else if (Balls.checkGameOver()) {
      gameState = 'gameover';
      won = false;
      Score.saveHighScore();
      Audio.playGameOver();
      Input.hapticGameOver();
      Audio.stopDangerHum();
    }
  } else if (gameState === 'gameover') {
    Physics.step(delta);

    if (Input.state.dropRequested) {
      Input.state.dropRequested = false;
      // Small delay to avoid accidental restart
      if (performance.now() - lastDropTime > 800) {
        resetGame();
      }
    }
  }

  // Update particles
  Particles.update();
  Balls.cleanupEffects();

  // Cleanup squish states for removed balls
  const activeIds = new Set(Balls.getAll().keys());
  Renderer.cleanupSquishStates(activeIds);

  // Render
  Renderer.render({
    gameState,
    balls: Balls.getAll(),
    previewX: Input.state.pointerX,
    previewTier: currentDropTier,
    nextTier: nextDropTier,
    score: Score.current,
    highScore: Score.getHighScore(),
    combo: Score.combo,
    mergeEffects: Balls.mergeEffects,
    won,
    dangerLevel,
    isDragging: Input.state.isDragging,
    isTouchDevice: Input.getIsTouchDevice(),
    muted: Audio.isMuted(),
  });
}

function resetGame() {
  Balls.reset();
  Score.reset();
  Particles.reset();
  currentDropTier = Balls.getNextDropTier();
  nextDropTier = Balls.getNextDropTier();
  gameState = 'playing';
  won = false;
  lastDropTime = performance.now();
  dangerLevel = 0;
  previouslyUnlocked = new Set([0, 1, 2, 3, 4]);
  Audio.startDangerHum();
}

// ── Start ───────────────────────────────────────────────────────
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setup);
} else {
  setup();
}
