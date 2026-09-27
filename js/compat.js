// ── Canvas Compatibility Shims ──────────────────────────────────
// The renderer leans on two canvas APIs that only arrived in 2022:
// roundRect (store pills, fever meter, the cup's rim) and conic
// gradients (the rainbow fruit). Phones that can't update past iOS 15,
// and older Android WebViews, don't have them, and a single missing
// method throws on every frame, freezing the game on a half-drawn
// screen. This module is imported first by main.js so the shims are in
// place before anything draws.

// Spec-shaped roundRect: `radii` is a number or a 1–4 item list (CSS
// corner order), radii shrink proportionally when they would overlap,
// and a negative width/height mirrors the rect like the native method.
function roundRectShim(x, y, w, h, radii = 0) {
  const list = Array.isArray(radii) ? radii : [radii];
  const r = list.map((v) => (typeof v === 'number' ? v : (v && v.x) || 0));
  let [tl, tr, br, bl] =
    r.length >= 4 ? r :
    r.length === 3 ? [r[0], r[1], r[2], r[1]] :
    r.length === 2 ? [r[0], r[1], r[0], r[1]] :
    [r[0] || 0, r[0] || 0, r[0] || 0, r[0] || 0];

  if (w < 0) { x += w; w = -w; [tl, tr, br, bl] = [tr, tl, bl, br]; }
  if (h < 0) { y += h; h = -h; [tl, tr, br, bl] = [bl, br, tr, tl]; }

  let scale = 1;
  const fit = (side, a, b) => { if (a + b > side) scale = Math.min(scale, side / (a + b)); };
  fit(w, tl, tr); fit(w, bl, br); fit(h, tl, bl); fit(h, tr, br);
  tl *= scale; tr *= scale; br *= scale; bl *= scale;

  this.moveTo(x + tl, y);
  this.lineTo(x + w - tr, y);
  this.arcTo(x + w, y, x + w, y + tr, tr);
  this.lineTo(x + w, y + h - br);
  this.arcTo(x + w, y + h, x + w - br, y + h, br);
  this.lineTo(x + bl, y + h);
  this.arcTo(x, y + h, x, y + h - bl, bl);
  this.lineTo(x, y + tl);
  this.arcTo(x, y, x + tl, y, tl);
  this.closePath();
  this.moveTo(x, y);
}

const targets = [
  window.CanvasRenderingContext2D,
  window.OffscreenCanvasRenderingContext2D,
  window.Path2D,
];
for (const T of targets) {
  if (T && T.prototype && typeof T.prototype.roundRect !== 'function') {
    T.prototype.roundRect = roundRectShim;
  }
}

// No conic gradients: fall back to a linear sweep through the center at
// the same angle. The rainbow still spins through every color (the
// angle animates), it just bands instead of pinwheeling.
const CONIC_FALLBACK_REACH = 90; // a little past the rainbow fruit's radius
for (const T of [window.CanvasRenderingContext2D, window.OffscreenCanvasRenderingContext2D]) {
  if (T && T.prototype && typeof T.prototype.createConicGradient !== 'function') {
    T.prototype.createConicGradient = function (startAngle, cx, cy) {
      const dx = Math.cos(startAngle) * CONIC_FALLBACK_REACH;
      const dy = Math.sin(startAngle) * CONIC_FALLBACK_REACH;
      return this.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
    };
  }
}
