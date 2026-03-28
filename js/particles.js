// ── Rich Particle System ────────────────────────────────────────
// Manages all visual effects: sparkles, shockwaves, confetti,
// floating score text, spawn pops, and screen shake.

import { BALL_TIERS } from './config.js';

// ── Active effect pools ─────────────────────────────────────────
const sparkles = [];
const shockwaves = [];
const confetti = [];
const scorePopups = [];
const spawnPops = [];
const unlockFlashes = [];
let screenShake = { x: 0, y: 0, intensity: 0, decay: 0.9 };
let dangerPulse = 0; // 0-1, how much danger warning to show

// ── Public API ──────────────────────────────────────────────────

export function emitMerge(x, y, tierIndex, comboCount) {
  const tier = BALL_TIERS[tierIndex];
  const color = tier.color === 'rainbow' ? '#FFD700' : tier.color;
  const r = tier.radius;
  const intensity = Math.min(tierIndex / 9, 1); // higher tiers = more juice

  // Scale factor: low tiers are subtle (0.3), high tiers are big (1.0+)
  const juiceFactor = 0.3 + intensity * 0.9;

  // Shockwave ring(s) — scaled by tier
  shockwaves.push({
    x, y,
    startRadius: r * 0.3 * juiceFactor,
    endRadius: r * (1.5 + intensity * 3),
    color,
    lineWidth: (2 + tierIndex * 0.8) * juiceFactor,
    life: 1,
    decay: 0.04 - intensity * 0.018,
  });
  // Second thinner ring for higher tiers
  if (tierIndex >= 4) {
    shockwaves.push({
      x, y,
      startRadius: r * 0.5,
      endRadius: r * (2.5 + intensity * 3),
      color: '#FFFFFF',
      lineWidth: 1.5 + intensity * 2,
      life: 1, decay: 0.035,
    });
  }
  // Third ring for very high tiers
  if (tierIndex >= 7) {
    shockwaves.push({
      x, y,
      startRadius: r * 0.2,
      endRadius: r * 5.5,
      color, lineWidth: 2 + intensity * 3,
      life: 1, decay: 0.022,
    });
  }

  // Sparkles burst — count and size scale with tier
  const sparkleCount = Math.round((4 + tierIndex * 4) * juiceFactor);
  for (let i = 0; i < sparkleCount; i++) {
    const angle = (Math.PI * 2 * i) / sparkleCount + (Math.random() - 0.5) * 0.5;
    const speed = (1.5 + Math.random() * 3) * (0.6 + intensity * 1.2);
    sparkles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 1.5 * juiceFactor,
      size: (1.5 + Math.random() * 2) * juiceFactor + tierIndex * 0.4,
      color,
      life: 1,
      decay: 0.02 + Math.random() * 0.015 - intensity * 0.008,
      gravity: 0.08,
      shape: Math.random() > (0.7 - intensity * 0.3) ? 'star' : 'circle',
    });
  }

  // White flash sparkles — fewer for low tiers, more for high
  const flashCount = Math.round((2 + tierIndex * 1.2) * juiceFactor);
  for (let i = 0; i < flashCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = (0.8 + Math.random() * 2) * juiceFactor;
    sparkles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 2 * juiceFactor,
      size: (1 + Math.random() * 1.5) * juiceFactor,
      color: '#FFFFFF',
      life: 1,
      decay: 0.03 + Math.random() * 0.02 - intensity * 0.01,
      gravity: 0.05,
      shape: 'circle',
    });
  }

  // Confetti for higher tiers (blue+) — scales up dramatically
  if (tierIndex >= 5) {
    const confettiCount = 6 + (tierIndex - 5) * 6;
    const colors = ['#E74C3C', '#F1C40F', '#2ECC71', '#3498DB', '#A569BD', '#FFD700'];
    for (let i = 0; i < confettiCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (2 + Math.random() * 4) * (0.7 + intensity * 0.8);
      confetti.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 3 * juiceFactor,
        width: (3 + Math.random() * 3) * juiceFactor,
        height: (2 + Math.random() * 3) * juiceFactor,
        color: colors[Math.floor(Math.random() * colors.length)],
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.3,
        life: 1,
        decay: 0.01 + Math.random() * 0.008 - intensity * 0.003,
        gravity: 0.06,
      });
    }
  }

  // Rainbow merge: extra spectacular
  if (tierIndex === 9) {
    for (let wave = 0; wave < 3; wave++) {
      setTimeout(() => {
        shockwaves.push({
          x, y, startRadius: r * 0.2, endRadius: r * 6,
          color: `hsl(${wave * 120}, 80%, 65%)`, lineWidth: 5,
          life: 1, decay: 0.015,
        });
      }, wave * 100);
    }
    // Tons of rainbow confetti
    const rainbowColors = ['#E74C3C', '#E67E22', '#F1C40F', '#2ECC71', '#3498DB', '#6C3483', '#A569BD'];
    for (let i = 0; i < 50; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 8;
      confetti.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 6,
        width: 5 + Math.random() * 6,
        height: 3 + Math.random() * 5,
        color: rainbowColors[i % rainbowColors.length],
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.5,
        life: 1,
        decay: 0.005,
        gravity: 0.04,
      });
    }
  }

  // Screen shake — subtle for low tiers, big for high tiers
  const shakeAmount = (1 + tierIndex * 2) * juiceFactor + comboCount * 2;
  triggerShake(shakeAmount);
}

