// ── Canvas Renderer (Hand-drawn aesthetic + Juice) ──────────────
import {
  GAME_WIDTH, GAME_HEIGHT,
  CUP_LEFT_X, CUP_RIGHT_X, CUP_TOP_Y, CUP_BOTTOM_Y,
  CUP_WALL_THICKNESS, CUP_BASE_EXTRA, DANGER_LINE_Y, DROP_Y,
  BALL_TIERS, INK, LEAF_GREEN,
} from './config.js';
import * as Particles from './particles.js';
import * as Menus from './menus.js';
import * as Skins from './skins.js';
import { STORE_ITEMS } from './store.js';

// Store button layout — positioned in the header area, well above the cup
const STORE_BUTTONS = [
  { id: 'colorBomb', x: 30, y: 130, w: 105, h: 28 },
  { id: 'cupExtend', x: 148, y: 130, w: 105, h: 28 },
  { id: 'ghostBall', x: 265, y: 130, w: 105, h: 28 },
];

let canvas, ctx;
let wobbleSeeds = [];

// Per-ball squish state (keyed by body.id)
const ballSquish = new Map();

// Cached static gradients (built once — cheaper and consistent)
let bgGradient = null;
let spotlightGradient = null;
let vignetteGradient = null;
let feverGlowGradient = null;

// Ambient floating dust motes for atmosphere
const dustMotes = [];
const DUST_COUNT = 22;

