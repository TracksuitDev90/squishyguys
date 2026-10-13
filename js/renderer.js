// ── Canvas Renderer (Hand-drawn aesthetic + Juice) ──────────────
import {
  GAME_WIDTH, GAME_HEIGHT,
  CUP_LEFT_X, CUP_RIGHT_X, CUP_TOP_Y, CUP_BOTTOM_Y,
  CUP_WALL_THICKNESS, CUP_BASE_EXTRA, DANGER_LINE_Y, DROP_Y,
  BALL_TIERS, RAINBOW_TIER, INK, LEAF_GREEN, BOMB_RADIUS,
  FRUIT_HUE_JITTER, FRUIT_LIGHT_JITTER, FRUIT_SAT_JITTER,
} from './config.js';
import * as Particles from './particles.js';
import * as Menus from './menus.js';
import * as Skins from './skins.js';
import * as Cups from './cups.js';
import * as CupArt from './cupart.js';
import * as Perf from './perf.js';
import { STORE_ITEMS } from './store.js';

// Store button layout — tucked up under the score/best readout
// (BEST baseline sits at y=80) while staying clear of the drop zone
const STORE_BUTTONS = [
  { id: 'mergeBomb', x: 30, y: 112, w: 105, h: 28 },
  { id: 'cupExtend', x: 148, y: 112, w: 105, h: 28 },
  { id: 'ghostBall', x: 265, y: 112, w: 105, h: 28 },
];

let canvas, ctx;
// Backing-store scale (devicePixelRatio capped by the adaptive quality
// level). Every cached sprite is rendered at this scale.
let renderScale = 1;

// Per-ball squish state (keyed by body.id)
const ballSquish = new Map();

// Cached static gradients (built once — cheaper and consistent)
let bgGradient = null;
let spotlightGradient = null;
let vignetteGradient = null;
let feverGlowGradient = null;

// Pre-rendered full-screen layers. Filling the screen with a gradient
// three times a frame is real fill-rate on a 3x phone; a cached bitmap
// blit is one cheap copy.
let bgLayer = null;       // background gradient + spotlight
let vignetteLayer = null; // corner darkening
let feverLayer = null;    // warm frenzy wash

// Ambient floating dust motes for atmosphere
const dustMotes = [];
const DUST_COUNT = 22;
let dustEnabled = true;

// Hand-drawn "boil": linework re-jitters ~8 times a second. It cycles
// through a fixed handful of drawings (like traditional animation) so
// every fruit sprite only ever needs BOIL_FRAMES cached renders.
const BOIL_FRAMES = 3;
const BOIL_MS = 125;
let boilFrame = 0;
let boilT = 0;

// Fixed 60 Hz simulation steps taken since the last frame (main.js).
// Springs and drifts advance per step, not per frame, so the jelly
// wobbles at the same speed on a 30 fps phone, a 60 Hz laptop and a
// 120 Hz display (where half the frames have no step at all).
let frameSteps = 1;

export function init(canvasEl) {
  canvas = canvasEl;
  // Opaque: every frame paints the full background, so the compositor
  // can skip blending the canvas with the page — free fill-rate on phones
  ctx = canvas.getContext('2d', { alpha: false });

  for (let i = 0; i < DUST_COUNT; i++) {
    dustMotes.push({
      x: Math.random() * GAME_WIDTH,
      y: Math.random() * GAME_HEIGHT,
      size: 0.6 + Math.random() * 1.6,
      speed: 0.08 + Math.random() * 0.18,
      drift: (Math.random() - 0.5) * 0.15,
      phase: Math.random() * Math.PI * 2,
      alpha: 0.04 + Math.random() * 0.08,
    });
  }

  applyQuality(Perf.getSettings());
  Perf.onChange((level, settings) => {
    applyQuality(settings);
    Perf.settle(600);
  });
  handleResize();
  window.addEventListener('resize', handleResize);
  window.addEventListener('orientationchange', handleResize);
  // Mobile browsers resize the *visual* viewport (URL bar collapse,
  // keyboard, pinch) without always firing window resize — track it so
  // the canvas keeps filling the screen edge to edge.
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', handleResize);
  }
}

// iOS Safari holds on to a canvas's pixel memory until the element is
// garbage collected, and caps total canvas memory per page — a long zen
// run churning through fruit sprites can hit that cap and blank the
// game. Zeroing the size hands the memory back immediately.
function releaseCanvas(c) {
  if (c) { c.width = 0; c.height = 0; }
}

function clearSpriteCache() {
  for (const frames of spriteCache.values()) frames.forEach(releaseCanvas);
  spriteCache.clear();
}

function clearCupCache() {
  for (const sprite of cupCache.values()) releaseCanvas(sprite.canvas);
  cupCache.clear();
}

// Rebuild the cached background gradients and sprite caches — call
// after a skin/theme/cup change so the new look takes effect at once.
export function applyTheme() {
  buildStaticGradients();
  buildLayers();
  clearSpriteCache();
  clearCupCache();
}

// ── Render scale ────────────────────────────────────────────────
// The backing store is sized to the pixels the canvas actually covers
// on screen: (CSS size / game size) x devicePixelRatio. A 360px-wide
// 3x Android gets ~1080px instead of a fixed 1200 (a fifth fewer
// pixels to fill every frame), and a desktop window showing the game
// at 1.4x gets a sharp image instead of an upscaled blur. The quality
// level caps the DPR part; the total is capped so a big tablet can't
// allocate a monster backing store.
const MAX_RENDER_SCALE = 3;
let qualityMaxDpr = 3;
let cssW = GAME_WIDTH;
let scaleChosen = false;

function applyQuality(settings) {
  dustEnabled = settings.dust;
  qualityMaxDpr = settings.maxScale;
  if (canvas) handleResize();
}

function targetRenderScale() {
  const dpr = Math.min(window.devicePixelRatio || 1, qualityMaxDpr);
  return Math.max(1, Math.min(MAX_RENDER_SCALE, (cssW / GAME_WIDTH) * dpr));
}

// Offscreen canvas at the current render scale covering the game area.
// Layers stay at full resolution on purpose: a 1:1 blit is a straight
// copy, while a stretched one filters every pixel — measurably slower
// wherever the canvas is rasterized on the CPU (plenty of Android).
function makeLayer(extra = 0) {
  const c = document.createElement('canvas');
  c.width = Math.ceil((GAME_WIDTH + extra * 2) * renderScale);
  c.height = Math.ceil((GAME_HEIGHT + extra * 2) * renderScale);
  const lctx = c.getContext('2d');
  lctx.scale(renderScale, renderScale);
  lctx.translate(extra, extra);
  return { canvas: c, ctx: lctx, extra, scale: renderScale };
}

// Layers are padded by the max screen-shake so a shake never reveals
// a bare edge
const LAYER_PAD = 30;

function buildLayers() {
  if (!bgGradient) buildStaticGradients();
  if (bgLayer) releaseCanvas(bgLayer.canvas);
  if (vignetteLayer) releaseCanvas(vignetteLayer.canvas);
  if (feverLayer) releaseCanvas(feverLayer.canvas);

  const bg = makeLayer(LAYER_PAD);
  bg.ctx.fillStyle = bgGradient;
  bg.ctx.fillRect(-LAYER_PAD, -LAYER_PAD, GAME_WIDTH + LAYER_PAD * 2, GAME_HEIGHT + LAYER_PAD * 2);
  bg.ctx.fillStyle = spotlightGradient;
  bg.ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
  bgLayer = bg;

  const vg = makeLayer(0);
  vg.ctx.fillStyle = vignetteGradient;
  vg.ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
  vignetteLayer = vg;

  // The fever wash is built the first time a frenzy starts
  feverLayer = null;
}

// Frenzy glow + golden border, painted once: filling the screen with a
// radial gradient every frame cost more than the rest of the scene on
// a CPU-rasterized canvas
function getFeverLayer() {
  if (!feverLayer) {
    const fv = makeLayer(0);
    fv.ctx.fillStyle = feverGlowGradient;
    fv.ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    fv.ctx.strokeStyle = 'rgba(255, 201, 60, 0.35)';
    fv.ctx.lineWidth = 5;
    fv.ctx.strokeRect(2, 2, GAME_WIDTH - 4, GAME_HEIGHT - 4);
    feverLayer = fv;
  }
  return feverLayer;
}

function drawLayer(layer) {
  const s = 1 / layer.scale;
  ctx.drawImage(layer.canvas, -layer.extra, -layer.extra,
                layer.canvas.width * s, layer.canvas.height * s);
}

// The vignette is clear through the middle of the screen (its gradient
// starts 245 px out from the center) — only the top and bottom bands
// darken anything, so only they are blended. Skips ~45% of a
// full-screen blend every frame; the cut sits where the edge alpha is
// already under 0.02.
const VIGNETTE_BANDS = [[0, 187], [513, GAME_HEIGHT]];

function drawVignette() {
  const c = vignetteLayer.canvas;
  const k = vignetteLayer.scale;
  for (const [y0, y1] of VIGNETTE_BANDS) {
    ctx.drawImage(c, 0, y0 * k, c.width, (y1 - y0) * k, 0, y0, GAME_WIDTH, y1 - y0);
  }
}

// ── Cached HUD sprites ──────────────────────────────────────────
// Text is one of the slowest things a phone's canvas draws, and the
// score readout and store row only change when a number does. Each is
// painted into its own small canvas whenever its key changes (and when
// the render scale or the web font changes) and blitted otherwise.
const hudCache = new Map();
let fontEpoch = 0;
if (document.fonts) {
  const bump = () => { fontEpoch++; };
  if (document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', bump);
  if (document.fonts.ready) document.fonts.ready.then(bump);
}

function drawCachedHud(name, key, x, y, w, h, paint) {
  const fullKey = `${key}|${renderScale}|${fontEpoch}`;
  let entry = hudCache.get(name);
  if (!entry || entry.key !== fullKey) {
    const c = entry ? entry.canvas : document.createElement('canvas');
    c.width = Math.ceil(w * renderScale);
    c.height = Math.ceil(h * renderScale);
    const octx = c.getContext('2d');
    octx.setTransform(renderScale, 0, 0, renderScale, -x * renderScale, -y * renderScale);
    const mainCtx = ctx;
    ctx = octx;
    paint();
    ctx = mainCtx;
    entry = { key: fullKey, canvas: c };
    hudCache.set(name, entry);
  }
  ctx.drawImage(entry.canvas, x, y, entry.canvas.width / renderScale, entry.canvas.height / renderScale);
}

function buildStaticGradients() {
  const theme = Skins.getActiveTheme() || ['#12122b', '#171f3f', '#1c3a63', '#1f4d7d'];
  bgGradient = ctx.createLinearGradient(0, 0, 0, GAME_HEIGHT);
  bgGradient.addColorStop(0, theme[0]);
  bgGradient.addColorStop(0.45, theme[1]);
  bgGradient.addColorStop(0.8, theme[2]);
  bgGradient.addColorStop(1, theme[3]);

  // Soft spotlight behind the cup — draws the eye to the play area
  const cx = (CUP_LEFT_X + CUP_RIGHT_X) / 2;
  const cy = (CUP_TOP_Y + CUP_BOTTOM_Y) / 2;
  spotlightGradient = ctx.createRadialGradient(cx, cy, 40, cx, cy, 340);
  spotlightGradient.addColorStop(0, 'rgba(120, 160, 255, 0.07)');
  spotlightGradient.addColorStop(0.5, 'rgba(120, 160, 255, 0.03)');
  spotlightGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

  // Vignette — darkened corners frame the scene
  vignetteGradient = ctx.createRadialGradient(
    GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_HEIGHT * 0.35,
    GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_HEIGHT * 0.75
  );
  vignetteGradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
  vignetteGradient.addColorStop(1, 'rgba(2, 2, 12, 0.42)');

  // Warm glow washed over everything during fever frenzy (alpha is
  // animated at draw time, the gradient itself is static)
  const fcx = (CUP_LEFT_X + CUP_RIGHT_X) / 2;
  const fcy = (CUP_TOP_Y + CUP_BOTTOM_Y) / 2;
  feverGlowGradient = ctx.createRadialGradient(fcx, fcy, 60, fcx, fcy, 420);
  feverGlowGradient.addColorStop(0, 'rgba(255, 190, 60, 0.16)');
  feverGlowGradient.addColorStop(0.55, 'rgba(255, 140, 40, 0.08)');
  feverGlowGradient.addColorStop(1, 'rgba(255, 90, 20, 0)');
}

// Safe-area padding lives on <body> (see index.html) so notches and the
// home indicator never cover the HUD; the canvas fits inside it.
function bodyInsets() {
  const cs = getComputedStyle(document.body);
  return {
    x: (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0),
    y: (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0),
  };
}

// Mobile browsers fire resize events in bursts (URL bar, rotation,
// visual viewport). Reassigning canvas.width reallocates the backing
// store and wipes every layer, so only touch what actually changed.
function handleResize() {
  const vv = window.visualViewport;
  const inset = bodyInsets();
  const maxW = Math.max(1, (vv ? vv.width : window.innerWidth) - inset.x);
  const maxH = Math.max(1, (vv ? vv.height : window.innerHeight) - inset.y);

  const aspect = GAME_WIDTH / GAME_HEIGHT;
  let w, h;
  if (maxW / maxH < aspect) {
    w = maxW;
    h = maxW / aspect;
  } else {
    h = maxH;
    w = maxH * aspect;
  }
  w = Math.floor(w);
  h = Math.floor(h);
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  cssW = w;

  // Snap to quarter steps, and ignore drift under 0.2 so a URL bar
  // wiggle can't throw away every cached sprite
  const raw = targetRenderScale();
  let layersDirty = !bgLayer;
  if (!scaleChosen || Math.abs(raw - renderScale) >= 0.2) {
    const next = Math.max(1, Math.round(raw * 4) / 4);
    scaleChosen = true;
    if (next !== renderScale) {
      renderScale = next;
      clearSpriteCache();
      clearCupCache();
      layersDirty = true;
    }
  }

  const bw = Math.round(GAME_WIDTH * renderScale);
  const bh = Math.round(GAME_HEIGHT * renderScale);
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }
  ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
  if (layersDirty) buildLayers();
}

