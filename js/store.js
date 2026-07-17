// ── Specials Store ──────────────────────────────────────────────
// Players spend in-game points to buy power-ups.
// The desc lines double as the in-run tooltip copy — keep them short,
// concrete, and about what the player gets for their points.

export const STORE_ITEMS = [
  {
    id: 'colorBomb',
    name: 'COLOR BOMB',
    desc: 'Your next drop is a bomb: it pulls in every fruit of the first color it touches and merges them all at once.',
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
let purchaseCounts = { colorBomb: 0, cupExtend: 0, ghostBall: 0 };

// Active state
let bombQueued = false; // next drop will be a bomb ball
let ghostQueued = false; // next drop will be a ghost ball
let cupExtensions = 0;
const CUP_EXTEND_PX = 35; // how much each extension adds

// Permanent HAGGLER upgrade: 0-0.3 price reduction, set by main.js at
// run start. Survives reset() — it's re-applied every startGame anyway.
let discount = 0;

export function setDiscount(pct) {
  discount = Math.max(0, Math.min(pct, 0.9));
}

// Permanent TALL CUP upgrade: pre-grant extensions at run start without
// charging or inflating the CUP+ price ladder.
export function grantFreeCupExtensions(n) {
  cupExtensions += n;
}

export function getPrice(itemId) {
  const item = STORE_ITEMS.find(i => i.id === itemId);
  if (!item) return Infinity;
  const count = purchaseCounts[itemId] || 0;
  // Price scales per purchase: base, 2x, 3x, 4x ...
  return Math.round(item.basePrice * (1 + count) * (1 - discount));
}

export function canAfford(itemId, currentScore) {
  return currentScore >= getPrice(itemId);
}

export function purchase(itemId, currentScore) {
  const price = getPrice(itemId);
  if (currentScore < price) return { success: false, cost: 0 };

  purchaseCounts[itemId] = (purchaseCounts[itemId] || 0) + 1;

  if (itemId === 'colorBomb') {
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
  purchaseCounts = { colorBomb: 0, cupExtend: 0, ghostBall: 0 };
  bombQueued = false;
  ghostQueued = false;
  cupExtensions = 0;
}