export function emitScorePopup(x, y, points, comboCount) {
  const text = comboCount > 1 ? `+${points} x${comboCount}` : `+${points}`;
  scorePopups.push({
    x: x + (Math.random() - 0.5) * 20,
    y: y - 10,
    text,
    life: 1,
    decay: 0.012,
    vy: -1.5,
    scale: comboCount > 1 ? 1.2 + comboCount * 0.1 : 1,
    color: comboCount > 3 ? '#FFD700' : comboCount > 1 ? '#F1C40F' : '#FFFFFF',
  });
}

export function emitSpawnPop(x, y, tierIndex) {
  spawnPops.push({
    x, y,
    radius: BALL_TIERS[tierIndex].radius,
    life: 1,
    decay: 0.06,
  });
}

export function emitUnlockFlash(tierIndex) {
  const tier = BALL_TIERS[tierIndex];
  unlockFlashes.push({
    name: tier.name.toUpperCase(),
    color: tier.color === 'rainbow' ? '#FFD700' : tier.color,
    life: 1,
    decay: 0.008,
  });
}

export function triggerShake(intensity) {
  screenShake.intensity = Math.min(screenShake.intensity + intensity, 25);
}

export function setDangerLevel(level) {
  dangerPulse = level;
}

// ── Update ──────────────────────────────────────────────────────
export function update() {
  // Sparkles
  for (let i = sparkles.length - 1; i >= 0; i--) {
    const p = sparkles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vy += p.gravity;
    p.vx *= 0.98;
    p.life -= p.decay;
    p.size *= 0.995;
    if (p.life <= 0) sparkles.splice(i, 1);
  }

  // Shockwaves
  for (let i = shockwaves.length - 1; i >= 0; i--) {
    const s = shockwaves[i];
    s.life -= s.decay;
    if (s.life <= 0) shockwaves.splice(i, 1);
  }

  // Confetti
  for (let i = confetti.length - 1; i >= 0; i--) {
    const c = confetti[i];
    c.x += c.vx;
    c.y += c.vy;
    c.vy += c.gravity;
    c.vx *= 0.98;
    c.rotation += c.rotSpeed;
    c.life -= c.decay;
    if (c.life <= 0) confetti.splice(i, 1);
  }

  // Score popups
  for (let i = scorePopups.length - 1; i >= 0; i--) {
    const s = scorePopups[i];
    s.y += s.vy;
    s.vy *= 0.97;
    s.life -= s.decay;
    if (s.life <= 0) scorePopups.splice(i, 1);
  }

  // Spawn pops
  for (let i = spawnPops.length - 1; i >= 0; i--) {
    const p = spawnPops[i];
    p.life -= p.decay;
    if (p.life <= 0) spawnPops.splice(i, 1);
  }

  // Unlock flashes
  for (let i = unlockFlashes.length - 1; i >= 0; i--) {
    const f = unlockFlashes[i];
    f.life -= f.decay;
    if (f.life <= 0) unlockFlashes.splice(i, 1);
  }

  // Screen shake
  if (screenShake.intensity > 0.1) {
    screenShake.x = (Math.random() - 0.5) * screenShake.intensity * 2;
    screenShake.y = (Math.random() - 0.5) * screenShake.intensity * 2;
    screenShake.intensity *= screenShake.decay;
  } else {
    screenShake.x = 0;
    screenShake.y = 0;
    screenShake.intensity = 0;
  }
}