// ── Main Render ─────────────────────────────────────────────────
export function render(state) {
  const shake = Particles.getScreenShake();
  frameSteps = state.simSteps != null ? state.simSteps : 1;

  // Which of the cached hand-drawn "boil" frames is showing right now
  boilFrame = Math.floor(performance.now() / BOIL_MS) % BOIL_FRAMES;
  boilT = boilFrame * 2.1;

  // The background layer is padded past the edges, so nothing needs
  // clearing first — it overwrites the whole canvas even mid-shake
  ctx.save();
  ctx.translate(shake.x, shake.y);

  drawBackground();

  // Menu screens: background + particles + screen content, no cup
  if (state.gameState === 'menu' || state.gameState === 'shop') {
    Particles.draw(ctx);
    drawVignette();
    if (state.gameState === 'menu') {
      Menus.drawMenu(ctx, state);
    } else {
      Menus.drawShop(ctx, state);
    }
    drawMuteButton(state.muted);
    ctx.restore();
    return;
  }

  const cupExt = state.cupExtendPx || 0;

  if (state.fever && state.fever.active) drawFeverOverlay();
  if (state.dangerEnabled) drawDangerZone(state.dangerLevel, cupExt);
  drawCup(cupExt);
  if (state.dangerEnabled) drawDangerLine(state.dangerLevel, cupExt);
  drawBalls(state.balls, state.gameState);
  Particles.draw(ctx);

  // Vignette sits above the scene but below the UI
  drawVignette();

  if (state.gameState === 'playing') {
    if (!state.hasActiveGhost) {
      const dropY = state.dropY != null ? state.dropY : DROP_Y;
      drawPreview(state.previewX, dropY, state.previewTier, state.isDragging, state.isTouchDevice, state.bombQueued, state.ghostQueued);
      drawDropLine(state.previewX, dropY);
    }
    if (state.nextTier != null) drawNextBubble(state.nextTier);
  }

  drawScore(state.score, state.bestScore, state.combo);
  drawModeStatus(state);
  if (state.fever) drawFeverMeter(state.fever, cupExt);
  drawMuteButton(state.muted);

  if (state.gameState === 'playing') {
    drawStoreButtons(state.storePrices, state.storeAffordable, state.storeBlocked);
    if (state.storeTooltip) {
      drawStoreTooltip(state.storeTooltip, state.storeTooltipHint, state.storeAffordable, state.storeBlocked);
    }
  }

  // Unlock banners ride above the HUD, never behind the store buttons
  Particles.drawOverlay(ctx);

  if (state.gameState === 'gameover') {
    drawGameOver(state);
    Menus.drawGameOverExtras(ctx, state);
  }

  ctx.restore();
}

