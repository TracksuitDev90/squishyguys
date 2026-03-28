// ── Canvas Renderer (Hand-drawn aesthetic + Juice) ──────────────
import {
  GAME_WIDTH, GAME_HEIGHT,
  CUP_LEFT_X, CUP_RIGHT_X, CUP_TOP_Y, CUP_BOTTOM_Y,
  CUP_WALL_THICKNESS, DANGER_LINE_Y, DROP_Y,
  BALL_TIERS, SQUISH_FACTOR,
} from './config.js';
import * as Particles from './particles.js';

// Store button layout — positioned in the header area, well above the cup
const STORE_BUTTONS = [
  { id: 'colorBomb', x: 58, y: 96, w: 130, h: 28 },
  { id: 'cupExtend', x: 212, y: 96, w: 130, h: 28 },
];

let canvas, ctx;
let wobbleSeeds = [];

// Per-ball squish state (keyed by body.id)
const ballSquish = new Map();

export function init(canvasEl) {
  canvas = canvasEl;
  ctx = canvas.getContext('2d');

  for (let i = 0; i < 100; i++) {
    wobbleSeeds.push((Math.random() - 0.5) * 3);
  }

  handleResize();
  window.addEventListener('resize', handleResize);
}

function handleResize() {
  const dpr = window.devicePixelRatio || 1;
  const maxW = window.innerWidth;
  const maxH = window.innerHeight;

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

  ctx.save();
  ctx.translate(shake.x, shake.y);

  ctx.clearRect(-20, -20, GAME_WIDTH + 40, GAME_HEIGHT + 40);

  const cupExt = state.cupExtendPx || 0;

  drawBackground();
  drawDangerZone(state.dangerLevel, cupExt);
  drawCup(cupExt);
  drawDangerLine(state.dangerLevel, cupExt);
  drawBalls(state.balls, state.gameState);
  Particles.draw(ctx);

  if (state.gameState === 'playing') {
    drawPreview(state.previewX, state.previewTier, state.isDragging, state.isTouchDevice, state.bombQueued);
    drawDropLine(state.previewX);
  }

  drawScore(state.score, state.highScore, state.combo);
  drawMuteButton(state.muted);

  if (state.gameState === 'playing') {
    drawStoreButtons(state.storePrices, state.storeAffordable);
  }

  if (state.gameState === 'gameover') {
    drawGameOver(state.score, state.highScore, state.won);
  }

  ctx.restore();
}

// ── Background ──────────────────────────────────────────────────
function drawBackground() {
  const grad = ctx.createLinearGradient(0, 0, 0, GAME_HEIGHT);
  grad.addColorStop(0, '#1a1a2e');
  grad.addColorStop(0.5, '#16213e');
  grad.addColorStop(1, '#1a4a7a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

  // Subtle grid pattern (cheaper than dots)
  ctx.strokeStyle = 'rgba(255,255,255,0.015)';
  ctx.lineWidth = 0.5;
  for (let x = 0; x < GAME_WIDTH; x += 30) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, GAME_HEIGHT);
    ctx.stroke();
  }
  for (let y = 0; y < GAME_HEIGHT; y += 30) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(GAME_WIDTH, y);
    ctx.stroke();
  }
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

  const effectiveTopY = CUP_TOP_Y - (cupExt || 0);
  const leftTop = { x: CUP_LEFT_X, y: effectiveTopY - 20 };
  const leftBot = { x: CUP_LEFT_X, y: CUP_BOTTOM_Y };
  const rightBot = { x: CUP_RIGHT_X, y: CUP_BOTTOM_Y };
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

  for (const entry of sorted) {
    if (entry.isBomb) {
      drawBombBall(entry.body);
    } else {
      drawBall(entry.body, entry.tierIndex, gameState);
    }
  }
}

function getSquishState(body) {
  if (!ballSquish.has(body.id)) {
    ballSquish.set(body.id, {
      scaleX: 0.3, // Start small for spawn animation
      scaleY: 0.3,
      targetSX: 1,
      targetSY: 1,
      spawnProgress: 0,
    });
  }
  return ballSquish.get(body.id);
}

