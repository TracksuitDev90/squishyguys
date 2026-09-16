// ── Rich Particle System ────────────────────────────────────────
// Manages all visual effects: sparkles, shockwaves, confetti,
// floating score text, spawn pops, and screen shake.

import {
  BALL_TIERS, RAINBOW_TIER, GAME_WIDTH, INK,
  CUP_LEFT_X, CUP_RIGHT_X, CUP_TOP_Y, CUP_BOTTOM_Y, CUP_BASE_EXTRA,
  MAX_JUICE_DROPLETS,
} from './config.js';
import * as Skins from './skins.js';

// ── Active effect pools ─────────────────────────────────────────
const sparkles = [];
const shockwaves = [];
const confetti = [];
const scorePopups = [];
const spawnPops = [];
const unlockFlashes = [];
const juice = []; // fluid-simulated droplets (see emitJuiceSquirt)
let screenShake = { x: 0, y: 0, intensity: 0, decay: 0.9 };
let dangerPulse = 0; // 0-1, how much danger warning to show
let feverActive = false; // ambient rising sparkles while frenzying

// ── Public API ──────────────────────────────────────────────────

export function emitMerge(x, y, tierIndex, comboCount) {
  const tier = BALL_TIERS[tierIndex];
  const style = Skins.getTierStyle(tierIndex);
  const color = style.color === 'rainbow' ? '#FFD700' : style.color;
  const r = tier.radius;
  const intensity = Math.min(tierIndex / RAINBOW_TIER, 1); // higher tiers = more juice

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
  if (tierIndex === RAINBOW_TIER) {
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
  const style = Skins.getTierStyle(tierIndex);
  unlockFlashes.push({
    name: tier.name.toUpperCase(),
    color: style.color === 'rainbow' ? '#FFD700' : style.color,
    life: 1,
    // Unlocking a new fruit is a milestone — the banner lingers 10%
    // longer than the base 0.008 decay so the moment can land.
    decay: 0.008 / 1.1,
  });
}

// ── Juice Squirt (fluid sim) ────────────────────────────────────
// When two fruits squish into one, juice sprays out of the pinch — the
// seam runs perpendicular to the line between their centers, so the
// spray fans out both ways along it. Droplets are simulated as a small
// particle fluid (see updateJuice): they clump, splash, run down other
// fruit and pool on the floor before soaking away.

// Juice per fruit — what actually comes out when you squeeze one.
const JUICE_COLORS = {
  coconut:     '#F6F1E4', // coconut water
  peach:       '#FFC076',
  apple:       '#F4CF62', // golden apple juice
  lemon:       '#FBF28C',
  orange:      '#FFA33B',
  watermelon:  '#FF6478',
  blueberry:   '#5A4BCC',
  grape:       '#8E44AD',
  plum:        '#C43C96',
  dragonfruit: '#EA3F8F',
  grapefruit:  '#FF7A8C',
  rainbow:     '#FFD700',
};

function juiceColorFor(tierIndex) {
  const style = Skins.getTierStyle(tierIndex);
  const name = BALL_TIERS[tierIndex].name;
  if (Skins.getDetailMode() === 'fruit' || style.color === 'rainbow') {
    return JUICE_COLORS[name] || '#FFD700';
  }
  // Palette-swap skins squirt a lighter tint of their own color
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(style.color);
  if (!m) return '#FFD700';
  const l = (h) => Math.min(255, parseInt(h, 16) + 28);
  return `rgb(${l(m[1])},${l(m[2])},${l(m[3])})`;
}

// x,y: merge point · seamAngle: direction of the pinch seam ·
// sourceRadius: radius of the fruits that merged · tierIndex: tier of
// the fruit that merged (drives color and how much juice there is).
// A squirt is a short-lived jet: it releases droplets over several
// frames (hardest at first, tapering off) rather than dumping them all
// at once, so the fluid leaves the pinch as a stream that stretches
// into a string of drops in flight.
const juiceJets = [];

export function emitJuiceSquirt(x, y, seamAngle, sourceRadius, tierIndex) {
  const color = juiceColorFor(tierIndex);
  const r = sourceRadius || BALL_TIERS[Math.max(0, tierIndex)].radius;
  const scale = Math.min(1.5, 0.6 + r / 45); // coconut≈0.87 … plum≈1.5
  const count = Math.round(14 + r * 0.4);    // coconut≈19 … plum≈38
  const frames = 7;
  juiceJets.push({
    x, y, seamAngle, color, scale,
    r,
    dropR: Math.max(2.6, Math.min(6, r * 0.14)),
    perFrame: Math.ceil(count / frames),
    frame: 0,
    frames,
  });
}

function spawnJetDroplets(jet) {
  const { x, y, seamAngle, color, scale, r, dropR } = jet;
  // Free slots — recycle the oldest droplets when the pool is full
  const overflow = juice.length + jet.perFrame - MAX_JUICE_DROPLETS;
  if (overflow > 0) juice.splice(0, overflow);

  // Pressure drops as the squeeze finishes: first drops fly, last ones dribble
  const pressure = 1.15 - (jet.frame / jet.frames) * 0.75;

  for (let i = 0; i < jet.perFrame; i++) {
    // Two opposed jets along the seam, plus the odd stray anywhere
    const stray = Math.random() < 0.12;
    const side = (i + jet.frame) % 2 === 0 ? 1 : -1;
    const a = stray
      ? Math.random() * Math.PI * 2
      : seamAngle + (side > 0 ? 0 : Math.PI) + (Math.random() - 0.5) * 0.45;
    const speed = (stray ? 0.8 + Math.random() * 1.4 : 2.2 + Math.random() * 3.2)
                * scale * pressure;
    const sr = r * (0.15 + Math.random() * 0.2);
    juice.push({
      x: x + Math.cos(a) * sr,
      y: y + Math.sin(a) * sr,
      px: 0, py: 0,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed - 0.5 * scale, // slight lift — squirts arc
      r: dropR * (0.75 + Math.random() * 0.5),
      color,
      life: 1,
      decay: 1 / (70 + Math.random() * 50), // ~1.2–2 s
      wet: 0,      // >0 while touching a surface (draws as a smear)
      nx: 0, ny: 0, // last contact normal for the smear orientation
      settled: 0,   // frames spent resting on the floor
    });
  }
  jet.frame++;
}

// Colliders for the juice: the live fruit and the current cup height.
// main.js refreshes these every frame while a run is on.
let juiceBalls = [];
let juiceCupExt = 0;

export function setJuiceColliders(balls, cupExt) {
  juiceBalls = balls;
  juiceCupExt = cupExt || 0;
}

export function triggerShake(intensity) {
  screenShake.intensity = Math.min(screenShake.intensity + intensity, 25);
}

export function setDangerLevel(level) {
  dangerPulse = level;
}

export function setFeverActive(active) {
  feverActive = active;
}

// ── Update ──────────────────────────────────────────────────────
export function update() {
  // Fever ambience: golden sparks drifting up from the bottom
  if (feverActive && Math.random() < 0.3) {
    sparkles.push({
      x: 30 + Math.random() * 340,
      y: 704,
      vx: (Math.random() - 0.5) * 0.4,
      vy: -(1 + Math.random() * 1.6),
      size: 1.2 + Math.random() * 1.8,
      color: Math.random() > 0.3 ? '#FFD700' : '#FFF3C0',
      life: 1,
      decay: 0.006 + Math.random() * 0.004,
      gravity: -0.004, // floats up
      shape: Math.random() > 0.75 ? 'star' : 'circle',
    });
  }

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

  // Juice jets feed droplets in over a few frames, then the fluid runs
  for (let i = juiceJets.length - 1; i >= 0; i--) {
    spawnJetDroplets(juiceJets[i]);
    if (juiceJets[i].frame >= juiceJets[i].frames) juiceJets.splice(i, 1);
  }
  if (juice.length) updateJuice();

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
  drawJuice(ctx);
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

// ── Juice fluid simulation ──────────────────────────────────────
// Particle-based viscoelastic fluid (Clavet, Beaudoin & Poulin 2005),
// trimmed to what a squirt needs: viscosity impulses so droplets drag
// on each other, then double-density relaxation — a pressure term that
// keeps droplets from piling into one point plus a "near" term that
// makes them cling into strands and blobs. Everything is in canvas
// pixels with a one-frame timestep, so the constants are tuned by eye
// rather than in SI units.
const J_H = 17;          // interaction radius
const J_REST = 3.0;      // rest density (sparser than this pulls together)
const J_K = 0.12;        // pressure stiffness
const J_KNEAR = 0.32;    // near-pressure stiffness (surface tension feel)
const J_SIGMA = 0.12;    // linear viscosity
const J_BETA = 0.03;     // quadratic viscosity (splash damping)
const J_GRAVITY = 0.3;   // ≈ the fruit's own gravity in px/frame²
const J_AIR = 0.985;

// Inner x-limits of the cup at a given y: the walls flare outward
// toward the base (mirrors physics.js buildCup)
function cupInnerLeft(y) {
  const rimY = CUP_TOP_Y - juiceCupExt - 20;
  const t = Math.max(0, Math.min((y - rimY) / (CUP_BOTTOM_Y - rimY), 1));
  return CUP_LEFT_X - CUP_BASE_EXTRA * t + 1;
}
function cupInnerRight(y) {
  const rimY = CUP_TOP_Y - juiceCupExt - 20;
  const t = Math.max(0, Math.min((y - rimY) / (CUP_BOTTOM_Y - rimY), 1));
  return CUP_RIGHT_X + CUP_BASE_EXTRA * t - 1;
}

function updateJuice() {
  const n = juice.length;

  // Aging + gravity + air drag on the velocity, then a pass of
  // viscosity impulses between neighbors
  for (let i = 0; i < n; i++) {
    const p = juice[i];
    p.life -= p.decay * (p.settled > 0 ? 2.2 : 1); // pooled juice soaks away
    p.vy += J_GRAVITY;
    p.vx *= J_AIR;
    p.vy *= J_AIR;
  }
  for (let i = 0; i < n; i++) {
    const a = juice[i];
    for (let j = i + 1; j < n; j++) {
      const b = juice[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= J_H * J_H || d2 < 0.0001) continue;
      const d = Math.sqrt(d2);
      const q = d / J_H;
      const nx = dx / d;
      const ny = dy / d;
      // Inward radial velocity — only damp approach, never pull apart
      const u = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
      if (u > 0) {
        const I = (1 - q) * (J_SIGMA * u + J_BETA * u * u) * 0.5;
        a.vx -= I * nx; a.vy -= I * ny;
        b.vx += I * nx; b.vy += I * ny;
      }
    }
  }

  // Predict positions
  for (let i = 0; i < n; i++) {
    const p = juice[i];
    p.px = p.x;
    p.py = p.y;
    p.x += p.vx;
    p.y += p.vy;
  }

  // Double density relaxation: push apart when crowded, and pull
  // together through the near-density term so the spray coheres into
  // strings and drops instead of dispersing like dust
  for (let i = 0; i < n; i++) {
    const a = juice[i];
    let rho = 0;
    let rhoNear = 0;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const b = juice[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= J_H * J_H) continue;
      const q = 1 - Math.sqrt(d2) / J_H;
      rho += q * q;
      rhoNear += q * q * q;
    }
    // Clamp so a dense cluster (e.g. a jet spawning into a corner)
    // spreads out rather than detonating
    const P = Math.min(J_K * (rho - J_REST), 0.5);
    const Pnear = Math.min(J_KNEAR * rhoNear, 1.2);
    let ddx = 0;
    let ddy = 0;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const b = juice[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= J_H * J_H || d2 < 0.0001) continue;
      const d = Math.sqrt(d2);
      const q = 1 - d / J_H;
      const D = (P * q + Pnear * q * q) * 0.5;
      const nx = dx / d;
      const ny = dy / d;
      b.x += D * nx; b.y += D * ny;
      ddx -= D * nx; ddy -= D * ny;
    }
    a.x += ddx;
    a.y += ddy;
  }

  // Collisions: fruit first (so a droplet pushed out of a fruit still
  // respects the cup), then walls and floor. Contact zeroes the normal
  // velocity and keeps most of the tangential — juice runs down things.
  for (let i = 0; i < n; i++) {
    const p = juice[i];
    p.wet = Math.max(0, p.wet - 1);

    for (const b of juiceBalls) {
      const dx = p.x - b.x;
      const dy = p.y - b.y;
      const rr = b.r + p.r * 0.6;
      const d2 = dx * dx + dy * dy;
      if (d2 >= rr * rr || d2 < 0.0001) continue;
      const d = Math.sqrt(d2);
      const nx = dx / d;
      const ny = dy / d;
      p.x = b.x + nx * rr;
      p.y = b.y + ny * rr;
      const vn = p.vx * nx + p.vy * ny;
      if (vn < 0) {
        // Bleed off the impact; a little bounce on the first hard hit
        const bounce = -vn > 4 ? 0.18 : 0;
        p.vx -= vn * nx * (1 + bounce);
        p.vy -= vn * ny * (1 + bounce);
      }
      // Cling: tangential drag against the skin
      p.vx *= 0.9;
      p.vy *= 0.9;
      p.wet = 3;
      p.nx = nx; p.ny = ny;
    }

    const left = cupInnerLeft(p.y) + p.r;
    const right = cupInnerRight(p.y) - p.r;
    if (p.x < left) {
      p.x = left;
      if (p.vx < 0) p.vx *= -0.15;
      p.vy *= 0.92;
      p.wet = 3; p.nx = 1; p.ny = 0;
    } else if (p.x > right) {
      p.x = right;
      if (p.vx > 0) p.vx *= -0.15;
      p.vy *= 0.92;
      p.wet = 3; p.nx = -1; p.ny = 0;
    }
    const floor = CUP_BOTTOM_Y - p.r * 0.5;
    if (p.y > floor) {
      p.y = floor;
      if (p.vy > 0) p.vy *= -0.1;
      p.vx *= 0.8;
      p.wet = 3; p.nx = 0; p.ny = -1;
      p.settled++;
    } else {
      p.settled = 0;
    }
  }

  // Velocity from the corrected displacement, and cull the spent
  for (let i = n - 1; i >= 0; i--) {
    const p = juice[i];
    p.vx = p.x - p.px;
    p.vy = p.y - p.py;
    // Cap runaway speeds so a bad relaxation step can't launch a droplet
    const sp = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
    if (sp > 14) { p.vx *= 14 / sp; p.vy *= 14 / sp; }
    if (p.life <= 0 || p.y > CUP_BOTTOM_Y + 20 || p.x < -20 || p.x > GAME_WIDTH + 20) {
      juice.splice(i, 1);
    }
  }
}

