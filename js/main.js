// ── Squishy Fruit — Main Game Loop ──────────────────────────────
import {
  GAME_WIDTH, GAME_HEIGHT, DROP_COOLDOWN_MS,
  BALL_TIERS, RAINBOW_TIER, DANGER_LINE_Y, DANGER_DURATION_MS, MODES,
  COIN_SCORE_DIVISOR, COIN_MERGE_DIVISOR, COIN_WIN_BONUS,
  ZEN_COIN_SCALE, ZEN_COIN_CAP,
} from './config.js';
import * as Physics from './physics.js';
import * as Balls from './balls.js';
import * as Renderer from './renderer.js';
import * as Input from './input.js';
import * as Score from './score.js';
import * as Particles from './particles.js';
import * as Audio from './audio.js';
import * as Music from './music.js';
import * as Store from './store.js';
import * as Save from './save.js';
import * as Menus from './menus.js';
import * as Skins from './skins.js';
import * as Fever from './fever.js';

// ── State ───────────────────────────────────────────────────────
let gameState = 'menu'; // 'menu' | 'shop' | 'playing' | 'gameover'
let currentMode = 'classic'; // 'classic' | 'rush' | 'zen'
let currentDropTier = 0;
let nextDropTier = 0;
let lastDropTime = 0;
let won = false;
let isNewBest = false;
let dangerLevel = 0; // 0-1, how close to game over
let previouslyUnlocked = new Set([0, 1, 2, 3]);
let seenBombEffect = null; // last bomb effect we played the suck sound for
let coinsEarned = 0; // coins awarded for the run that just ended
let gameoverAt = 0; // drives restart guard + coin count-up ceremony
let gameoverReason = 'danger'; // 'danger' | 'time' | 'rainbow'
let rushTimeLeftMs = 0;

// Store tooltips — touch shows one on first tap and buys on the next
// tap while it's still up; desktop shows them on plain hover.
const TOUCH_TOOLTIP_MS = 3500;
let touchTooltipId = null;
let touchTooltipAt = 0;

// ── Init ────────────────────────────────────────────────────────
function setup() {
  const canvas = document.getElementById('game');
  Physics.init();
  Renderer.init(canvas);
  Input.init(canvas, GAME_WIDTH, GAME_HEIGHT);
  Audio.setMuted(Save.getMuted());

  // Wire collision → merge + effects
  Physics.onCollision((bodyA, bodyB) => {
    const merge = Balls.handleCollision(bodyA, bodyB);

    // Bomb starts its suck-in phase asynchronously; play the suction
    // sound once per bomb effect (contact events can re-fire)
    const bombEffect = Balls.getActiveBombEffect();
    if (bombEffect && bombEffect !== seenBombEffect) {
      seenBombEffect = bombEffect;
      Audio.playBombSuck();
      Particles.triggerShake(4);
      return;
    }

    if (merge) {
      const points = merge.points * Fever.getMultiplier();
      Score.addPoints(points);
      Fever.onMerge(Score.combo);
      Particles.emitMerge(merge.x, merge.y, merge.tierIndex, Score.combo);
      Particles.emitScorePopup(merge.x, merge.y, points, Score.combo);
      Audio.playMerge(merge.tierIndex, Score.combo);
      Input.hapticMerge(merge.tierIndex);

      checkNewUnlocks();
    }
  });

  // Wall/floor collision sounds
  Physics.onWallCollision((body, speed) => {
    Audio.playBounce(speed);
  });

  // Ghost ball auto-activates on floor hit
  Physics.onFloorCollision((body) => {
    const ghost = Balls.getActiveGhost();
    if (ghost && ghost.body.id === body.id) {
      Balls.activateGhost();
      Audio.playMerge(ghost.tierIndex, 1);
      Particles.emitSpawnPop(body.position.x, body.position.y, ghost.tierIndex);
    }
  });

  currentDropTier = Balls.getNextDropTier();
  nextDropTier = Balls.getNextDropTier();

  // Handle mute button, menu, and store clicks
  canvas.addEventListener('mousedown', handleUIClick);
  canvas.addEventListener('touchstart', handleUITouch, { passive: false });

  setupMobileFullscreen();

  requestAnimationFrame(loop);
}