function drawBall(body, tierIndex, gameState) {
  const tier = BALL_TIERS[tierIndex];
  const { x, y } = body.position;
  const r = tier.radius;
  const sq = getSquishState(body);

  // ── Spawn scale-up animation ──────────────────────────────────
  if (sq.spawnProgress < 1) {
    sq.spawnProgress = Math.min(sq.spawnProgress + 0.08, 1);
    const t = easeOutBack(sq.spawnProgress);
    sq.targetSX = 1;
    sq.targetSY = 1;
    sq.scaleX = t;
    sq.scaleY = t;
  } else {
    // ── Velocity-based squish ────────────────────────────────────
    const vx = body.velocity.x;
    const vy = body.velocity.y;
    const speed = Math.sqrt(vx * vx + vy * vy);

    // Smaller balls (white, red, yellow, orange) are gooier — more squish
    const gooFactor = tierIndex <= 3 ? 1 + (3 - tierIndex) * 0.25 : 1; // white=1.75, red=1.5, yellow=1.25, orange=1.0

    // Collision squish: compress on impact
    const impactSquish = Math.min(speed * 0.012 * gooFactor, 0.35);
    const angle = Math.atan2(Math.abs(vy), Math.abs(vx) + 0.001);
    const verticalness = angle / (Math.PI / 2); // 0=horizontal, 1=vertical

    sq.targetSX = 1 + impactSquish * verticalness;
    sq.targetSY = 1 - impactSquish * verticalness;

    // Also squish horizontally on horizontal impacts
    if (verticalness < 0.5) {
      sq.targetSX = 1 - impactSquish * (1 - verticalness) * 0.5;
      sq.targetSY = 1 + impactSquish * (1 - verticalness) * 0.3;
    }

    // Spring back to 1,1 (jelly recovery) — gooier balls recover slower
    const recovery = tierIndex <= 3 ? 0.15 - (3 - tierIndex) * 0.02 : 0.15; // white=0.09, larger=0.15
    sq.scaleX += (sq.targetSX - sq.scaleX) * recovery;
    sq.scaleY += (sq.targetSY - sq.scaleY) * recovery;

    // Idle wobble (subtle breathing) — gooier balls wobble more
    const wobbleAmp = tierIndex <= 3 ? 0.008 + (3 - tierIndex) * 0.004 : 0.008; // white=0.02, larger=0.008
    const wobbleTime = performance.now() * 0.002 + body.id * 1.7;
    sq.scaleX += Math.sin(wobbleTime) * wobbleAmp;
    sq.scaleY += Math.cos(wobbleTime * 1.3) * wobbleAmp;
  }

  ctx.save();
  ctx.translate(x, y);

  // Rotate with body angle for more life
  ctx.rotate(body.angle);
  ctx.scale(sq.scaleX, sq.scaleY);

  // ── Draw based on tier type ───────────────────────────────────
  if (tier.name === 'rainbow') {
    drawRainbowBall(r);
  } else if (tier.name === 'chrome') {
    drawChromeBall(r);
  } else {
    drawSolidBall(r, tier.color, tier.stroke, tierIndex, body.id);
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

  // Dark core
  const coreGrad = ctx.createRadialGradient(-r * 0.2, -r * 0.25, r * 0.05, 0, 0, r);
  coreGrad.addColorStop(0, '#555');
  coreGrad.addColorStop(0.3, '#333');
  coreGrad.addColorStop(0.7, '#1a1a1a');
  coreGrad.addColorStop(1, '#000');
  ctx.fillStyle = coreGrad;
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

  // Highlight dot
  ctx.fillStyle = 'rgba(255, 150, 150, 0.5)';
  ctx.beginPath();
  ctx.arc(-r * 0.25, -r * 0.3, r * 0.12, 0, Math.PI * 2);
  ctx.fill();
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

// ── Solid Ball ──────────────────────────────────────────────────
function drawSolidBall(r, fill, stroke, tierIndex, ballId) {
  // Outer glow
  const glow = ctx.createRadialGradient(0, 0, r * 0.5, 0, 0, r * 1.4);
  glow.addColorStop(0, hexWithAlpha(fill, 0.25));
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.4, 0, Math.PI * 2);
  ctx.fill();

  // Main body gradient (3D sphere look)
  const grad = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.05, r * 0.1, r * 0.1, r * 1.1);
  grad.addColorStop(0, lightenColor(fill, 60));
  grad.addColorStop(0.3, lightenColor(fill, 20));
  grad.addColorStop(0.6, fill);
  grad.addColorStop(1, darkenColor(fill, 40));
  ctx.fillStyle = grad;

  // Wobbly circle
  ctx.beginPath();
  const points = 32;
  const wobbleSpeed = 0.003;
  const wobbleAmt = 0.012 + tierIndex * 0.001;
  for (let i = 0; i <= points; i++) {
    const a = (i / points) * Math.PI * 2;
    const w = 1 + Math.sin(a * 3 + performance.now() * wobbleSpeed) * wobbleAmt
                + Math.sin(a * 5 + performance.now() * wobbleSpeed * 1.7) * wobbleAmt * 0.5;
    const px = Math.cos(a) * r * w;
    const py = Math.sin(a) * r * w;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();

  // Stroke with slight variation
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Per-ball randomized highlights
  const hl = ballId != null ? getBallHighlights(ballId) : {
    primaryX: -0.2, primaryY: -0.28, primaryW: 0.4, primaryH: 0.22,
    primaryAngle: -0.5, primaryAlpha: 0.25,
    dotX: -0.15, dotY: -0.42, dotSize: 0.08, dotAlpha: 0.5,
    shadowX: 0.05, shadowY: 0.35, shadowAngle: 0.2,
  };

  // Primary highlight (big soft reflection)
  ctx.fillStyle = `rgba(255,255,255,${hl.primaryAlpha})`;
  ctx.beginPath();
  ctx.ellipse(r * hl.primaryX, r * hl.primaryY, r * hl.primaryW, r * hl.primaryH, hl.primaryAngle, 0, Math.PI * 2);
  ctx.fill();

  // Secondary highlight (sharp tiny dot)
  ctx.fillStyle = `rgba(255,255,255,${hl.dotAlpha})`;
  ctx.beginPath();
  ctx.arc(r * hl.dotX, r * hl.dotY, r * hl.dotSize, 0, Math.PI * 2);
  ctx.fill();

  // Bottom shadow crescent
  ctx.fillStyle = 'rgba(0,0,0,0.08)';
  ctx.beginPath();
  ctx.ellipse(r * hl.shadowX, r * hl.shadowY, r * 0.5, r * 0.18, hl.shadowAngle, 0, Math.PI * 2);
  ctx.fill();
}

// ── Chrome Ball (metallic sheen) ────────────────────────────────
function drawChromeBall(r) {
  const time = performance.now() * 0.001;

  // Outer glow
  const glow = ctx.createRadialGradient(0, 0, r * 0.5, 0, 0, r * 1.5);
  glow.addColorStop(0, 'rgba(200,210,220,0.3)');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.5, 0, Math.PI * 2);
  ctx.fill();

  // Metallic gradient (shifts with time for living sheen)
  const shineAngle = time * 0.5;
  const shineX = Math.cos(shineAngle) * r * 0.3;
  const shineY = Math.sin(shineAngle) * r * 0.3;

  const grad = ctx.createRadialGradient(shineX - r * 0.2, shineY - r * 0.3, r * 0.1, 0, 0, r);
  grad.addColorStop(0, '#FAFAFA');
  grad.addColorStop(0.2, '#E8E8E8');
  grad.addColorStop(0.4, '#C0C8D0');
  grad.addColorStop(0.6, '#8899AA');
  grad.addColorStop(0.8, '#A0ADB8');
  grad.addColorStop(1, '#6B7B8D');
  ctx.fillStyle = grad;

  ctx.beginPath();
  const points = 32;
  for (let i = 0; i <= points; i++) {
    const a = (i / points) * Math.PI * 2;
    const w = 1 + Math.sin(a * 4 + time * 2) * 0.01;
    ctx.lineTo(Math.cos(a) * r * w, Math.sin(a) * r * w);
  }
  ctx.closePath();
  ctx.fill();

  // Metallic edge stroke
  ctx.strokeStyle = '#7B8C9D';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Moving highlight (the "sheen" that sweeps across)
  const sweepX = Math.sin(time * 1.2) * r * 0.4;
  const sweepGrad = ctx.createRadialGradient(sweepX, -r * 0.2, r * 0.05, sweepX, -r * 0.1, r * 0.6);
  sweepGrad.addColorStop(0, 'rgba(255,255,255,0.6)');
  sweepGrad.addColorStop(0.5, 'rgba(255,255,255,0.1)');
  sweepGrad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sweepGrad;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();

  // Sharp highlight
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.beginPath();
  ctx.ellipse(-r * 0.2, -r * 0.35, r * 0.18, r * 0.1, -0.5, 0, Math.PI * 2);
  ctx.fill();

  // Environment reflection hint (subtle colored reflection)
  ctx.fillStyle = `rgba(100,150,200,${0.05 + Math.sin(time) * 0.03})`;
  ctx.beginPath();
  ctx.ellipse(r * 0.2, r * 0.1, r * 0.5, r * 0.3, 0.3, 0, Math.PI * 2);
  ctx.fill();
}

