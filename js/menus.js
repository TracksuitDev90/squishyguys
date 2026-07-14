// ── Menus & Screens ─────────────────────────────────────────────
// Title / mode select, unlock shop, and game-over buttons. Draw and
// hit-test code live together here (same pattern as the in-run store
// buttons) so renderer.js stays lean — it just dispatches. All layout
// is in the game's logical 400x700 space; ctx is passed in so the
// renderer keeps sole ownership of the canvas context.
import { GAME_WIDTH, GAME_HEIGHT, MODES, BALL_TIERS } from './config.js';
import * as Save from './save.js';
import * as Skins from './skins.js';
import { drawDecorBall, drawCoinIcon } from './renderer.js';

// ── Layouts ─────────────────────────────────────────────────────
export const MENU_BUTTONS = [
  { id: 'classic', x: 70, y: 250, w: 260, h: 64 },
  { id: 'rush',    x: 70, y: 330, w: 260, h: 64 },
  { id: 'zen',     x: 70, y: 410, w: 260, h: 64 },
  { id: 'shop',    x: 110, y: 508, w: 180, h: 50 },
];

export const GAMEOVER_BUTTONS = [
  { id: 'again', x: 55, y: 480, w: 140, h: 48, label: 'PLAY AGAIN' },
  { id: 'menu',  x: 205, y: 480, w: 140, h: 48, label: 'MENU' },
];

export const SHOP_BACK_BUTTON = { id: 'back', x: 130, y: 628, w: 140, h: 44, label: 'BACK' };

// ── Shared helpers ──────────────────────────────────────────────
function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function hitRect(btn, x, y) {
  return x >= btn.x && x <= btn.x + btn.w && y >= btn.y && y <= btn.y + btn.h;
}

