// ── Cup Painters ────────────────────────────────────────────────
// Procedural material rendering for the cup. Every material is painted
// ONCE into an offscreen canvas (renderer.js caches the result and just
// drawImage()s it each frame), so the painters are free to use the
// expensive stuff — clips, shadow blur, hundreds of grain strokes —
// that would be far too slow to redraw every frame on a phone.
//
// Geometry is passed in so the same painters draw the in-game cup, a
// taller extended cup, and the little shop thumbnails:
//   leftX/rightX  inner x of the walls at the rim
//   rimY/bottomY  y of the rim and of the floor's top face
//   baseExtra     how much wider each side gets at the base (flare)
//   wall          wall/floor thickness

// ── Seeded random (grain must not change between re-renders) ────
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Geometry helpers ────────────────────────────────────────────
function withFaces(geom) {
  const { leftX, rightX, rimY, bottomY, baseExtra, wall } = geom;
  const span = bottomY - rimY;
  const flare = (y) => baseExtra * Math.max(0, Math.min((y - rimY) / span, 1));
  return {
    ...geom,
    innerL: (y) => leftX - flare(y),
    innerR: (y) => rightX + flare(y),
    outerL: (y) => leftX - flare(y) - wall,
    outerR: (y) => rightX + flare(y) + wall,
    lipH: wall * 0.55,
  };
}

// U-shaped band: both walls and the floor as one closed polygon.
// `wobble` jitters the edges for hand-cut materials (paper).
function bodyPath(g, wobble = 0, seed = 1) {
  const r = rng(seed);
  const p = new Path2D();
  const jit = () => (wobble ? (r() - 0.5) * wobble * 2 : 0);
  const line = (x1, y1, x2, y2, first) => {
    const segs = wobble ? 14 : 1;
    for (let i = first ? 0 : 1; i <= segs; i++) {
      const t = i / segs;
      const x = x1 + (x2 - x1) * t + (i === 0 || i === segs ? 0 : jit());
      const y = y1 + (y2 - y1) * t + (i === 0 || i === segs ? 0 : jit());
      if (first && i === 0) p.moveTo(x, y); else p.lineTo(x, y);
    }
  };
  const { rimY, bottomY, wall } = g;
  const floorY = bottomY + wall;
  line(g.outerL(rimY), rimY, g.outerL(bottomY), floorY, true);
  line(g.outerL(bottomY), floorY, g.outerR(bottomY), floorY);
  line(g.outerR(bottomY), floorY, g.outerR(rimY), rimY);
  line(g.outerR(rimY), rimY, g.innerR(rimY), rimY);
  line(g.innerR(rimY), rimY, g.innerR(bottomY), bottomY);
  line(g.innerR(bottomY), bottomY, g.innerL(bottomY), bottomY);
  line(g.innerL(bottomY), bottomY, g.innerL(rimY), rimY);
  p.closePath();
  return p;
}

// Quad covering one wall (for wall-local gradients)
function wallQuad(g, side) {
  const p = new Path2D();
  const o = side < 0 ? g.outerL : g.outerR;
  const n = side < 0 ? g.innerL : g.innerR;
  p.moveTo(o(g.rimY), g.rimY);
  p.lineTo(o(g.bottomY), g.bottomY + g.wall);
  p.lineTo(n(g.bottomY), g.bottomY + g.wall);
  p.lineTo(n(g.rimY), g.rimY);
  p.closePath();
  return p;
}

// Gradient running across a wall's thickness (outer → inner face)
function acrossWall(c, g, side, stops) {
  const midY = (g.rimY + g.bottomY) / 2;
  const o = side < 0 ? g.outerL(midY) : g.outerR(midY);
  const n = side < 0 ? g.innerL(midY) : g.innerR(midY);
  const grad = c.createLinearGradient(o, 0, n, 0);
  for (const [t, col] of stops) grad.addColorStop(t, col);
  return grad;
}