// ── Rainbow Ball ────────────────────────────────────────────────
function drawRainbowBall(r) {
  const time = performance.now() * 0.001;

  // Grand outer glow
  const glow = ctx.createRadialGradient(0, 0, r * 0.5, 0, 0, r * 2);
  const hue = (time * 60) % 360;
  glow.addColorStop(0, `hsla(${hue}, 80%, 65%, 0.3)`);
  glow.addColorStop(0.5, `hsla(${(hue + 120) % 360}, 80%, 65%, 0.1)`);
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, r * 2, 0, Math.PI * 2);
  ctx.fill();

  // Animated rainbow conic gradient
  const grad = ctx.createConicGradient(time * 1.5, 0, 0);
  const colors = ['#E74C3C', '#E67E22', '#F1C40F', '#2ECC71', '#3498DB', '#6C3483', '#A569BD', '#E74C3C'];
  for (let i = 0; i < colors.length; i++) {
    grad.addColorStop(i / (colors.length - 1), colors[i]);
  }

  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fill();

  // Shimmering white overlay
  const shimmer = 0.15 + Math.sin(time * 4) * 0.1 + Math.sin(time * 7) * 0.05;
  ctx.fillStyle = `rgba(255,255,255,${shimmer})`;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();

  // Rotating star highlight
  ctx.save();
  ctx.rotate(time * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
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
  ctx.restore();

  // Main highlight
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.ellipse(-r * 0.2, -r * 0.28, r * 0.4, r * 0.25, -0.5, 0, Math.PI * 2);
  ctx.fill();

  // Stroke
  ctx.strokeStyle = `hsla(${hue}, 70%, 75%, 0.6)`;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
}