// ── Mobile Fullscreen ───────────────────────────────────────────
// Android (and other mobile browsers with the Fullscreen API): promote
// to true fullscreen on the first tap — the API only works inside a
// user gesture. iOS Safari has no Fullscreen API on iPhone; there,
// fullscreen comes from the home-screen standalone mode configured in
// index.html + manifest.webmanifest, so this quietly does nothing.
function setupMobileFullscreen() {
  if (!Input.getIsTouchDevice()) return;
  // Already running as an installed/standalone app — nothing to do
  if (navigator.standalone ||
      window.matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches) {
    return;
  }

  const onTap = () => {
    if (document.fullscreenElement) {
      window.removeEventListener('touchend', onTap);
      return;
    }
    const el = document.documentElement;
    const request = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!request) {
      window.removeEventListener('touchend', onTap);
      return;
    }
    try {
      const p = request.call(el, { navigationUI: 'hide' });
      if (p && p.then) {
        p.then(() => window.removeEventListener('touchend', onTap))
         .catch(() => {}); // rejected (e.g. iOS) — keep playing windowed
      }
    } catch {
      window.removeEventListener('touchend', onTap);
    }
  };
  window.addEventListener('touchend', onTap, { passive: true });
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

// ── UI Click Handling (per-state dispatch) ──────────────────────
function handleUIClick(e) {
  const rect = e.target.getBoundingClientRect();
  const scaleX = GAME_WIDTH / rect.width;
  const scaleY = GAME_HEIGHT / rect.height;
  const x = (e.clientX - rect.left) * scaleX;
  const y = (e.clientY - rect.top) * scaleY;
  if (checkUIHit(x, y)) {
    e.stopImmediatePropagation();
  }
}

function handleUITouch(e) {
  const touch = e.touches[0];
  const rect = e.target.getBoundingClientRect();
  const scaleX = GAME_WIDTH / rect.width;
  const scaleY = GAME_HEIGHT / rect.height;
  const x = (touch.clientX - rect.left) * scaleX;
  const y = (touch.clientY - rect.top) * scaleY;
  if (checkUIHit(x, y)) {
    e.stopImmediatePropagation();
  }
}

function checkUIHit(x, y) {
  // Mute button — active in every state
  const btn = Renderer.MUTE_BTN;
  const dist = Math.sqrt((x - btn.x) ** 2 + (y - btn.y) ** 2);
  if (dist < btn.size) {
    Save.setMuted(Audio.toggleMute());
    Input.state.uiConsumed = true;
    return true;
  }

  switch (gameState) {
    case 'menu': {
      const hit = Menus.checkMenuHit(x, y);
      if (hit === 'shop') {
        Audio.playDrop(2);
        gameState = 'shop';
      } else if (hit && MODES[hit]) {
        Audio.playMerge(3, 1);
        startGame(hit);
      }
      // Consume every tap in the menu so a stray press can never
      // leak a dropRequested into the first playing frame
      Input.state.uiConsumed = true;
      return true;
    }

    case 'shop': {
      const hit = Menus.checkShopHit(x, y);
      if (hit) handleShopAction(hit);
      Input.state.uiConsumed = true;
      return true;
    }

    case 'gameover': {
      const hit = Menus.checkGameOverHit(x, y);
      if (hit && performance.now() - gameoverAt > 800) {
        if (hit === 'again') {
          Audio.playMerge(3, 1);
          startGame(currentMode);
        } else {
          Audio.playDrop(2);
          returnToMenu();
        }
        Input.state.uiConsumed = true;
        return true;
      }
      // Taps elsewhere fall through to the tap-anywhere restart
      return false;
    }

    case 'playing': {
      const storeHit = Renderer.checkStoreButtonHit(x, y);
      if (storeHit) {
        // Always consume taps on a store button — a failed purchase
        // must never fall through and drop a fruit
        Input.state.uiConsumed = true;

        // Touch has no hover: the first tap opens the tooltip so the
        // player knows what they're buying; the next tap confirms.
        if (Input.getIsTouchDevice() && touchTooltipId !== storeHit) {
          touchTooltipId = storeHit;
          touchTooltipAt = performance.now();
          Audio.playDrop(1);
          return true;
        }

        const result = Store.purchase(storeHit, Score.current);
        if (result.success) {
          Score.spend(result.cost);

          if (storeHit === 'cupExtend') {
            applyNewCupExtension();
          }
          // colorBomb just queues the bomb for next drop (handled in drop logic)

          Audio.playMerge(5, 1); // satisfying purchase sound
          touchTooltipId = null;
        }
        return true;
      }
      return false;
    }
  }
  return false;
}