// ── Draw ────────────────────────────────────────────────────────
export function getScreenShake() {
  return screenShake;
}

export function getDangerPulse() {
  return dangerPulse;
}

export function draw(ctx) {
  drawShockwaves(ctx);
  drawSparkles(ctx);
  drawConfetti(ctx);
  drawScorePopups(ctx);
  drawSpawnPops(ctx);
  drawUnlockFlashes(ctx);
}

function drawShockwaves(ctx) {
  for (const s of shockwaves) {
    const progress = 1 - s.life;
    const radius = s.startRadius + (s.endRadius - s.startRadius) * easeOutCubic(progress);

    ctx.save();
    ctx.globalAlpha = s.life * 0.7;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.lineWidth * s.life;
    ctx.beginPath();
    ctx.arc(s.x, s.y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

function drawSparkles(ctx) {
  for (const p of sparkles) {
    ctx.save();
    ctx.globalAlpha = p.life;
    ctx.fillStyle = p.color;

    if (p.shape === 'star') {
      drawStar(ctx, p.x, p.y, p.size);
    } else {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();

      // Glow
      ctx.globalAlpha = p.life * 0.3;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

function drawStar(ctx, x, y, size) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(performance.now() * 0.003);
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2;
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(angle) * size * 1.5, Math.sin(angle) * size * 1.5);
  }
  ctx.strokeStyle = ctx.fillStyle;
  ctx.lineWidth = size * 0.5;
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.restore();
}

function drawConfetti(ctx) {
  for (const c of confetti) {
    ctx.save();
    ctx.globalAlpha = c.life;
    ctx.translate(c.x, c.y);
    ctx.rotate(c.rotation);
    ctx.fillStyle = c.color;
    ctx.fillRect(-c.width / 2, -c.height / 2, c.width, c.height);
    ctx.restore();
  }
}

function drawScorePopups(ctx) {
  for (const s of scorePopups) {
    ctx.save();
    ctx.globalAlpha = s.life;
    ctx.textAlign = 'center';
    ctx.font = `bold ${Math.round(16 * s.scale)}px "Patrick Hand", cursive`;

    // Text shadow
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillText(s.text, s.x + 1, s.y + 1);

    // Text
    ctx.fillStyle = s.color;
    ctx.fillText(s.text, s.x, s.y);
    ctx.restore();
  }
}

function drawSpawnPops(ctx) {
  for (const p of spawnPops) {
    const progress = 1 - p.life;
    const radius = p.radius * (1 + progress * 0.5);

    ctx.save();
    ctx.globalAlpha = p.life * 0.3;
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2 * p.life;
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

function drawUnlockFlashes(ctx) {
  const GAME_WIDTH = 400; // Import avoided for simplicity
  for (const f of unlockFlashes) {
    if (f.life < 0.5) continue; // only show in first half

    const progress = 1 - (f.life - 0.5) * 2; // 0 to 1 over first half
    ctx.save();
    ctx.globalAlpha = (1 - progress) * 0.9;
    ctx.textAlign = 'center';
    ctx.font = `bold 24px "Patrick Hand", cursive`;

    // Slide in from top
    const yPos = 135 + progress * 5;

    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillText(`${f.name} UNLOCKED!`, GAME_WIDTH / 2 + 1, yPos + 1);

    ctx.fillStyle = f.color;
    ctx.fillText(`${f.name} UNLOCKED!`, GAME_WIDTH / 2, yPos);
    ctx.restore();
  }
}

// ── Easing ──────────────────────────────────────────────────────
function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

export function reset() {
  sparkles.length = 0;
  shockwaves.length = 0;
  confetti.length = 0;
  scorePopups.length = 0;
  spawnPops.length = 0;
  unlockFlashes.length = 0;
  screenShake.intensity = 0;
  screenShake.x = 0;
  screenShake.y = 0;
  dangerPulse = 0;
}
