// ── Squishy Fruit — Main Game Loop ──────────────────────────────
// Must stay the first import: canvas shims for older phones have to be
// installed before any other module draws
import './compat.js';
import {
  GAME_WIDTH, GAME_HEIGHT, DROP_COOLDOWN_MS, DROP_Y, DROP_Y_MIN,
  BALL_TIERS, RAINBOW_TIER, DANGER_LINE_Y, DANGER_DURATION_MS, MODES,
  COIN_SCORE_DIVISOR, COIN_MERGE_DIVISOR, COIN_WIN_BONUS,
  ZEN_COIN_SCALE, ZEN_COIN_CAP,
  JUICE_SQUIRT_CHANCE, JUICE_SQUIRT_TIER_BONUS,
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
import * as Cups from './cups.js';
import * as Fever from './fever.js';
import * as Perf from './perf.js';
import * as Clock from './clock.js';

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

// Flat bonus for making the rainbow (not multiplied by the combo)
const RAINBOW_BONUS = 500;
// Game-over taps are ignored this long so a panicked tap can't skip it
const GAMEOVER_TAP_GUARD_MS = 800;

// ── Init ────────────────────────────────────────────────────────
function setup() {
  const canvas = document.getElementById('game');
  Perf.init();
  // Particle budgets follow the adaptive quality level
  const applyBudget = (s) => Particles.setBudget(s.particles, s.juice);
  applyBudget(Perf.getSettings());
  Perf.onChange((level, settings) => applyBudget(settings));
  Physics.init();
  Renderer.init(canvas);
  Input.init(canvas, GAME_WIDTH, GAME_HEIGHT);
  Audio.setMuted(Save.getMuted());
  // Audio may only start on a real user activation (a release, not a
  // touchstart). Listen for the whole session: iOS can re-suspend the
  // context after a call, and the next tap should bring sound back.
  for (const type of ['touchend', 'mouseup', 'keydown']) {
    window.addEventListener(type, Audio.unlock, { passive: true });
  }

  // Wire collision → merge + effects
  Physics.onCollision((bodyA, bodyB) => {
    // Physics keeps running under the game-over overlay so the pile
    // settles, but the run is over: no merges, no points, no fever
    if (gameState !== 'playing') return;

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
      const earned = Score.addPoints(points);
      Fever.onMerge(Score.combo);
      Particles.emitMerge(merge.x, merge.y, merge.tierIndex, Score.combo);
      Particles.emitScorePopup(merge.x, merge.y, earned, Score.combo);
      maybeSquirtJuice(merge);
      // The newborn fruit's instrument plays the hit, in key with the
      // band; combos climb the chord on the beat grid
      Music.onMerge(merge.tierIndex, Score.combo);
      Input.hapticMerge(merge.tierIndex);
      Music.bumpActivity();

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

  // Mute button, menus, and store buttons get first refusal on every
  // press; only presses they don't claim become drops
  Input.setUIHitTest(checkUIHit);

  setupMobileFullscreen();
  loadFont();
  registerServiceWorker();

  requestAnimationFrame(loop);
}

// ── Font & Offline Cache ────────────────────────────────────────
// The canvas is the only thing drawing text, and browsers don't fetch
// a web font until something asks for it — ask up front so the HUD
// switches to the hand-drawn face within the first frames (text draws
// in the fallback font until then, never blank).
function loadFont() {
  if (document.fonts && document.fonts.load) {
    document.fonts.load('20px "Patrick Hand"').catch(() => {});
  }
}

// Cache the game for instant, offline-capable launches (see sw.js).
// Skipped on localhost so edits show up on a plain reload while
// developing.
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) return;
  const register = () => navigator.serviceWorker.register('sw.js').catch(() => {});
  // Wait for the first load to finish so caching never competes with it
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
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

// ── Juice Squirt ────────────────────────────────────────────────
// Only some merges squirt — a constant spray would stop being a treat.
// `merge` is the result from balls.js: the merge point, the seam angle
// of the pinch, and the radius/tier of the fruit that squished.
function maybeSquirtJuice(merge, force = false) {
  // Tier that was squeezed (classic skips grapefruit, so don't infer it)
  const sourceTier = merge.sourceTier != null ? merge.sourceTier : merge.tierIndex - 1;
  const producedRainbow = merge.tierIndex === RAINBOW_TIER;
  const chance = JUICE_SQUIRT_CHANCE + Math.max(0, sourceTier) * JUICE_SQUIRT_TIER_BONUS;
  if (!force && !producedRainbow && Math.random() > chance) return;
  const juiceTier = Math.max(0, Math.min(sourceTier, BALL_TIERS.length - 1));
  Particles.emitJuiceSquirt(
    merge.x, merge.y,
    merge.seamAngle != null ? merge.seamAngle : Math.random() * Math.PI,
    merge.sourceRadius,
    juiceTier
  );
}

// Live fruit outlines so juice can splash onto and run down them
function refreshJuiceColliders() {
  if (!Particles.hasJuice()) return;
  const list = [];
  for (const entry of Balls.getAll().values()) {
    if (entry.isGhost) continue;
    const r = entry.isBomb ? 16 : BALL_TIERS[entry.tierIndex].radius;
    list.push({ x: entry.body.position.x, y: entry.body.position.y, r });
  }
  Particles.setJuiceColliders(list, Store.getCupExtendPx());
}

// ── Drop Point ──────────────────────────────────────────────────
// The drop line rises with the cup so fruit always enter from above
// the rim (and above the danger line), stopping short of the UI.
function getDropY() {
  return Math.max(DROP_Y - Store.getCupExtendPx(), DROP_Y_MIN);
}

// Keep the aim clamp sized to whatever is about to fall
function syncDropClamp() {
  const r = Store.isBombQueued() ? 16 : BALL_TIERS[currentDropTier].radius;
  Input.setClampRadius(r);
}

// ── UI Press Handling (per-state dispatch) ──────────────────────
// Called synchronously by input.js on every pointer-down with game-space
// coordinates. Returns true when something on screen took the press.
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
      if (hit && performance.now() - gameoverAt > GAMEOVER_TAP_GUARD_MS) {
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
      // Zen has no game over, so it needs an explicit way out — the
      // small exit button under the zen tag banks progress and leaves.
      if (currentMode === 'zen' && Renderer.checkZenExitHit(x, y)) {
        Input.state.uiConsumed = true;
        exitZenMode();
        return true;
      }

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
          // colorBomb/ghostBall just queue for the next drop (handled
          // in drop logic); the bomb is smaller, so re-fit the aim clamp
          syncDropClamp();

          Audio.playMerge(5, 1); // satisfying purchase sound
          touchTooltipId = null;
        } else {
          Audio.playDrop(0); // soft "nope"
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

  if (hit.type === 'cup') {
    if (Save.isCupUnlocked(hit.id)) {
      if (Cups.selectCup(hit.id)) {
        Renderer.applyTheme();
        Audio.playDrop(3);
      }
    } else if (Cups.purchaseCup(hit.id)) {
      Renderer.applyTheme();
      Audio.playMerge(5, 2); // cha-ching
      Particles.triggerShake(4);
    }
    return;
  }

  if (hit.type === 'tab') {
    Audio.playDrop(1);
    return;
  }

  if (hit.type === 'upgrade') {
    if (Skins.purchaseUpgrade(hit.id)) {
      Audio.playMerge(5, 2);
      Particles.triggerShake(4);
    }
  }
}

// Leaving zen isn't a game over — bank the high score and coin payout
// for the session, then drop back to the menu.
function exitZenMode() {
  Score.saveHighScore('zen');
  const coins = computeCoins(false, 'zen');
  if (coins > 0) Save.addCoins(coins);
  Audio.playDrop(2);
  returnToMenu();
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
  const now = Clock.now();
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
  Music.setDanger(dangerLevel);
}

// ── Music Band Line-up ──────────────────────────────────────────
// Every fruit tier is an instrument in the soundtrack; count what's
// sitting in the cup so the band plays exactly those parts.
const bandCounts = new Array(BALL_TIERS.length).fill(0);

function syncMusicBand() {
  bandCounts.fill(0);
  for (const entry of Balls.getAll().values()) {
    if (entry.isBomb || entry.isGhost || entry.tierIndex < 0) continue;
    if (entry.body.isMerging) continue;
    bandCounts[entry.tierIndex]++;
  }
  Music.setCupContents(bandCounts);
}

// Zen has no game over: a ball that lingers above the line gently
// pops instead, banking its points and making room in the cup.
function zenOverflowRelief() {
  const expired = Balls.findExpiredDangerBall(getEffectiveDangerY());
  if (!expired) return;
  const popped = Balls.popBall(expired.body.id);
  if (!popped || popped.tierIndex < 0) return;

  // Banked as a flat bonus: a pop isn't a merge, so it neither feeds
  // the combo nor counts toward the merge-based coin payout
  const points = Score.addBonus(BALL_TIERS[popped.tierIndex].points);
  Particles.emitMerge(popped.x, popped.y, popped.tierIndex, 1);
  Particles.emitScorePopup(popped.x, popped.y, points, 1);
  Audio.playDrop(popped.tierIndex);
}

// ── Game Loop ───────────────────────────────────────────────────
let lastTime = 0;

function loop(timestamp) {
  requestAnimationFrame(loop);

  const rawDelta = lastTime ? timestamp - lastTime : 16.67;
  lastTime = timestamp;
  Perf.sample(rawDelta);
  // Cap the catch-up so a stall (tab switch, GC pause) can't cascade
  // into a spiral of ever more simulation per frame
  const delta = Math.min(rawDelta, 50);

  // Everything that moves runs in fixed 60 Hz slices — physics, juice,
  // sparkles — so a phone rendering at 30 fps still plays at full
  // speed instead of in slow motion
  const simSteps = Physics.fixedSteps(delta);
  // Game time moves with the simulation, never with the wall clock
  Clock.advance(simSteps * Physics.FIXED_DT);

  if (gameState === 'menu' || gameState === 'shop') {
    // Belt and suspenders with checkUIHit's consume-everything: no
    // tap on a menu screen may ever become a ball drop
    Input.state.dropRequested = false;
  } else if (gameState === 'playing') {
    const modeCfg = MODES[currentMode];

    // Handle drop / ghost activation
    if (Input.state.dropRequested) {
      Input.state.dropRequested = false;

      // Cooldown runs on game time so a pause can't bank a free drop
      const now = Clock.now();

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
        const dropY = getDropY();
        const dropX = Input.state.pointerX;
        if (Store.isBombQueued()) {
          // Drop a bomb ball instead of normal
          Balls.spawnBombBall(dropX, dropY);
          Particles.emitSpawnPop(dropX, dropY, 1); // ~bomb-sized ring
          Audio.playDrop(7); // deeper sound for bomb
          Store.consumeBombQueue();
        } else if (Store.isGhostQueued()) {
          // Drop a ghost ball with the current drop tier color
          Balls.spawnGhostBall(dropX, currentDropTier, dropY);
          Particles.emitSpawnPop(dropX, dropY, currentDropTier);
          Audio.playDrop(currentDropTier);
          Store.consumeGhostQueue();

          currentDropTier = nextDropTier;
          nextDropTier = Balls.getNextDropTier();
        } else {
          Balls.spawnBall(dropX, currentDropTier, dropY);
          Particles.emitSpawnPop(dropX, dropY, currentDropTier);
          Audio.playDrop(currentDropTier);

          currentDropTier = nextDropTier;
          nextDropTier = Balls.getNextDropTier();
        }
        syncDropClamp();
        lastDropTime = now;
      }
    }

    // Step physics
    for (let i = 0; i < simSteps; i++) Physics.stepOnce();

    // Update bomb suck-in effect
    const bombResult = Balls.updateBombEffect();
    if (bombResult && bombResult.points > 0) {
      const points = bombResult.points * Fever.getMultiplier();
      const earned = Score.addPoints(points, bombResult.merges);
      Fever.onMerge(Score.combo);
      Particles.emitMerge(bombResult.x, bombResult.y, bombResult.tier, 5);
      Particles.emitScorePopup(bombResult.x, bombResult.y, earned, Score.combo);
      // A bomb crushing a whole color at once always makes a mess
      maybeSquirtJuice({
        x: bombResult.x, y: bombResult.y, tierIndex: bombResult.tier,
        seamAngle: bombResult.seamAngle, sourceTier: bombResult.sourceTier,
        sourceRadius: bombResult.sourceRadius,
      }, true);
      Music.onMerge(bombResult.tier, 3);
      Input.hapticMerge(8);
      Music.bumpActivity(0.3);
      Particles.triggerShake(12);
      checkNewUnlocks();
    }

    // Music tempo tracks run intensity: combo streaks lift it, fever
    // pins it high, and bumpActivity() merge pings (added inside
    // music.js) surge it during heavy merging even at low combo
    Music.setIntensity(Math.min(1,
      Score.combo / 6 + (Fever.isActive() ? 0.5 : Fever.getMeter() * 0.25)));
    // The band's line-up is whatever fruit are in the cup right now
    syncMusicBand();

    // Fever meter tick + start/end transitions
    const feverEvents = Fever.update(delta);
    if (feverEvents.started) {
      Audio.playFeverStart();
      Audio.setFeverActive(true);
      Music.setFever(true);
      Particles.setFeverActive(true);
      Particles.triggerShake(10);
      Input.hapticWin();
    }
    if (feverEvents.ended) {
      Audio.playFeverEnd();
      Audio.setFeverActive(false);
      Music.setFever(false);
      Particles.setFeverActive(false);
    }

    // Update danger (zen relieves overflow instead of ending the run)
    if (modeCfg.danger) {
      updateDangerLevel();
    } else {
      dangerLevel = 0;
      Particles.setDangerLevel(0);
      Music.setDanger(0);
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
          Score.addBonus(RAINBOW_BONUS);
          Particles.emitMerge(rb.x, rb.y, RAINBOW_TIER, 5);
          Particles.emitScorePopup(rb.x, rb.y, RAINBOW_BONUS, 1);
          // The rainbow merge already played the band's fanfare
          Input.hapticWin();
        }
      } else {
        Score.addBonus(RAINBOW_BONUS);
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
    for (let i = 0; i < simSteps; i++) Physics.stepOnce();
    updateCoinTicks();

    if (Input.state.dropRequested) {
      Input.state.dropRequested = false;
      // Tap anywhere (outside the buttons) replays the same mode — but
      // only a fresh tap. Drops fire on release, so a finger that was
      // still aiming when the cup overflowed would otherwise restart
      // the run the instant it lifted, skipping the results screen.
      const now = performance.now();
      if (now - gameoverAt > GAMEOVER_TAP_GUARD_MS &&
          Input.state.pressStartedAt > gameoverAt) {
        startGame(currentMode);
      }
    }
  }

  // Update particles (juice needs the current fruit layout to splash on)
  if (gameState === 'playing' || gameState === 'gameover') refreshJuiceColliders();
  for (let i = 0; i < simSteps; i++) Particles.update();
  Balls.cleanupEffects();

  // Cleanup squish states + cached sprites for removed balls
  Renderer.cleanupSquishStates(Balls.getAll());

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
  const rs = renderState;
  rs.simSteps = simSteps;
  rs.gameState = gameState;
  rs.mode = currentMode;
  rs.fever.meter = Fever.getMeter();
  rs.fever.active = Fever.isActive();
  rs.rushTimeLeftMs = rushTimeLeftMs;
  rs.dangerEnabled = MODES[currentMode].danger;
  rs.balls = Balls.getAll();
  rs.previewX = Input.state.pointerX;
  rs.previewTier = currentDropTier;
  // A queued bomb drops first without using up the current fruit, so
  // the current fruit is what really comes next
  rs.nextTier = Store.isBombQueued() ? currentDropTier : nextDropTier;
  rs.dropY = getDropY();
  rs.score = Score.current;
  rs.bestScore = Math.max(Score.getHighScore(currentMode), Score.current);
  rs.bestCombo = Math.max(Score.bestCombo, Score.getBestCombo());
  rs.combo = Score.combo;
  rs.won = won;
  rs.isNewBest = isNewBest;
  rs.gameoverReason = gameoverReason;
  rs.coinsEarned = coinsEarned;
  rs.gameoverAt = gameoverAt;
  rs.coinBalance = Save.getCoins();
  rs.dangerLevel = dangerLevel;
  rs.isDragging = Input.state.isDragging;
  rs.isTouchDevice = Input.getIsTouchDevice();
  rs.muted = Audio.isMuted();
  rs.bombQueued = Store.isBombQueued();
  rs.ghostQueued = Store.isGhostQueued();
  rs.hasActiveGhost = !!Balls.getActiveGhost();
  rs.cupExtendPx = Store.getCupExtendPx();
  for (const id of STORE_IDS) {
    rs.storePrices[id] = Store.getPrice(id);
    rs.storeAffordable[id] = Store.canAfford(id, Score.current);
    rs.storeBlocked[id] = Store.getBlockReason(id);
  }
  rs.storeTooltip = storeTooltip;
  rs.storeTooltipHint = storeTooltipHint;
  Renderer.render(rs);
}

// One render-state object reused every frame — rebuilding it (plus its
// nested objects) 60 times a second is steady garbage for a phone's GC
const STORE_IDS = ['colorBomb', 'cupExtend', 'ghostBall'];
const renderState = {
  fever: { meter: 0, active: false },
  storePrices: {},
  storeAffordable: {},
  storeBlocked: {},
};

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
  // The frenzy ends with the run — otherwise its wash and meter keep
  // pulsing under the results screen
  Fever.reset();
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
  Balls.setZenTiersEnabled(modeId === 'zen');
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
  Renderer.resetCupAnimation(Store.getCupExtendPx());

  currentDropTier = Balls.getNextDropTier();
  nextDropTier = Balls.getNextDropTier();
  syncDropClamp();
  rushTimeLeftMs = MODES[modeId].timeLimitMs || 0;
  Save.incrementGamesPlayed();
  gameState = 'playing';
  Perf.settle(1000);
  won = false;
  isNewBest = false;
  lastDropTime = Clock.now();
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
  Fever.reset();
  Physics.resetCup();
  Audio.stopDangerHum();
  // Leaving mid-frenzy (zen exit) must drop the pitched-up soundscape
  Audio.setFeverActive(false);
  Music.stop(0.5);
  gameState = 'menu';
}

// ── Start ───────────────────────────────────────────────────────
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setup);
} else {
  setup();
}