// Soft dark shadow under and around the cup so it sits on the scene
function groundShadow(c, g) {
  const { bottomY, wall } = g;
  c.save();
  c.fillStyle = 'rgba(3, 3, 14, 0.5)';
  c.shadowColor = 'rgba(3, 3, 14, 0.55)';
  c.shadowBlur = wall * 1.4;
  c.shadowOffsetY = wall * 0.4;
  c.fill(bodyPath(g));
  c.restore();
  // Contact shadow pooled under the base
  c.save();
  const cx = (g.innerL(bottomY) + g.innerR(bottomY)) / 2;
  const rx = (g.outerR(bottomY) - g.outerL(bottomY)) / 2 + wall * 0.5;
  const grad = c.createRadialGradient(cx, bottomY + wall, 0, cx, bottomY + wall, rx);
  grad.addColorStop(0, 'rgba(0, 0, 10, 0.45)');
  grad.addColorStop(1, 'rgba(0, 0, 10, 0)');
  c.fillStyle = grad;
  c.beginPath();
  c.ellipse(cx, bottomY + wall, rx, wall * 0.9, 0, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

// Ambient occlusion inside the cup — the inner faces cast a soft
// shade onto the "back" of the cup so the interior reads as a hollow
// rather than a flat cutout. Drawn under the fruit (the cup layer
// renders first) so it never muddies the fruit themselves.
function interiorShade(c, g, strength = 0.26) {
  const { rimY, bottomY } = g;
  const reach = g.wall * 2.2;
  c.save();
  for (const side of [-1, 1]) {
    const n = side < 0 ? g.innerL : g.innerR;
    const midY = (rimY + bottomY) / 2;
    const grad = c.createLinearGradient(n(midY), 0, n(midY) - side * reach, 0);
    grad.addColorStop(0, `rgba(0, 0, 12, ${strength})`);
    grad.addColorStop(1, 'rgba(0, 0, 12, 0)');
    c.fillStyle = grad;
    c.beginPath();
    c.moveTo(n(rimY), rimY + 2);
    c.lineTo(n(bottomY), bottomY);
    c.lineTo(n(bottomY) - side * reach, bottomY);
    c.lineTo(n(rimY) - side * reach, rimY + 2);
    c.closePath();
    c.fill();
  }
  const fg = c.createLinearGradient(0, bottomY, 0, bottomY - reach * 0.8);
  fg.addColorStop(0, `rgba(0, 0, 12, ${strength * 0.9})`);
  fg.addColorStop(1, 'rgba(0, 0, 12, 0)');
  c.fillStyle = fg;
  c.fillRect(g.innerL(bottomY), bottomY - reach * 0.8, g.innerR(bottomY) - g.innerL(bottomY), reach * 0.8);
  c.restore();
}

// Rounded cap on top of each wall — a rolled rim, a machined lip
function lipPath(g, side, grow = 0) {
  const o = side < 0 ? g.outerL(g.rimY) : g.outerR(g.rimY);
  const n = side < 0 ? g.innerL(g.rimY) : g.innerR(g.rimY);
  const x = Math.min(o, n) - 1.5 - grow;
  const w = Math.abs(n - o) + 3 + grow * 2;
  const h = g.lipH * 1.9 + grow * 2;
  const p = new Path2D();
  p.roundRect(x, g.rimY - g.lipH - grow, w, h, Math.min(w, h) / 2);
  return p;
}

function verticalLipGradient(c, g, stops) {
  const grad = c.createLinearGradient(0, g.rimY - g.lipH, 0, g.rimY + g.lipH * 0.9);
  for (const [t, col] of stops) grad.addColorStop(t, col);
  return grad;
}

// ── Materials ───────────────────────────────────────────────────

// Brushed metal — a spun cylinder: one horizontal gradient across the
// whole cup gives the left wall the light and the right wall the
// shade, fine horizontal strokes are the brushing, one hard specular
// streak sells the polish.
function paintMetal(c, g, pal, seed) {
  const { rimY, bottomY, wall } = g;
  const body = bodyPath(g);
  groundShadow(c, g);

  const grad = c.createLinearGradient(g.outerL(bottomY), 0, g.outerR(bottomY), 0);
  grad.addColorStop(0.00, pal.dark);
  grad.addColorStop(0.06, pal.mid);
  grad.addColorStop(0.20, pal.light);
  grad.addColorStop(0.36, pal.mid);
  grad.addColorStop(0.60, pal.deep);
  grad.addColorStop(0.82, pal.mid);
  grad.addColorStop(0.93, pal.light);
  grad.addColorStop(1.00, pal.dark);
  c.fillStyle = grad;
  c.fill(body);

  c.save();
  c.clip(body);

  // Brushing: dense horizontal hairlines with random length and weight
  const r = rng(seed);
  const h = bottomY + wall - rimY;
  const count = Math.round(h * 1.6);
  c.lineCap = 'butt';
  for (let i = 0; i < count; i++) {
    const y = rimY + r() * h;
    const bright = r() > 0.5;
    c.strokeStyle = bright ? `rgba(255,255,255,${0.03 + r() * 0.09})` : `rgba(0,0,0,${0.03 + r() * 0.1})`;
    c.lineWidth = 0.4 + r() * 0.8;
    c.beginPath();
    if (y < bottomY) {
      for (const side of [-1, 1]) {
        const o = side < 0 ? g.outerL(y) : g.outerR(y);
        const n = side < 0 ? g.innerL(y) : g.innerR(y);
        const a = o + (n - o) * r() * 0.4;
        const b = n - (n - o) * r() * 0.4;
        c.moveTo(a, y);
        c.lineTo(b, y);
      }
    } else {
      const l = g.outerL(bottomY);
      const rr = g.outerR(bottomY);
      const a = l + (rr - l) * r() * 0.6;
      c.moveTo(a, y);
      c.lineTo(a + (rr - a) * (0.3 + r() * 0.7), y);
    }
    c.stroke();
  }

  // Specular streak down the lit (left) wall, a ghost of one on the right
  c.fillStyle = acrossWall(c, g, -1, [
    [0, 'rgba(255,255,255,0)'], [0.22, 'rgba(255,255,255,0)'],
    [0.38, `rgba(255,255,255,${pal.spec})`], [0.55, 'rgba(255,255,255,0)'], [1, 'rgba(255,255,255,0)'],
  ]);
  c.fill(wallQuad(g, -1));
  c.fillStyle = acrossWall(c, g, 1, [
    [0, 'rgba(255,255,255,0)'], [0.55, 'rgba(255,255,255,0)'],
    [0.7, `rgba(255,255,255,${pal.spec * 0.35})`], [0.82, 'rgba(255,255,255,0)'], [1, 'rgba(255,255,255,0)'],
  ]);
  c.fill(wallQuad(g, 1));

  // Top light / bottom weight
  const v = c.createLinearGradient(0, rimY, 0, bottomY + wall);
  v.addColorStop(0, 'rgba(255,255,255,0.14)');
  v.addColorStop(0.35, 'rgba(255,255,255,0)');
  v.addColorStop(0.8, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.28)');
  c.fillStyle = v;
  c.fill(body);
  c.restore();

  // Machined edges
  c.strokeStyle = pal.edge;
  c.lineWidth = 1.2;
  c.lineJoin = 'round';
  c.stroke(body);
  c.strokeStyle = 'rgba(255,255,255,0.28)';
  c.lineWidth = 0.9;
  c.beginPath();
  c.moveTo(g.innerL(rimY) - 0.5, rimY + 1);
  c.lineTo(g.innerL(bottomY) - 0.5, bottomY - 0.5);
  c.lineTo(g.innerR(bottomY) + 0.5, bottomY - 0.5);
  c.lineTo(g.innerR(rimY) + 0.5, rimY + 1);
  c.stroke();

  // Lip — bright rolled rim
  for (const side of [-1, 1]) {
    const lp = lipPath(g, side);
    c.fillStyle = verticalLipGradient(c, g, [
      [0, pal.light], [0.45, pal.mid], [0.7, pal.deep], [1, pal.dark],
    ]);
    c.fill(lp);
    c.strokeStyle = pal.edge;
    c.lineWidth = 1;
    c.stroke(lp);
    c.strokeStyle = 'rgba(255,255,255,0.5)';
    c.lineWidth = 0.8;
    c.beginPath();
    const o = side < 0 ? g.outerL(rimY) : g.outerR(rimY);
    const n = side < 0 ? g.innerL(rimY) : g.innerR(rimY);
    c.moveTo(Math.min(o, n) + 1.5, rimY - g.lipH * 0.45);
    c.lineTo(Math.max(o, n) - 1.5, rimY - g.lipH * 0.45);
    c.stroke();
  }

  interiorShade(c, g, 0.3);
}

const STEEL = {
  dark: '#4d545c', deep: '#6b737c', mid: '#9ea7b0', light: '#e3e8ec',
  edge: 'rgba(20, 24, 30, 0.6)', spec: 0.5,
};
const GOLD = {
  dark: '#6b4c0f', deep: '#a3782a', mid: '#d9ad45', light: '#fff0b3',
  edge: 'rgba(60, 40, 8, 0.65)', spec: 0.65,
};

// Paper — warm off-white with fiber flecks, a rolled rim, and a
// printed stripe around the middle like a takeaway cup.
function paintPaper(c, g, seed) {
  const { rimY, bottomY, wall } = g;
  const body = bodyPath(g, 0.55, seed);
  groundShadow(c, g);

  const base = c.createLinearGradient(0, rimY, 0, bottomY + wall);
  base.addColorStop(0, '#f8f3ea');
  base.addColorStop(1, '#e6dccb');
  c.fillStyle = base;
  c.fill(body);

  c.save();
  c.clip(body);
  const r = rng(seed);
  // Fiber flecks
  const h = bottomY + wall - rimY;
  const w = g.outerR(bottomY) - g.outerL(bottomY);
  const flecks = Math.round(w * h * 0.03);
  for (let i = 0; i < flecks; i++) {
    const x = g.outerL(bottomY) + r() * w;
    const y = rimY + r() * h;
    c.fillStyle = r() > 0.5 ? 'rgba(120, 90, 60, 0.09)' : 'rgba(80, 70, 60, 0.06)';
    c.fillRect(x, y, 0.6 + r() * 0.9, 0.4 + r() * 0.6);
  }
  // Longer fibers
  c.lineCap = 'round';
  for (let i = 0; i < flecks * 0.08; i++) {
    const x = g.outerL(bottomY) + r() * w;
    const y = rimY + r() * h;
    const a = r() * Math.PI;
    const len = 1.5 + r() * 3;
    c.strokeStyle = `rgba(110, 85, 60, ${0.05 + r() * 0.06})`;
    c.lineWidth = 0.5;
    c.beginPath();
    c.moveTo(x - Math.cos(a) * len, y - Math.sin(a) * len);
    c.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    c.stroke();
  }
  // Printed stripes around the walls
  const stripeY = rimY + (bottomY - rimY) * 0.42;
  const stripeH = Math.max(3, wall * 0.5);
  for (const side of [-1, 1]) {
    const o = side < 0 ? g.outerL : g.outerR;
    const n = side < 0 ? g.innerL : g.innerR;
    c.fillStyle = 'rgba(58, 169, 143, 0.85)';
    c.beginPath();
    c.moveTo(o(stripeY), stripeY);
    c.lineTo(n(stripeY), stripeY);
    c.lineTo(n(stripeY + stripeH), stripeY + stripeH);
    c.lineTo(o(stripeY + stripeH), stripeY + stripeH);
    c.closePath();
    c.fill();
    const y2 = stripeY + stripeH * 1.8;
    c.fillStyle = 'rgba(58, 169, 143, 0.55)';
    c.beginPath();
    c.moveTo(o(y2), y2);
    c.lineTo(n(y2), y2);
    c.lineTo(n(y2 + stripeH * 0.4), y2 + stripeH * 0.4);
    c.lineTo(o(y2 + stripeH * 0.4), y2 + stripeH * 0.4);
    c.closePath();
    c.fill();
  }
  // Cylinder shading
  const cyl = c.createLinearGradient(g.outerL(bottomY), 0, g.outerR(bottomY), 0);
  cyl.addColorStop(0, 'rgba(60, 40, 20, 0.10)');
  cyl.addColorStop(0.25, 'rgba(60, 40, 20, 0)');
  cyl.addColorStop(0.7, 'rgba(60, 40, 20, 0.02)');
  cyl.addColorStop(1, 'rgba(60, 40, 20, 0.18)');
  c.fillStyle = cyl;
  c.fill(body);
  c.restore();

  c.strokeStyle = 'rgba(95, 75, 55, 0.55)';
  c.lineWidth = 1.4;
  c.lineJoin = 'round';
  c.stroke(body);

  // Rolled rim
  for (const side of [-1, 1]) {
    const lp = lipPath(g, side, 0.6);
    c.fillStyle = verticalLipGradient(c, g, [
      [0, '#fbf7ef'], [0.6, '#efe7d8'], [1, '#d9cdb8'],
    ]);
    c.fill(lp);
    c.strokeStyle = 'rgba(95, 75, 55, 0.55)';
    c.lineWidth = 1.2;
    c.stroke(lp);
  }

  interiorShade(c, g, 0.2);
}

// Clear plastic — mostly see-through, so what sells it is the light:
// a hard specular streak, ribbed rings, and bright edge highlights.
function paintPlastic(c, g) {
  const { rimY, bottomY, wall } = g;
  const body = bodyPath(g);

  c.save();
  c.fillStyle = 'rgba(0, 0, 10, 0.18)';
  c.shadowColor = 'rgba(0, 0, 10, 0.4)';
  c.shadowBlur = wall;
  c.shadowOffsetY = wall * 0.3;
  c.fill(body);
  c.restore();

  const base = c.createLinearGradient(0, rimY, 0, bottomY + wall);
  base.addColorStop(0, 'rgba(205, 232, 250, 0.30)');
  base.addColorStop(1, 'rgba(160, 200, 235, 0.42)');
  c.fillStyle = base;
  c.fill(body);

  c.save();
  c.clip(body);
  // Ribs
  for (const f of [0.16, 0.28, 0.40, 0.52, 0.64]) {
    const y = rimY + (bottomY - rimY) * f;
    for (const side of [-1, 1]) {
      const o = side < 0 ? g.outerL(y) : g.outerR(y);
      const n = side < 0 ? g.innerL(y) : g.innerR(y);
      c.strokeStyle = 'rgba(255,255,255,0.42)';
      c.lineWidth = 1;
      c.beginPath(); c.moveTo(o, y); c.lineTo(n, y); c.stroke();
      c.strokeStyle = 'rgba(30, 60, 100, 0.22)';
      c.beginPath(); c.moveTo(o, y + 1.5); c.lineTo(n, y + 1.5); c.stroke();
    }
  }
  // Specular streaks
  c.fillStyle = acrossWall(c, g, -1, [
    [0, 'rgba(255,255,255,0)'], [0.18, 'rgba(255,255,255,0)'],
    [0.32, 'rgba(255,255,255,0.62)'], [0.5, 'rgba(255,255,255,0)'], [1, 'rgba(255,255,255,0)'],
  ]);
  c.fill(wallQuad(g, -1));
  c.fillStyle = acrossWall(c, g, 1, [
    [0, 'rgba(255,255,255,0)'], [0.5, 'rgba(255,255,255,0)'],
    [0.68, 'rgba(255,255,255,0.3)'], [0.8, 'rgba(255,255,255,0)'], [1, 'rgba(255,255,255,0)'],
  ]);
  c.fill(wallQuad(g, 1));
  // Floor gleam
  const fg = c.createLinearGradient(g.outerL(bottomY), 0, g.outerR(bottomY), 0);
  fg.addColorStop(0, 'rgba(255,255,255,0.05)');
  fg.addColorStop(0.3, 'rgba(255,255,255,0.35)');
  fg.addColorStop(0.5, 'rgba(255,255,255,0.05)');
  fg.addColorStop(1, 'rgba(255,255,255,0.15)');
  c.fillStyle = fg;
  c.fillRect(g.outerL(bottomY), bottomY, g.outerR(bottomY) - g.outerL(bottomY), wall);
  c.restore();

  c.strokeStyle = 'rgba(255,255,255,0.6)';
  c.lineWidth = 1;
  c.lineJoin = 'round';
  c.stroke(body);
  c.strokeStyle = 'rgba(40, 80, 120, 0.35)';
  c.lineWidth = 0.8;
  c.beginPath();
  c.moveTo(g.innerL(rimY) - 1, rimY + 1);
  c.lineTo(g.innerL(bottomY) - 1, bottomY - 1);
  c.lineTo(g.innerR(bottomY) + 1, bottomY - 1);
  c.lineTo(g.innerR(rimY) + 1, rimY + 1);
  c.stroke();

  for (const side of [-1, 1]) {
    const lp = lipPath(g, side, 0.4);
    c.fillStyle = verticalLipGradient(c, g, [
      [0, 'rgba(240, 250, 255, 0.75)'], [0.5, 'rgba(200, 230, 250, 0.45)'], [1, 'rgba(150, 190, 230, 0.5)'],
    ]);
    c.fill(lp);
    c.strokeStyle = 'rgba(255,255,255,0.7)';
    c.lineWidth = 1;
    c.stroke(lp);
  }

  interiorShade(c, g, 0.12);
}

// Wood — warm stain, long wavy grain running with the walls, a knot,
// and end-grain rings on the rim.
function paintWood(c, g, seed) {
  const { rimY, bottomY, wall } = g;
  const body = bodyPath(g, 0.25, seed);
  groundShadow(c, g);

  const base = c.createLinearGradient(0, rimY, 0, bottomY + wall);
  base.addColorStop(0, '#b97a4b');
  base.addColorStop(0.5, '#a5673b');
  base.addColorStop(1, '#84502c');
  c.fillStyle = base;
  c.fill(body);

  c.save();
  c.clip(body);
  const r = rng(seed);
  c.lineCap = 'round';
  // Wall grain
  for (const side of [-1, 1]) {
    const o = side < 0 ? g.outerL : g.outerR;
    const lines = 7 + Math.round(wall * 0.4);
    for (let i = 0; i < lines; i++) {
      const off = (i + 0.3 + r() * 0.5) / lines * wall;
      const amp = 0.4 + r() * 1.2;
      const freq = 0.02 + r() * 0.04;
      const phase = r() * Math.PI * 2;
      c.strokeStyle = `rgba(70, 40, 18, ${0.18 + r() * 0.32})`;
      c.lineWidth = 0.5 + r() * 1.1;
      c.beginPath();
      const steps = 40;
      for (let s = 0; s <= steps; s++) {
        const y = rimY + (bottomY + wall - rimY) * (s / steps);
        const x = o(Math.min(y, bottomY)) + off + Math.sin(y * freq + phase) * amp
                + Math.sin(y * freq * 3.1 + phase) * amp * 0.3;
        if (s === 0) c.moveTo(x, y); else c.lineTo(x, y);
      }
      c.stroke();
    }
  }
  // Floor grain (horizontal)
  const floorLines = 4 + Math.round(wall * 0.3);
  for (let i = 0; i < floorLines; i++) {
    const off = (i + 0.3 + r() * 0.5) / floorLines * wall;
    const amp = 0.3 + r() * 0.9;
    const freq = 0.02 + r() * 0.03;
    const phase = r() * Math.PI * 2;
    c.strokeStyle = `rgba(70, 40, 18, ${0.18 + r() * 0.3})`;
    c.lineWidth = 0.5 + r() * 1;
    c.beginPath();
    const l = g.outerL(bottomY);
    const rr = g.outerR(bottomY);
    const steps = 40;
    for (let s = 0; s <= steps; s++) {
      const x = l + (rr - l) * (s / steps);
      const y = bottomY + off + Math.sin(x * freq + phase) * amp;
      if (s === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.stroke();
  }
  // A knot on the right wall, another lower on the left
  const knots = [
    { side: 1, f: 0.58 }, { side: -1, f: 0.3 },
  ];
  for (const k of knots) {
    const y = rimY + (bottomY - rimY) * k.f;
    const o = k.side < 0 ? g.outerL(y) : g.outerR(y);
    const n = k.side < 0 ? g.innerL(y) : g.innerR(y);
    const kx = (o + n) / 2 + (r() - 0.5) * wall * 0.3;
    c.fillStyle = 'rgba(70, 40, 18, 0.35)';
    c.beginPath();
    c.ellipse(kx, y, wall * 0.22, wall * 0.5, 0, 0, Math.PI * 2);
    c.fill();
    for (let ring = 1; ring <= 3; ring++) {
      c.strokeStyle = `rgba(70, 40, 18, ${0.5 - ring * 0.1})`;
      c.lineWidth = 0.7;
      c.beginPath();
      c.ellipse(kx, y, wall * 0.14 * ring + wall * 0.08, wall * 0.36 * ring + wall * 0.2, 0, 0, Math.PI * 2);
      c.stroke();
    }
  }
  // Cylinder shading
  const cyl = c.createLinearGradient(g.outerL(bottomY), 0, g.outerR(bottomY), 0);
  cyl.addColorStop(0, 'rgba(40, 20, 8, 0.22)');
  cyl.addColorStop(0.2, 'rgba(255, 220, 170, 0.12)');
  cyl.addColorStop(0.45, 'rgba(40, 20, 8, 0)');
  cyl.addColorStop(1, 'rgba(40, 20, 8, 0.3)');
  c.fillStyle = cyl;
  c.fill(body);
  c.restore();

  c.strokeStyle = 'rgba(50, 28, 12, 0.8)';
  c.lineWidth = 1.6;
  c.lineJoin = 'round';
  c.stroke(body);

  // End-grain rim
  for (const side of [-1, 1]) {
    const lp = lipPath(g, side, 0.3);
    c.fillStyle = verticalLipGradient(c, g, [
      [0, '#d39a63'], [0.6, '#c2864f'], [1, '#9d6236'],
    ]);
    c.fill(lp);
    c.save();
    c.clip(lp);
    const o = side < 0 ? g.outerL(rimY) : g.outerR(rimY);
    const n = side < 0 ? g.innerL(rimY) : g.innerR(rimY);
    const cx = (o + n) / 2;
    c.strokeStyle = 'rgba(70, 40, 18, 0.35)';
    c.lineWidth = 0.6;
    for (let ring = 1; ring <= 3; ring++) {
      c.beginPath();
      c.ellipse(cx, rimY - g.lipH * 0.1, wall * 0.15 * ring, g.lipH * 0.3 * ring, 0, 0, Math.PI * 2);
      c.stroke();
    }
    c.restore();
    c.strokeStyle = 'rgba(50, 28, 12, 0.8)';
    c.lineWidth = 1.3;
    c.stroke(lp);
  }

  interiorShade(c, g, 0.3);
}

const PAINTERS = {
  steel: (c, g, seed) => paintMetal(c, g, STEEL, seed),
  gold: (c, g, seed) => paintMetal(c, g, GOLD, seed),
  paper: paintPaper,
  plastic: paintPlastic,
  wood: paintWood,
};

// Paint a cup into a fresh offscreen canvas. Returns the canvas plus
// where to draw it in game units.
export function renderCup(styleId, geom, scale) {
  const g = withFaces(geom);
  const margin = geom.wall * 1.6 + 8;
  const x0 = g.outerL(geom.bottomY) - margin;
  const y0 = geom.rimY - g.lipH - margin;
  const w = g.outerR(geom.bottomY) - g.outerL(geom.bottomY) + margin * 2;
  const h = geom.bottomY + geom.wall + margin - y0;

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(w * scale));
  canvas.height = Math.max(1, Math.ceil(h * scale));
  const c = canvas.getContext('2d');
  c.scale(scale, scale);
  c.translate(-x0, -y0);

  const painter = PAINTERS[styleId] || PAINTERS.steel;
  painter(c, g, 1337);

  return { canvas, x: x0, y: y0, w, h };
}

export function hasStyle(styleId) {
  return !!PAINTERS[styleId];
}
