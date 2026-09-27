// ── Game Clock ──────────────────────────────────────────────────
// Simulation time in ms. It only moves when main.js steps the physics,
// so it stops dead whenever the game does: a backgrounded tab (rAF
// paused), a phone call, a long GC stall. Anything that measures how
// long something has been happening *in the cup* — the danger timer,
// the spawn grace period, the bomb suck-in, the drop cooldown — reads
// this instead of performance.now(). Otherwise a player who switched
// apps for ten seconds would come back to an instant game over because
// the wall clock kept counting while the pile sat frozen above the line.
let t = 0;

export function now() {
  return t;
}

export function advance(ms) {
  t += ms;
}
