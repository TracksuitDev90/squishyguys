// ── Canvas Renderer (Hand-drawn aesthetic) ──────────────────────
import {
  GAME_WIDTH, GAME_HEIGHT,
  CUP_LEFT_X, CUP_RIGHT_X, CUP_TOP_Y, CUP_BOTTOM_Y,
  CUP_WALL_THICKNESS, DANGER_LINE_Y, DROP_Y,
  BALL_TIERS, SQUISH_FACTOR,
} from './config.js';

let canvas, ctx;
let wobbleSeeds = []; // Per-wall wobble offsets (stable per frame)

export function init(canvasEl) {
  canvas = canvasEl;
  ctx = canvas.getContext('2d');

  // Generate stable wobble seeds for cup walls
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

  // Maintain aspect ratio
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

export function getContext() {
  return ctx;
}

// ── Main Render ─────────────────────────────────────────────────
export function render(state) {
  ctx.clearRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

  drawBackground();
  drawCup();
  drawDangerLine();
  drawBalls(state.balls);
  drawMergeEffects(state.mergeEffects);

  if (state.gameState === 'playing') {
    drawPreview(state.previewX, state.previewTier);
    drawDropLine(state.previewX);
  }

  drawScore(state.score, state.highScore, state.combo);

  if (state.gameState === 'gameover') {
    drawGameOver(state.score, state.highScore, state.won);
  }
}

// ── Background ──────────────────────────────────────────────────
function drawBackground() {
  const grad = ctx.createLinearGradient(0, 0, 0, GAME_HEIGHT);
  grad.addColorStop(0, '#1a1a2e');
  grad.addColorStop(0.5, '#16213e');
  grad.addColorStop(1, '#0f3460');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

  // Subtle dot pattern
  ctx.fillStyle = 'rgba(255,255,255,0.02)';
  for (let x = 0; x < GAME_WIDTH; x += 20) {
    for (let y = 0; y < GAME_HEIGHT; y += 20) {
      ctx.beginPath();
      ctx.arc(x, y, 1, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// ── Cup ─────────────────────────────────────────────────────────
function drawCup() {
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = CUP_WALL_THICKNESS;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Draw cup as a U-shape with wobbly lines
  ctx.beginPath();

  // Left wall top to bottom
  const steps = 20;
  const leftTop = { x: CUP_LEFT_X, y: CUP_TOP_Y - 20 };
  const leftBot = { x: CUP_LEFT_X, y: CUP_BOTTOM_Y };
  const rightBot = { x: CUP_RIGHT_X, y: CUP_BOTTOM_Y };
  const rightTop = { x: CUP_RIGHT_X, y: CUP_TOP_Y - 20 };

  // Draw wobbly U-shape
  drawWobblyLine(leftTop.x, leftTop.y, leftBot.x, leftBot.y, 0);
  drawWobblyLine(leftBot.x, leftBot.y, rightBot.x, rightBot.y, 20);
  drawWobblyLine(rightBot.x, rightBot.y, rightTop.x, rightTop.y, 40);

  // Inner glow
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = CUP_WALL_THICKNESS + 8;
  ctx.beginPath();
  ctx.moveTo(leftTop.x, leftTop.y);
  ctx.lineTo(leftBot.x, leftBot.y);
  ctx.lineTo(rightBot.x, rightBot.y);
  ctx.lineTo(rightTop.x, rightTop.y);
  ctx.stroke();

  ctx.restore();
}

function drawWobblyLine(x1, y1, x2, y2, seedOffset) {
  const segments = 10;
  ctx.beginPath();
  ctx.moveTo(x1 + wobbleSeeds[seedOffset] * 0.5, y1);

  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    const x = x1 + (x2 - x1) * t + wobbleSeeds[seedOffset + i] * 0.8;
    const y = y1 + (y2 - y1) * t + wobbleSeeds[(seedOffset + i + 5) % 100] * 0.8;
    ctx.lineTo(x, y);
  }
  ctx.stroke();
}

// ── Danger Line ─────────────────────────────────────────────────
function drawDangerLine() {
  ctx.save();
  ctx.setLineDash([8, 8]);
  ctx.strokeStyle = 'rgba(231, 76, 60, 0.3)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(CUP_LEFT_X + 5, DANGER_LINE_Y);
  ctx.lineTo(CUP_RIGHT_X - 5, DANGER_LINE_Y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

// ── Drop guide line ─────────────────────────────────────────────
function drawDropLine(x) {
  ctx.save();
  ctx.setLineDash([4, 8]);
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, DROP_Y + 20);
  ctx.lineTo(x, CUP_BOTTOM_Y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

// ── Balls ───────────────────────────────────────────────────────
function drawBalls(ballMap) {
  for (const [id, { body, tierIndex }] of ballMap) {
    drawBall(body, tierIndex);
  }
}

function drawBall(body, tierIndex) {
  const tier = BALL_TIERS[tierIndex];
  const { x, y } = body.position;
  const r = tier.radius;

  // Calculate squish based on velocity
  const vx = body.velocity.x;
  const vy = body.velocity.y;
  const speed = Math.sqrt(vx * vx + vy * vy);
  const squishAmount = Math.min(speed * SQUISH_FACTOR * 0.05, 0.25);

  // Squish perpendicular to velocity direction
  const angle = Math.atan2(vy, vx);
  const scaleX = 1 + squishAmount;
  const scaleY = 1 - squishAmount * 0.6;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(scaleX, scaleY);
  ctx.rotate(-angle);

  // Main body
  if (tier.color === 'rainbow') {
    drawRainbowBall(r);
  } else {
    drawSolidBall(r, tier.color, tier.stroke);
  }

  ctx.restore();
}

function drawSolidBall(r, fill, stroke) {
  // Outer glow
  const glow = ctx.createRadialGradient(0, 0, r * 0.5, 0, 0, r * 1.3);
  glow.addColorStop(0, fill + '40');
  glow.addColorStop(1, 'transparent');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.3, 0, Math.PI * 2);
  ctx.fill();

  // Main circle with gradient for 3D effect
  const grad = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
  grad.addColorStop(0, lightenColor(fill, 40));
  grad.addColorStop(0.5, fill);
  grad.addColorStop(1, darkenColor(fill, 30));
  ctx.fillStyle = grad;

  // Wobbly circle outline
  ctx.beginPath();
  const points = 24;
  for (let i = 0; i <= points; i++) {
    const a = (i / points) * Math.PI * 2;
    const wobble = 1 + Math.sin(a * 3 + performance.now() * 0.003) * 0.015;
    const px = Math.cos(a) * r * wobble;
    const py = Math.sin(a) * r * wobble;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();

  // Stroke
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Highlight
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.beginPath();
  ctx.ellipse(-r * 0.25, -r * 0.3, r * 0.35, r * 0.2, -0.5, 0, Math.PI * 2);
  ctx.fill();

  // Small secondary highlight
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.beginPath();
  ctx.arc(-r * 0.1, -r * 0.5, r * 0.1, 0, Math.PI * 2);
  ctx.fill();
}

function drawRainbowBall(r) {
  const time = performance.now() * 0.001;

  // Animated rainbow gradient
  const grad = ctx.createConicGradient(time, 0, 0);
  const colors = ['#E74C3C', '#E67E22', '#F1C40F', '#2ECC71', '#3498DB', '#6C3483', '#A569BD', '#E74C3C'];
  for (let i = 0; i < colors.length; i++) {
    grad.addColorStop(i / (colors.length - 1), colors[i]);
  }

  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fill();

  // Shimmering overlay
  ctx.fillStyle = `rgba(255,255,255,${0.15 + Math.sin(time * 3) * 0.1})`;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();

  // Highlight
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.beginPath();
  ctx.ellipse(-r * 0.25, -r * 0.3, r * 0.4, r * 0.25, -0.5, 0, Math.PI * 2);
  ctx.fill();

  // Stroke
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
}

// ── Chrome ball (shiny metallic) ────────────────────────────────
// (integrated into drawSolidBall via the silver gradient)

// ── Merge Effects ───────────────────────────────────────────────
function drawMergeEffects(effects) {
  const now = performance.now();

  for (const effect of effects) {
    const elapsed = now - effect.startTime;
    const progress = elapsed / effect.duration;
    if (progress >= 1) continue;

    const tier = BALL_TIERS[effect.tierIndex];
    const color = tier.color === 'rainbow' ? '#FFD700' : tier.color;
    const r = tier.radius;

    ctx.save();
    ctx.translate(effect.x, effect.y);

    // Expanding ring
    ctx.strokeStyle = color;
    ctx.lineWidth = 3 * (1 - progress);
    ctx.globalAlpha = 1 - progress;
    ctx.beginPath();
    ctx.arc(0, 0, r * (1 + progress * 2), 0, Math.PI * 2);
    ctx.stroke();

    // Particles
    const particleCount = 8;
    for (let i = 0; i < particleCount; i++) {
      const angle = (i / particleCount) * Math.PI * 2;
      const dist = r * progress * 2.5;
      const px = Math.cos(angle) * dist;
      const py = Math.sin(angle) * dist;
      const size = 3 * (1 - progress);

      ctx.fillStyle = color;
      ctx.globalAlpha = (1 - progress) * 0.8;
      ctx.beginPath();
      ctx.arc(px, py, size, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}

// ── Preview Ball ────────────────────────────────────────────────
function drawPreview(x, tierIndex) {
  const tier = BALL_TIERS[tierIndex];
  const y = DROP_Y;

  ctx.save();
  ctx.globalAlpha = 0.5 + Math.sin(performance.now() * 0.005) * 0.15;
  ctx.translate(x, y);

  if (tier.color === 'rainbow') {
    drawRainbowBall(tier.radius);
  } else {
    drawSolidBall(tier.radius, tier.color, tier.stroke);
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

  // Score
  ctx.font = 'bold 28px "Patrick Hand", cursive';
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(score.toLocaleString(), GAME_WIDTH / 2, 60);

  // High score
  ctx.font = '14px "Patrick Hand", cursive';
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillText(`Best: ${highScore.toLocaleString()}`, GAME_WIDTH / 2, 80);

  // Combo indicator
  if (combo > 1) {
    ctx.font = 'bold 20px "Patrick Hand", cursive';
    ctx.fillStyle = '#F1C40F';
    ctx.globalAlpha = 0.6 + Math.sin(performance.now() * 0.01) * 0.4;
    ctx.fillText(`${combo}x COMBO!`, GAME_WIDTH / 2, 108);
  }

  ctx.restore();
}

// ── Game Over Overlay ───────────────────────────────────────────
function drawGameOver(score, highScore, won) {
  ctx.save();

  // Dim overlay
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

  ctx.textAlign = 'center';

  if (won) {
    // Rainbow win!
    ctx.font = 'bold 36px "Patrick Hand", cursive';
    const time = performance.now() * 0.002;
    ctx.fillStyle = `hsl(${(time * 60) % 360}, 80%, 65%)`;
    ctx.fillText('RAINBOW!', GAME_WIDTH / 2, GAME_HEIGHT / 2 - 60);

    ctx.font = '22px "Patrick Hand", cursive';
    ctx.fillStyle = '#FFD700';
    ctx.fillText('You did it!', GAME_WIDTH / 2, GAME_HEIGHT / 2 - 20);
  } else {
    ctx.font = 'bold 36px "Patrick Hand", cursive';
    ctx.fillStyle = '#E74C3C';
    ctx.fillText('GAME OVER', GAME_WIDTH / 2, GAME_HEIGHT / 2 - 60);
  }

  ctx.font = '22px "Patrick Hand", cursive';
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(`Score: ${score.toLocaleString()}`, GAME_WIDTH / 2, GAME_HEIGHT / 2 + 10);

  if (score >= highScore && score > 0) {
    ctx.fillStyle = '#F1C40F';
    ctx.fillText('New High Score!', GAME_WIDTH / 2, GAME_HEIGHT / 2 + 45);
  }

  ctx.font = '18px "Patrick Hand", cursive';
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillText('Tap to play again', GAME_WIDTH / 2, GAME_HEIGHT / 2 + 90);

  ctx.restore();
}

// ── Color Utilities ─────────────────────────────────────────────
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