function handleShopAction(hit) {
  if (hit.type === 'back') {
    Audio.playDrop(2);
    gameState = 'menu';
    return;
  }

  if (hit.type === 'skin') {
    if (Save.isSkinUnlocked(hit.id)) {
      if (Skins.selectSkin(hit.id)) {
        Renderer.applyTheme();
        Audio.playDrop(3);
      }
    } else if (Skins.purchaseSkin(hit.id)) {
      Renderer.applyTheme();
      Audio.playMerge(5, 2); // cha-ching
      Particles.triggerShake(4);
    }
    return;
  }

  if (hit.type === 'upgrade') {
    if (Skins.purchaseUpgrade(hit.id)) {
      Audio.playMerge(5, 2);
      Particles.triggerShake(4);
    }
  }
}

// ── Coin Payout ─────────────────────────────────────────────────
function computeCoins(wonRun, mode) {
  let coins = Math.floor(Score.current / COIN_SCORE_DIVISOR)
            + Math.floor(Score.mergeCount / COIN_MERGE_DIVISOR)
            + (wonRun ? COIN_WIN_BONUS : 0);
  if (mode === 'zen') {
    coins = Math.min(Math.floor(coins * ZEN_COIN_SCALE), ZEN_COIN_CAP);
  }
  return coins;
}

// ── Cup Extension ───────────────────────────────────────────────
function applyNewCupExtension() {
  Physics.extendCup(Store.getCupExtendPx());
  Particles.triggerShake(8);
}

// ── Danger Level Tracking ───────────────────────────────────────
function getEffectiveDangerY() {
  return DANGER_LINE_Y - Store.getCupExtendPx();
}