// ── Preview Ball ────────────────────────────────────────────────
function drawPreview(x, tierIndex, isDragging, isTouchDevice, bombQueued) {
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
  } else {
    const tier = BALL_TIERS[tierIndex];
    if (tier.color === 'rainbow') {
      drawRainbowBall(tier.radius);
    } else if (tier.name === 'chrome') {
      drawChromeBall(tier.radius);
    } else {
      drawSolidBall(tier.radius, tier.color, tier.stroke, tierIndex);
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

// ── Next Ball Preview (small, in corner) ────────────────────────
function drawNextBall(tierIndex) {
  if (tierIndex === undefined) return;

  const tier = BALL_TIERS[tierIndex];
  const previewR = Math.min(tier.radius * 0.5, 16);
  const px = GAME_WIDTH - 35;
  const py = 55;

  ctx.save();

  // Label
  ctx.font = '11px "Patrick Hand", cursive';
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.textAlign = 'center';
  ctx.fillText('NEXT', px, py - previewR - 8);

  // Mini ball
  ctx.globalAlpha = 0.6;
  ctx.translate(px, py);

  const miniScale = previewR / tier.radius;
  ctx.scale(miniScale, miniScale);

  if (tier.color === 'rainbow') {
    drawRainbowBall(tier.radius);
  } else if (tier.name === 'chrome') {
    drawChromeBall(tier.radius);
  } else {
    drawSolidBall(tier.radius, tier.color, tier.stroke, tierIndex);
  }

  ctx.restore();
}

// ── Score Display ───────────────────────────────────────────────
function drawScore(score, highScore, combo) {
  ctx.save();
  ctx.textAlign = 'center';

  // Title
  ctx.font = '18px "Patrick Hand", cursive';
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fillText('SQUISHY GUYS', GAME_WIDTH / 2, 28);

  // Score with shadow
  ctx.font = 'bold 30px "Patrick Hand", cursive';
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillText(score.toLocaleString(), GAME_WIDTH / 2 + 1, 61);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(score.toLocaleString(), GAME_WIDTH / 2, 60);

  // High score
  ctx.font = '14px "Patrick Hand", cursive';
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.fillText(`Best Combo: ${highScore.toLocaleString()}`, GAME_WIDTH / 2, 80);

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
function drawGameOver(score, highScore, won) {
  ctx.save();

  // Animated dim overlay
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.fillRect(-20, -20, GAME_WIDTH + 40, GAME_HEIGHT + 40);

  ctx.textAlign = 'center';
  const cx = GAME_WIDTH / 2;
  const cy = GAME_HEIGHT / 2;

  if (won) {
    // Rainbow win - cycling colors
    const time = performance.now() * 0.002;
    ctx.font = 'bold 42px "Patrick Hand", cursive';
    ctx.fillStyle = `hsl(${(time * 60) % 360}, 85%, 65%)`;
    ctx.fillText('RAINBOW!', cx, cy - 70);

    ctx.font = '24px "Patrick Hand", cursive';
    ctx.fillStyle = '#FFD700';
    ctx.fillText('You did it!', cx, cy - 30);

    // Sparkle emojis
    ctx.font = '20px sans-serif';
    const sparkleY = cy - 95;
    ctx.fillText('*', cx - 80 + Math.sin(time * 3) * 5, sparkleY);
    ctx.fillText('*', cx + 80 + Math.sin(time * 3 + 2) * 5, sparkleY);
  } else {
    ctx.font = 'bold 42px "Patrick Hand", cursive';
    // Subtle pulse
    const pulse = 1 + Math.sin(performance.now() * 0.003) * 0.02;
    ctx.save();
    ctx.translate(cx, cy - 70);
    ctx.scale(pulse, pulse);
    ctx.fillStyle = '#E74C3C';
    ctx.fillText('GAME OVER', 0, 0);
    ctx.restore();
  }

  // Score
  ctx.font = '24px "Patrick Hand", cursive';
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(`Score: ${score.toLocaleString()}`, cx, cy + 10);

  // Best combo display
  if (highScore > 0) {
    ctx.font = '18px "Patrick Hand", cursive';
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText(`Best Combo: ${highScore.toLocaleString()}`, cx, cy + 42);
  }

  // Restart prompt with pulse
  const promptAlpha = 0.4 + Math.sin(performance.now() * 0.004) * 0.2;
  ctx.font = '18px "Patrick Hand", cursive';
  ctx.fillStyle = `rgba(255,255,255,${promptAlpha})`;
  ctx.fillText('Tap to play again', cx, cy + 95);

  ctx.restore();
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
    const label = btn.id === 'colorBomb' ? '\u25C9 BOMB' : '\u2B06 CUP+';
    const textAlpha = canBuy ? 0.85 : 0.35;
    ctx.font = 'bold 12px "Patrick Hand", cursive';
    ctx.fillStyle = `rgba(255, 255, 255, ${textAlpha})`;
    ctx.textAlign = 'left';
    ctx.fillText(label, btn.x + 8, btn.y + 20);

    // Price
    ctx.textAlign = 'right';
    ctx.font = '12px "Patrick Hand", cursive';
    ctx.fillStyle = canBuy
      ? `rgba(46, 204, 113, ${textAlpha})`
      : `rgba(255, 255, 255, ${textAlpha * 0.7})`;
    ctx.fillText(`${price}pts`, btn.x + btn.w - 8, btn.y + 20);

    ctx.restore();
  }
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