// ── Background ──────────────────────────────────────────────────
function drawBackground() {
  drawLayer(bgLayer);

  if (!dustEnabled) return;

  // Slow-drifting dust motes give the scene depth and life
  const t = performance.now() * 0.001;
  ctx.fillStyle = '#cfe0ff';
  for (const m of dustMotes) {
    m.y -= m.speed * frameSteps;
    m.x += (m.drift + Math.sin(t + m.phase) * 0.08) * frameSteps;
    if (m.y < -4) { m.y = GAME_HEIGHT + 4; m.x = Math.random() * GAME_WIDTH; }
    if (m.x < -4) m.x = GAME_WIDTH + 4;
    if (m.x > GAME_WIDTH + 4) m.x = -4;

    const twinkle = 0.7 + Math.sin(t * 1.5 + m.phase) * 0.3;
    ctx.globalAlpha = m.alpha * twinkle;
    ctx.beginPath();
    ctx.arc(m.x, m.y, m.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// ── Danger Zone (red glow when approaching game over) ───────────
let dangerGrad = null;
let dangerGradY = null;

function drawDangerZone(dangerLevel, cupExt) {
  if (dangerLevel <= 0) return;

  const effectiveTopY = CUP_TOP_Y - (cupExt || 0);
  const pulse = Math.sin(performance.now() * 0.008) * 0.3 + 0.7;
  const alpha = dangerLevel * 0.25 * pulse;

  // Red vignette at top of cup (gradient cached; alpha animated)
  if (!dangerGrad || dangerGradY !== effectiveTopY) {
    dangerGrad = ctx.createLinearGradient(0, effectiveTopY - 40, 0, effectiveTopY + 80);
    dangerGrad.addColorStop(0, 'rgba(231, 76, 60, 1)');
    dangerGrad.addColorStop(1, 'rgba(231, 76, 60, 0)');
    dangerGradY = effectiveTopY;
  }
  ctx.globalAlpha = alpha;
  ctx.fillStyle = dangerGrad;
  ctx.fillRect(CUP_LEFT_X - 10, effectiveTopY - 40, CUP_RIGHT_X - CUP_LEFT_X + 20, 120);
  ctx.globalAlpha = 1;

  // Side edge glow
  const edgeAlpha = dangerLevel * 0.15 * pulse;
  ctx.fillStyle = `rgba(231, 76, 60, ${edgeAlpha})`;
  ctx.fillRect(0, 0, GAME_WIDTH, 8);
}

// ── Cup ─────────────────────────────────────────────────────────
// The cup is a real material (see cupart.js) painted once into an
// offscreen sprite per (style, height, scale) and blitted each frame.
const cupCache = new Map();
let cupShownExt = 0; // animated height so a CUP+ purchase grows visibly

function getCupSprite(styleId, cupExt) {
  const key = `${styleId}:${cupExt}:${renderScale}`;
  let sprite = cupCache.get(key);
  if (!sprite) {
    sprite = CupArt.renderCup(styleId, {
      leftX: CUP_LEFT_X, rightX: CUP_RIGHT_X,
      rimY: CUP_TOP_Y - cupExt - 20, bottomY: CUP_BOTTOM_Y,
      baseExtra: CUP_BASE_EXTRA, wall: CUP_WALL_THICKNESS,
    }, renderScale);
    // Keep the cache small (a few heights, plus shop thumbnails)
    if (cupCache.size >= 6) {
      const oldest = cupCache.keys().next().value;
      releaseCanvas(cupCache.get(oldest).canvas);
      cupCache.delete(oldest);
    }
    cupCache.set(key, sprite);
  }
  return sprite;
}

// Game-space y where the grow animation splits the cup (well inside
// the walls at any height: below the tallest rim's travel, above the floor)
const CUP_SPLIT_Y = 470;

function drawCup(cupExt) {
  // Ease toward the target height (the cup only ever grows mid-run)
  if (cupExt < cupShownExt || Math.abs(cupShownExt - cupExt) < 0.5) {
    cupShownExt = cupExt;
  } else {
    cupShownExt += (cupExt - cupShownExt) * (1 - Math.pow(0.78, frameSteps));
  }

  // Only the final height is ever painted (a cup paint is 30-50 ms on a
  // phone — the old per-height sprites stuttered every CUP+). While it
  // grows, the upper walls and rim slide down over the lower walls by
  // however far the rim still has to rise.
  const sprite = getCupSprite(Cups.getActiveCupId(), cupExt);
  const c = sprite.canvas;
  const k = c.width / sprite.w; // sprite pixels per game unit
  const dPx = Math.round((cupExt - cupShownExt) * k);
  if (dPx <= 0) {
    ctx.drawImage(c, sprite.x, sprite.y, sprite.w, sprite.h);
    return;
  }
  const splitPx = Math.round((CUP_SPLIT_Y - sprite.y) * k);
  // The walls flare outward toward the base, so the sliding part also
  // spreads sideways by the flare it skips — left half left, right half
  // right — or the walls kink where the two parts meet
  const rimY = CUP_TOP_Y - cupExt - 20;
  const spread = (CUP_BASE_EXTRA / (CUP_BOTTOM_Y - rimY)) * (dPx / k);
  const midPx = Math.round(((CUP_LEFT_X + CUP_RIGHT_X) / 2 - sprite.x) * k);
  const topY = sprite.y + dPx / k;
  ctx.drawImage(c, 0, 0, midPx, splitPx,
                sprite.x - spread, topY, midPx / k, splitPx / k);
  ctx.drawImage(c, midPx, 0, c.width - midPx, splitPx,
                sprite.x + midPx / k + spread, topY, (c.width - midPx) / k, splitPx / k);
  const botPx = splitPx + dPx;
  if (botPx < c.height) {
    ctx.drawImage(c, 0, botPx, c.width, c.height - botPx,
                  sprite.x, sprite.y + botPx / k, sprite.w, (c.height - botPx) / k);
  }
}

// Snap the animated height (new run / menu) so it never grows on entry
export function resetCupAnimation(cupExt) {
  cupShownExt = cupExt || 0;
}

// ── Danger Line ─────────────────────────────────────────────────
function drawDangerLine(dangerLevel, cupExt) {
  const alpha = 0.35 + (dangerLevel || 0) * 0.5;
  const dashOffset = (performance.now() * 0.02) % 16;
  const effectiveDangerY = DANGER_LINE_Y - (cupExt || 0);

  ctx.save();
  ctx.setLineDash([8, 8]);
  ctx.lineDashOffset = -dashOffset;
  ctx.strokeStyle = `rgba(255, 50, 30, ${Math.min(alpha, 1)})`;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(CUP_LEFT_X + 5, effectiveDangerY);
  ctx.lineTo(CUP_RIGHT_X - 5, effectiveDangerY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Small label so the line reads as a rule, not decoration
  ctx.font = '11px "Patrick Hand", cursive';
  ctx.fillStyle = `rgba(255, 90, 70, ${Math.min(alpha * 0.9, 1)})`;
  ctx.textAlign = 'right';
  ctx.fillText('DANGER', CUP_RIGHT_X - 8, effectiveDangerY - 5);
  ctx.restore();
}

// ── Drop guide line ─────────────────────────────────────────────
let dropLineGrad = null;
let dropLineGradY = null;

function drawDropLine(x, dropY) {
  ctx.save();
  if (!dropLineGrad || dropLineGradY !== dropY) {
    dropLineGrad = ctx.createLinearGradient(0, dropY + 20, 0, CUP_BOTTOM_Y);
    dropLineGrad.addColorStop(0, 'rgba(255,255,255,0.12)');
    dropLineGrad.addColorStop(1, 'rgba(255,255,255,0.02)');
    dropLineGradY = dropY;
  }
  ctx.setLineDash([4, 8]);
  ctx.strokeStyle = dropLineGrad;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, dropY + 20);
  ctx.lineTo(x, CUP_BOTTOM_Y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

// ── Balls ───────────────────────────────────────────────────────
// Draw order, reused across frames. The pile barely moves between
// frames, so an insertion sort over last frame's order is close to
// O(n) — and a fresh spread + sort every frame was steady garbage.
const drawOrder = [];

function drawBalls(ballMap, gameState) {
  // Sort by y position so lower balls draw on top (depth feel)
  let n = 0;
  for (const entry of ballMap.values()) drawOrder[n++] = entry;
  drawOrder.length = n;
  for (let i = 1; i < n; i++) {
    const e = drawOrder[i];
    const y = e.body.position.y;
    let j = i - 1;
    while (j >= 0 && drawOrder[j].body.position.y > y) {
      drawOrder[j + 1] = drawOrder[j];
      j--;
    }
    drawOrder[j + 1] = e;
  }
  const sorted = drawOrder;

  // Pass 1: soft contact shadows under every solid ball — one path,
  // one fill (overlapping shadows union instead of stacking darker)
  ctx.fillStyle = 'rgba(4, 4, 18, 0.22)';
  ctx.beginPath();
  for (const entry of sorted) {
    if (entry.isGhost) continue;
    const r = entry.isBomb ? BOMB_RADIUS : BALL_TIERS[entry.tierIndex].radius;
    const { x, y } = entry.body.position;
    ctx.moveTo(x + r * 0.82, y + r * 0.85);
    ctx.ellipse(x, y + r * 0.85, r * 0.82, r * 0.3, 0, 0, Math.PI * 2);
  }
  ctx.fill();

  // Pass 2: the balls themselves
  for (const entry of sorted) {
    if (entry.isBomb) {
      drawBombBall(entry.body);
    } else if (entry.isGhost) {
      drawGhostBall(entry.body, entry.tierIndex);
    } else {
      drawBall(entry.body, entry.tierIndex, gameState);
    }
  }
  // Don't hold on to removed balls until the next frame
  drawOrder.length = 0;
}

function getSquishState(body) {
  if (!ballSquish.has(body.id)) {
    ballSquish.set(body.id, {
      scaleX: 0.3, // Start small for spawn animation (bomb/ghost path)
      scaleY: 0.3,
      spawnProgress: 0,
      // Spring-based squash & stretch (solid balls)
      squash: 0,       // >0 compressed along motion axis, <0 rebounding
      squashVel: 0,    // spring velocity — this is what makes it jiggle
      deformAngle: Math.PI / 2,
      prevVx: 0,
      prevVy: 0,
    });
  }
  return ballSquish.get(body.id);
}

function drawBall(body, tierIndex, gameState) {
  const tier = BALL_TIERS[tierIndex];
  const { x, y } = body.position;
  const r = tier.radius;
  const sq = getSquishState(body);

  let sx = 1;
  let sy = 1;
  let deformAngle = sq.deformAngle;

  if (sq.spawnProgress < 1) {
    // ── Spawn scale-up animation ────────────────────────────────
    sq.spawnProgress = Math.min(sq.spawnProgress + 0.08 * frameSteps, 1);
    const t = easeOutBack(sq.spawnProgress);
    sx = t;
    sy = t;
    deformAngle = 0;
    sq.prevVx = body.velocity.x;
    sq.prevVy = body.velocity.y;
  } else {
    // ── Velocity-aligned squash & stretch with spring recovery ──
    const vx = body.velocity.x;
    const vy = body.velocity.y;
    const speed = Math.sqrt(vx * vx + vy * vy);

    // Smaller balls are gooier: bigger deformation, floppier spring.
    // Bigger balls deform less but carry visible weight.
    const goo = tierIndex <= 3
      ? 1 + (3 - tierIndex) * 0.28              // coconut=1.84 … orange=1.0
      : Math.max(0.65, 1 - (tierIndex - 3) * 0.06);

    // Impact detection: a sudden velocity change means we hit something.
    // Kick the squash spring proportionally, along the incoming direction.
    // (Only on frames where the physics actually stepped — on a 120 Hz
    // display every other frame has no new velocity to react to.)
    if (frameSteps > 0) {
      const dvx = vx - sq.prevVx;
      const dvy = vy - sq.prevVy;
      const impact = Math.sqrt(dvx * dvx + dvy * dvy);
      const prevSpeed = Math.sqrt(sq.prevVx * sq.prevVx + sq.prevVy * sq.prevVy);

      if (impact > 1.2 && prevSpeed > 1.4) {
        sq.squash = Math.min(sq.squash + impact * 0.050 * goo, 0.50);
        sq.deformAngle = Math.atan2(sq.prevVy, sq.prevVx);
      } else if (speed > 0.6) {
        // While moving freely, deform along the direction of travel
        sq.deformAngle = Math.atan2(vy, vx);
      }
    }

    // Damped spring: overshoots past rest into a stretch, then settles —
    // that overshoot IS the jelly wobble. Gooier balls = looser spring.
    // Integrated once per simulation step so it runs in real time.
    const stiffness = tierIndex <= 3 ? 0.145 + tierIndex * 0.018 : 0.20;
    const damping = tierIndex <= 3 ? 0.80 : 0.72;
    for (let i = 0; i < frameSteps; i++) {
      sq.squashVel += -sq.squash * stiffness;
      sq.squashVel *= damping;
      sq.squash += sq.squashVel;
    }

    // Free-fall stretch: elongate along the motion vector
    const stretch = Math.min(speed * 0.012 * goo, 0.24);

    const squash = Math.max(-0.24, Math.min(sq.squash, 0.50));
    let along = 1 + stretch - squash;        // axis of motion
    let perp = 1 - stretch * 0.55 + squash * 0.8; // bulge sideways on impact

    // Idle wobble (subtle breathing) — gooier balls wobble more
    const wobbleAmp = tierIndex <= 3 ? 0.008 + (3 - tierIndex) * 0.0044 : 0.0066;
    const wobbleTime = performance.now() * 0.002 + body.id * 1.7;
    along += Math.sin(wobbleTime) * wobbleAmp;
    perp += Math.cos(wobbleTime * 1.3) * wobbleAmp;

    sx = along;
    sy = perp;
    deformAngle = sq.deformAngle;

    sq.prevVx = vx;
    sq.prevVy = vy;
  }

  ctx.save();
  ctx.translate(x, y);

  // Deform in world space along the motion axis, then let the ball's
  // own spin rotate the texture inside the deformed shape
  ctx.rotate(deformAngle);
  ctx.scale(sx, sy);
  ctx.rotate(body.angle - deformAngle);

  // ── Draw based on tier type ───────────────────────────────────
  // Every fruit is a cached sprite (see drawFruitSprite); the rainbow
  // squishy spins its sprite and adds a live sparkle
  if (tierIndex === RAINBOW_TIER) {
    drawRainbowBall(r, body.id);
  } else {
    drawFruitSprite(tierIndex, r, body.id);
  }

  ctx.restore();
}

// ── Fruit sprite cache ──────────────────────────────────────────
// Drawing a fruit from scratch is 2-3 Path2D builds, a couple of
// clips and dozens of strokes. That's fine once; forty times a frame
// on a phone it's the whole frame budget. Each fruit is rendered once
// per boil frame into a small offscreen canvas at the current render
// scale, then blitted with the ball's live squash/rotation transform.
// Keyed by tier + ball id so per-fruit variation survives intact.
const spriteCache = new Map();
const SPRITE_PAD = 1.5; // stems/leaves/scales poke past the radius

function renderFruitSprite(tierIndex, r, ballId, frame) {
  const size = Math.ceil(r * SPRITE_PAD * 2 * renderScale);
  const off = document.createElement('canvas');
  off.width = size;
  off.height = size;
  const octx = off.getContext('2d');
  octx.setTransform(renderScale, 0, 0, renderScale, size / 2, size / 2);

  // Paint with the shared drawing code by pointing it at the offscreen
  // context for the duration
  const mainCtx = ctx;
  const savedBoilT = boilT;
  ctx = octx;
  boilT = frame * 2.1;
  const name = BALL_TIERS[tierIndex].name;
  const fruitSkin = Skins.getDetailMode() === 'fruit';
  // The goal fruits look like themselves in every skin; the rest are
  // real fruit in the fruit skin and uniform balls in the others
  if (name === 'rainbow') {
    drawRainbowBody(r, ballId);
  } else if (name === 'dragonfruit') {
    drawDragonfruitBall(r, ballId);
  } else if (name === 'blackberry') {
    drawBlackberryBall(r, ballId);
  } else if (fruitSkin && name === 'grapefruit') {
    drawGrapefruitBall(r, ballId);
  } else if (fruitSkin) {
    drawFruitBall(tierIndex, r, ballId);
  } else {
    const style = Skins.getTierStyle(tierIndex);
    drawSolidBall(r, style.color, style.stroke, tierIndex, ballId);
  }
  ctx = mainCtx;
  boilT = savedBoilT;
  return off;
}

// Draw the fruit centered on the current origin (caller has already
// translated/rotated/scaled the context). ballId null = generic look.
function drawFruitSprite(tierIndex, r, ballId, cacheKey) {
  const key = cacheKey || `${tierIndex}:${ballId == null ? 'p' : ballId}:${r}`;
  let frames = spriteCache.get(key);
  if (!frames) {
    frames = new Array(BOIL_FRAMES).fill(null);
    spriteCache.set(key, frames);
  }
  let sprite = frames[boilFrame];
  if (!sprite) {
    sprite = renderFruitSprite(tierIndex, r, ballId, boilFrame);
    frames[boilFrame] = sprite;
  }
  const half = sprite.width / renderScale / 2;
  ctx.drawImage(sprite, -half, -half, half * 2, half * 2);
}

// Pop-in scale for bomb/ghost balls, advanced per simulation step
function settleSpawnScale(sq) {
  if (sq.spawnProgress < 1) {
    sq.spawnProgress = Math.min(sq.spawnProgress + 0.08 * frameSteps, 1);
    const t = easeOutBack(sq.spawnProgress);
    sq.scaleX = t;
    sq.scaleY = t;
  } else {
    const k = 1 - Math.pow(0.85, frameSteps);
    sq.scaleX += (1 - sq.scaleX) * k;
    sq.scaleY += (1 - sq.scaleY) * k;
  }
}

// ── Bomb Ball ───────────────────────────────────────────────────
function drawBombBall(body) {
  const { x, y } = body.position;
  const r = BOMB_RADIUS;
  const sq = getSquishState(body);

  settleSpawnScale(sq);

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(body.angle);
  ctx.scale(sq.scaleX, sq.scaleY);

  drawBombVisual(r);

  ctx.restore();
}

// The merge bomb: the store button's round bomb (fuse cap, fizzing
// spark) with two chevrons squeezing in on its face — "merge"
function drawBombVisual(r) {
  const time = performance.now() * 0.003;

  // Pulsing warm glow
  const pulseR = r * (1.8 + Math.sin(time * 2) * 0.3);
  const glow = ctx.createRadialGradient(0, 0, r * 0.3, 0, 0, pulseR);
  glow.addColorStop(0, 'rgba(255, 159, 67, 0.42)');
  glow.addColorStop(0.5, 'rgba(255, 110, 60, 0.14)');
  glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, pulseR, 0, Math.PI * 2);
  ctx.fill();

  // Fuse cap on the upper-right shoulder, under the body outline
  ctx.save();
  ctx.rotate(-Math.PI / 4);
  ctx.fillStyle = '#5A6274';
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.roundRect(-r * 0.24, -r * 1.16, r * 0.48, r * 0.36, r * 0.08);
  ctx.fill();
  ctx.stroke();
  // Fuse and its spark
  ctx.strokeStyle = '#C9B48A';
  ctx.lineWidth = 1.8;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, -r * 1.16);
  ctx.quadraticCurveTo(r * 0.2, -r * 1.4, r * 0.05, -r * 1.55);
  ctx.stroke();
  const flick = 0.75 + Math.sin(time * 9) * 0.25;
  ctx.strokeStyle = `rgba(255, 210, 90, ${flick})`;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const a = time * 3 + i * Math.PI / 2;
    const len = r * (0.18 + 0.1 * Math.sin(time * 7 + i));
    ctx.moveTo(r * 0.05, -r * 1.55);
    ctx.lineTo(r * 0.05 + Math.cos(a) * len, -r * 1.55 + Math.sin(a) * len);
  }
  ctx.stroke();
  ctx.restore();

  // Body — flat dark navy with the offset tint patch, ink outline
  ctx.fillStyle = '#262B3A';
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = '#3A4256';
  ctx.beginPath();
  ctx.arc(-r * 0.25, -r * 0.28, r * 0.78, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();

  // Merge chevrons pinching toward the middle, breathing in and out
  const squeeze = Math.sin(time * 4) * r * 0.06;
  ctx.strokeStyle = `rgba(255, 170, 90, ${0.75 + Math.sin(time * 4) * 0.2})`;
  ctx.lineWidth = Math.max(1.8, r * 0.14);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const cx = r * 0.36 - squeeze;
  const h = r * 0.24;
  ctx.beginPath();
  ctx.moveTo(-cx - h * 0.6, -h);
  ctx.lineTo(-cx + h * 0.4, 0);
  ctx.lineTo(-cx - h * 0.6, h);
  ctx.moveTo(cx + h * 0.6, -h);
  ctx.lineTo(cx - h * 0.4, 0);
  ctx.lineTo(cx + h * 0.6, h);
  ctx.stroke();

  // Shine tick
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.68, -2.5, -1.9);
  ctx.stroke();
}

// ── Ghost Ball ─────────────────────────────────────────────────
function drawGhostBall(body, tierIndex) {
  const tier = BALL_TIERS[tierIndex];
  const style = Skins.getTierStyle(tierIndex);
  const { x, y } = body.position;
  const r = tier.radius;
  const sq = getSquishState(body);

  settleSpawnScale(sq);

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(body.angle);
  ctx.scale(sq.scaleX, sq.scaleY);

  const time = performance.now() * 0.003;
  const ghostAlpha = 0.3 + Math.sin(time * 2) * 0.08;
  ctx.globalAlpha = ghostAlpha;

  // Flat washed-out body on an extra-wobbly doodle outline
  const ghostPath = wobblyCirclePath(0, 0, r, body.id, 0.04);
  ctx.fillStyle = lightenColor(style.color, 45);
  ctx.fill(ghostPath);

  // Dashed ghostly ink stroke
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = hexWithAlpha(INK, 0.7);
  ctx.lineJoin = 'round';
  ctx.lineWidth = outlineWidth(r) * 0.8;
  ctx.stroke(ghostPath);
  ctx.setLineDash([]);

  drawShineTicks(r, body.id);

  ctx.restore();
}

// Clean up squish states + cached sprites for removed balls.
// `activeBalls` is the live Map<id, entry> from balls.js.
export function cleanupSquishStates(activeBalls) {
  if (ballSquish.size === 0) return;
  let removed = null;
  for (const id of ballSquish.keys()) {
    if (!activeBalls.has(id)) {
      ballSquish.delete(id);
      ballHighlightCache.delete(id);
      ballLookCache.delete(id);
      (removed || (removed = new Set())).add(String(id));
    }
  }
  // Sprite keys are "tier:id:radius" — free the frames of removed balls
  if (removed) {
    for (const key of spriteCache.keys()) {
      if (removed.has(key.split(':')[1])) {
        spriteCache.get(key).forEach(releaseCanvas);
        spriteCache.delete(key);
      }
    }
  }
}

// ── Seeded random for per-ball highlight variation ──────────────
// One directional light (up-left) hits every ball, but each ball
// catches it a little differently: the angle, radius, sweep, weight,
// and shape of the shine all jitter per ball, and each ball commits
// to one of a few shine "styles" so no two fruits gleam like clones.
const ballHighlightCache = new Map();
function getBallHighlights(ballId) {
  if (ballHighlightCache.has(ballId)) return ballHighlightCache.get(ballId);
  const h = {
    // Shared light from the upper-left, with per-ball drift (±0.35 rad)
    lightAngle: -2.25 + (pseudoRand(ballId * 7) - 0.5) * 0.7,
    // Where along the radius the shine sits, and how far it sweeps
    shineRadius: 0.60 + pseudoRand(ballId * 13) * 0.14,
    shineSpan: 0.42 + pseudoRand(ballId * 19) * 0.5,
    shineAlpha: 0.65 + pseudoRand(ballId * 23) * 0.28,
    shineWidth: 0.6 + pseudoRand(ballId * 29) * 0.45,
    // 0: tick + dot · 1: long single sweep · 2: split double tick
    style: Math.floor(pseudoRand(ballId * 31) * 3),
    // Trailing dot(s)
    dotCount: pseudoRand(ballId * 37) > 0.55 ? 2 : 1,
    dotSize: 0.32 + pseudoRand(ballId * 41) * 0.28,
    dotGap: 0.42 + pseudoRand(ballId * 43) * 0.3,
  };
  ballHighlightCache.set(ballId, h);
  return h;
}

function pseudoRand(seed) {
  // Simple hash → 0-1 float
  let x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

// ── Per-fruit look variation ────────────────────────────────────
// No two apples off the same tree match exactly. Each ball commits to
// a small, seeded set of deviations — a nudge of hue, lightness and
// saturation, a slightly different silhouette, how strong its blush
// is, how many freckles it grew, which way its stem leans — all kept
// small enough that a peach is still obviously a peach next to any
// other peach. (Tier identity comes from size, base color, and the
// topper; these only touch what's inside that.)
const ballLookCache = new Map();
function getBallLook(ballId) {
  if (ballLookCache.has(ballId)) return ballLookCache.get(ballId);
  const rnd = (k) => pseudoRand(ballId * 53 + k * 7.31) * 2 - 1; // -1..1
  const look = {
    hue: rnd(1) * FRUIT_HUE_JITTER,
    light: rnd(2) * FRUIT_LIGHT_JITTER,
    sat: rnd(3) * FRUIT_SAT_JITTER,
    // Silhouette: a little taller or squatter, and a hair lopsided
    aspect: 1 + rnd(4) * 0.035,
    lean: rnd(5) * 0.05,
    // Tint patch: size and how much lighter it prints
    patchSize: 0.72 + pseudoRand(ballId * 53 + 6 * 7.31) * 0.14,
    patchLift: 26 + pseudoRand(ballId * 53 + 7 * 7.31) * 14,
    // Skin texture: blush strength, speckle density, stripe/crease phase
    blush: 0.7 + pseudoRand(ballId * 53 + 8 * 7.31) * 0.6,
    density: 0.75 + pseudoRand(ballId * 53 + 9 * 7.31) * 0.5,
    phase: pseudoRand(ballId * 53 + 10 * 7.31),
    flip: pseudoRand(ballId * 53 + 11 * 7.31) > 0.5 ? -1 : 1,
    // Topper: stem/leaf lean
    tilt: rnd(12) * 0.22,
    fillCacheKey: null,
    fillCacheVal: null,
  };
  ballLookCache.set(ballId, look);
  return look;
}

// Apply a look's color drift to a base hex fill (cached per base color
// so a skin swap re-derives it but a normal frame never re-parses)
function lookFill(look, fill) {
  if (look.fillCacheKey === fill) return look.fillCacheVal;
  const rgb = hexToRgb(fill);
  let out = fill;
  if (rgb) {
    const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
    const h = (hsl.h + look.hue + 360) % 360;
    const sat = Math.max(0, Math.min(100, hsl.s + look.sat));
    const l = Math.max(0, Math.min(100, hsl.l + look.light));
    const o = hslToRgb(h, sat, l);
    out = `#${toHex2(o.r)}${toHex2(o.g)}${toHex2(o.b)}`;
  }
  look.fillCacheKey = fill;
  look.fillCacheVal = out;
  return out;
}

// Neutral look for balls without an id (preview, decor)
const DEFAULT_LOOK = {
  hue: 0, light: 0, sat: 0, aspect: 1, lean: 0,
  patchSize: 0.78, patchLift: 32, blush: 1, density: 1, phase: 0.5,
  flip: 1, tilt: 0, fillCacheKey: null, fillCacheVal: null,
};

// Uniform ink linework: thin on small fruits, capped so the biggest
// don't turn into coloring-book blobs.
function outlineWidth(r) {
  return Math.min(5, Math.max(2.5, r * 0.11));
}

// Wobbly hand-drawn circle as a reusable Path2D (body, tint patch,
// dragonfruit all share it). Time is quantized to ~8 fps steps so the
// linework "boils" like traditional animation instead of swimming.
function wobblyCirclePath(cx, cy, radius, seed, wobbleAmt = 0.02) {
  const path = new Path2D();
  const points = 32;
  const t = boilT;
  const phase = pseudoRand(seed) * Math.PI * 2;
  for (let i = 0; i <= points; i++) {
    const a = (i / points) * Math.PI * 2;
    const w = 1 + Math.sin(a * 3 + t + phase) * wobbleAmt
                + Math.sin(a * 5 + t * 1.7 + phase * 2) * wobbleAmt * 0.5;
    const px = cx + Math.cos(a) * radius * w;
    const py = cy + Math.sin(a) * radius * w;
    if (i === 0) path.moveTo(px, py);
    else path.lineTo(px, py);
  }
  path.closePath();
  return path;
}

// Flat comic-style shine catching the shared up-left light, with
// per-ball variance in placement, sweep, weight, and style.
function drawShineTicks(r, ballId) {
  const hl = getBallHighlights(ballId != null ? ballId : 7);
  const a0 = hl.lightAngle;
  const sr = r * hl.shineRadius;

  ctx.save();
  ctx.strokeStyle = `rgba(255,255,255,${hl.shineAlpha})`;
  ctx.fillStyle = `rgba(255,255,255,${hl.shineAlpha})`;
  ctx.lineCap = 'round';
  ctx.lineWidth = outlineWidth(r) * hl.shineWidth;

  if (hl.style === 1) {
    // Long single sweep along the lit rim
    ctx.beginPath();
    ctx.arc(0, 0, sr, a0 - hl.shineSpan * 0.9, a0 + hl.shineSpan * 0.7);
    ctx.stroke();
  } else if (hl.style === 2) {
    // Split double tick — a big stroke and a smaller echo
    ctx.beginPath();
    ctx.arc(0, 0, sr, a0 - hl.shineSpan * 0.8, a0 - hl.shineSpan * 0.1);
    ctx.stroke();
    ctx.lineWidth = outlineWidth(r) * hl.shineWidth * 0.6;
    ctx.beginPath();
    ctx.arc(0, 0, sr, a0 + hl.shineSpan * 0.25, a0 + hl.shineSpan * 0.6);
    ctx.stroke();
  } else {
    // Classic tick + trailing dot(s)
    ctx.beginPath();
    ctx.arc(0, 0, sr, a0 - hl.shineSpan * 0.7, a0 + hl.shineSpan * 0.45);
    ctx.stroke();
    for (let i = 0; i < hl.dotCount; i++) {
      const da = a0 + hl.shineSpan * 0.45 + hl.dotGap * (i + 1) * 0.55;
      const ds = outlineWidth(r) * hl.dotSize * (i === 0 ? 1 : 0.65);
      ctx.beginPath();
      ctx.arc(Math.cos(da) * sr, Math.sin(da) * sr, ds, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

// Shortest angular distance between two angles (for shape sculpting)
function angDist(a, b) {
  let d = Math.abs(a - b) % (Math.PI * 2);
  return d > Math.PI ? Math.PI * 2 - d : d;
}

// ── Fruit silhouettes ───────────────────────────────────────────
// Every fruit is still a squishy ball underneath — the physics body is
// a circle, and the jelly squash and wobble act on the whole sprite —
// but each outline is sculpted toward the real thing: lemons and limes
// are pointed ovals, a watermelon lies long on its side, grapes and
// plums stand tall, a blackberry is a lumpy cluster. Deviations stay
// within about a tenth of the radius, so what looks like touching is
// touching.
//
// A shape is an aspect stretch plus a polar profile: extra radius (as
// a fraction of r) at angle a, where 0 is the fruit's right side and
// -π/2 its top. `points` raises the outline resolution for edges with
// fine detail (coconut fibers, blackberry lumps).
const TOP = -Math.PI / 2;
const BOT = Math.PI / 2;

function bump(a, at, width, amt) {
  const d = angDist(a, at);
  return amt * Math.exp(-(d * d) / (2 * width * width));
}

const FRUIT_SHAPES = {
  // Husked coconut: a slightly pointed egg (the eyes sit at the narrow
  // end) with a ragged, fibrous edge
  coconut: { sx: 0.97, sy: 1.04, points: 84, profile: (a) =>
    bump(a, TOP, 0.6, 0.06) - bump(a, BOT, 1.0, 0.02) + Math.sin(a * 21) * 0.014 },
  // Peach: the cleft dips into the top between two full cheeks, and
  // the blossom end comes to a soft point
  peach: { sx: 1.03, sy: 0.98, profile: (a) =>
    -bump(a, TOP, 0.2, 0.1) + bump(a, TOP - 0.75, 0.42, 0.045)
    + bump(a, TOP + 0.75, 0.42, 0.045) + bump(a, BOT, 0.18, 0.04) },
  // Lemon: a pointed oval — a pronounced nipple at the blossom end and
  // a smaller nub at the stem end
  lemon: { sx: 1.12, sy: 0.88, profile: (a) =>
    bump(a, 0, 0.15, 0.13) + bump(a, Math.PI, 0.17, 0.07) },
  // Lime: rounder than a lemon, with just a hint of a nub
  lime: { sx: 1.06, sy: 0.95, profile: (a) =>
    bump(a, 0, 0.14, 0.055) + bump(a, Math.PI, 0.2, 0.02) },
  // Orange: round, a hair squat, pebbled peel, a little dip at the stem
  orange: { sx: 1.01, sy: 0.98, points: 64, profile: (a) =>
    Math.sin(a * 23) * 0.006 - bump(a, TOP, 0.16, 0.03) },
  // Watermelon: a long melon lying on its side
  watermelon: { sx: 1.11, sy: 0.9, profile: () => 0 },
  // Blueberry: squat, with the crown sunk into the top
  blueberry: { sx: 1.05, sy: 0.95, profile: (a) => -bump(a, TOP, 0.3, 0.05) },
  // Grape: a tall oval, a touch fuller toward the bottom
  grape: { sx: 0.92, sy: 1.08, profile: (a) => bump(a, BOT, 0.7, 0.02) },
  // Grapefruit: big, round, a hair squat
  grapefruit: { sx: 1.03, sy: 0.97, profile: () => 0 },
  // Plum: taller than wide, the stem sunk into a dimple between the
  // faint heart-shaped shoulders of the suture
  plum: { sx: 0.95, sy: 1.05, profile: (a) =>
    -bump(a, TOP, 0.22, 0.06) + bump(a, TOP - 0.6, 0.4, 0.025) + bump(a, TOP + 0.6, 0.4, 0.025) },
  // Dragonfruit: an upright egg narrowing into its crown of scales
  dragonfruit: { sx: 0.93, sy: 1.07, profile: (a) => bump(a, TOP, 0.4, 0.06) },
  // Blackberry: lumpy — every lump on the edge is a drupelet
  blackberry: { sx: 0.96, sy: 1.04, points: 90, profile: (a) =>
    Math.abs(Math.cos(a * 4.5)) * 0.05 - 0.025 },
};

// Hand-drawn outline for a fruit shape, boiling like the circle path
function fruitPath(shape, radius, seed, wobbleAmt = 0.016) {
  const path = new Path2D();
  const points = shape.points || 44;
  const t = boilT;
  const phase = pseudoRand(seed) * Math.PI * 2;
  for (let i = 0; i <= points; i++) {
    const a = (i / points) * Math.PI * 2;
    const w = 1 + Math.sin(a * 3 + t + phase) * wobbleAmt
                + Math.sin(a * 5 + t * 1.7 + phase * 2) * wobbleAmt * 0.5
                + shape.profile(a);
    const px = Math.cos(a) * radius * w * shape.sx;
    const py = Math.sin(a) * radius * w * shape.sy;
    if (i === 0) path.moveTo(px, py);
    else path.lineTo(px, py);
  }
  path.closePath();
  return path;
}

// Apple silhouette: a wobbly circle sculpted with a sunken stem dimple,
// broad shoulders, a gentle taper toward the base, and the faint
// double-lobe apples have at the bottom. Slightly squat overall.
function wobblyApplePath(cx, cy, radius, seed) {
  const path = new Path2D();
  const points = 40;
  const t = boilT;
  const phase = pseudoRand(seed) * Math.PI * 2;
  for (let i = 0; i <= points; i++) {
    const a = (i / points) * Math.PI * 2;
    // Hand-drawn boil, same as the circle path
    let w = 1 + Math.sin(a * 3 + t + phase) * 0.016
              + Math.sin(a * 5 + t * 1.7 + phase * 2) * 0.008;
    // Stem dimple sunk into the top
    w -= bump(a, TOP, 0.30, 0.15);
    // Broad shoulders either side of the dimple
    w += bump(a, TOP - 0.85, 0.5, 0.05) + bump(a, TOP + 0.85, 0.5, 0.05);
    // Tapered base with a soft double lobe
    w -= bump(a, BOT, 0.26, 0.055);
    w += bump(a, BOT - 0.45, 0.3, 0.028) + bump(a, BOT + 0.45, 0.3, 0.028);
    const px = cx + Math.cos(a) * radius * w * 1.03;
    const py = cy + Math.sin(a) * radius * w * 0.97;
    if (i === 0) path.moveTo(px, py);
    else path.lineTo(px, py);
  }
  path.closePath();
  return path;
}

// A pointed leaf with a center vein, base at the origin pointing +x
function drawLeaf(x, y, len, width, angle, lineW) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(len * 0.45, -width, len, 0);
  ctx.quadraticCurveTo(len * 0.45, width, 0, 0);
  ctx.closePath();
  ctx.fillStyle = LEAF_GREEN;
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineJoin = 'round';
  ctx.lineWidth = lineW;
  ctx.stroke();
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(0.6, lineW * 0.6);
  ctx.beginPath();
  ctx.moveTo(len * 0.1, 0);
  ctx.lineTo(len * 0.78, 0);
  ctx.stroke();
  ctx.restore();
}

// Scatter `n` seeded dots inside an ellipse (pores, freckles, specks)
function speckle(n, seed, rx, ry, size, sizeJitter = 0) {
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = pseudoRand(seed + i * 3) * Math.PI * 2;
    const d = Math.sqrt(pseudoRand(seed + i * 5));
    const x = Math.cos(a) * d * rx;
    const y = Math.sin(a) * d * ry;
    const s = size * (1 + (pseudoRand(seed + i * 7) - 0.5) * sizeJitter);
    ctx.moveTo(x + s, y);
    ctx.arc(x, y, s, 0, Math.PI * 2);
  }
  ctx.fill();
}

// ── Fruit (fruit skin) ──────────────────────────────────────────
// Flat sticker-art doodle: flat fill, offset lighter tint patch as the
// main shading, the fruit's own skin details, then a uniform ink
// outline, the shine, and stems/leaves on top.
function drawFruitBall(tierIndex, r, ballId) {
  const name = BALL_TIERS[tierIndex].name;
  const seed = ballId != null ? ballId : 7;
  const look = ballId != null ? getBallLook(ballId) : DEFAULT_LOOK;
  const style = Skins.getTierStyle(tierIndex);
  const body = name === 'apple'
    ? wobblyApplePath(0, 0, r, seed)
    : fruitPath(FRUIT_SHAPES[name], r, seed, 0.016 + tierIndex * 0.001);

  // Each fruit's own proportions: a touch taller/squatter, a hair lopsided
  ctx.save();
  ctx.transform(look.aspect, look.lean, 0, 1 / look.aspect, 0, 0);

  const fill = lookFill(look, style.color);
  ctx.fillStyle = fill;
  ctx.fill(body);

  ctx.save();
  ctx.clip(body);
  // Offset tint patch — the misregistered-print shading from the
  // reference art: a lighter wobbly blob pushed up-left
  const ox = -r * (0.24 + pseudoRand(seed * 3) * 0.1);
  const oy = -r * (0.26 + pseudoRand(seed * 5) * 0.1);
  ctx.fillStyle = lightenColor(fill, look.patchLift);
  ctx.fill(wobblyCirclePath(ox, oy, r * look.patchSize, seed + 11, 0.05));
  // Skin texture tucks under the outline
  drawFruitSkin(name, r, seed, look);
  ctx.restore();

  ctx.strokeStyle = INK;
  ctx.lineJoin = 'round';
  ctx.lineWidth = outlineWidth(r);
  ctx.stroke(body);

  drawShineTicks(r, ballId);
  drawFruitTopper(name, r, look);
  ctx.restore();
}

// Called inside a clip to the fruit's outline
function drawFruitSkin(name, r, seed0, look) {
  const s = seed0 * 101;
  const { blush, density, phase, flip } = look;
  ctx.lineCap = 'round';

  switch (name) {
    case 'coconut': {
      // Three faint ridges fanning down from the eye end
      ctx.strokeStyle = 'rgba(50, 28, 10, 0.32)';
      ctx.lineWidth = r * 0.07;
      ctx.beginPath();
      for (const k of [-1, 0, 1]) {
        ctx.moveTo(k * r * 0.08, -r * 0.62);
        ctx.quadraticCurveTo(k * r * 0.78, -r * 0.05, k * r * 0.4, r * 1.0);
      }
      ctx.stroke();
      // Husk fibers: short hairy strokes, dark and light, combed pole
      // to pole and fanning out with the curve of the shell
      const fibers = Math.round(18 * density);
      for (let pass = 0; pass < 2; pass++) {
        ctx.strokeStyle = pass ? 'rgba(214, 166, 112, 0.5)' : 'rgba(48, 26, 10, 0.45)';
        ctx.lineWidth = r * (pass ? 0.035 : 0.05);
        ctx.beginPath();
        for (let i = pass; i < fibers; i += 2) {
          const x = (pseudoRand(s + i * 3) - 0.5) * r * 1.8;
          const y = (pseudoRand(s + i * 5) - 0.4) * r * 1.8;
          const len = r * (0.12 + pseudoRand(s + i * 7) * 0.15);
          const tilt = (x / r) * 0.7 + (pseudoRand(s + i * 11) - 0.5) * 0.5;
          ctx.moveTo(x - Math.sin(tilt) * len, y - Math.cos(tilt) * len);
          ctx.lineTo(x + Math.sin(tilt) * len, y + Math.cos(tilt) * len);
        }
        ctx.stroke();
      }
      break;
    }
    case 'peach': {
      // Sun-kissed blush: a broad rosy flush with a deeper heart
      ctx.fillStyle = `rgba(240, 96, 112, ${0.42 * blush})`;
      ctx.beginPath();
      ctx.ellipse(-flip * r * 0.22, r * 0.12, r * 0.62, r * 0.52, -0.3 * flip, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(212, 48, 80, ${0.22 * blush})`;
      ctx.beginPath();
      ctx.ellipse(-flip * r * 0.34, r * 0.08, r * 0.3, r * 0.26, -0.3 * flip, 0, Math.PI * 2);
      ctx.fill();
      // Suture: the crease running from the cleft down one cheek
      ctx.strokeStyle = hexWithAlpha(INK, 0.38);
      ctx.lineWidth = r * 0.065;
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.84);
      ctx.quadraticCurveTo(flip * r * (0.42 + phase * 0.12), -r * 0.1, flip * r * 0.1, r * 0.95);
      ctx.stroke();
      // Fuzz: a dusting of pale specks
      ctx.fillStyle = 'rgba(255, 242, 228, 0.5)';
      speckle(Math.round(8 * density), s, r * 0.8, r * 0.8, r * 0.028, 0.6);
      break;
    }
    case 'apple': {
      // Warm golden blush low on the sun-catching cheek — real apples
      // are never one flat red (and some are far more golden than others)
      ctx.fillStyle = `rgba(255, 190, 80, ${0.28 * blush})`;
      ctx.beginPath();
      ctx.ellipse(-flip * r * 0.28, r * 0.3, r * 0.44, r * 0.34, 0.4 * flip, 0, Math.PI * 2);
      ctx.fill();
      // Deeper red flush up near the shoulder
      ctx.fillStyle = `rgba(150, 20, 40, ${0.22 * (2 - blush)})`;
      ctx.beginPath();
      ctx.ellipse(flip * r * 0.34, -r * 0.28, r * 0.42, r * 0.34, -0.3 * flip, 0, Math.PI * 2);
      ctx.fill();
      // Darker streaks arcing pole to pole, varied per apple
      ctx.strokeStyle = 'rgba(120, 20, 35, 0.32)';
      const streaks = 4 + Math.round(density * 1.2);
      for (let i = 0; i < streaks; i++) {
        const lon = -0.62 + i * (1.24 / Math.max(1, streaks - 1)) + (pseudoRand(s + i * 13) - 0.5) * 0.12;
        const top = -0.82 + pseudoRand(s + i * 17) * 0.22;
        const bot = 0.55 + pseudoRand(s + i * 19) * 0.3;
        ctx.lineWidth = r * (0.03 + pseudoRand(s + i * 23) * 0.035);
        ctx.beginPath();
        ctx.moveTo(lon * r * 1.25, top * r);
        ctx.quadraticCurveTo(lon * r * 1.9, 0, lon * r * 1.2, bot * r);
        ctx.stroke();
      }
      // Pale freckle lenticels
      ctx.fillStyle = 'rgba(255, 224, 200, 0.4)';
      speckle(Math.round(9 * density), s, r * 0.82, r * 0.82, r * 0.028, 0.6);
      break;
    }
    case 'lemon': {
      // A paler band along the length where the light rolls over the peel
      ctx.fillStyle = 'rgba(255, 250, 205, 0.4)';
      ctx.beginPath();
      ctx.ellipse(-r * 0.05, -r * 0.3, r * 0.85, r * 0.2, -0.05, 0, Math.PI * 2);
      ctx.fill();
      // Shade under the belly
      ctx.fillStyle = 'rgba(190, 140, 0, 0.18)';
      ctx.beginPath();
      ctx.ellipse(r * 0.05, r * 0.55, r * 0.95, r * 0.35, 0, 0, Math.PI * 2);
      ctx.fill();
      // Dimpled peel — oil-gland pores
      ctx.fillStyle = 'rgba(150, 110, 10, 0.45)';
      speckle(Math.round(12 * density), s, r * 1.0, r * 0.75, r * 0.032, 0.5);
      break;
    }
    case 'lime': {
      // Deeper green on the shadow side, pale oil glands all over
      ctx.fillStyle = 'rgba(30, 80, 20, 0.22)';
      ctx.beginPath();
      ctx.ellipse(flip * r * 0.25, r * 0.4, r * 0.85, r * 0.45, 0.2 * flip, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(228, 248, 188, 0.6)';
      speckle(Math.round(13 * density), s, r * 0.95, r * 0.85, r * 0.03, 0.5);
      break;
    }
    case 'orange': {
      // Rind pores — ink dots, varied in size
      ctx.fillStyle = hexWithAlpha(INK, 0.4);
      speckle(Math.round(12 * density), s, r * 0.88, r * 0.88, r * 0.03, 0.7);
      // A warm darker cheek
      ctx.fillStyle = 'rgba(200, 80, 0, 0.16)';
      ctx.beginPath();
      ctx.ellipse(flip * r * 0.35, r * 0.35, r * 0.6, r * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'watermelon': {
      // Dark wavy rind stripes running end to end, converging at the
      // poles of the long melon. The wiggle and weight are this melon's own.
      ctx.strokeStyle = '#14503a';
      const wavePhase = phase * Math.PI * 2;
      const stripeW = 0.85 + density * 0.2;
      for (const lat of [-0.68, -0.23, 0.23, 0.68]) {
        ctx.lineWidth = r * (0.15 - Math.abs(lat) * 0.05) * stripeW;
        ctx.beginPath();
        const steps = 16;
        for (let k = 0; k <= steps; k++) {
          const t = (k / steps) * 2 - 1;               // -1 stem end → 1 blossom end
          const bulge = Math.sqrt(Math.max(1 - t * t, 0));
          const wave = Math.sin(t * 8 + lat * 20 + wavePhase) * r * 0.05;
          const x = t * r * 1.1;
          const y = (lat * r * 1.0 + wave) * bulge * 0.92;
          if (k === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      // The pale "field spot" where it lay in the sun
      ctx.fillStyle = 'rgba(236, 226, 120, 0.55)';
      ctx.beginPath();
      ctx.ellipse(flip * r * 0.15, r * 0.74, r * 0.4, r * 0.14, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'blueberry': {
      // Dusty bloom — frosty patches over the deep blue
      ctx.fillStyle = `rgba(212, 224, 252, ${0.26 * blush})`;
      ctx.beginPath();
      ctx.ellipse(flip * r * 0.2, r * 0.25, r * 0.58, r * 0.38, 0.4 * flip, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(222, 232, 255, ${0.45 * blush})`;
      speckle(3 + Math.round(density * 2), s, r * 0.7, r * 0.6, r * 0.045, 0.4);
      break;
    }
    case 'grape': {
      // Translucent flesh: a lighter core where the light passes through
      ctx.fillStyle = 'rgba(255, 255, 255, 0.13)';
      ctx.beginPath();
      ctx.ellipse(-r * 0.15, -r * 0.1, r * 0.4, r * 0.66, 0.25, 0, Math.PI * 2);
      ctx.fill();
      // Thin ink crescent along the lower rim suggests roundness
      ctx.strokeStyle = hexWithAlpha(INK, 0.3);
      ctx.lineWidth = r * 0.05;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.74, r * 0.88, 0, 0.4 + phase * 0.3, 1.5 + phase * 0.3);
      ctx.stroke();
      // A touch of dusty bloom on some grapes
      if (blush > 1) {
        ctx.fillStyle = `rgba(230, 220, 250, ${(blush - 1) * 0.4})`;
        ctx.beginPath();
        ctx.ellipse(-r * 0.15, r * 0.3, r * 0.4, r * 0.3, 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'plum': {
      // Bloom: the dusty blue-grey film plums wear
      ctx.fillStyle = `rgba(184, 170, 228, ${0.3 * blush})`;
      ctx.beginPath();
      ctx.ellipse(flip * r * 0.25, r * 0.2, r * 0.55, r * 0.6, 0.3 * flip, 0, Math.PI * 2);
      ctx.ellipse(-flip * r * 0.4, -r * 0.3, r * 0.3, r * 0.22, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(230, 210, 240, 0.35)';
      speckle(Math.round(6 * density), s, r * 0.75, r * 0.8, r * 0.025, 0.5);
      // Suture crease from the stem dimple down one side
      ctx.strokeStyle = hexWithAlpha(INK, 0.42);
      ctx.lineWidth = r * 0.06;
      ctx.beginPath();
      ctx.moveTo(-flip * r * 0.04, -r * 0.88);
      ctx.quadraticCurveTo(-flip * r * (0.4 + phase * 0.12), -r * 0.05, -flip * r * 0.08, r * 0.98);
      ctx.stroke();
      break;
    }
  }
}

function drawFruitTopper(name, r, look = DEFAULT_LOOK) {
  // Stems and leaves lean a little differently on every fruit
  ctx.save();
  ctx.rotate(look.tilt);
  ctx.lineCap = 'round';
  const leafW = outlineWidth(r) * 0.5;

  switch (name) {
    case 'coconut': {
      // The three coconut "eyes" at the narrow end
      ctx.fillStyle = hexWithAlpha(INK, 0.92);
      ctx.beginPath();
      for (const e of [{ x: -0.17, y: -0.62 }, { x: 0.17, y: -0.62 }, { x: 0, y: -0.4 }]) {
        ctx.moveTo(e.x * r + r * 0.09, e.y * r);
        ctx.ellipse(e.x * r, e.y * r, r * 0.09, r * 0.11, 0, 0, Math.PI * 2);
      }
      ctx.fill();
      break;
    }
    case 'peach': {
      // Short woody stem in the cleft and one long slender leaf
      ctx.strokeStyle = INK;
      ctx.lineWidth = r * 0.1;
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.84);
      ctx.lineTo(r * 0.05, -r * 1.06);
      ctx.stroke();
      drawLeaf(r * 0.04, -r * 1.0, r * 0.62, r * 0.18, -0.35, leafW);
      break;
    }
    case 'apple': {
      // Deep dimple where the stem sinks into the fruit
      ctx.fillStyle = hexWithAlpha(INK, 0.4);
      ctx.beginPath();
      ctx.ellipse(0, -r * 0.8, r * 0.16, r * 0.08, 0, 0, Math.PI * 2);
      ctx.fill();
      // Sturdy curved ink stem
      ctx.strokeStyle = INK;
      ctx.lineWidth = r * 0.1;
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.82);
      ctx.quadraticCurveTo(r * 0.03, -r * 1.05, r * 0.12, -r * 1.18);
      ctx.stroke();
      drawLeaf(r * 0.08, -r * 1.02, r * 0.55, r * 0.17, -0.45, leafW);
      break;
    }
    case 'lemon': {
      // Stem scar on the left nub, a darker tip on the right
      ctx.fillStyle = '#6B7A1E';
      ctx.strokeStyle = INK;
      ctx.lineWidth = leafW;
      ctx.beginPath();
      ctx.arc(-r * 1.14, 0, r * 0.07, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = hexWithAlpha(INK, 0.45);
      ctx.beginPath();
      ctx.arc(r * 1.22, 0, r * 0.04, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'lime': {
      // A stem nub with a single glossy leaf
      drawLeaf(-r * 1.0, -r * 0.08, r * 0.62, r * 0.2, Math.PI + 0.55, leafW);
      ctx.fillStyle = '#5E6B1A';
      ctx.strokeStyle = INK;
      ctx.lineWidth = leafW;
      ctx.beginPath();
      ctx.arc(-r * 1.04, 0, r * 0.07, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'orange': {
      // Star-shaped calyx at the stem, and a leaf
      drawLeaf(r * 0.06, -r * 0.94, r * 0.5, r * 0.15, -0.3, leafW);
      ctx.fillStyle = '#5E7D2A';
      ctx.strokeStyle = INK;
      ctx.lineWidth = leafW;
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
        const rad = (i % 2 === 0 ? 0.13 : 0.06) * r;
        ctx.lineTo(Math.cos(a) * rad, -r * 0.9 + Math.sin(a) * rad * 0.6);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'watermelon': {
      // Curly stem at the end of the melon
      ctx.strokeStyle = INK;
      ctx.lineWidth = r * 0.07;
      ctx.beginPath();
      ctx.moveTo(r * 1.08, 0);
      ctx.quadraticCurveTo(r * 1.3, -r * 0.05, r * 1.28, -r * 0.22);
      ctx.quadraticCurveTo(r * 1.25, -r * 0.34, r * 1.14, -r * 0.28);
      ctx.stroke();
      break;
    }
    case 'blueberry': {
      // The crown: a five-pointed calyx in a little crater on top
      ctx.save();
      ctx.translate(0, -r * 0.8);
      ctx.fillStyle = '#2B3B7E';
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.24, r * 0.1, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = hexWithAlpha(INK, 0.9);
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
        const rad = (i % 2 === 0 ? 0.24 : 0.08) * r;
        ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad * 0.5 - r * 0.03);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      break;
    }
    case 'grape': {
      // Woody pedicel with a little cap, and a curl of tendril on some
      ctx.strokeStyle = INK;
      ctx.lineWidth = r * 0.07;
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.98);
      ctx.lineTo(r * 0.05, -r * 1.22);
      ctx.stroke();
      ctx.fillStyle = '#7A5A3A';
      ctx.lineWidth = leafW;
      ctx.beginPath();
      ctx.ellipse(0, -r * 1.0, r * 0.12, r * 0.06, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (look.phase > 0.5) {
        ctx.strokeStyle = LEAF_GREEN;
        ctx.lineWidth = r * 0.035;
        ctx.beginPath();
        ctx.moveTo(r * 0.04, -r * 1.14);
        ctx.quadraticCurveTo(r * 0.32, -r * 1.3, r * 0.3, -r * 1.12);
        ctx.quadraticCurveTo(r * 0.28, -r * 1.02, r * 0.2, -r * 1.08);
        ctx.stroke();
      }
      break;
    }
    case 'plum': {
      // Short stem sunk into the dimple
      ctx.strokeStyle = INK;
      ctx.lineWidth = r * 0.06;
      ctx.beginPath();
      ctx.moveTo(-r * 0.03, -r * 0.88);
      ctx.quadraticCurveTo(-r * 0.02, -r * 1.0, r * 0.06, -r * 1.08);
      ctx.stroke();
      break;
    }
  }
  ctx.restore();
}

// ── Plain / candy balls (palette-swap skins) ────────────────────
// Candy, neon and doodle sets keep a simple ball so the set reads as
// one uniform family
function drawSolidBall(r, fill, stroke, tierIndex, ballId) {
  const seed = ballId != null ? ballId : 7;
  const look = ballId != null ? getBallLook(ballId) : DEFAULT_LOOK;
  const body = wobblyCirclePath(0, 0, r, seed, 0.02 + tierIndex * 0.0012);

  ctx.save();
  ctx.transform(look.aspect, look.lean, 0, 1 / look.aspect, 0, 0);
  const fillVaried = lookFill(look, fill);
  ctx.fillStyle = fillVaried;
  ctx.fill(body);

  const ox = -r * (0.24 + pseudoRand(seed * 3) * 0.1);
  const oy = -r * (0.26 + pseudoRand(seed * 5) * 0.1);
  ctx.save();
  ctx.clip(body);
  ctx.fillStyle = lightenColor(fillVaried, look.patchLift);
  ctx.fill(wobblyCirclePath(ox, oy, r * look.patchSize, seed + 11, 0.05));
  ctx.restore();

  if (Skins.getDetailMode() === 'gloss') drawCandyGloss(r, seed);

  ctx.strokeStyle = INK;
  ctx.lineJoin = 'round';
  ctx.lineWidth = outlineWidth(r);
  ctx.stroke(body);

  drawShineTicks(r, ballId);
  ctx.restore();
}

// Generic sheen for non-fruit skins — a curved candy shine band,
// jittered per ball so palette-swapped balls don't read as clones.
function drawCandyGloss(r, seed) {
  const j = seed != null ? (pseudoRand(seed * 61) - 0.5) * 0.5 : 0;
  const wj = seed != null ? 0.85 + pseudoRand(seed * 67) * 0.35 : 1;
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.97, 0, Math.PI * 2);
  ctx.clip();
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.lineWidth = r * 0.16 * wj;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.62, -2.4 + j, -1.15 + j * 0.7);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.lineWidth = r * 0.07 * wj;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.8, -0.95 + j, -0.5 + j);
  ctx.stroke();
  ctx.restore();
}

// ── Dragonfruit (vivid pink egg, green-tipped scales) ───────────
// Leathery scale flaps grow out of the skin in staggered rows, all
// sweeping up toward the crown; the outer ones flare past the outline
// like the real fruit, and a tuft of them closes the top.
const DRAGON_SCALES = [
  // x, y (fractions of r), size — staggered rows, bottom row first
  { x: -0.3, y: 0.74, s: 0.8 }, { x: 0.32, y: 0.72, s: 0.8 },
  { x: -0.66, y: 0.4, s: 0.95 }, { x: 0.0, y: 0.42, s: 1.0 }, { x: 0.64, y: 0.38, s: 0.95 },
  { x: -0.36, y: 0.06, s: 1.0 }, { x: 0.32, y: 0.04, s: 1.0 },
  { x: -0.68, y: -0.3, s: 0.9 }, { x: 0.0, y: -0.28, s: 1.0 }, { x: 0.66, y: -0.32, s: 0.9 },
  { x: -0.32, y: -0.6, s: 0.85 }, { x: 0.34, y: -0.6, s: 0.85 },
];

function drawDragonfruitBall(r, ballId) {
  const seed = ballId != null ? ballId : 8;
  const look = ballId != null ? getBallLook(ballId) : DEFAULT_LOOK;
  const body = fruitPath(FRUIT_SHAPES.dragonfruit, r, seed, 0.02);
  const pink = lookFill(look, '#E44D8D');

  ctx.save();
  ctx.transform(look.aspect, look.lean, 0, 1 / look.aspect, 0, 0);

  ctx.fillStyle = pink;
  ctx.fill(body);
  ctx.save();
  ctx.clip(body);
  ctx.fillStyle = lightenColor(pink, look.patchLift);
  ctx.fill(wobblyCirclePath(-r * 0.26, -r * 0.28, r * look.patchSize, seed + 11, 0.05));
  ctx.restore();

  ctx.strokeStyle = INK;
  ctx.lineJoin = 'round';
  ctx.lineWidth = outlineWidth(r);
  ctx.stroke(body);

  // Scales, bottom rows first so upper flaps overlap the ones below.
  // Each sweeps upward and outward from where it grows.
  const jitter = look.tilt * 0.6;
  const grow = 0.9 + look.density * 0.12;
  for (const sc of DRAGON_SCALES) {
    const x = sc.x * r * 0.93;
    const y = sc.y * r * 1.07;
    const angle = -Math.PI / 2 + sc.x * 1.25 + jitter;
    drawDragonfruitScale(x, y, r * 0.44 * sc.s * grow, angle);
  }
  // The crown: a tuft of flaps closing the top of the fruit
  for (const a of [-0.6, 0, 0.6]) {
    drawDragonfruitScale(a * r * 0.2, -r * 0.98, r * 0.38, -Math.PI / 2 + a * 1.1);
  }

  drawShineTicks(r, seed);
  ctx.restore();
}

// One curved leaf flap, pointing outward along `angle`
function drawDragonfruitScale(x, y, len, angle) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  const flap = new Path2D();
  flap.moveTo(-len * 0.25, 0);
  flap.quadraticCurveTo(len * 0.3, -len * 0.38, len, -len * 0.06);
  flap.quadraticCurveTo(len * 0.3, len * 0.32, -len * 0.25, 0);
  flap.closePath();
  // Flat pink base with a flat green tip (outer third)
  ctx.fillStyle = '#F27DAE';
  ctx.fill(flap);
  ctx.save();
  ctx.clip(flap);
  ctx.fillStyle = LEAF_GREEN;
  ctx.fillRect(len * 0.55, -len * 0.4, len * 0.5, len * 0.8);
  ctx.restore();
  ctx.strokeStyle = INK;
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1, len * 0.08);
  ctx.stroke(flap);
  // Short center line, like a leaf vein
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(0.8, len * 0.05);
  ctx.beginPath();
  ctx.moveTo(-len * 0.1, 0);
  ctx.lineTo(len * 0.5, -len * 0.02);
  ctx.stroke();
  ctx.restore();
}

// ── Blackberry (a glossy cluster of drupelets) ──────────────────
// The berry is dozens of tiny round drupelets packed together, each
// with its own glint; the lumps on the outline are the outer ring of
// them. A star of green sepals and a stem cap the top.
function drawBlackberryBall(r, ballId) {
  const seed = ballId != null ? ballId : 13;
  const look = ballId != null ? getBallLook(ballId) : DEFAULT_LOOK;
  const shape = FRUIT_SHAPES.blackberry;
  const body = fruitPath(shape, r, seed, 0.012);
  const base = lookFill(look, '#24122F');

  ctx.save();
  ctx.transform(look.aspect, look.lean, 0, 1 / look.aspect, 0, 0);

  ctx.fillStyle = base;
  ctx.fill(body);

  ctx.save();
  ctx.clip(body);
  // Drupelets on a staggered grid, lower rows drawn last so they sit
  // in front (the berry is lit from above)
  const dr = r * 0.2;
  const dx = r * 0.34;
  const dy = r * 0.3;
  const drupe = lookFill(look, '#3E2257');
  const lit = lightenColor(drupe, 34);
  const cells = [];
  for (let j = -4; j <= 4; j++) {
    for (let i = -4; i <= 4; i++) {
      const x = (i + (j & 1 ? 0.5 : 0)) * dx + (pseudoRand(seed + i * 7 + j * 13) - 0.5) * r * 0.05;
      const y = j * dy;
      const ex = x / (r * shape.sx);
      const ey = y / (r * shape.sy);
      if (ex * ex + ey * ey < 1.05) cells.push(x, y);
    }
  }
  ctx.strokeStyle = hexWithAlpha(INK, 0.75);
  ctx.lineWidth = Math.max(0.8, r * 0.025);
  for (let k = 0; k < cells.length; k += 2) {
    const x = cells[k];
    const y = cells[k + 1];
    ctx.fillStyle = drupe;
    ctx.beginPath();
    ctx.arc(x, y, dr, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Each drupelet catches the light up-left
    ctx.fillStyle = lit;
    ctx.beginPath();
    ctx.arc(x - dr * 0.25, y - dr * 0.28, dr * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
  // Tiny white glints, all in one path
  ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
  ctx.beginPath();
  for (let k = 0; k < cells.length; k += 2) {
    const gx = cells[k] - dr * 0.35;
    const gy = cells[k + 1] - dr * 0.4;
    ctx.moveTo(gx + dr * 0.16, gy);
    ctx.arc(gx, gy, dr * 0.16, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = INK;
  ctx.lineJoin = 'round';
  ctx.lineWidth = outlineWidth(r);
  ctx.stroke(body);

  drawShineTicks(r, seed);

  // Sepals: a five-pointed green star, and the stem
  ctx.save();
  ctx.rotate(look.tilt);
  ctx.translate(0, -r * 0.98);
  ctx.fillStyle = LEAF_GREEN;
  ctx.strokeStyle = INK;
  ctx.lineWidth = outlineWidth(r) * 0.5;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const rad = (i % 2 === 0 ? 0.34 : 0.1) * r;
    ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad * 0.45);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.lineCap = 'round';
  ctx.lineWidth = r * 0.07;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(r * 0.02, -r * 0.14, r * 0.1, -r * 0.24);
  ctx.stroke();
  ctx.restore();

  ctx.restore();
}

// ── Grapefruit (sliced open) ────────────────────────────────────
// The cut face is offset toward the lower-right so a crescent of peel
// stays visible on the lit side: outside AND inside at once — and it's
// unmistakable next to the orange.
function drawGrapefruitBall(r, ballId) {
  const seed = ballId != null ? ballId : 12;
  const look = ballId != null ? getBallLook(ballId) : DEFAULT_LOOK;
  const body = fruitPath(FRUIT_SHAPES.grapefruit, r, seed, 0.02);
  const peel = lookFill(look, Skins.getTierStyle(BALL_TIER_INDEX.grapefruit).color);

  ctx.save();
  ctx.transform(look.aspect, look.lean, 0, 1 / look.aspect, 0, 0);

  // Peel — sunny yellow-orange with a pink blush and the usual tint patch
  ctx.fillStyle = peel;
  ctx.fill(body);
  ctx.save();
  ctx.clip(body);
  ctx.fillStyle = lightenColor(peel, look.patchLift);
  ctx.fill(wobblyCirclePath(-r * 0.26, -r * 0.28, r * 0.8, seed + 11, 0.05));
  ctx.fillStyle = `rgba(240, 90, 90, ${0.25 * look.blush})`;
  ctx.beginPath();
  ctx.ellipse(r * 0.35, r * 0.4, r * 0.7, r * 0.5, 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Cut face: white pith ring…
  const cutX = r * 0.09;
  const cutY = r * 0.11;
  const pith = wobblyCirclePath(cutX, cutY, r * 0.74, seed + 23, 0.025);
  ctx.fillStyle = '#FFEBDD';
  ctx.fill(pith);

  // …around ruby flesh
  const fleshR = r * 0.64;
  const flesh = wobblyCirclePath(cutX, cutY, fleshR, seed + 31, 0.025);
  ctx.fillStyle = '#F4586E';
  ctx.fill(flesh);

  ctx.save();
  ctx.clip(flesh);
  // Segment wedges — pith-colored spokes dividing the flesh
  const segs = 8 + Math.round(look.density);
  const segPhase = pseudoRand(seed * 3) * Math.PI * 2;
  ctx.strokeStyle = '#FFEBDD';
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1.5, r * 0.055);
  ctx.beginPath();
  for (let i = 0; i < segs; i++) {
    const a = segPhase + (i / segs) * Math.PI * 2;
    ctx.moveTo(cutX + Math.cos(a) * r * 0.08, cutY + Math.sin(a) * r * 0.08);
    ctx.lineTo(cutX + Math.cos(a) * fleshR, cutY + Math.sin(a) * fleshR);
  }
  ctx.stroke();
  // Juicy glisten flecks on a few segments
  ctx.fillStyle = 'rgba(255, 200, 200, 0.5)';
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = segPhase + pseudoRand(seed + i * 7) * Math.PI * 2;
    const d = (0.25 + pseudoRand(seed + i * 13) * 0.55) * fleshR;
    const fx = cutX + Math.cos(a) * d;
    const fy = cutY + Math.sin(a) * d;
    ctx.moveTo(fx + r * 0.035, fy);
    ctx.ellipse(fx, fy, r * 0.035, r * 0.02, a, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.restore();

  // Center button where the segments meet
  ctx.fillStyle = '#FFEBDD';
  ctx.beginPath();
  ctx.arc(cutX, cutY, r * 0.07, 0, Math.PI * 2);
  ctx.fill();

  // Ink linework: thin ring around the cut face, full outline on the body
  ctx.strokeStyle = hexWithAlpha(INK, 0.55);
  ctx.lineJoin = 'round';
  ctx.lineWidth = outlineWidth(r) * 0.5;
  ctx.stroke(pith);
  ctx.strokeStyle = INK;
  ctx.lineWidth = outlineWidth(r);
  ctx.stroke(body);

  drawShineTicks(r, seed);
  ctx.restore();
}

// ── Rainbow Squishy (every fruit at once) ───────────────────────
// A pinwheel of wedges, one per fruit in rainbow order, each wearing a
// hint of its fruit's skin — seeds, pores, drupelets — around a cream
// center. The wedge disk is a cached sprite; drawRainbowBall spins it
// and adds the live sparkle on top.
const RAINBOW_WEDGES = [
  { c: '#E8394F', dot: 'rgba(255,224,200,0.7)' },  // red apple — freckles
  { c: '#FF8E62', dot: 'rgba(255,240,220,0.7)' },  // grapefruit
  { c: '#F5921E', dot: 'rgba(120,60,10,0.45)' },   // orange — pores
  { c: '#FFA07A', dot: 'rgba(240,96,112,0.6)' },   // peach — blush
  { c: '#F4D735', dot: 'rgba(150,110,10,0.5)' },   // lemon — pores
  { c: '#7BC043', dot: 'rgba(228,248,188,0.8)' },  // lime
  { c: '#2ECC71', dot: 'rgba(20,80,58,0.85)' },    // watermelon — stripes-ish
  { c: '#5578DE', dot: 'rgba(222,232,255,0.8)' },  // blueberry — bloom
  { c: '#8A4FB8', dot: 'rgba(255,255,255,0.5)' },  // grape
  { c: '#3B2150', dot: 'rgba(160,120,200,0.9)' },  // blackberry — drupelets
  { c: '#8C2F66', dot: 'rgba(200,180,235,0.7)' },  // plum — bloom
  { c: '#E44D8D', dot: 'rgba(30,20,30,0.8)' },     // dragonfruit — seeds
];

function drawRainbowBody(r, ballId) {
  const seed = ballId != null ? ballId : 9;
  const body = wobblyCirclePath(0, 0, r, seed, 0.018);
  const n = RAINBOW_WEDGES.length;

  ctx.save();
  ctx.clip(body);
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    const w = RAINBOW_WEDGES[i];
    ctx.fillStyle = w.c;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r * 1.1, a0, a1);
    ctx.closePath();
    ctx.fill();
    // A lighter inner band so each wedge reads as a plump segment
    ctx.fillStyle = lightenColor(w.c, 34);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r * 0.62, a0 + 0.04, a1 - 0.04);
    ctx.closePath();
    ctx.fill();
    // The fruit's skin in miniature
    ctx.fillStyle = w.dot;
    ctx.beginPath();
    for (let k = 0; k < 3; k++) {
      const a = a0 + (a1 - a0) * (0.3 + k * 0.2);
      const d = r * (0.72 + (k % 2) * 0.14);
      const ds = r * 0.035;
      ctx.moveTo(Math.cos(a) * d + ds, Math.sin(a) * d);
      ctx.arc(Math.cos(a) * d, Math.sin(a) * d, ds, 0, Math.PI * 2);
    }
    ctx.fill();
  }
  // Thin ink seams between the wedges
  ctx.strokeStyle = hexWithAlpha(INK, 0.45);
  ctx.lineWidth = outlineWidth(r) * 0.35;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    ctx.moveTo(Math.cos(a) * r * 0.2, Math.sin(a) * r * 0.2);
    ctx.lineTo(Math.cos(a) * r * 1.1, Math.sin(a) * r * 1.1);
  }
  ctx.stroke();
  ctx.restore();

  // Cream center the sparkle sits on
  ctx.fillStyle = '#FFF6E0';
  ctx.strokeStyle = INK;
  ctx.lineWidth = outlineWidth(r) * 0.5;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.24, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = INK;
  ctx.lineJoin = 'round';
  ctx.lineWidth = outlineWidth(r);
  ctx.stroke(body);
}

function drawRainbowBall(r, ballId) {
  const time = performance.now() * 0.001;
  // The pinwheel turns slowly…
  ctx.save();
  ctx.rotate(time * 0.8);
  drawFruitSprite(RAINBOW_TIER, r, ballId);
  ctx.restore();

  // …while a sparkle star spins the other way on the cream center
  ctx.save();
  ctx.rotate(-time * 2);
  const pulse = 1 + Math.sin(time * 5) * 0.08;
  ctx.fillStyle = '#FFD84A';
  ctx.strokeStyle = INK;
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1.2, r * 0.025);
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const rad = (i % 2 === 0 ? 0.2 : 0.085) * r * pulse;
    ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // Shine stays put under the light, whatever the wheel is doing
  drawShineTicks(r, ballId != null ? ballId : 9);
}

// Tier lookups by name for the few places that need a specific fruit
const BALL_TIER_INDEX = {};
BALL_TIERS.forEach((t, i) => { BALL_TIER_INDEX[t.name] = i; });

// ── Preview Ball ────────────────────────────────────────────────
function drawPreview(x, y, tierIndex, isDragging, isTouchDevice, bombQueued, ghostQueued) {

  // On touch: show bigger, more visible preview while dragging
  const baseAlpha = isDragging ? 0.7 : 0.45;
  const pulse = Math.sin(performance.now() * 0.005) * 0.1;
  const scale = isDragging ? 1.05 : 1;

  ctx.save();
  ctx.globalAlpha = baseAlpha + pulse;
  ctx.translate(x, y);
  ctx.scale(scale, scale);

  if (bombQueued) {
    drawBombVisual(BOMB_RADIUS);
  } else if (ghostQueued) {
    // Ghostly preview — same ball but more transparent with dashed outline
    const tier = BALL_TIERS[tierIndex];
    ctx.globalAlpha = 0.25 + Math.sin(performance.now() * 0.006) * 0.1;
    drawFruitSprite(tierIndex, tier.radius, null);
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(200,220,255,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, tier.radius + 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  } else {
    const tier = BALL_TIERS[tierIndex];
    if (tierIndex === RAINBOW_TIER) {
      drawRainbowBall(tier.radius);
    } else {
      drawFruitSprite(tierIndex, tier.radius, null);
    }
  }

  ctx.restore();

  // Touch: draw drag indicator ring
  const previewR = bombQueued ? BOMB_RADIUS : BALL_TIERS[tierIndex].radius;
  if (isDragging) {
    ctx.save();
    ctx.globalAlpha = 0.3 + pulse;
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(x, y, previewR + 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }
}

// ── Next-fruit bubble ───────────────────────────────────────────
// The drop queue always knew the fruit after this one; showing it is
// what lets a player plan a merge instead of just reacting. Sits in the
// free strip right of the cup, below the store row.
const NEXT_BUBBLE = { x: 374, y: 190, r: 18 };

function drawNextBubble(tierIndex) {
  const { x, y, r } = NEXT_BUBBLE;
  const tier = BALL_TIERS[tierIndex];
  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = '11px "Patrick Hand", cursive';
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fillText('NEXT', x, y - r - 6);

  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Same cached sprite as the aim preview, shrunk to fit the bubble
  const fit = Math.min(1, (r - 4) / tier.radius);
  ctx.translate(x, y);
  ctx.scale(fit, fit);
  drawFruitSprite(tierIndex, tier.radius, null);
  ctx.restore();
}

// ── Score Display ───────────────────────────────────────────────
function drawScore(score, bestScore, combo) {
  // Title, score and best only change on a merge — cached sprite
  drawCachedHud('score', `${score}|${bestScore}`, 60, 6, 280, 82, () => {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = '18px "Patrick Hand", cursive';
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillText('SQUISHY FRUIT', GAME_WIDTH / 2, 28);

    // Score with shadow
    ctx.font = 'bold 30px "Patrick Hand", cursive';
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillText(score.toLocaleString(), GAME_WIDTH / 2 + 1, 61);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(score.toLocaleString(), GAME_WIDTH / 2, 60);

    // All-time best score
    ctx.font = '14px "Patrick Hand", cursive';
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillText(`BEST ${(bestScore || 0).toLocaleString()}`, GAME_WIDTH / 2, 80);
    ctx.restore();
  });

  ctx.save();
  ctx.textAlign = 'center';

  // Combo indicator with scale animation
  if (combo > 1) {
    const comboScale = 1 + Math.sin(performance.now() * 0.012) * 0.08;
    ctx.save();
    ctx.translate(GAME_WIDTH / 2, 106);
    ctx.scale(comboScale, comboScale);
    ctx.font = `bold ${18 + Math.min(combo, 5) * 2}px "Patrick Hand", cursive`;

    // Glow
    ctx.fillStyle = `rgba(241, 196, 15, ${0.3 + Math.sin(performance.now() * 0.015) * 0.2})`;
    ctx.fillText(`${combo}x COMBO!`, 0, 0);

    ctx.fillStyle = '#F1C40F';
    ctx.globalAlpha = 0.7 + Math.sin(performance.now() * 0.01) * 0.3;
    ctx.fillText(`${combo}x COMBO!`, 0, 0);
    ctx.restore();
  }

  ctx.restore();
}

// ── Fever Meter & Overlay ───────────────────────────────────────
// Vertical meter along the left edge of the cup: fills gold as merges
// chain, drains as the countdown while frenzy is active.
function drawFeverMeter(fever, cupExt) {
  if (fever.meter <= 0 && !fever.active) return;

  const barX = 26;
  const barW = 9;
  const barBottom = 640;
  const barTop = 390 - (cupExt || 0);
  const barH = barBottom - barTop;
  const t = performance.now();

  ctx.save();

  // Track
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(barX, barTop, barW, barH, 5);
  ctx.fill();
  ctx.stroke();

  // Fill (bottom-up)
  const fillH = barH * Math.min(fever.meter, 1);
  if (fillH > 1) {
    const nearFull = fever.meter > 0.8 || fever.active;
    const pulse = nearFull ? 0.75 + Math.sin(t * 0.012) * 0.25 : 0.85;
    const grad = ctx.createLinearGradient(0, barBottom - fillH, 0, barBottom);
    grad.addColorStop(0, fever.active ? '#FFE066' : '#FFD700');
    grad.addColorStop(1, fever.active ? '#FF8C42' : '#E8A317');
    ctx.globalAlpha = pulse;
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(barX + 1, barBottom - fillH, barW - 2, fillH, 4);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Label + burst text while active
  if (fever.active) {
    const wob = Math.sin(t * 0.02) * 0.12;
    ctx.save();
    ctx.translate(barX + barW / 2, barTop - 16);
    ctx.rotate(wob);
    ctx.textAlign = 'center';
    ctx.font = 'bold 13px "Patrick Hand", cursive';
    ctx.fillStyle = `rgba(255, 215, 0, ${0.7 + Math.sin(t * 0.015) * 0.3})`;
    ctx.fillText('2x', 0, 0);
    ctx.restore();
  } else {
    ctx.textAlign = 'center';
    ctx.font = '10px "Patrick Hand", cursive';
    ctx.fillStyle = 'rgba(255, 215, 0, 0.35)';
    ctx.fillText('FEVER', barX + barW / 2, barTop - 8);
  }

  ctx.restore();
}

// Warm pulsing wash over the scene while frenzy is running (glow and
// golden border are one cached layer; only its alpha animates)
function drawFeverOverlay() {
  const pulse = 0.75 + Math.sin(performance.now() * 0.006) * 0.25;
  ctx.save();
  ctx.globalAlpha = pulse;
  drawLayer(getFeverLayer());
  ctx.restore();
}

// ── Mode Status (rush timer / zen tag) ──────────────────────────
function drawModeStatus(state) {
  if (state.mode === 'rush') {
    const ms = Math.max(0, state.rushTimeLeftMs || 0);
    const totalSec = Math.ceil(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = String(totalSec % 60).padStart(2, '0');
    const urgent = ms < 10000 && ms > 0;
    const pulse = urgent ? 0.6 + Math.sin(performance.now() * 0.012) * 0.4 : 0.6;

    ctx.save();
    ctx.font = 'bold 24px "Patrick Hand", cursive';
    ctx.textAlign = 'right';
    ctx.fillStyle = urgent
      ? `rgba(231, 76, 60, ${pulse})`
      : `rgba(255, 255, 255, ${pulse})`;
    ctx.fillText(`${m}:${s}`, GAME_WIDTH - 16, 54);
    ctx.restore();
  } else if (state.mode === 'zen') {
    ctx.save();
    ctx.font = '16px "Patrick Hand", cursive';
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(140, 220, 190, 0.5)';
    ctx.fillText('~ zen ~', GAME_WIDTH - 16, 52);

    // Zen never ends on its own, so give it a door: a soft pill button
    // under the tag that banks progress and returns to the menu.
    const b = ZEN_EXIT_BTN;
    ctx.fillStyle = 'rgba(140, 220, 190, 0.10)';
    ctx.strokeStyle = 'rgba(140, 220, 190, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(b.x, b.y, b.w, b.h, b.h / 2);
    ctx.fill();
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.font = '14px "Patrick Hand", cursive';
    ctx.fillStyle = 'rgba(140, 220, 190, 0.75)';
    ctx.fillText('exit', b.x + b.w / 2, b.y + 17);
    ctx.restore();
  }
}

// Zen-only exit button, tucked under the "~ zen ~" tag
export const ZEN_EXIT_BTN = { x: GAME_WIDTH - 82, y: 62, w: 66, h: 25 };

export function checkZenExitHit(x, y) {
  const b = ZEN_EXIT_BTN;
  return x >= b.x - 4 && x <= b.x + b.w + 4 && y >= b.y - 4 && y <= b.y + b.h + 4;
}

// ── Decorative Ball (title screen etc.) ─────────────────────────
// Draws a bobbing squishy fruit at an arbitrary position/size — used
// by menus.js so it never has to duplicate the fruit art.
export function drawDecorBall(x, y, r, tierIndex, seed = 1) {
  const t = performance.now() * 0.001;
  const bob = Math.sin(t * 1.2 + seed * 2.1) * 4;
  const tilt = Math.sin(t * 0.8 + seed * 3.7) * 0.08;

  ctx.save();
  ctx.translate(x, y + bob);
  ctx.rotate(tilt);
  if (tierIndex === RAINBOW_TIER) {
    drawRainbowBall(r, seed);
  } else {
    drawFruitSprite(tierIndex, r, seed, `${tierIndex}:d${seed}:${r}`);
  }
  ctx.restore();
}

// Cup thumbnail for the unlock shop — same painters as the real cup,
// cached per style at the current render scale.
export function drawCupThumb(styleId, x, y, w, h) {
  const key = `thumb:${styleId}:${renderScale}`;
  let sprite = cupCache.get(key);
  if (!sprite) {
    const wall = Math.max(3.5, w * 0.11);
    sprite = CupArt.renderCup(styleId, {
      leftX: wall + 2, rightX: w - wall - 2,
      rimY: h * 0.12, bottomY: h - wall - 2,
      baseExtra: w * 0.06, wall,
    }, renderScale);
    cupCache.set(key, sprite);
  }
  ctx.drawImage(sprite.canvas, x + sprite.x, y + sprite.y, sprite.w, sprite.h);
}

// ── Mute Button ─────────────────────────────────────────────────
export const MUTE_BTN = { x: 20, y: 45, size: 22 };

function drawMuteButton(muted) {
  const { x, y, size } = MUTE_BTN;
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = 0.4;

  // Speaker icon
  ctx.fillStyle = '#FFFFFF';
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';

  // Speaker body
  ctx.beginPath();
  ctx.moveTo(-4, -3);
  ctx.lineTo(-1, -3);
  ctx.lineTo(4, -7);
  ctx.lineTo(4, 7);
  ctx.lineTo(-1, 3);
  ctx.lineTo(-4, 3);
  ctx.closePath();
  ctx.fill();

  if (muted) {
    // X mark
    ctx.strokeStyle = '#E74C3C';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(7, -4);
    ctx.lineTo(13, 4);
    ctx.moveTo(13, -4);
    ctx.lineTo(7, 4);
    ctx.stroke();
  } else {
    // Sound waves
    ctx.beginPath();
    ctx.arc(4, 0, 5, -0.6, 0.6);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(4, 0, 9, -0.5, 0.5);
    ctx.stroke();
  }

  ctx.restore();
}

// ── Game Over Overlay ───────────────────────────────────────────
function drawGameOver(state) {
  const { score, bestScore, bestCombo, won, isNewBest } = state;
  ctx.save();

  // Animated dim overlay
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.fillRect(-30, -30, GAME_WIDTH + 60, GAME_HEIGHT + 60);

  ctx.textAlign = 'center';
  const cx = GAME_WIDTH / 2;
  const cy = GAME_HEIGHT / 2;
  const time = performance.now() * 0.002;

  if (won) {
    // Rainbow win - cycling colors
    // Sits a little higher than GAME OVER so the subtitle clears the
    // NEW BEST! line below it
    ctx.font = 'bold 42px "Patrick Hand", cursive';
    ctx.fillStyle = `hsl(${(time * 60) % 360}, 85%, 65%)`;
    ctx.fillText('RAINBOW!', cx, cy - 96);

    ctx.font = '24px "Patrick Hand", cursive';
    ctx.fillStyle = '#FFD700';
    ctx.fillText('You did it!', cx, cy - 62);
  } else {
    ctx.font = 'bold 42px "Patrick Hand", cursive';
    // Subtle pulse
    const pulse = 1 + Math.sin(performance.now() * 0.003) * 0.02;
    ctx.save();
    ctx.translate(cx, cy - 80);
    ctx.scale(pulse, pulse);
    if (state.gameoverReason === 'time') {
      ctx.fillStyle = '#F5A623';
      ctx.fillText("TIME'S UP!", 0, 0);
    } else {
      ctx.fillStyle = '#E74C3C';
      ctx.fillText('GAME OVER', 0, 0);
    }
    ctx.restore();
  }

  // New best celebration
  if (isNewBest) {
    const flash = 0.7 + Math.sin(performance.now() * 0.008) * 0.3;
    ctx.font = 'bold 22px "Patrick Hand", cursive';
    ctx.fillStyle = `rgba(255, 215, 0, ${flash})`;
    ctx.fillText('NEW BEST!', cx, cy - 32);
  }

  // Score
  ctx.font = '26px "Patrick Hand", cursive';
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(`Score: ${score.toLocaleString()}`, cx, cy + 8);

  // Best score + best combo
  ctx.font = '17px "Patrick Hand", cursive';
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillText(`Best: ${(bestScore || 0).toLocaleString()}`, cx, cy + 38);
  if (bestCombo > 0) {
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    // A combo's record is the points it chained, not its length
    ctx.fillText(`Best Combo: ${bestCombo.toLocaleString()} pts`, cx, cy + 62);
  }

  // Coin payout ceremony: count up over 1.2s, then rest
  if (state.coinsEarned > 0) {
    const t = Math.min((performance.now() - state.gameoverAt) / 1200, 1);
    const shown = Math.floor(state.coinsEarned * easeOutCubicLocal(t));
    const settled = t >= 1;

    drawCoinIcon(cx - 12 - String(shown).length * 5, cy + 96, 9);
    ctx.font = 'bold 22px "Patrick Hand", cursive';
    ctx.textAlign = 'left';
    ctx.fillStyle = settled ? '#FFD700' : '#FFE9A0';
    ctx.fillText(`+${shown.toLocaleString()}`, cx - 12 - String(shown).length * 5 + 16, cy + 103);

    // Running bank total, small below
    ctx.font = '14px "Patrick Hand", cursive';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255, 215, 0, 0.5)';
    ctx.fillText(`bank: ${(state.coinBalance || 0).toLocaleString()}`, cx, cy + 126);
  }

  ctx.restore();
}

// Small hand-drawn coin used in payout displays
export function drawCoinIcon(x, y, r) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = '#F1C40F';
  ctx.strokeStyle = '#B7950B';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = 'rgba(183, 149, 11, 0.7)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2);
  ctx.stroke();
  // Little glint
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.beginPath();
  ctx.arc(-r * 0.3, -r * 0.35, r * 0.18, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function easeOutCubicLocal(t) {
  return 1 - Math.pow(1 - t, 3);
}

// ── Store Buttons ───────────────────────────────────────────────
// Pill-style chips (dark-mode take on the tag-button reference):
// full-radius rounded pill, saturated colored border, dark tinted
// fill, and a rounded icon chip on the left holding a little glyph.
// `icon` is a lighter tint of the accent so the solid glyph reads
// softly against the tinted chip instead of blazing at full saturation.
const STORE_BTN_STYLE = {
  mergeBomb: { accent: '255, 159, 67',  icon: '255, 202, 150', label: 'MERGE' }, // warm orange
  cupExtend: { accent: '52, 215, 123',  icon: '150, 240, 194', label: 'CUP+'  }, // fresh green
  ghostBall: { accent: '110, 168, 255', icon: '172, 206, 255', label: 'GHOST' }, // soft blue
};

function drawStoreButtonIcon(id, cx, cy, s, iconRGB, alpha) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.strokeStyle = `rgb(${iconRGB})`;
  ctx.fillStyle = `rgb(${iconRGB})`;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (id === 'mergeBomb') {
    // Round bomb with an angled fuse cap and a spark going off
    const bx = cx - s * 0.06;
    const by = cy + s * 0.08;
    const r = s * 0.3;
    ctx.beginPath();
    ctx.arc(bx, by, r, 0, Math.PI * 2);
    ctx.fill();
    // Fuse cap: small rounded block on the upper-right shoulder
    ctx.save();
    ctx.translate(bx + r * 0.72, by - r * 0.72);
    ctx.rotate(Math.PI / 4);
    ctx.beginPath();
    ctx.roundRect(-s * 0.1, -s * 0.09, s * 0.2, s * 0.13, s * 0.04);
    ctx.fill();
    ctx.restore();
    // Spark rays past the cap
    const sx = bx + r * 1.15;
    const sy = by - r * 1.15;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(sx + s * 0.03, sy - s * 0.03);
    ctx.lineTo(sx + s * 0.13, sy - s * 0.13);
    ctx.moveTo(sx + s * 0.08, sy + s * 0.08);
    ctx.lineTo(sx + s * 0.2, sy + s * 0.12);
    ctx.moveTo(sx - s * 0.08, sy - s * 0.08);
    ctx.lineTo(sx - s * 0.12, sy - s * 0.2);
    ctx.stroke();
  } else if (id === 'cupExtend') {
    // Solid up arrow with motion dashes trailing beneath
    ctx.beginPath();
    ctx.moveTo(cx, cy - s * 0.42);
    ctx.lineTo(cx + s * 0.28, cy - s * 0.06);
    ctx.lineTo(cx + s * 0.11, cy - s * 0.06);
    ctx.lineTo(cx + s * 0.11, cy + s * 0.14);
    ctx.lineTo(cx - s * 0.11, cy + s * 0.14);
    ctx.lineTo(cx - s * 0.11, cy - s * 0.06);
    ctx.lineTo(cx - s * 0.28, cy - s * 0.06);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(cx - s * 0.18, cy + s * 0.22, s * 0.36, s * 0.055, s * 0.03);
    ctx.roundRect(cx - s * 0.18, cy + s * 0.34, s * 0.36, s * 0.055, s * 0.03);
    ctx.fill();
  } else {
    // Arcade ghost: dome top, scalloped skirt, punched-out eyes
    const gr = s * 0.32;
    const top = cy - s * 0.08;
    const hem = cy + s * 0.36;
    ctx.beginPath();
    ctx.moveTo(cx - gr, hem);
    ctx.lineTo(cx - gr, top);
    ctx.arc(cx, top, gr, Math.PI, 0);
    ctx.lineTo(cx + gr, hem);
    ctx.lineTo(cx + gr * 0.55, hem - s * 0.12);
    ctx.lineTo(cx, hem);
    ctx.lineTo(cx - gr * 0.55, hem - s * 0.12);
    ctx.closePath();
    ctx.fill();
    // Eyes read as cutouts against the dark chip base
    ctx.fillStyle = 'rgba(10, 14, 30, 0.92)';
    ctx.beginPath();
    ctx.arc(cx - gr * 0.42, cy - s * 0.08, s * 0.075, 0, Math.PI * 2);
    ctx.arc(cx + gr * 0.42, cy - s * 0.08, s * 0.075, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawStoreButtons(prices, affordable, blocked) {
  if (!prices) return;
  let key = '';
  for (const btn of STORE_BUTTONS) {
    key += `${prices[btn.id]}${affordable[btn.id] ? 'y' : 'n'}${blocked ? blocked[btn.id] : ''}|`;
  }
  drawCachedHud('store', key, 24, 106, 352, 40, () => paintStoreButtons(prices, affordable, blocked));
}

function paintStoreButtons(prices, affordable, blocked) {
  for (const btn of STORE_BUTTONS) {
    const price = prices[btn.id];
    const canBuy = affordable[btn.id];
    const block = blocked ? blocked[btn.id] : null;
    const { accent, icon, label } = STORE_BTN_STYLE[btn.id];

    ctx.save();

    // Pill body: dark base + accent tint, saturated accent border
    ctx.beginPath();
    ctx.roundRect(btn.x, btn.y, btn.w, btn.h, btn.h / 2);
    ctx.fillStyle = 'rgba(10, 14, 30, 0.78)';
    ctx.fill();
    ctx.fillStyle = `rgba(${accent}, ${canBuy ? 0.14 : 0.05})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(${accent}, ${canBuy ? 0.85 : 0.22})`;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Icon chip: rounded square tinted with the accent
    const chip = btn.h - 9;
    const chipX = btn.x + 6;
    const chipY = btn.y + 4.5;
    ctx.beginPath();
    ctx.roundRect(chipX, chipY, chip, chip, 6);
    ctx.fillStyle = `rgba(${accent}, ${canBuy ? 0.28 : 0.1})`;
    ctx.fill();
    drawStoreButtonIcon(btn.id, chipX + chip / 2, chipY + chip / 2,
                        chip, icon, canBuy ? 0.95 : 0.35);

    // Label in the accent color, like the reference pills
    ctx.font = 'bold 12px "Patrick Hand", cursive';
    ctx.fillStyle = `rgba(${accent}, ${canBuy ? 0.95 : 0.35})`;
    ctx.textAlign = 'left';
    ctx.fillText(label, chipX + chip + 6, btn.y + 19);

    // Price, right-aligned and quieter — or why it can't be bought:
    // a bomb/ghost already waiting to drop, or a cup at full height
    ctx.textAlign = 'right';
    ctx.font = '11px "Patrick Hand", cursive';
    if (block === 'queued') {
      ctx.fillStyle = `rgba(${accent}, 0.7)`;
      ctx.fillText('SET', btn.x + btn.w - 10, btn.y + 19);
    } else if (block === 'maxed') {
      ctx.fillStyle = 'rgba(255, 215, 0, 0.6)';
      ctx.fillText('MAX', btn.x + btn.w - 10, btn.y + 19);
    } else {
      ctx.fillStyle = canBuy
        ? 'rgba(255, 255, 255, 0.75)'
        : 'rgba(255, 255, 255, 0.25)';
      ctx.fillText(`${price}`, btn.x + btn.w - 10, btn.y + 19);
    }

    ctx.restore();
  }
}

// ── Store Tooltip ───────────────────────────────────────────────
// Explains what a power-up does before the player commits points.
// Desktop shows it on hover; touch shows it on first tap (with a
// "tap again to buy" hint) so nobody buys blind.

function wrapText(text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawStoreTooltip(itemId, showBuyHint, affordable, blocked) {
  const btn = STORE_BUTTONS.find(b => b.id === itemId);
  const item = STORE_ITEMS.find(i => i.id === itemId);
  if (!btn || !item) return;

  const w = 246;
  const pad = 12;
  const lineH = 16;

  ctx.save();
  ctx.font = '13px "Patrick Hand", cursive';
  const lines = wrapText(item.desc, w - pad * 2);
  const canBuy = affordable && affordable[itemId];
  const block = blocked ? blocked[itemId] : null;
  const hint = block === 'queued' ? 'already loaded — drop it first'
    : block === 'maxed' ? 'cup is as tall as it goes'
    : showBuyHint ? (canBuy ? 'tap again to buy' : 'not enough points yet')
    : null;
  const h = 30 + lines.length * lineH + (hint ? 18 : 6);

  // Anchor under the button, clamped to the canvas
  const x = Math.max(8, Math.min(GAME_WIDTH - w - 8, btn.x + btn.w / 2 - w / 2));
  const y = btn.y + btn.h + 9;

  // Little caret pointing up at the button
  const caretX = btn.x + btn.w / 2;
  ctx.fillStyle = 'rgba(12, 16, 34, 0.94)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(caretX - 7, y);
  ctx.lineTo(caretX, y - 7);
  ctx.lineTo(caretX + 7, y);
  ctx.fill();

  // Panel
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 9);
  ctx.fill();
  ctx.stroke();

  // Re-draw the caret fill over the panel border seam
  ctx.fillStyle = 'rgba(12, 16, 34, 0.94)';
  ctx.beginPath();
  ctx.moveTo(caretX - 6, y + 1);
  ctx.lineTo(caretX, y - 5);
  ctx.lineTo(caretX + 6, y + 1);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
  ctx.beginPath();
  ctx.moveTo(caretX - 7, y);
  ctx.lineTo(caretX, y - 7);
  ctx.lineTo(caretX + 7, y);
  ctx.stroke();

  // Title, led by the same icon the button wears
  const style = STORE_BTN_STYLE[itemId];
  drawStoreButtonIcon(itemId, x + pad + 7, y + 14, 18, style.icon, 1);
  ctx.textAlign = 'left';
  ctx.font = 'bold 14px "Patrick Hand", cursive';
  ctx.fillStyle = `rgba(${style.accent}, 0.95)`;
  ctx.fillText(item.name, x + pad + 20, y + 19);

  // Description
  ctx.font = '13px "Patrick Hand", cursive';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
  lines.forEach((line, i) => {
    ctx.fillText(line, x + pad, y + 37 + i * lineH);
  });

  // Touch hint
  if (hint) {
    ctx.font = '12px "Patrick Hand", cursive';
    ctx.fillStyle = canBuy ? 'rgba(46, 204, 113, 0.85)'
      : block ? 'rgba(200, 210, 230, 0.7)' : 'rgba(255, 190, 90, 0.75)';
    ctx.fillText(hint, x + pad, y + h - 8);
  }

  ctx.restore();
}

export function checkStoreButtonHit(x, y) {
  for (const btn of STORE_BUTTONS) {
    if (x >= btn.x && x <= btn.x + btn.w &&
        y >= btn.y && y <= btn.y + btn.h) {
      return btn.id;
    }
  }
  return null;
}

// ── Color Utilities ─────────────────────────────────────────────
function hexWithAlpha(hex, alpha) {
  const rgb = hexToRgb(hex);
  if (!rgb) return `rgba(200,200,200,${alpha})`;
  return `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha})`;
}

function lightenColor(hex, amount) {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  return `rgb(${Math.min(255, rgb.r + amount)},${Math.min(255, rgb.g + amount)},${Math.min(255, rgb.b + amount)})`;
}

function darkenColor(hex, amount) {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  return `rgb(${Math.max(0, rgb.r - amount)},${Math.max(0, rgb.g - amount)},${Math.max(0, rgb.b - amount)})`;
}

function toHex2(v) {
  return Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
}

// h: 0-360, s/l: 0-100
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h, s: s * 100, l: l * 100 };
}

function hslToRgb(h, s, l) {
  s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (h % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) { r = c; g = x; }
  else if (hp < 2) { r = x; g = c; }
  else if (hp < 3) { g = c; b = x; }
  else if (hp < 4) { g = x; b = c; }
  else if (hp < 5) { r = x; b = c; }
  else { r = c; b = x; }
  const m = l - c / 2;
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16),
  } : null;
}

function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