export function init(canvasEl) {
  canvas = canvasEl;
  ctx = canvas.getContext('2d');

  for (let i = 0; i < 100; i++) {
    wobbleSeeds.push((Math.random() - 0.5) * 3);
  }

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

  buildStaticGradients();
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

// Rebuild the cached background gradients — call after a skin/theme
// change so the new palette takes effect immediately.
export function applyTheme() {
  buildStaticGradients();
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

function handleResize() {
  const dpr = window.devicePixelRatio || 1;
  const vv = window.visualViewport;
  const maxW = vv ? vv.width : window.innerWidth;
  const maxH = vv ? vv.height : window.innerHeight;

  const aspect = GAME_WIDTH / GAME_HEIGHT;
  let w, h;
  if (maxW / maxH < aspect) {
    w = maxW;
    h = maxW / aspect;
  } else {
    h = maxH;
    w = maxH * aspect;
  }

  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  canvas.width = GAME_WIDTH * dpr;
  canvas.height = GAME_HEIGHT * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// ── Main Render ─────────────────────────────────────────────────
export function render(state) {
  const shake = Particles.getScreenShake();

  // Clear in un-shaken space so big shakes never leave stale pixels
  ctx.clearRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

  ctx.save();
  ctx.translate(shake.x, shake.y);

  drawBackground();

  // Menu screens: background + particles + screen content, no cup
  if (state.gameState === 'menu' || state.gameState === 'shop') {
    Particles.draw(ctx);
    ctx.fillStyle = vignetteGradient;
    ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
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
  ctx.fillStyle = vignetteGradient;
  ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

  if (state.gameState === 'playing') {
    if (!state.hasActiveGhost) {
      drawPreview(state.previewX, state.previewTier, state.isDragging, state.isTouchDevice, state.bombQueued, state.ghostQueued);
      drawDropLine(state.previewX);
    }
  }

  drawScore(state.score, state.bestScore, state.combo);
  drawModeStatus(state);
  if (state.fever) drawFeverMeter(state.fever, cupExt);
  drawMuteButton(state.muted);

  if (state.gameState === 'playing') {
    drawStoreButtons(state.storePrices, state.storeAffordable);
    if (state.storeTooltip) {
      drawStoreTooltip(state.storeTooltip, state.storeTooltipHint, state.storeAffordable);
    }
  }

  if (state.gameState === 'gameover') {
    drawGameOver(state);
    Menus.drawGameOverExtras(ctx, state);
  }

  ctx.restore();
}

// ── Background ──────────────────────────────────────────────────
function drawBackground() {
  ctx.fillStyle = bgGradient;
  ctx.fillRect(-30, -30, GAME_WIDTH + 60, GAME_HEIGHT + 60);

  ctx.fillStyle = spotlightGradient;
  ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

  // Slow-drifting dust motes give the scene depth and life
  const t = performance.now() * 0.001;
  for (const m of dustMotes) {
    m.y -= m.speed;
    m.x += m.drift + Math.sin(t + m.phase) * 0.08;
    if (m.y < -4) { m.y = GAME_HEIGHT + 4; m.x = Math.random() * GAME_WIDTH; }
    if (m.x < -4) m.x = GAME_WIDTH + 4;
    if (m.x > GAME_WIDTH + 4) m.x = -4;

    const twinkle = 0.7 + Math.sin(t * 1.5 + m.phase) * 0.3;
    ctx.globalAlpha = m.alpha * twinkle;
    ctx.fillStyle = '#cfe0ff';
    ctx.beginPath();
    ctx.arc(m.x, m.y, m.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// ── Danger Zone (red glow when approaching game over) ───────────
function drawDangerZone(dangerLevel, cupExt) {
  if (dangerLevel <= 0) return;

  const effectiveTopY = CUP_TOP_Y - (cupExt || 0);
  const pulse = Math.sin(performance.now() * 0.008) * 0.3 + 0.7;
  const alpha = dangerLevel * 0.25 * pulse;

  // Red vignette at top of cup
  const grad = ctx.createLinearGradient(0, effectiveTopY - 40, 0, effectiveTopY + 80);
  grad.addColorStop(0, `rgba(231, 76, 60, ${alpha})`);
  grad.addColorStop(1, 'rgba(231, 76, 60, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(CUP_LEFT_X - 10, effectiveTopY - 40, CUP_RIGHT_X - CUP_LEFT_X + 20, 120);

  // Side edge glow
  const edgeAlpha = dangerLevel * 0.15 * pulse;
  ctx.fillStyle = `rgba(231, 76, 60, ${edgeAlpha})`;
  ctx.fillRect(0, 0, GAME_WIDTH, 8);
}

// ── Cup ─────────────────────────────────────────────────────────
function drawCup(cupExt) {
  ctx.save();

  // Walls flare outward: the base sits CUP_BASE_EXTRA wider per side
  const effectiveTopY = CUP_TOP_Y - (cupExt || 0);
  const leftTop = { x: CUP_LEFT_X, y: effectiveTopY - 20 };
  const leftBot = { x: CUP_LEFT_X - CUP_BASE_EXTRA, y: CUP_BOTTOM_Y };
  const rightBot = { x: CUP_RIGHT_X + CUP_BASE_EXTRA, y: CUP_BOTTOM_Y };
  const rightTop = { x: CUP_RIGHT_X, y: effectiveTopY - 20 };

  // Outer glow
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = CUP_WALL_THICKNESS + 12;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(leftTop.x, leftTop.y);
  ctx.lineTo(leftBot.x, leftBot.y);
  ctx.lineTo(rightBot.x, rightBot.y);
  ctx.lineTo(rightTop.x, rightTop.y);
  ctx.stroke();

  // Inner glow
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = CUP_WALL_THICKNESS + 6;
  ctx.beginPath();
  ctx.moveTo(leftTop.x, leftTop.y);
  ctx.lineTo(leftBot.x, leftBot.y);
  ctx.lineTo(rightBot.x, rightBot.y);
  ctx.lineTo(rightTop.x, rightTop.y);
  ctx.stroke();

  // Main walls (wobbly)
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = CUP_WALL_THICKNESS;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  drawWobblyLine(leftTop.x, leftTop.y, leftBot.x, leftBot.y, 0);
  drawWobblyLine(leftBot.x, leftBot.y, rightBot.x, rightBot.y, 20);
  drawWobblyLine(rightBot.x, rightBot.y, rightTop.x, rightTop.y, 40);

  // Highlight edge (thin bright line on inside)
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(leftTop.x + CUP_WALL_THICKNESS / 2, leftTop.y);
  ctx.lineTo(leftBot.x + CUP_WALL_THICKNESS / 2, leftBot.y - 2);
  ctx.lineTo(rightBot.x - CUP_WALL_THICKNESS / 2, rightBot.y - 2);
  ctx.lineTo(rightTop.x - CUP_WALL_THICKNESS / 2, rightTop.y);
  ctx.stroke();

  ctx.restore();
}

function drawWobblyLine(x1, y1, x2, y2, seedOffset) {
  const segments = 12;
  ctx.beginPath();
  ctx.moveTo(x1 + wobbleSeeds[seedOffset] * 0.5, y1);

  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    const x = x1 + (x2 - x1) * t + wobbleSeeds[(seedOffset + i) % 100] * 0.8;
    const y = y1 + (y2 - y1) * t + wobbleSeeds[(seedOffset + i + 5) % 100] * 0.8;
    ctx.lineTo(x, y);
  }
  ctx.stroke();
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
function drawDropLine(x) {
  ctx.save();
  const grad = ctx.createLinearGradient(0, DROP_Y + 20, 0, CUP_BOTTOM_Y);
  grad.addColorStop(0, 'rgba(255,255,255,0.12)');
  grad.addColorStop(1, 'rgba(255,255,255,0.02)');
  ctx.setLineDash([4, 8]);
  ctx.strokeStyle = grad;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, DROP_Y + 20);
  ctx.lineTo(x, CUP_BOTTOM_Y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

// ── Balls ───────────────────────────────────────────────────────
function drawBalls(ballMap, gameState) {
  // Sort by y position so lower balls draw on top (depth feel)
  const sorted = [...ballMap.values()].sort((a, b) => a.body.position.y - b.body.position.y);

  // Pass 1: soft contact shadows under every solid ball
  for (const entry of sorted) {
    if (entry.isGhost) continue;
    const r = entry.isBomb ? 16 : BALL_TIERS[entry.tierIndex].radius;
    drawBallShadow(entry.body, r);
  }

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
}

function drawBallShadow(body, r) {
  const { x, y } = body.position;
  ctx.save();
  ctx.fillStyle = 'rgba(4, 4, 18, 0.22)';
  ctx.beginPath();
  ctx.ellipse(x, y + r * 0.85, r * 0.82, r * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
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
    sq.spawnProgress = Math.min(sq.spawnProgress + 0.08, 1);
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

    // Damped spring: overshoots past rest into a stretch, then settles —
    // that overshoot IS the jelly wobble. Gooier balls = looser spring.
    const stiffness = tierIndex <= 3 ? 0.145 + tierIndex * 0.018 : 0.20;
    const damping = tierIndex <= 3 ? 0.80 : 0.72;
    sq.squashVel += -sq.squash * stiffness;
    sq.squashVel *= damping;
    sq.squash += sq.squashVel;

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
  if (tier.name === 'rainbow') {
    drawRainbowBall(r);
  } else if (tier.name === 'dragonfruit') {
    drawDragonfruitBall(r);
  } else {
    const style = Skins.getTierStyle(tierIndex);
    drawSolidBall(r, style.color, style.stroke, tierIndex, body.id);
  }

  ctx.restore();
}

// ── Bomb Ball ───────────────────────────────────────────────────
function drawBombBall(body) {
  const { x, y } = body.position;
  const r = 16;
  const sq = getSquishState(body);

  if (sq.spawnProgress < 1) {
    sq.spawnProgress = Math.min(sq.spawnProgress + 0.08, 1);
    const t = easeOutBack(sq.spawnProgress);
    sq.scaleX = t;
    sq.scaleY = t;
  } else {
    sq.scaleX += (1 - sq.scaleX) * 0.15;
    sq.scaleY += (1 - sq.scaleY) * 0.15;
  }

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(body.angle);
  ctx.scale(sq.scaleX, sq.scaleY);

  drawBombVisual(r);

  ctx.restore();
}

function drawBombVisual(r) {
  const time = performance.now() * 0.003;

  // Pulsing outer glow
  const pulseR = r * (1.8 + Math.sin(time * 2) * 0.3);
  const glow = ctx.createRadialGradient(0, 0, r * 0.3, 0, 0, pulseR);
  glow.addColorStop(0, 'rgba(255, 60, 60, 0.4)');
  glow.addColorStop(0.5, 'rgba(200, 40, 200, 0.15)');
  glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, pulseR, 0, Math.PI * 2);
  ctx.fill();

  // Dark core — flat, doodle-style
  ctx.fillStyle = '#20242e';
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();

  // Red/magenta ring
  const ringAlpha = 0.6 + Math.sin(time * 3) * 0.2;
  ctx.strokeStyle = `rgba(255, 50, 100, ${ringAlpha})`;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();

  // Inner crosshair / target symbol
  ctx.strokeStyle = `rgba(255, 80, 80, ${0.5 + Math.sin(time * 4) * 0.2})`;
  ctx.lineWidth = 1.5;
  const cr = r * 0.5;
  ctx.beginPath();
  ctx.moveTo(-cr, 0); ctx.lineTo(cr, 0);
  ctx.moveTo(0, -cr); ctx.lineTo(0, cr);
  ctx.stroke();

  // Tiny inner ring
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.35, 0, Math.PI * 2);
  ctx.stroke();

  // Shine tick
  ctx.strokeStyle = 'rgba(255, 180, 180, 0.6)';
  ctx.lineCap = 'round';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.68, -2.4, -1.9);
  ctx.stroke();
}

// ── Ghost Ball ─────────────────────────────────────────────────
function drawGhostBall(body, tierIndex) {
  const tier = BALL_TIERS[tierIndex];
  const style = Skins.getTierStyle(tierIndex);
  const { x, y } = body.position;
  const r = tier.radius;
  const sq = getSquishState(body);

  if (sq.spawnProgress < 1) {
    sq.spawnProgress = Math.min(sq.spawnProgress + 0.08, 1);
    const t = easeOutBack(sq.spawnProgress);
    sq.scaleX = t;
    sq.scaleY = t;
  } else {
    sq.scaleX += (1 - sq.scaleX) * 0.15;
    sq.scaleY += (1 - sq.scaleY) * 0.15;
  }

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

// Clean up squish states for removed balls
export function cleanupSquishStates(activeBallIds) {
  for (const id of ballSquish.keys()) {
    if (!activeBallIds.has(id)) {
      ballSquish.delete(id);
      ballHighlightCache.delete(id);
    }
  }
}

// ── Seeded random for per-ball highlight variation ──────────────
const ballHighlightCache = new Map();
function getBallHighlights(ballId) {
  if (ballHighlightCache.has(ballId)) return ballHighlightCache.get(ballId);
  // Generate unique highlight parameters for this ball
  const h = {
    // Primary highlight offset and shape
    primaryX: -0.15 + (pseudoRand(ballId * 7) - 0.5) * 0.2,
    primaryY: -0.25 + (pseudoRand(ballId * 13) - 0.5) * 0.15,
    primaryW: 0.35 + (pseudoRand(ballId * 19) - 0.5) * 0.15,
    primaryH: 0.18 + (pseudoRand(ballId * 23) - 0.5) * 0.1,
    primaryAngle: -0.5 + (pseudoRand(ballId * 29) - 0.5) * 0.8,
    primaryAlpha: 0.2 + pseudoRand(ballId * 31) * 0.12,
    // Secondary highlight (sharp dot)
    dotX: -0.12 + (pseudoRand(ballId * 37) - 0.5) * 0.25,
    dotY: -0.38 + (pseudoRand(ballId * 41) - 0.5) * 0.15,
    dotSize: 0.06 + pseudoRand(ballId * 43) * 0.06,
    dotAlpha: 0.35 + pseudoRand(ballId * 47) * 0.3,
    // Shadow crescent
    shadowX: 0.03 + (pseudoRand(ballId * 53) - 0.5) * 0.1,
    shadowY: 0.32 + (pseudoRand(ballId * 59) - 0.5) * 0.1,
    shadowAngle: 0.2 + (pseudoRand(ballId * 61) - 0.5) * 0.4,
  };
  ballHighlightCache.set(ballId, h);
  return h;
}

function pseudoRand(seed) {
  // Simple hash → 0-1 float
  let x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

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
  const t = Math.floor(performance.now() / 125) * 0.15;
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

// Flat comic-style shine: a curved white tick following the rim plus a
// dot beside it, jittered per ball so no two fruits gleam identically.
function drawShineTicks(r, ballId) {
  const hl = ballId != null ? getBallHighlights(ballId)
    : { primaryX: -0.2, primaryY: -0.28, primaryAngle: -0.5 };
  const a0 = Math.atan2(hl.primaryY, hl.primaryX) + hl.primaryAngle * 0.2;
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineCap = 'round';
  ctx.lineWidth = outlineWidth(r) * 0.8;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.68, a0 - 0.35, a0 + 0.25);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  const da = a0 + 0.55;
  ctx.beginPath();
  ctx.arc(Math.cos(da) * r * 0.66, Math.sin(da) * r * 0.66, outlineWidth(r) * 0.42, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ── Solid Ball (fruit-themed) ───────────────────────────────────
// Flat sticker-art doodle: flat fill, offset lighter tint patch as the
// only shading, then details tucked under a uniform ink outline.
function drawSolidBall(r, fill, stroke, tierIndex, ballId) {
  const seed = ballId != null ? ballId : 7;
  const wobbleAmt = 0.02 + tierIndex * 0.0012;
  const body = wobblyCirclePath(0, 0, r, seed, wobbleAmt);

  // Flat fill — no gradients anywhere in this style
  ctx.fillStyle = fill;
  ctx.fill(body);

  // Offset tint patch — the misregistered-print shading from the
  // reference art: a lighter wobbly blob pushed up-left, clipped inside
  const ox = -r * (0.24 + pseudoRand(seed * 3) * 0.1);
  const oy = -r * (0.26 + pseudoRand(seed * 5) * 0.1);
  ctx.save();
  ctx.clip(body);
  ctx.fillStyle = lightenColor(fill, 32);
  ctx.fill(wobblyCirclePath(ox, oy, r * 0.78, seed + 11, 0.05));
  ctx.restore();

  // Skin texture goes under the outline so pores/stripes tuck beneath it.
  // Non-fruit skins swap the stems/stripes for their own detail pass.
  const detailMode = Skins.getDetailMode();
  if (detailMode === 'fruit') {
    drawFruitSkin(tierIndex, r, ballId);
  } else if (detailMode === 'gloss') {
    drawCandyGloss(r);
  }

  // Uniform ink outline
  ctx.strokeStyle = INK;
  ctx.lineJoin = 'round';
  ctx.lineWidth = outlineWidth(r);
  ctx.stroke(body);

  drawShineTicks(r, ballId);

  // Stems, leaves, and crowns sit on top (and may poke past the edge)
  if (detailMode === 'fruit') {
    drawFruitTopper(tierIndex, r);
  }
}

// Generic sheen for non-fruit skins — a curved candy shine band so
// palette-swapped balls don't read as flat.
function drawCandyGloss(r) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.97, 0, Math.PI * 2);
  ctx.clip();
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.lineWidth = r * 0.16;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.62, -2.4, -1.15);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.lineWidth = r * 0.07;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.8, -0.95, -0.5);
  ctx.stroke();
  ctx.restore();
}

// ── Fruit Details ───────────────────────────────────────────────
// Cartoony fruit dressing layered onto the squishy ball base.
// Everything is drawn in ball-local space, so it squishes, spins,
// and wobbles along with the ball — that's the charm.

function drawFruitSkin(tierIndex, r, ballId) {
  const name = BALL_TIERS[tierIndex].name;
  const seed = (ballId != null ? ballId : 7) * 101;

  ctx.save();
  // Keep skin texture inside the ball body
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.97, 0, Math.PI * 2);
  ctx.clip();

  switch (name) {
    case 'coconut': {
      // Sparse husk hatching — a few short curved ink strokes
      ctx.strokeStyle = hexWithAlpha(INK, 0.35);
      ctx.lineCap = 'round';
      ctx.lineWidth = r * 0.05;
      for (let i = 0; i < 6; i++) {
        const a = pseudoRand(seed + i * 3) * Math.PI * 2;
        const d = (0.2 + pseudoRand(seed + i * 5) * 0.6) * r;
        const x = Math.cos(a) * d;
        const y = Math.sin(a) * d;
        const len = r * (0.16 + pseudoRand(seed + i * 7) * 0.18);
        const tilt = pseudoRand(seed + i * 11) * Math.PI;
        ctx.beginPath();
        ctx.moveTo(x - Math.cos(tilt) * len, y - Math.sin(tilt) * len);
        ctx.quadraticCurveTo(x + Math.sin(tilt) * len * 0.4, y - Math.cos(tilt) * len * 0.4,
                             x + Math.cos(tilt) * len, y + Math.sin(tilt) * len);
        ctx.stroke();
      }
      break;
    }
    case 'peach': {
      // Suture crease — the classic peach cleft down the cheek
      ctx.strokeStyle = hexWithAlpha(INK, 0.4);
      ctx.lineWidth = r * 0.06;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(r * 0.05, -r * 0.9);
      ctx.quadraticCurveTo(r * 0.42, 0, r * 0.05, r * 0.9);
      ctx.stroke();
      // Soft pink blush on the sun-kissed side
      ctx.fillStyle = 'rgba(240, 100, 130, 0.4)';
      ctx.beginPath();
      ctx.ellipse(-r * 0.3, r * 0.18, r * 0.42, r * 0.32, -0.35, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'apple': {
      // Faint darker streaks arcing pole to pole, like real apple skin
      ctx.strokeStyle = 'rgba(120, 20, 35, 0.3)';
      ctx.lineCap = 'round';
      ctx.lineWidth = r * 0.055;
      for (const lon of [-0.5, -0.15, 0.28]) {
        ctx.beginPath();
        ctx.moveTo(lon * r * 1.3, -r * 0.75);
        ctx.quadraticCurveTo(lon * r * 2, 0, lon * r * 1.3, r * 0.75);
        ctx.stroke();
      }
      // Pale freckle lenticels
      ctx.fillStyle = 'rgba(255, 220, 200, 0.35)';
      for (let i = 0; i < 6; i++) {
        const a = pseudoRand(seed + i * 3) * Math.PI * 2;
        const d = Math.sqrt(pseudoRand(seed + i * 5)) * r * 0.8;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * d, Math.sin(a) * d, r * 0.03, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'lemon': {
      // Dimpled peel — plain ink pore dots
      ctx.fillStyle = hexWithAlpha(INK, 0.55);
      for (let i = 0; i < 8; i++) {
        const a = pseudoRand(seed + i * 3) * Math.PI * 2;
        const d = Math.sqrt(pseudoRand(seed + i * 5)) * r * 0.85;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * d, Math.sin(a) * d, r * 0.035, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'orange': {
      // Rind pores — ink dots, varied in size
      ctx.fillStyle = hexWithAlpha(INK, 0.45);
      for (let i = 0; i < 10; i++) {
        const a = pseudoRand(seed + i * 3) * Math.PI * 2;
        const d = Math.sqrt(pseudoRand(seed + i * 5)) * r * 0.85;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * d, Math.sin(a) * d,
                r * (0.025 + pseudoRand(seed + i * 7) * 0.02), 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'watermelon': {
      // Dark wavy rind stripes converging at the poles — flat solid
      ctx.strokeStyle = '#14503a';
      ctx.lineCap = 'round';
      for (const lon of [-0.62, -0.21, 0.21, 0.62]) {
        ctx.lineWidth = r * (0.15 - Math.abs(lon) * 0.05);
        ctx.beginPath();
        const steps = 14;
        for (let s = 0; s <= steps; s++) {
          const t = (s / steps) * 2 - 1;                 // -1 top pole → 1 bottom
          const bulge = Math.sqrt(Math.max(1 - t * t, 0));
          const wave = Math.sin(t * 7 + lon * 20) * r * 0.045;
          const x = (lon * r * 1.35 + wave) * bulge;
          const y = t * r * 0.96;
          if (s === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      // Ink teardrop seeds scattered on the light bands
      ctx.fillStyle = hexWithAlpha(INK, 0.85);
      const seedLons = [-0.42, 0, 0, 0.42];
      for (let i = 0; i < 4; i++) {
        const t0 = -0.55 + pseudoRand(seed + i * 17) * 1.1;
        const bulge = Math.sqrt(Math.max(1 - t0 * t0, 0));
        ctx.save();
        ctx.translate(seedLons[i] * r * 1.35 * bulge, t0 * r * 0.96);
        ctx.rotate(pseudoRand(seed + i * 23) * Math.PI);
        ctx.beginPath();
        ctx.ellipse(0, 0, r * 0.03, r * 0.05, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      break;
    }
    case 'blueberry': {
      // A few flat pale bloom dots (the tint patch is the frost)
      ctx.fillStyle = 'rgba(220, 232, 255, 0.5)';
      for (let i = 0; i < 3; i++) {
        const a = pseudoRand(seed + i * 3) * Math.PI * 2;
        const d = Math.sqrt(pseudoRand(seed + i * 5)) * r * 0.7;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * d, Math.sin(a) * d, r * 0.045, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'grape': {
      // Thin ink crescent along the lower-right rim suggests roundness
      ctx.strokeStyle = hexWithAlpha(INK, 0.3);
      ctx.lineWidth = r * 0.05;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.8, 0.4, 1.5);
      ctx.stroke();
      break;
    }
    case 'plum': {
      // Flat blush patch on one cheek
      ctx.fillStyle = 'rgba(220, 90, 110, 0.35)';
      ctx.beginPath();
      ctx.ellipse(r * 0.35, r * 0.15, r * 0.4, r * 0.3, 0.3, 0, Math.PI * 2);
      ctx.fill();
      // Cleft crease from pole to pole
      ctx.strokeStyle = hexWithAlpha(INK, 0.45);
      ctx.lineWidth = r * 0.06;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-r * 0.06, -r * 0.94);
      ctx.quadraticCurveTo(-r * 0.42, 0, -r * 0.06, r * 0.94);
      ctx.stroke();
      break;
    }
  }
  ctx.restore();
}

function drawFruitTopper(tierIndex, r) {
  const name = BALL_TIERS[tierIndex].name;

  switch (name) {
    case 'coconut': {
      // The three classic coconut "eyes" — plain ink dots
      ctx.fillStyle = hexWithAlpha(INK, 0.9);
      for (const e of [{ x: -0.16, y: -0.48 }, { x: 0.16, y: -0.48 }, { x: 0, y: -0.24 }]) {
        ctx.beginPath();
        ctx.ellipse(e.x * r, e.y * r, r * 0.09, r * 0.11, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'peach': {
      // Stem dimple + short ink stem
      ctx.fillStyle = hexWithAlpha(INK, 0.4);
      ctx.beginPath();
      ctx.ellipse(0, -r * 0.84, r * 0.13, r * 0.07, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = r * 0.09;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.86);
      ctx.lineTo(r * 0.06, -r * 1.1);
      ctx.stroke();
      // Two flat teal leaves splaying opposite ways
      for (const side of [-1, 1]) {
        ctx.save();
        ctx.translate(side * r * 0.26, -r * 1.04);
        ctx.rotate(side * 0.85);
        ctx.fillStyle = LEAF_GREEN;
        ctx.strokeStyle = INK;
        ctx.lineWidth = outlineWidth(r) * 0.5;
        ctx.beginPath();
        ctx.ellipse(0, 0, r * 0.2, r * 0.1, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
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
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.82);
      ctx.quadraticCurveTo(r * 0.03, -r * 1.05, r * 0.12, -r * 1.18);
      ctx.stroke();
      // Flat teal leaf with a center vein
      ctx.save();
      ctx.translate(r * 0.32, -r * 1.08);
      ctx.rotate(0.55);
      ctx.fillStyle = LEAF_GREEN;
      ctx.strokeStyle = INK;
      ctx.lineWidth = outlineWidth(r) * 0.55;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.24, r * 0.12, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.lineWidth = Math.max(0.8, r * 0.03);
      ctx.beginPath();
      ctx.moveTo(-r * 0.19, 0);
      ctx.lineTo(r * 0.19, 0);
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 'lemon': {
      // The two signature lemon nubs — stem end up top, nipple below
      ctx.fillStyle = '#DCBE2A';
      ctx.strokeStyle = INK;
      ctx.lineWidth = outlineWidth(r) * 0.6;
      ctx.beginPath();
      ctx.ellipse(0, -r * 0.97, r * 0.16, r * 0.12, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(0, r * 0.97, r * 0.12, r * 0.1, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // Ink stem dot on the top nub
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.ellipse(0, -r * 1.02, r * 0.05, r * 0.04, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'orange': {
      // Ink stem stub + flat teal leaf with a center vein
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.ellipse(0, -r * 0.93, r * 0.08, r * 0.06, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.save();
      ctx.translate(r * 0.24, -r * 0.98);
      ctx.rotate(0.35);
      ctx.fillStyle = LEAF_GREEN;
      ctx.strokeStyle = INK;
      ctx.lineWidth = outlineWidth(r) * 0.55;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.24, r * 0.11, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.lineWidth = Math.max(0.8, r * 0.03);
      ctx.beginPath();
      ctx.moveTo(-r * 0.2, 0);
      ctx.lineTo(r * 0.2, 0);
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 'watermelon': {
      // Curly ink stem
      ctx.strokeStyle = INK;
      ctx.lineWidth = r * 0.07;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.92);
      ctx.quadraticCurveTo(r * 0.1, -r * 1.12, r * 0.24, -r * 1.08);
      ctx.stroke();
      break;
    }
    case 'blueberry': {
      // Star-shaped calyx crown — solid ink
      ctx.save();
      ctx.translate(0, -r * 0.52);
      ctx.fillStyle = hexWithAlpha(INK, 0.9);
      ctx.beginPath();
      const spikes = 5;
      for (let i = 0; i < spikes * 2; i++) {
        const a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
        const rad = (i % 2 === 0 ? 0.2 : 0.09) * r;
        ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad * 0.7);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      break;
    }
    case 'grape': {
      // Woody stem nub — ink
      ctx.strokeStyle = INK;
      ctx.lineWidth = r * 0.07;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.9);
      ctx.lineTo(r * 0.06, -r * 1.08);
      ctx.stroke();
      break;
    }
    case 'plum': {
      // Stem sunk into the top dimple — ink
      ctx.strokeStyle = INK;
      ctx.lineWidth = r * 0.06;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-r * 0.06, -r * 0.88);
      ctx.lineTo(-r * 0.02, -r * 1.06);
      ctx.stroke();
      break;
    }
  }
}

// ── Dragon Fruit Ball (tier 8 — vivid pink, green-tipped scales) ─
function drawDragonfruitBall(r) {
  const body = wobblyCirclePath(0, 0, r, 8, 0.022);

  // Flat pink body + offset tint patch, same recipe as the fruits
  ctx.fillStyle = '#E44D8D';
  ctx.fill(body);
  ctx.save();
  ctx.clip(body);
  ctx.fillStyle = lightenColor('#E44D8D', 32);
  ctx.fill(wobblyCirclePath(-r * 0.26, -r * 0.28, r * 0.78, 19, 0.05));
  ctx.restore();

  // Uniform ink outline
  ctx.strokeStyle = INK;
  ctx.lineJoin = 'round';
  ctx.lineWidth = outlineWidth(r);
  ctx.stroke(body);

  // Leathery scale flaps — flat pink with flat green tips. Outer ones
  // poke just past the silhouette like the real fruit.
  const scales = [
    { a: -1.95, d: 0.55, s: 1.0 },
    { a: -1.1,  d: 0.72, s: 0.85 },
    { a: -0.3,  d: 0.5,  s: 1.1 },
    { a: 0.6,   d: 0.68, s: 0.9 },
    { a: 1.5,   d: 0.55, s: 1.05 },
    { a: 2.4,   d: 0.7,  s: 0.8 },
    { a: 3.0,   d: 0.45, s: 0.95 },
    { a: 0.2,   d: 0.12, s: 0.9 },
  ];
  for (const sc of scales) {
    drawDragonfruitScale(
      Math.cos(sc.a) * r * sc.d,
      Math.sin(sc.a) * r * sc.d,
      r * 0.34 * sc.s,
      sc.a
    );
  }

  drawShineTicks(r, 8);
}

// One curved leaf flap, pointing outward along `angle`
function drawDragonfruitScale(x, y, len, angle) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  const flap = new Path2D();
  flap.moveTo(-len * 0.25, 0);
  flap.quadraticCurveTo(len * 0.3, -len * 0.38, len, 0);
  flap.quadraticCurveTo(len * 0.3, len * 0.38, -len * 0.25, 0);
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
  ctx.lineTo(len * 0.5, 0);
  ctx.stroke();
  ctx.restore();
}

// ── Rainbow Ball ────────────────────────────────────────────────
function drawRainbowBall(r) {
  const time = performance.now() * 0.001;

  // Animated rainbow conic gradient — the goal fruit keeps its magic,
  // framed in the same wobbly ink outline as everything else
  const grad = ctx.createConicGradient(time * 1.5, 0, 0);
  const colors = ['#E8394F', '#F5921E', '#F7D14E', '#2ECC71', '#5578DE', '#7D3C98', '#A569BD', '#E8394F'];
  for (let i = 0; i < colors.length; i++) {
    grad.addColorStop(i / (colors.length - 1), colors[i]);
  }

  const body = wobblyCirclePath(0, 0, r, 9, 0.02);
  ctx.fillStyle = grad;
  ctx.fill(body);

  // Rotating star — flat white with a thin ink outline
  ctx.save();
  ctx.rotate(time * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.strokeStyle = INK;
  ctx.lineJoin = 'round';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const outerR = r * 0.5;
    const innerR = r * 0.2;
    ctx.lineTo(Math.cos(a) * outerR, Math.sin(a) * outerR);
    const midA = a + Math.PI / 6;
    ctx.lineTo(Math.cos(midA) * innerR, Math.sin(midA) * innerR);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // Ink rim
  ctx.strokeStyle = INK;
  ctx.lineJoin = 'round';
  ctx.lineWidth = outlineWidth(r);
  ctx.stroke(body);

  drawShineTicks(r, 9);
}

// ── Preview Ball ────────────────────────────────────────────────
function drawPreview(x, tierIndex, isDragging, isTouchDevice, bombQueued, ghostQueued) {
  const y = DROP_Y;

  // On touch: show bigger, more visible preview while dragging
  const baseAlpha = isDragging ? 0.7 : 0.45;
  const pulse = Math.sin(performance.now() * 0.005) * 0.1;
  const scale = isDragging ? 1.05 : 1;

  ctx.save();
  ctx.globalAlpha = baseAlpha + pulse;
  ctx.translate(x, y);
  ctx.scale(scale, scale);

  if (bombQueued) {
    drawBombVisual(16);
  } else if (ghostQueued) {
    // Ghostly preview — same ball but more transparent with dashed outline
    const tier = BALL_TIERS[tierIndex];
    const style = Skins.getTierStyle(tierIndex);
    ctx.globalAlpha = 0.25 + Math.sin(performance.now() * 0.006) * 0.1;
    drawSolidBall(tier.radius, style.color, style.stroke, tierIndex);
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(200,220,255,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, tier.radius + 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  } else {
    const tier = BALL_TIERS[tierIndex];
    if (tier.color === 'rainbow') {
      drawRainbowBall(tier.radius);
    } else if (tier.name === 'dragonfruit') {
      drawDragonfruitBall(tier.radius);
    } else {
      const style = Skins.getTierStyle(tierIndex);
      drawSolidBall(tier.radius, style.color, style.stroke, tierIndex);
    }
  }

  ctx.restore();

  // Touch: draw drag indicator ring
  const previewR = bombQueued ? 16 : BALL_TIERS[tierIndex].radius;
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

// ── Score Display ───────────────────────────────────────────────
function drawScore(score, bestScore, combo) {
  ctx.save();
  ctx.textAlign = 'center';

  // Title
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

// Warm pulsing wash over the scene while frenzy is running
function drawFeverOverlay() {
  const pulse = 0.75 + Math.sin(performance.now() * 0.006) * 0.25;
  ctx.save();
  ctx.globalAlpha = pulse;
  ctx.fillStyle = feverGlowGradient;
  ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

  // Thin golden border glow
  ctx.globalAlpha = 0.35 * pulse;
  ctx.strokeStyle = '#FFC93C';
  ctx.lineWidth = 5;
  ctx.strokeRect(2, 2, GAME_WIDTH - 4, GAME_HEIGHT - 4);
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
    ctx.restore();
  }
}

// ── Decorative Ball (title screen etc.) ─────────────────────────
// Draws a bobbing squishy fruit at an arbitrary position/size — used
// by menus.js so it never has to duplicate the fruit art.
export function drawDecorBall(x, y, r, tierIndex, seed = 1) {
  const t = performance.now() * 0.001;
  const bob = Math.sin(t * 1.2 + seed * 2.1) * 4;
  const tilt = Math.sin(t * 0.8 + seed * 3.7) * 0.08;
  const tier = BALL_TIERS[tierIndex];

  ctx.save();
  ctx.translate(x, y + bob);
  ctx.rotate(tilt);
  if (tier.name === 'rainbow') {
    drawRainbowBall(r);
  } else if (tier.name === 'dragonfruit') {
    drawDragonfruitBall(r);
  } else {
    const style = Skins.getTierStyle(tierIndex);
    drawSolidBall(r, style.color, style.stroke, tierIndex, seed);
  }
  ctx.restore();
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
    ctx.font = 'bold 42px "Patrick Hand", cursive';
    ctx.fillStyle = `hsl(${(time * 60) % 360}, 85%, 65%)`;
    ctx.fillText('RAINBOW!', cx, cy - 80);

    ctx.font = '24px "Patrick Hand", cursive';
    ctx.fillStyle = '#FFD700';
    ctx.fillText('You did it!', cx, cy - 44);
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
    ctx.fillText(`Best Combo: ${bestCombo.toLocaleString()}`, cx, cy + 62);
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
function drawStoreButtons(prices, affordable) {
  if (!prices) return;

  for (const btn of STORE_BUTTONS) {
    const price = prices[btn.id];
    const canBuy = affordable[btn.id];

    ctx.save();

    // Button background
    const bgAlpha = canBuy ? 0.18 : 0.08;
    const borderAlpha = canBuy ? 0.4 : 0.15;
    ctx.fillStyle = canBuy
      ? `rgba(46, 204, 113, ${bgAlpha})`
      : `rgba(255, 255, 255, ${bgAlpha})`;
    ctx.strokeStyle = canBuy
      ? `rgba(46, 204, 113, ${borderAlpha})`
      : `rgba(255, 255, 255, ${borderAlpha})`;
    ctx.lineWidth = 1.5;

    // Rounded rect
    const r = 6;
    ctx.beginPath();
    ctx.moveTo(btn.x + r, btn.y);
    ctx.lineTo(btn.x + btn.w - r, btn.y);
    ctx.quadraticCurveTo(btn.x + btn.w, btn.y, btn.x + btn.w, btn.y + r);
    ctx.lineTo(btn.x + btn.w, btn.y + btn.h - r);
    ctx.quadraticCurveTo(btn.x + btn.w, btn.y + btn.h, btn.x + btn.w - r, btn.y + btn.h);
    ctx.lineTo(btn.x + r, btn.y + btn.h);
    ctx.quadraticCurveTo(btn.x, btn.y + btn.h, btn.x, btn.y + btn.h - r);
    ctx.lineTo(btn.x, btn.y + r);
    ctx.quadraticCurveTo(btn.x, btn.y, btn.x + r, btn.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Label
    const label = btn.id === 'colorBomb' ? '\u25C9 BOMB'
                : btn.id === 'cupExtend' ? '\u2B06 CUP+'
                : '\u25C7 GHOST';
    const textAlpha = canBuy ? 0.85 : 0.35;
    ctx.font = 'bold 11px "Patrick Hand", cursive';
    ctx.fillStyle = `rgba(255, 255, 255, ${textAlpha})`;
    ctx.textAlign = 'left';
    ctx.fillText(label, btn.x + 6, btn.y + 20);

    // Price
    ctx.textAlign = 'right';
    ctx.font = '11px "Patrick Hand", cursive';
    ctx.fillStyle = canBuy
      ? `rgba(46, 204, 113, ${textAlpha})`
      : `rgba(255, 255, 255, ${textAlpha * 0.7})`;
    ctx.fillText(`${price}`, btn.x + btn.w - 6, btn.y + 20);

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

function drawStoreTooltip(itemId, showBuyHint, affordable) {
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
  const hint = showBuyHint
    ? (canBuy ? 'tap again to buy' : 'not enough points yet')
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

  // Title
  ctx.textAlign = 'left';
  ctx.font = 'bold 14px "Patrick Hand", cursive';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.fillText(`${item.icon} ${item.name}`, x + pad, y + 19);

  // Description
  ctx.font = '13px "Patrick Hand", cursive';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
  lines.forEach((line, i) => {
    ctx.fillText(line, x + pad, y + 37 + i * lineH);
  });

  // Touch hint
  if (hint) {
    ctx.font = '12px "Patrick Hand", cursive';
    ctx.fillStyle = canBuy ? 'rgba(46, 204, 113, 0.85)' : 'rgba(255, 190, 90, 0.75)';
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
