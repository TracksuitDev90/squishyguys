// ── Specials Store ──────────────────────────────────────────────
// Players spend in-game points to buy power-ups.
// The desc lines double as the in-run tooltip copy — keep them short,
// concrete, and about what the player gets for their points.
import { CUP_EXTEND_PX, MAX_CUP_EXTENSIONS } from './config.js';

export const STORE_ITEMS = [
  {
    id: 'mergeBomb',
    name: 'MERGE',
    desc: 'Your next drop is a merge bomb: the first fruit it touches pulls in every matching fruit in the cup, and they all merge at once.',
    basePrice: 150,
    icon: '\u25C9', // ◉
  },
  {
    id: 'cupExtend',
    name: 'CUP+',
    desc: 'Raises the cup walls and the danger line, giving you more room to stack before overflowing.',
    basePrice: 200,
    icon: '\u2B06', // ⬆
  },
  {
    id: 'ghostBall',
    name: 'GHOST',
    desc: 'Your next drop falls through other fruit. Tap to make it solid mid-fall, or let it settle at the bottom.',
    basePrice: 100,
    icon: '\u25C7', // ◇
  },
];

// Track how many times each item has been bought this game (for price scaling)
let purchaseCounts = { mergeBomb: 0, cupExtend: 0, ghostBall: 0 };

// Active state
let bombQueued = false; // next drop will be a bomb ball
let ghostQueued = false; // next drop will be a ghost ball
let cupExtensions = 0;

// Permanent HAGGLER upgrade: 0-0.3 price reduction, set by main.js at
// run start. Survives reset() — it's re-applied every startGame anyway.
let discount = 0;

export function setDiscount(pct) {
  discount = Math.max(0, Math.min(pct, 0.9));
}

// Permanent TALL CUP upgrade: pre-grant extensions at run start without
// charging or inflating the CUP+ price ladder.
export function grantFreeCupExtensions(n) {
  cupExtensions = Math.min(cupExtensions + n, MAX_CUP_EXTENSIONS);
}

// Why an item can't be bought right now (null = purchasable). A bomb or
// ghost is a one-slot queue — buying a second while one is still waiting
// to drop would just burn points — and the cup has a height ceiling.
export function getBlockReason(itemId) {
  if (itemId === 'mergeBomb' && bombQueued) return 'queued';
  if (itemId === 'ghostBall' && ghostQueued) return 'queued';
  if (itemId === 'cupExtend' && cupExtensions >= MAX_CUP_EXTENSIONS) return 'maxed';
  return null;
}

export function getPrice(itemId) {
  const item = STORE_ITEMS.find(i => i.id === itemId);
  if (!item) return Infinity;
  const count = purchaseCounts[itemId] || 0;
  // Price scales per purchase: base, 2x, 3x, 4x ...
  return Math.round(item.basePrice * (1 + count) * (1 - discount));
}

export function canAfford(itemId, currentScore) {
  return !getBlockReason(itemId) && currentScore >= getPrice(itemId);
}

export function purchase(itemId, currentScore) {
  const price = getPrice(itemId);
  if (getBlockReason(itemId)) return { success: false, cost: 0, reason: getBlockReason(itemId) };
  if (currentScore < price) return { success: false, cost: 0, reason: 'points' };

  purchaseCounts[itemId] = (purchaseCounts[itemId] || 0) + 1;

  if (itemId === 'mergeBomb') {
    bombQueued = true;
  } else if (itemId === 'cupExtend') {
    cupExtensions++;
  } else if (itemId === 'ghostBall') {
    ghostQueued = true;
  }

  return { success: true, cost: price };
}

export function isBombQueued() {
  return bombQueued;
}

export function consumeBombQueue() {
  bombQueued = false;
}

export function isGhostQueued() {
  return ghostQueued;
}

export function consumeGhostQueue() {
  ghostQueued = false;
}

export function getCupExtensions() {
  return cupExtensions;
}

export function getCupExtendPx() {
  return cupExtensions * CUP_EXTEND_PX;
}

export function reset() {
  purchaseCounts = { mergeBomb: 0, cupExtend: 0, ghostBall: 0 };
  bombQueued = false;
  ghostQueued = false;
  cupExtensions = 0;
}
