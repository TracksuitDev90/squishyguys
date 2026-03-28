// ── Unified Input (Mouse + Touch) ───────────────────────────────
import { CUP_LEFT_X, CUP_RIGHT_X, BALL_TIERS } from './config.js';

let canvas, scaleX, scaleY, offsetX, offsetY;

export const state = {
  pointerX: (CUP_LEFT_X + CUP_RIGHT_X) / 2,
  pointerActive: false,
  dropRequested: false,
};

export function init(canvasEl, logicalWidth, logicalHeight) {
  canvas = canvasEl;
  updateScale(logicalWidth, logicalHeight);

  // Mouse events
  canvas.addEventListener('mousemove', onPointerMove);
  canvas.addEventListener('mousedown', onPointerDown);
  canvas.addEventListener('mouseenter', () => { state.pointerActive = true; });
  canvas.addEventListener('mouseleave', () => { state.pointerActive = false; });

  // Touch events
  canvas.addEventListener('touchstart', onTouchStart, { passive: false });
  canvas.addEventListener('touchmove', onTouchMove, { passive: false });
  canvas.addEventListener('touchend', onTouchEnd, { passive: false });

  // Prevent context menu on long press
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}

export function updateScale(logicalWidth, logicalHeight) {
  const rect = canvas.getBoundingClientRect();
  scaleX = logicalWidth / rect.width;
  scaleY = logicalHeight / rect.height;
  offsetX = rect.left;
  offsetY = rect.top;
}

function toLogical(clientX) {
  const rect = canvas.getBoundingClientRect();
  const x = (clientX - rect.left) * (scaleX || 1);
  // Clamp to cup interior with a small margin for the current ball radius
  const margin = 16;
  return Math.max(CUP_LEFT_X + margin, Math.min(CUP_RIGHT_X - margin, x));
}

function onPointerMove(e) {
  state.pointerX = toLogical(e.clientX);
  state.pointerActive = true;
}

function onPointerDown(e) {
  state.pointerX = toLogical(e.clientX);
  state.dropRequested = true;
  state.pointerActive = true;
}

function onTouchStart(e) {
  e.preventDefault();
  const touch = e.touches[0];
  state.pointerX = toLogical(touch.clientX);
  state.pointerActive = true;
  state.dropRequested = true;
}

function onTouchMove(e) {
  e.preventDefault();
  const touch = e.touches[0];
  state.pointerX = toLogical(touch.clientX);
}

function onTouchEnd(e) {
  e.preventDefault();
  // Keep pointerActive true on touch so the preview stays visible
}