function updateDangerLevel() {
  const now = performance.now();
  let maxDanger = 0;
  const effectiveDangerY = getEffectiveDangerY();

  for (const entry of Balls.getAll().values()) {
    const { body } = entry;
    if (body.isMerging) continue;
    if (entry.isBomb) continue; // bomb balls don't contribute to danger
    if (entry.isGhost) continue; // ghost balls don't contribute to danger
    if (now - body.createdAt < 1500) continue;

    const tierRadius = BALL_TIERS[body.tierIndex].radius;
    if (body.position.y - tierRadius < effectiveDangerY) {
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

// Zen has no game over: a ball that lingers above the line gently
// pops instead, banking its points and making room in the cup.
function zenOverflowRelief() {
  const expired = Balls.findExpiredDangerBall(getEffectiveDangerY());
  if (!expired) return;
  const popped = Balls.popBall(expired.body.id);
  if (!popped || popped.tierIndex < 0) return;

  const points = BALL_TIERS[popped.tierIndex].points;
  Score.addPoints(points);
  Particles.emitMerge(popped.x, popped.y, popped.tierIndex, 1);
  Particles.emitScorePopup(popped.x, popped.y, points, 1);
  Audio.playDrop(popped.tierIndex);
}

// ── Game Loop ───────────────────────────────────────────────────
let lastTime = 0;

function loop(timestamp) {
  requestAnimationFrame(loop);

  const delta = lastTime ? Math.min(timestamp - lastTime, 32) : 16.67;
  lastTime = timestamp;

  if (gameState === 'menu' || gameState === 'shop') {
    // Belt and suspenders with checkUIHit's consume-everything: no
    // tap on a menu screen may ever become a ball drop
    Input.state.dropRequested = false;
  } else if (gameState === 'playing') {
    const modeCfg = MODES[currentMode];

    // Handle drop / ghost activation
    if (Input.state.dropRequested) {
      Input.state.dropRequested = false;
      const now = performance.now();

      // If a ghost ball is actively falling, tap activates it
      const activeGhost = Balls.getActiveGhost();
      if (activeGhost) {
        Balls.activateGhost();
        Audio.playMerge(activeGhost.tierIndex, 1);
        Particles.emitSpawnPop(
          activeGhost.body.position.x,
          activeGhost.body.position.y,
          activeGhost.tierIndex
        );
      } else if (now - lastDropTime >=
                 (modeCfg.dropCooldownMs || DROP_COOLDOWN_MS) * Fever.getCooldownScale()) {
        if (Store.isBombQueued()) {
          // Drop a bomb ball instead of normal
          Balls.spawnBombBall(Input.state.pointerX);
          Particles.emitSpawnPop(Input.state.pointerX, 120, 0);
          Audio.playDrop(7); // deeper sound for bomb
          Store.consumeBombQueue();
        } else if (Store.isGhostQueued()) {
          // Drop a ghost ball with the current drop tier color
          Balls.spawnGhostBall(Input.state.pointerX, currentDropTier);
          Particles.emitSpawnPop(Input.state.pointerX, 120, currentDropTier);
          Audio.playDrop(currentDropTier);
          Store.consumeGhostQueue();

          currentDropTier = nextDropTier;
          nextDropTier = Balls.getNextDropTier();
        } else {
          Balls.spawnBall(Input.state.pointerX, currentDropTier);
          Particles.emitSpawnPop(Input.state.pointerX, 120, currentDropTier);
          Audio.playDrop(currentDropTier);

          currentDropTier = nextDropTier;
          nextDropTier = Balls.getNextDropTier();
        }
        lastDropTime = now;
      }
    }

    // Step physics
    Physics.step(delta);

    // Update bomb suck-in effect
    const bombResult = Balls.updateBombEffect();
    if (bombResult && bombResult.points > 0) {
      const points = bombResult.points * Fever.getMultiplier();
      Score.addPoints(points);
      Fever.onMerge(Score.combo);
      Particles.emitMerge(bombResult.x, bombResult.y, bombResult.tier, 5);
      Particles.emitScorePopup(bombResult.x, bombResult.y, points, Score.combo);
      Audio.playMerge(bombResult.tier, 3);
      Input.hapticMerge(8);
      Particles.triggerShake(12);
      checkNewUnlocks();
    }

    // Music tempo tracks run intensity: combo streaks lift it, fever
    // pins it high (a modest lift — the groove quickens, not panics)
    Music.setIntensity(Math.min(1,
      Score.combo / 6 + (Fever.isActive() ? 0.5 : Fever.getMeter() * 0.25)));

    // Fever meter tick + start/end transitions
    const feverEvents = Fever.update(delta);
    if (feverEvents.started) {
      Audio.playFeverStart();
      Audio.setFeverActive(true);
      Particles.setFeverActive(true);
      Particles.triggerShake(10);
      Input.hapticWin();
    }
    if (feverEvents.ended) {
      Audio.playFeverEnd();
      Audio.setFeverActive(false);
      Particles.setFeverActive(false);
    }

    // Update danger (zen relieves overflow instead of ending the run)
    if (modeCfg.danger) {
      updateDangerLevel();
    } else {
      dangerLevel = 0;
      Particles.setDangerLevel(0);
      zenOverflowRelief();
    }

    // Rush: count down with the frame delta — rAF pauses in background
    // tabs so the clock pauses too (never diff wall-clock here)
    if (modeCfg.timeLimitMs) {
      rushTimeLeftMs = Math.max(0, rushTimeLeftMs - delta);
    }

    // End-of-run checks
    if (Balls.hasRainbow()) {
      if (currentMode === 'zen') {
        // Zen: celebrate the rainbow, then it floats away and play continues
        const rb = Balls.consumeRainbow();
        if (rb) {
          Score.addPoints(500);
          Particles.emitMerge(rb.x, rb.y, RAINBOW_TIER, 5);
          Particles.emitScorePopup(rb.x, rb.y, 500, 1);
          Audio.playWin();
          Input.hapticWin();
        }
      } else {
        Score.addPoints(500);
        endRun(true, 'rainbow');

        // Big celebration particles
        Particles.emitMerge(GAME_WIDTH / 2, GAME_HEIGHT / 2, RAINBOW_TIER, 5);
      }
    } else if (modeCfg.danger && Balls.checkGameOver(getEffectiveDangerY())) {
      endRun(false, 'danger');
    } else if (modeCfg.timeLimitMs && rushTimeLeftMs <= 0) {
      endRun(false, 'time');
    }
  } else if (gameState === 'gameover') {
    Physics.step(delta);
    updateCoinTicks();

    if (Input.state.dropRequested) {
      Input.state.dropRequested = false;
      // Tap anywhere (outside the buttons) replays the same mode.
      // Small delay to avoid accidental restart.
      if (performance.now() - gameoverAt > 800) {
        startGame(currentMode);
      }
    }
  }

  // Update particles
  Particles.update();
  Balls.cleanupEffects();

  // Cleanup squish states for removed balls
  const activeIds = new Set(Balls.getAll().keys());
  Renderer.cleanupSquishStates(activeIds);

  // Store tooltip: hover-driven on desktop, tap-driven (with expiry)
  // on touch — see checkUIHit's playing case for the touch flow.
  let storeTooltip = null;
  let storeTooltipHint = false;
  if (gameState === 'playing') {
    if (Input.getIsTouchDevice()) {
      if (touchTooltipId && performance.now() - touchTooltipAt > TOUCH_TOOLTIP_MS) {
        touchTooltipId = null;
      }
      storeTooltip = touchTooltipId;
      storeTooltipHint = !!touchTooltipId;
    } else {
      storeTooltip = Renderer.checkStoreButtonHit(Input.state.hoverX, Input.state.hoverY);
    }
  }

  // Render
  Renderer.render({
    gameState,
    mode: currentMode,
    fever: { meter: Fever.getMeter(), active: Fever.isActive() },
    rushTimeLeftMs,
    dangerEnabled: MODES[currentMode].danger,
    balls: Balls.getAll(),
    previewX: Input.state.pointerX,
    previewTier: currentDropTier,
    score: Score.current,
    bestScore: Math.max(Score.getHighScore(currentMode), Score.current),
    bestCombo: Math.max(Score.bestCombo, Score.getBestCombo()),
    combo: Score.combo,
    mergeEffects: Balls.mergeEffects,
    won,
    isNewBest,
    gameoverReason,
    coinsEarned,
    gameoverAt,
    coinBalance: Save.getCoins(),
    dangerLevel,
    isDragging: Input.state.isDragging,
    isTouchDevice: Input.getIsTouchDevice(),
    muted: Audio.isMuted(),
    bombQueued: Store.isBombQueued(),
    ghostQueued: Store.isGhostQueued(),
    hasActiveGhost: !!Balls.getActiveGhost(),
    cupExtendPx: Store.getCupExtendPx(),
    storePrices: {
      colorBomb: Store.getPrice('colorBomb'),
      cupExtend: Store.getPrice('cupExtend'),
      ghostBall: Store.getPrice('ghostBall'),
    },
    storeAffordable: {
      colorBomb: Store.canAfford('colorBomb', Score.current),
      cupExtend: Store.canAfford('cupExtend', Score.current),
      ghostBall: Store.canAfford('ghostBall', Score.current),
    },
    storeTooltip,
    storeTooltipHint,
  });
}

// Little blips while the coin ceremony counts up. Mirrors the count
// the renderer derives from gameoverAt so sight and sound stay in sync.
let lastTickedCoins = 0;

function updateCoinTicks() {
  if (coinsEarned <= 0) return;
  const t = Math.min((performance.now() - gameoverAt) / 1200, 1);
  const shown = Math.floor(coinsEarned * (1 - Math.pow(1 - t, 3)));
  if (shown > lastTickedCoins) {
    Audio.playCoinTick();
    lastTickedCoins = shown;
    if (t >= 1) Particles.triggerShake(3);
  }
}

// Centralized end-of-run: high score, coin payout, audio/haptics.
// Coins are banked immediately — the count-up on the gameover screen
// is purely visual, so a refresh mid-ceremony never loses them.
function endRun(wonRun, reason) {
  gameState = 'gameover';
  won = wonRun;
  gameoverReason = reason;
  isNewBest = Score.saveHighScore(currentMode);
  coinsEarned = computeCoins(wonRun, currentMode);
  Save.addCoins(coinsEarned);
  lastTickedCoins = 0;
  Audio.setFeverActive(false);
  Particles.setFeverActive(false);
  Music.stop(1.2);
  if (wonRun) {
    Audio.playWin();
    Input.hapticWin();
  } else {
    Audio.playGameOver();
    Input.hapticGameOver();
  }
  Audio.stopDangerHum();
  gameoverAt = performance.now();
}

function startGame(modeId) {
  currentMode = modeId;
  Score.setMode(modeId); // before Score.reset so it loads this mode's records
  Balls.reset();
  Score.reset();
  Particles.reset();
  Store.reset();
  Fever.reset();
  Audio.setFeverActive(false);
  Physics.resetCup();

  // Apply permanent upgrades bought in the unlock shop
  Store.setDiscount(Save.getUpgradeLevel('discount') * 0.10);
  const startCup = Save.getUpgradeLevel('startCup');
  if (startCup > 0) {
    Store.grantFreeCupExtensions(startCup);
    Physics.extendCup(Store.getCupExtendPx());
  }

  currentDropTier = Balls.getNextDropTier();
  nextDropTier = Balls.getNextDropTier();
  rushTimeLeftMs = MODES[modeId].timeLimitMs || 0;
  Save.incrementGamesPlayed();
  gameState = 'playing';
  won = false;
  isNewBest = false;
  lastDropTime = performance.now();
  dangerLevel = 0;
  previouslyUnlocked = new Set([0, 1, 2, 3]);
  seenBombEffect = null;
  coinsEarned = 0;
  touchTooltipId = null;
  // Called from a click/touch handler, so the AudioContext can start
  Music.start();
}

function returnToMenu() {
  Balls.reset();
  Particles.reset();
  Store.reset();
  Physics.resetCup();
  Audio.stopDangerHum();
  Music.stop(0.5);
  gameState = 'menu';
}

// ── Start ───────────────────────────────────────────────────────
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setup);
} else {
  setup();
}
