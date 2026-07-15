// ── Skins, Themes & Permanent Upgrades ──────────────────────────
// Cosmetic skin sets are palette swaps over the same fruit shapes
// (plus a `detail` mode that decides whether fruit stems/stripes or a
// generic candy gloss is drawn). Purchases spend the persistent coin
// bank in save.js. Mirrors the store.js module style.
import { BALL_TIERS } from './config.js';
import * as Save from './save.js';

// Palettes cover tiers 0-7; dragonfruit and rainbow (8-9) stay special
// in every skin — they're the goal fruits.
export const SKINS = [
  {
    id: 'classic', name: 'FRUIT SALAD', price: 0, detail: 'fruit',
    palette: null, // null = BALL_TIERS colors
    bg: null,      // null = default background
  },
  {
    id: 'candy', name: 'CANDY SHOP', price: 300, detail: 'gloss',
    palette: [
      { color: '#FFF3E0', stroke: '#D7B894' }, // white chocolate
      { color: '#FF5CA8', stroke: '#C73580' }, // bubblegum
      { color: '#FFE066', stroke: '#D4A917' }, // lemon drop
      { color: '#FF8C42', stroke: '#CC6318' }, // orange taffy
      { color: '#4CD97B', stroke: '#2A9D54' }, // sour apple
      { color: '#5BC8F5', stroke: '#2E96C4' }, // blue raspberry
      { color: '#9B59D0', stroke: '#6E3A9E' }, // grape gum
      { color: '#F06292', stroke: '#C2185B' }, // raspberry cream
    ],
    bg: ['#2b1230', '#3d1a44', '#54245f', '#6b2d6e'],
  },
  {
    id: 'neon', name: 'NEON NIGHTS', price: 600, detail: 'gloss',
    palette: [
      { color: '#E8FFF7', stroke: '#8EE8CE' },
      { color: '#FF3D81', stroke: '#C4165A' },
      { color: '#F9F871', stroke: '#C9C825' },
      { color: '#FF9E1F', stroke: '#D97706' },
      { color: '#39FF88', stroke: '#0FBF5F' },
      { color: '#26C6FF', stroke: '#0891C9' },
      { color: '#B26BFF', stroke: '#7C3AED' },
      { color: '#FF6BF5', stroke: '#C026D3' },
    ],
    bg: ['#05010f', '#0a0520', '#141033', '#1b1440'],
  },
  {
    id: 'doodle', name: 'DOODLE', price: 900, detail: 'plain',
    palette: [
      { color: '#FAFAF2', stroke: '#3A3A3A' },
      { color: '#F5D9D9', stroke: '#3A3A3A' },
      { color: '#F5EFC9', stroke: '#3A3A3A' },
      { color: '#F7DFC2', stroke: '#3A3A3A' },
      { color: '#D5EAD3', stroke: '#3A3A3A' },
      { color: '#D3DEF2', stroke: '#3A3A3A' },
      { color: '#E3D3EE', stroke: '#3A3A3A' },
      { color: '#EFD8F0', stroke: '#3A3A3A' },
    ],
    bg: ['#26221c', '#2e2a22', '#3a352a', '#453f31'],
  },
];

// Permanent upgrades bought with coins; applied at the start of every
// run (see startGame in main.js).
export const UPGRADES = [
  {
    id: 'startCup', name: 'TALL CUP', desc: 'start each run with a taller cup',
    basePrice: 800, maxLevel: 2,
  },
  {
    id: 'discount', name: 'HAGGLER', desc: 'in-run shop 10% cheaper per level',
    basePrice: 600, maxLevel: 3,
  },
];

// Cache the active skin so getTierStyle is a cheap per-draw lookup
let activeSkin = null;

function resolveActiveSkin() {
  if (!activeSkin) {
    const id = Save.getSelectedSkin();
    activeSkin = SKINS.find(s => s.id === id) || SKINS[0];
  }
  return activeSkin;
}

// Called after equipping a different skin
export function refresh() {
  activeSkin = null;
  resolveActiveSkin();
}

// The renderer's single color source for tier fills/strokes.
// Falls back to BALL_TIERS for dragonfruit/rainbow and the classic skin.
export function getTierStyle(tierIndex) {
  const skin = resolveActiveSkin();
  if (skin.palette && skin.palette[tierIndex]) return skin.palette[tierIndex];
  return BALL_TIERS[tierIndex];
}

// 'fruit' (stems, stripes, coconut eyes) | 'gloss' (candy sheen) | 'plain'
export function getDetailMode() {
  return resolveActiveSkin().detail;
}

// Background gradient stops for the active skin (null = default)
export function getActiveTheme() {
  return resolveActiveSkin().bg;
}

// ── Shop actions ────────────────────────────────────────────────
export function getSkinPrice(id) {
  const skin = SKINS.find(s => s.id === id);
  return skin ? skin.price : Infinity;
}

// Buying a skin also equips it — one less tap, and the reward is
// instantly visible. Returns true on success.
export function purchaseSkin(id) {
  const skin = SKINS.find(s => s.id === id);
  if (!skin || Save.isSkinUnlocked(id)) return false;
  if (!Save.spendCoins(skin.price)) return false;
  Save.unlockSkin(id);
  Save.setSelectedSkin(id);
  refresh();
  return true;
}

export function selectSkin(id) {
  if (!Save.isSkinUnlocked(id)) return false;
  Save.setSelectedSkin(id);
  refresh();
  return true;
}

export function getUpgradePrice(id) {
  const up = UPGRADES.find(u => u.id === id);
  if (!up) return Infinity;
  return up.basePrice * (Save.getUpgradeLevel(id) + 1);
}

export function purchaseUpgrade(id) {
  const up = UPGRADES.find(u => u.id === id);
  if (!up) return false;
  if (Save.getUpgradeLevel(id) >= up.maxLevel) return false;
  if (!Save.spendCoins(getUpgradePrice(id))) return false;
  Save.incrementUpgrade(id);
  return true;
}
