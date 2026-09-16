// ── Cup Materials ───────────────────────────────────────────────
// The cup the fruit fall into is a real object with a real material.
// Brushed steel is the default; the rest are bought in the unlock shop
// with the persistent coin bank (same flow as skins.js). The painters
// that actually draw each material live in cupart.js.
import * as Save from './save.js';

export const CUPS = [
  {
    id: 'steel', name: 'BRUSHED STEEL', price: 0,
    desc: 'cold, heavy, catches the light',
  },
  {
    id: 'paper', name: 'PAPER CUP', price: 250,
    desc: 'rolled rim, printed stripe, to go',
  },
  {
    id: 'plastic', name: 'CLEAR PLASTIC', price: 400,
    desc: 'see-through, ribbed, a little squeaky',
  },
  {
    id: 'wood', name: 'OAK BARREL', price: 650,
    desc: 'warm grain with a knot or two',
  },
  {
    id: 'gold', name: 'SOLID GOLD', price: 1200,
    desc: 'because the rainbow deserves it',
  },
];

let activeCup = null;

function resolveActiveCup() {
  if (!activeCup) {
    const id = Save.getSelectedCup();
    activeCup = CUPS.find(c => c.id === id) || CUPS[0];
  }
  return activeCup;
}

export function refresh() {
  activeCup = null;
  resolveActiveCup();
}

export function getActiveCup() {
  return resolveActiveCup();
}

export function getActiveCupId() {
  return resolveActiveCup().id;
}

export function getCupPrice(id) {
  const cup = CUPS.find(c => c.id === id);
  return cup ? cup.price : Infinity;
}

// Buying a cup also equips it — the reward is instantly visible.
export function purchaseCup(id) {
  const cup = CUPS.find(c => c.id === id);
  if (!cup || Save.isCupUnlocked(id)) return false;
  if (!Save.spendCoins(cup.price)) return false;
  Save.unlockCup(id);
  Save.setSelectedCup(id);
  refresh();
  return true;
}

export function selectCup(id) {
  if (!Save.isCupUnlocked(id)) return false;
  Save.setSelectedCup(id);
  refresh();
  return true;
}
