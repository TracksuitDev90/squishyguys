// ── Specials Store ──────────────────────────────────────────────
// Players spend in-game points to buy power-ups.

export const STORE_ITEMS = [
  {
    id: 'colorBomb',
    name: 'COLOR BOMB',
    desc: 'Merges all balls of one color',
    basePrice: 150,
    icon: '\u25C9', // ◉
  },
  {
    id: 'cupExtend',
    name: 'CUP+',
    desc: 'Makes the cup taller',
    basePrice: 200,
    icon: '\u2B06', // ⬆
  },
];

// Track how many times each item has been bought this game (for price scaling)
let purchaseCounts = { colorBomb: 0, cupExtend: 0 };

// Active state
let colorBombActive = false;
let cupExtensions = 0;
const CUP_EXTEND_PX = 35; // how much each extension adds

export function getPrice(itemId) {
  const item = STORE_ITEMS.find(i => i.id === itemId);
  if (!item) return Infinity;
  const count = purchaseCounts[itemId] || 0;
  // Price scales: base, base*1.8, base*3, base*4.5 ...
  return Math.round(item.basePrice * (1 + count * 0.8));
}

export function canAfford(itemId, currentScore) {
  return currentScore >= getPrice(itemId);
}

export function purchase(itemId, currentScore) {
  const price = getPrice(itemId);
  if (currentScore < price) return { success: false, cost: 0 };

  purchaseCounts[itemId] = (purchaseCounts[itemId] || 0) + 1;

  if (itemId === 'colorBomb') {
    colorBombActive = true;
  } else if (itemId === 'cupExtend') {
    cupExtensions++;
  }

  return { success: true, cost: price };
}

export function isColorBombActive() {
  return colorBombActive;
}

export function consumeColorBomb() {
  colorBombActive = false;
}

export function getCupExtensions() {
  return cupExtensions;
}

export function getCupExtendPx() {
  return cupExtensions * CUP_EXTEND_PX;
}

export function reset() {
  purchaseCounts = { colorBomb: 0, cupExtend: 0 };
  colorBombActive = false;
  cupExtensions = 0;
}