// A soft translucent panel button with the hand-drawn look. `accent`
// tints the fill/border (defaults to white); `wobble` gives each
// button its own tiny idle tilt so the screen feels alive.
function drawPanel(ctx, btn, { accent = '255, 255, 255', alpha = 1, wobbleSeed = 0 } = {}) {
  const t = performance.now() * 0.001;
  ctx.save();
  ctx.translate(btn.x + btn.w / 2, btn.y + btn.h / 2);
  ctx.rotate(Math.sin(t * 0.9 + wobbleSeed) * 0.004);
  ctx.translate(-(btn.x + btn.w / 2), -(btn.y + btn.h / 2));

  ctx.fillStyle = `rgba(${accent}, ${0.12 * alpha})`;
  ctx.strokeStyle = `rgba(${accent}, ${0.4 * alpha})`;
  ctx.lineWidth = 2;
  roundRectPath(ctx, btn.x, btn.y, btn.w, btn.h, 12);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

// ── Title / Mode Select ─────────────────────────────────────────
export function drawMenu(ctx) {
  // Decorative squishy guys drifting around the edges
  drawDecorBall(58, 84, 17, 1, 11);
  drawDecorBall(330, 68, 15, 2, 37);
  drawDecorBall(354, 212, 26, 4, 23);
  drawDecorBall(44, 620, 22, 3, 41);
  drawDecorBall(356, 606, 24, 5, 53);

  ctx.save();
  ctx.textAlign = 'center';

  // Title with a gentle breathing wobble
  const t = performance.now() * 0.001;
  ctx.save();
  ctx.translate(GAME_WIDTH / 2, 148);
  ctx.rotate(Math.sin(t * 0.7) * 0.015);
  const breathe = 1 + Math.sin(t * 1.1) * 0.012;
  ctx.scale(breathe, breathe);
  ctx.font = 'bold 44px "Patrick Hand", cursive';
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillText('SQUISHY GUYS', 2, 3);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText('SQUISHY GUYS', 0, 0);
  ctx.restore();

  ctx.font = '17px "Patrick Hand", cursive';
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fillText('drop · merge · squish', GAME_WIDTH / 2, 182);

  // Mode buttons
  let wobble = 0;
  for (const btn of MENU_BUTTONS) {
    if (btn.id === 'shop') continue;
    const mode = MODES[btn.id];
    drawPanel(ctx, btn, { wobbleSeed: wobble++ * 1.7 });

    ctx.textAlign = 'left';
    ctx.font = 'bold 22px "Patrick Hand", cursive';
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillText(mode.label, btn.x + 18, btn.y + 28);

    ctx.font = '13px "Patrick Hand", cursive';
    ctx.fillStyle = 'rgba(255,255,255,0.42)';
    ctx.fillText(mode.desc, btn.x + 18, btn.y + 49);

    const best = Save.getHighScore(btn.id);
    if (best > 0) {
      ctx.textAlign = 'right';
      ctx.font = '13px "Patrick Hand", cursive';
      ctx.fillStyle = 'rgba(255, 215, 0, 0.55)';
      ctx.fillText(`BEST ${best.toLocaleString()}`, btn.x + btn.w - 14, btn.y + 28);
    }
  }

  // Shop button with coin balance
  const shopBtn = MENU_BUTTONS.find(b => b.id === 'shop');
  drawPanel(ctx, shopBtn, { accent: '241, 196, 15', wobbleSeed: 9.1 });
  ctx.textAlign = 'left';
  ctx.font = 'bold 20px "Patrick Hand", cursive';
  ctx.fillStyle = 'rgba(255, 226, 130, 0.95)';
  ctx.fillText('SHOP', shopBtn.x + 22, shopBtn.y + 32);
  drawCoinIcon(shopBtn.x + shopBtn.w - 62, shopBtn.y + 25, 9);
  ctx.font = '17px "Patrick Hand", cursive';
  ctx.fillStyle = 'rgba(255, 215, 0, 0.85)';
  ctx.fillText(Save.getCoins().toLocaleString(), shopBtn.x + shopBtn.w - 48, shopBtn.y + 31);

  // Footer stats
  const games = Save.getGamesPlayed();
  if (games > 0) {
    ctx.textAlign = 'center';
    ctx.font = '13px "Patrick Hand", cursive';
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillText(`${games.toLocaleString()} games squished`, GAME_WIDTH / 2, 676);
  }

  ctx.restore();
}

// Returns 'classic' | 'rush' | 'zen' | 'shop' | null
export function checkMenuHit(x, y) {
  for (const btn of MENU_BUTTONS) {
    if (hitRect(btn, x, y)) return btn.id;
  }
  return null;
}

// ── Unlock Shop ─────────────────────────────────────────────────
// Skin/upgrade catalog rendering lives here; purchase logic is in
// skins.js and is driven by main.js via checkShopHit results.
export function drawShop(ctx) {
  ctx.save();
  ctx.textAlign = 'center';

  ctx.font = 'bold 32px "Patrick Hand", cursive';
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText('SHOP', GAME_WIDTH / 2, 58);

  // Coin balance top right
  drawCoinIcon(GAME_WIDTH - 74, 50, 9);
  ctx.textAlign = 'left';
  ctx.font = 'bold 18px "Patrick Hand", cursive';
  ctx.fillStyle = 'rgba(255, 215, 0, 0.9)';
  ctx.fillText(Save.getCoins().toLocaleString(), GAME_WIDTH - 60, 56);

  drawShopCatalog(ctx);

  // Back button
  drawPanel(ctx, SHOP_BACK_BUTTON, { wobbleSeed: 4.2 });
  ctx.textAlign = 'center';
  ctx.font = 'bold 19px "Patrick Hand", cursive';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText('BACK', SHOP_BACK_BUTTON.x + SHOP_BACK_BUTTON.w / 2, SHOP_BACK_BUTTON.y + 29);

  ctx.restore();
}

// Shop rows are derived from the catalogs so layout and hit-testing
// can never drift apart.
function getSkinRows() {
  return Skins.SKINS.map((skin, i) => ({
    id: skin.id, skin, x: 30, y: 96 + i * 70, w: 340, h: 62,
  }));
}

function getUpgradeRows() {
  return Skins.UPGRADES.map((up, i) => ({
    id: up.id, up, x: 30, y: 418 + i * 68, w: 340, h: 58,
  }));
}

function drawShopCatalog(ctx) {
  const coins = Save.getCoins();
  ctx.save();

  // ── Skins ──
  ctx.textAlign = 'left';
  ctx.font = '14px "Patrick Hand", cursive';
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillText('SKINS', 32, 88);

  let wobble = 0;
  for (const row of getSkinRows()) {
    const { skin } = row;
    const owned = Save.isSkinUnlocked(skin.id);
    const equipped = Save.getSelectedSkin() === skin.id;
    const affordable = coins >= skin.price;

    const accent = equipped ? '46, 204, 113'
                 : owned || affordable ? '255, 255, 255'
                 : '150, 150, 150';
    drawPanel(ctx, row, { accent, wobbleSeed: wobble++ * 2.3 });

    // Palette swatches — a quick taste of the skin
    const swatchTiers = [1, 2, 4, 6];
    swatchTiers.forEach((tierIdx, si) => {
      const src = skin.palette ? skin.palette[tierIdx] : BALL_TIERS[tierIdx];
      ctx.fillStyle = src.color;
      ctx.strokeStyle = src.stroke;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(row.x + 26 + si * 22, row.y + 31, 8.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });

    ctx.textAlign = 'left';
    ctx.font = 'bold 17px "Patrick Hand", cursive';
    ctx.fillStyle = `rgba(255,255,255,${owned || affordable ? 0.9 : 0.45})`;
    ctx.fillText(skin.name, row.x + 122, row.y + 26);

    ctx.font = '13px "Patrick Hand", cursive';
    if (equipped) {
      ctx.fillStyle = 'rgba(130, 235, 175, 0.9)';
      ctx.fillText('EQUIPPED', row.x + 122, row.y + 47);
    } else if (owned) {
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillText('tap to equip', row.x + 122, row.y + 47);
    } else {
      drawCoinIcon(row.x + 128, row.y + 43, 6);
      ctx.fillStyle = affordable ? 'rgba(255, 215, 0, 0.85)' : 'rgba(255, 215, 0, 0.35)';
      ctx.fillText(skin.price.toLocaleString(), row.x + 138, row.y + 47);
    }
  }

  // ── Upgrades ──
  ctx.textAlign = 'left';
  ctx.font = '14px "Patrick Hand", cursive';
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillText('UPGRADES', 32, 410);

  for (const row of getUpgradeRows()) {
    const { up } = row;
    const level = Save.getUpgradeLevel(up.id);
    const maxed = level >= up.maxLevel;
    const price = Skins.getUpgradePrice(up.id);
    const affordable = !maxed && coins >= price;

    drawPanel(ctx, row, {
      accent: maxed ? '241, 196, 15' : affordable ? '255, 255, 255' : '150, 150, 150',
      wobbleSeed: wobble++ * 2.3,
    });

    ctx.textAlign = 'left';
    ctx.font = 'bold 17px "Patrick Hand", cursive';
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillText(up.name, row.x + 16, row.y + 24);

    ctx.font = '12px "Patrick Hand", cursive';
    ctx.fillStyle = 'rgba(255,255,255,0.42)';
    ctx.fillText(up.desc, row.x + 16, row.y + 44);

    // Level pips
    for (let i = 0; i < up.maxLevel; i++) {
      ctx.fillStyle = i < level ? 'rgba(241, 196, 15, 0.9)' : 'rgba(255,255,255,0.18)';
      ctx.beginPath();
      ctx.arc(row.x + row.w - 24 - i * 16, row.y + 18, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.textAlign = 'right';
    ctx.font = '13px "Patrick Hand", cursive';
    if (maxed) {
      ctx.fillStyle = 'rgba(241, 196, 15, 0.8)';
      ctx.fillText('MAX', row.x + row.w - 16, row.y + 46);
    } else {
      drawCoinIcon(row.x + row.w - 58, row.y + 42, 6);
      ctx.fillStyle = affordable ? 'rgba(255, 215, 0, 0.85)' : 'rgba(255, 215, 0, 0.35)';
      ctx.fillText(price.toLocaleString(), row.x + row.w - 16, row.y + 46);
    }
  }

  ctx.restore();
}

// Returns { type: 'back' } | { type: 'skin', id } | { type: 'upgrade', id } | null
export function checkShopHit(x, y) {
  if (hitRect(SHOP_BACK_BUTTON, x, y)) return { type: 'back' };
  for (const row of getSkinRows()) {
    if (hitRect(row, x, y)) return { type: 'skin', id: row.id };
  }
  for (const row of getUpgradeRows()) {
    if (hitRect(row, x, y)) return { type: 'upgrade', id: row.id };
  }
  return null;
}

// ── Game Over Buttons ───────────────────────────────────────────
export function drawGameOverExtras(ctx, state) {
  // Buttons fade in after the accidental-tap guard window
  const sinceOver = performance.now() - (state.gameoverAt || 0);
  const alpha = Math.max(0, Math.min((sinceOver - 500) / 500, 1));
  if (alpha <= 0) return;

  ctx.save();
  for (const btn of GAMEOVER_BUTTONS) {
    const accent = btn.id === 'again' ? '46, 204, 113' : '255, 255, 255';
    drawPanel(ctx, btn, { accent, alpha, wobbleSeed: btn.id === 'again' ? 2.3 : 5.9 });
    ctx.textAlign = 'center';
    ctx.font = 'bold 18px "Patrick Hand", cursive';
    ctx.fillStyle = btn.id === 'again'
      ? `rgba(130, 235, 175, ${0.95 * alpha})`
      : `rgba(255, 255, 255, ${0.85 * alpha})`;
    ctx.fillText(btn.label, btn.x + btn.w / 2, btn.y + 30);
  }
  ctx.restore();
}

// Returns 'again' | 'menu' | null
export function checkGameOverHit(x, y) {
  for (const btn of GAMEOVER_BUTTONS) {
    if (hitRect(btn, x, y)) return btn.id;
  }
  return null;
}
