// ── Unified Input (Mouse + Touch) ───────────────────────────────
// Desktop: move mouse to aim, click to drop
// Mobile: touch & drag to aim, release to drop (more natural on touch)
import { CUP_LEFT_X, CUP_RIGHT_X, GAME_WIDTH } from './config.js';

let canvas;
let logicalW, logicalH;
let isTouchDevice = false;
// UI hit-test supplied by main.js: (x, y) in game space → true if a
// button/menu consumed the press. Called synchronously inside the
// pointer-down handler, so a press on a button can never also become
// a drop. (The old approach — deferring the drop to a microtask so a
// second listener could veto it — didn't work: browsers run microtasks
// between event listeners, so the drop was queued before the veto.)
let uiHitTest = null;

export function setUIHitTest(fn) {
  uiHitTest = fn;
}

// The canvas rect only changes on resize; reading it on every pointer
// move forces a layout pass, which is jank on phones
let cachedRect = null;
function canvasRect() {
  if (!cachedRect) cachedRect = canvas.getBoundingClientRect();
  return cachedRect;
}
function invalidateRect() {
  cachedRect = null;
}

function toLogical(clientX, clientY) {
  const rect = canvasRect();
  return {
    x: (clientX - rect.left) * (logicalW / rect.width),
    y: (clientY - rect.top) * (logicalH / rect.height),
  };
}
// Half-width of whatever is about to drop — the aim clamp keeps the
// whole fruit inside the rim, not just its center (a watermelon aimed
// at the edge used to spawn overlapping the wall and get spat out).
let clampRadius = 18;

export const state = {
  pointerX: (CUP_LEFT_X + CUP_RIGHT_X) / 2,
  pointerActive: false,
  dropRequested: false,
  isDragging: false,       // touch: finger is currently down
  dragStartX: 0,           // where touch started
  pointerDown: false,      // raw pointer-down state
  uiConsumed: false,       // set true when a UI element consumes the input
  pressStartedAt: 0,       // performance.now() when the current/last press began
  hoverX: -1,              // raw (unclamped) pointer position in game space,
  hoverY: -1,              // -1 while the cursor is off the canvas (touch stays -1)
};

export function init(canvasEl, logicalWidth, logicalHeight) {
  canvas = canvasEl;
  logicalW = logicalWidth;
  logicalH = logicalHeight;

  // Detect touch support
  isTouchDevice = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

  window.addEventListener('resize', invalidateRect);
  window.addEventListener('orientationchange', invalidateRect);
  window.addEventListener('scroll', invalidateRect, { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', invalidateRect);
    window.visualViewport.addEventListener('scroll', invalidateRect);
  }
  // The renderer resizes the canvas after these same events fire, so
  // refresh lazily on the next pointer event rather than right now

  // ── Mouse events ──────────────────────────────────────────────
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('mouseenter', () => { state.pointerActive = true; });
  canvas.addEventListener('mouseleave', () => {
    state.pointerActive = false;
    state.pointerDown = false;
    state.hoverX = -1;
    state.hoverY = -1;
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

function clampToCup(x) {
  const margin = clampRadius + 4;
  return Math.max(CUP_LEFT_X + margin, Math.min(CUP_RIGHT_X - margin, x));
}

function toLogicalX(clientX) {
  const rect = canvasRect();
  const scaleX = logicalW / rect.width;
  return clampToCup((clientX - rect.left) * scaleX);
}

// Called by main.js whenever the queued drop changes size, so the aim
// clamp (and the preview that follows it) always fits the fruit.
export function setClampRadius(r) {
  clampRadius = Math.max(8, r || 0);
  state.pointerX = clampToCup(state.pointerX);
}

// Unclamped game-space coordinates — used for UI hover (tooltips),
// which needs to reach areas outside the cup's drop range.
function updateHover(clientX, clientY) {
  const rect = canvasRect();
  state.hoverX = (clientX - rect.left) * (logicalW / rect.width);
  state.hoverY = (clientY - rect.top) * (logicalH / rect.height);
}

// ── Mouse Handlers ──────────────────────────────────────────────
function onMouseMove(e) {
  state.pointerX = toLogicalX(e.clientX);
  state.pointerActive = true;
  updateHover(e.clientX, e.clientY);
}

function onMouseDown(e) {
  // Only the primary button drops — a right-click opening the (blocked)
  // context menu shouldn't spend a fruit
  if (e.button !== 0) return;
  state.pressStartedAt = performance.now();
  state.pointerX = toLogicalX(e.clientX);
  state.pointerDown = true;
  state.pointerActive = true;
  // Desktop: click = immediate drop, unless a UI element takes it
  const ui = toLogical(e.clientX, e.clientY);
  state.uiConsumed = !!(uiHitTest && uiHitTest(ui.x, ui.y));
  if (!state.uiConsumed) {
    state.dropRequested = true;
  }
}

function onMouseUp(e) {
  state.pointerDown = false;
}

// ── Touch Handlers ──────────────────────────────────────────────
function onTouchStart(e) {
  e.preventDefault();
  const touch = e.touches[0];
  const x = toLogicalX(touch.clientX);

  // Drops fire on release, so remember when this press began: a finger
  // that was already down when the run ended must not restart it
  state.pressStartedAt = performance.now();
  state.pointerX = x;
  state.pointerActive = true;
  state.isDragging = true;
  state.dragStartX = x;
  state.pointerDown = true;
  // A touch that lands on a button belongs to the button — the release
  // must not drop a fruit
  const ui = toLogical(touch.clientX, touch.clientY);
  state.uiConsumed = !!(uiHitTest && uiHitTest(ui.x, ui.y));

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

  if (state.isDragging && !state.uiConsumed) {
    // Drop on release (unless a UI element consumed this touch)
    state.dropRequested = true;
    triggerHaptic('medium');
  }

  state.isDragging = false;
  state.pointerDown = false;
  state.uiConsumed = false;
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