// Droplet blobs in the game's sticker style: an ink outline pass under
// a fill pass, so touching droplets merge into one outlined blob (the
// strokes of every droplet are drawn before any fill covers them).
// Neighbors within reach get a bridge between them for a stringy,
// liquid feel, and a droplet in contact with a surface squashes flat
// along it.
function dropletPath(ctx, p, grow) {
  const r = p.r * (p.life < 0.3 ? p.life / 0.3 : 1) + grow;
  if (r <= 0.2) return false;
  if (p.wet > 0) {
    // Flatten against the contact normal
    const ang = Math.atan2(p.ny, p.nx);
    ctx.ellipse(p.x, p.y, r * 0.7, r * 1.35, ang, 0, Math.PI * 2);
  } else {
    // Stretch slightly along the motion vector when moving fast
    const sp = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
    const stretch = Math.min(sp * 0.045, 0.35);
    const ang = Math.atan2(p.vy, p.vx);
    ctx.ellipse(p.x, p.y, r * (1 + stretch), r * (1 - stretch * 0.4), ang, 0, Math.PI * 2);
  }
  return true;
}

function drawJuice(ctx) {
  if (!juice.length) return;
  const n = juice.length;
  const bridgeDist = J_H * 0.75;

  // Group by color so each squirt keeps its own tint
  const groups = new Map();
  for (const p of juice) {
    let g = groups.get(p.color);
    if (!g) { g = []; groups.set(p.color, g); }
    g.push(p);
  }

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const [color, list] of groups) {
    // Pass 1: ink outline (grown droplets + fat bridges)
    ctx.fillStyle = INK;
    ctx.strokeStyle = INK;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    for (const p of list) {
      ctx.moveTo(p.x, p.y);
      dropletPath(ctx, p, 1.4);
    }
    ctx.fill();
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        if (dx * dx + dy * dy > bridgeDist * bridgeDist) continue;
        ctx.lineWidth = Math.min(a.r, b.r) * Math.min(a.life, b.life, 1) * 1.1 + 2.8;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }

    // Pass 2: juice fill on top
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.globalAlpha = 1;
    ctx.beginPath();
    for (const p of list) {
      ctx.moveTo(p.x, p.y);
      dropletPath(ctx, p, 0);
    }
    ctx.fill();
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        if (dx * dx + dy * dy > bridgeDist * bridgeDist) continue;
        ctx.lineWidth = Math.min(a.r, b.r) * Math.min(a.life, b.life, 1) * 1.1;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }

    // Pass 3: one glint per blob — only the biggest droplet of any
    // cluster catches the light, so a clump reads as one shiny mass
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (p.r < 3 || p.life < 0.4) continue;
      let biggest = true;
      for (let j = 0; j < list.length && biggest; j++) {
        if (j === i) continue;
        const q = list[j];
        const dx = q.x - p.x;
        const dy = q.y - p.y;
        if (dx * dx + dy * dy < bridgeDist * bridgeDist && (q.r > p.r || (q.r === p.r && j < i))) {
          biggest = false;
        }
      }
      if (!biggest) continue;
      const gr = p.r * 0.32;
      ctx.moveTo(p.x - p.r * 0.3 + gr, p.y - p.r * 0.35);
      ctx.arc(p.x - p.r * 0.3, p.y - p.r * 0.35, gr, 0, Math.PI * 2);
    }
    ctx.fill();
  }

  ctx.restore();
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
  juice.length = 0;
  juiceJets.length = 0;
  juiceBalls = [];
  screenShake.intensity = 0;
  screenShake.x = 0;
  screenShake.y = 0;
  dangerPulse = 0;
  feverActive = false;
}
