// ── Unified Input (Mouse + Touch) ───────────────────────────────
// Desktop: move mouse to aim, click to drop
// Mobile: touch & drag to aim, release to drop (more natural on touch)
import { CUP_LEFT_X, CUP_RIGHT_X, GAME_WIDTH } from './config.js';

let canvas;
let logicalW, logicalH;
let isTouchDevice = false;

export const state = {
  pointerX: (CUP_LEFT_X + CUP_RIGHT_X) / 2,
  pointerActive: false,
  dropRequested: false,
  isDragging: false,       // touch: finger is currently down
  dragStartX: 0,           // where touch started
  pointerDown: false,      // raw pointer-down state
};

export function init(canvasEl, logicalWidth, logicalHeight) {
  canvas = canvasEl;
  logicalW = logicalWidth;
  logicalH = logicalHeight;

  // Detect touch support
  isTouchDevice = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

  // ── Mouse events ──────────────────────────────────────────────
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('mouseenter', () => { state.pointerActive = true; });
  canvas.addEventListener('mouseleave', () => {
    state.pointerActive = false;
    state.pointerDown = false;
  });

  // ── Touch events ──────────────────────────────────────────────
  canvas.addEventListener('touchstart', onTouchStart, { passive: false });
  canvas.addEventListener('touchmove', onTouchMove, { passive: false });
  canvas.addEventListener('touchend', onTouchEnd, { passive: false });
  canvas.addEventListener('touchcancel', onTouchCancel, { passive: false });

  // Prevent all default touch behaviors
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // Prevent double-tap zoom on iOS
  let lastTap = 0;
  canvas.addEventListener('touchend', (e) => {
    const now = Date.now();
    if (now - lastTap < 300) e.preventDefault();
    lastTap = now;
  }, { passive: false });
}

function toLogicalX(clientX) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = logicalW / rect.width;
  const x = (clientX - rect.left) * scaleX;
  const margin = 18;
  return Math.max(CUP_LEFT_X + margin, Math.min(CUP_RIGHT_X - margin, x));
}

// ── Mouse Handlers ──────────────────────────────────────────────
function onMouseMove(e) {
  state.pointerX = toLogicalX(e.clientX);
  state.pointerActive = true;
}

function onMouseDown(e) {
  state.pointerX = toLogicalX(e.clientX);
  state.pointerDown = true;
  state.pointerActive = true;
  // Desktop: click = immediate drop
  state.dropRequested = true;
}

function onMouseUp(e) {
  state.pointerDown = false;
}

// ── Touch Handlers ──────────────────────────────────────────────
function onTouchStart(e) {
  e.preventDefault();
  const touch = e.touches[0];
  const x = toLogicalX(touch.clientX);

  state.pointerX = x;
  state.pointerActive = true;
  state.isDragging = true;
  state.dragStartX = x;
  state.pointerDown = true;

  // Haptic feedback on touch start
  triggerHaptic('light');
}

function onTouchMove(e) {
  e.preventDefault();
  if (!e.touches.length) return;

  const touch = e.touches[0];
  state.pointerX = toLogicalX(touch.clientX);
  state.isDragging = true;
}

function onTouchEnd(e) {
  e.preventDefault();

  if (state.isDragging) {
    // Drop on release
    state.dropRequested = true;
    triggerHaptic('medium');
  }

  state.isDragging = false;
  state.pointerDown = false;
  // Keep pointerActive true so the preview doesn't vanish immediately
  // It will fade in the renderer
}

function onTouchCancel(e) {
  e.preventDefault();
  state.isDragging = false;
  state.pointerDown = false;
}

// ── Haptic Feedback ─────────────────────────────────────────────
function triggerHaptic(style) {
  if (!navigator.vibrate) return;
  switch (style) {
    case 'light':
      navigator.vibrate(10);
      break;
    case 'medium':
      navigator.vibrate(20);
      break;
    case 'heavy':
      navigator.vibrate([30, 20, 30]);
      break;
    case 'success':
      navigator.vibrate([20, 40, 20, 40, 40]);
      break;
  }
}

export function hapticMerge(tierIndex) {
  if (tierIndex >= 7) {
    triggerHaptic('heavy');
  } else if (tierIndex >= 4) {
    triggerHaptic('medium');
  } else {
    triggerHaptic('light');
  }
}

export function hapticGameOver() {
  triggerHaptic('heavy');
}

export function hapticWin() {
  triggerHaptic('success');
}

export function getIsTouchDevice() {
  return isTouchDevice;
}
