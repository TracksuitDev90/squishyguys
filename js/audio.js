// ── Synthesized Sound Effects (Web Audio API) ──────────────────
// All sounds generated procedurally — no audio files needed.

let audioCtx = null;
let masterGain = null;
let muted = false;

// Note frequencies for merge sounds (descending — bigger balls = deeper pitch)
const MERGE_NOTES = [
  659.25, // E5 - white→red (smallest, highest pitch)
  587.33, // D5 - red→yellow
  523.25, // C5 - yellow→orange
  493.88, // B4 - orange→green
  440.00, // A4 - green→blue
  392.00, // G4 - blue→indigo
  349.23, // F4 - indigo→violet
  329.63, // E4 - violet→chrome
  293.66, // D4 - chrome→rainbow
  261.63, // C4 - rainbow bonus (biggest, deepest pitch)
];

function ensureContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.3;
    masterGain.connect(audioCtx.destination);
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

export function toggleMute() {
  muted = !muted;
  if (masterGain) {
    masterGain.gain.value = muted ? 0 : 0.3;
  }
  return muted;
}

export function isMuted() {
  return muted;
}

// ── Drop sound: soft thud + tiny chirp ──────────────────────────
export function playDrop(tierIndex) {
  const ctx = ensureContext();
  if (!ctx) return;

  const now = ctx.currentTime;

  // Soft percussive thud — deeper for bigger balls
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(220 - tierIndex * 18, now);
  osc.frequency.exponentialRampToValueAtTime(Math.max(30, 60 - tierIndex * 4), now + 0.1);
  gain.gain.setValueAtTime(0.2 + tierIndex * 0.02, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15 + tierIndex * 0.02);
  osc.connect(gain);
  gain.connect(masterGain);
  osc.start(now);
  osc.stop(now + 0.18 + tierIndex * 0.02);

  // Tiny chirp — lower pitch for bigger balls
  const chirp = ctx.createOscillator();
  const chirpGain = ctx.createGain();
  chirp.type = 'sine';
  chirp.frequency.setValueAtTime(1000 - tierIndex * 70, now);
  chirp.frequency.exponentialRampToValueAtTime(Math.max(200, 500 - tierIndex * 30), now + 0.08);
  chirpGain.gain.setValueAtTime(0.08, now);
  chirpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
  chirp.connect(chirpGain);
  chirpGain.connect(masterGain);
  chirp.start(now);
  chirp.stop(now + 0.1);
}

// ── Merge sound: musical chime that rises with tier ─────────────
export function playMerge(tierIndex, comboCount) {
  const ctx = ensureContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const baseFreq = MERGE_NOTES[Math.min(tierIndex, MERGE_NOTES.length - 1)];

  // Main chime tone
  const osc1 = ctx.createOscillator();
  const gain1 = ctx.createGain();
  osc1.type = 'sine';
  osc1.frequency.setValueAtTime(baseFreq, now);
  gain1.gain.setValueAtTime(0.3, now);
  gain1.gain.setValueAtTime(0.35, now + 0.02);
  gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
  osc1.connect(gain1);
  gain1.connect(masterGain);
  osc1.start(now);
  osc1.stop(now + 0.5);

  // Harmonic overtone (octave + fifth)
  const osc2 = ctx.createOscillator();
  const gain2 = ctx.createGain();
  osc2.type = 'sine';
  osc2.frequency.setValueAtTime(baseFreq * 1.5, now);
  gain2.gain.setValueAtTime(0.12, now);
  gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
  osc2.connect(gain2);
  gain2.connect(masterGain);
  osc2.start(now);
  osc2.stop(now + 0.35);

  // Combo extra: rising arpeggio
  if (comboCount > 1) {
    const comboTones = Math.min(comboCount, 4);
    for (let i = 0; i < comboTones; i++) {
      const delay = 0.05 + i * 0.08;
      const freq = baseFreq * Math.pow(2, (i + 1) / 12);
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + delay);
      g.gain.setValueAtTime(0, now);
      g.gain.setValueAtTime(0.15, now + delay);
      g.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.2);
      osc.connect(g);
      g.connect(masterGain);
      osc.start(now + delay);
      osc.stop(now + delay + 0.25);
    }
  }

  // High tier: add shimmer
  if (tierIndex >= 6) {
    const shimmer = ctx.createOscillator();
    const shimmerGain = ctx.createGain();
    shimmer.type = 'sine';
    shimmer.frequency.setValueAtTime(baseFreq * 3, now);
    shimmer.frequency.setValueAtTime(baseFreq * 4, now + 0.1);
    shimmerGain.gain.setValueAtTime(0.06, now);
    shimmerGain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    shimmer.connect(shimmerGain);
    shimmerGain.connect(masterGain);
    shimmer.start(now);
    shimmer.stop(now + 0.4);
  }

  // Rainbow: major chord fanfare
  if (tierIndex === 9) {
    const chord = [1, 1.25, 1.5, 2]; // root, major 3rd, 5th, octave
    chord.forEach((ratio, i) => {
      const delay = 0.1 + i * 0.12;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(baseFreq * ratio, now + delay);
      g.gain.setValueAtTime(0.2, now + delay);
      g.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.8);
      osc.connect(g);
      g.connect(masterGain);
      osc.start(now + delay);
      osc.stop(now + delay + 0.8);
    });
  }
}

// ── Bomb suction sound: rising whoosh as balls get pulled in ────
export function playBombSuck() {
  const ctx = ensureContext();
  if (!ctx) return;

  const now = ctx.currentTime;

  // Rising whoosh (filtered noise via oscillator sweep)
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(60, now);
  osc.frequency.exponentialRampToValueAtTime(400, now + 0.4);
  gain.gain.setValueAtTime(0.0, now);
  gain.gain.linearRampToValueAtTime(0.15, now + 0.15);
  gain.gain.linearRampToValueAtTime(0.2, now + 0.35);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
  osc.connect(gain);
  gain.connect(masterGain);
  osc.start(now);
  osc.stop(now + 0.5);

  // Sub-bass rumble
  const sub = ctx.createOscillator();
  const subGain = ctx.createGain();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(40, now);
  sub.frequency.exponentialRampToValueAtTime(80, now + 0.45);
  subGain.gain.setValueAtTime(0.12, now);
  subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
  sub.connect(subGain);
  subGain.connect(masterGain);
  sub.start(now);
  sub.stop(now + 0.5);
}

// ── Bounce sound: soft impact when balls collide with walls ─────
export function playBounce(speed) {
  const ctx = ensureContext();
  if (!ctx || speed < 2) return; // Only play for significant impacts

  const now = ctx.currentTime;
  const vol = Math.min(speed * 0.02, 0.15);

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(80 + speed * 10, now);
  osc.frequency.exponentialRampToValueAtTime(40, now + 0.08);
  gain.gain.setValueAtTime(vol, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
  osc.connect(gain);
  gain.connect(masterGain);
  osc.start(now);
  osc.stop(now + 0.1);
}

// ── Game over sound: descending sad tones ───────────────────────
export function playGameOver() {
  const ctx = ensureContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const notes = [392, 349.23, 293.66, 261.63]; // G4 → C4 descending

  notes.forEach((freq, i) => {
    const delay = i * 0.25;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now + delay);
    g.gain.setValueAtTime(0.2, now + delay);
    g.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.4);
    osc.connect(g);
    g.connect(masterGain);
    osc.start(now + delay);
    osc.stop(now + delay + 0.45);
  });
}

// ── Win sound: triumphant ascending fanfare ─────────────────────
export function playWin() {
  const ctx = ensureContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const notes = [523.25, 659.25, 783.99, 1046.50]; // C5 → C6 ascending

  notes.forEach((freq, i) => {
    const delay = i * 0.15;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now + delay);
    g.gain.setValueAtTime(0.25, now + delay);
    g.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.6);
    osc.connect(g);
    g.connect(masterGain);
    osc.start(now + delay);
    osc.stop(now + delay + 0.65);

    // Harmony
    const osc2 = ctx.createOscillator();
    const g2 = ctx.createGain();
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(freq * 1.5, now + delay + 0.05);
    g2.gain.setValueAtTime(0.1, now + delay + 0.05);
    g2.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.5);
    osc2.connect(g2);
    g2.connect(masterGain);
    osc2.start(now + delay + 0.05);
    osc2.stop(now + delay + 0.55);
  });
}

// ── Danger warning: low pulsing hum ─────────────────────────────
let dangerOsc = null;
let dangerGain = null;

export function startDangerHum() {
  const ctx = ensureContext();
  if (!ctx || dangerOsc) return;

  dangerOsc = ctx.createOscillator();
  dangerGain = ctx.createGain();
  dangerOsc.type = 'sawtooth';
  dangerOsc.frequency.setValueAtTime(55, ctx.currentTime);
  dangerGain.gain.setValueAtTime(0, ctx.currentTime);
  dangerOsc.connect(dangerGain);
  dangerGain.connect(masterGain);
  dangerOsc.start();
}

export function updateDangerHum(level) {
  if (!dangerGain) return;
  dangerGain.gain.setTargetAtTime(level * 0.08, audioCtx.currentTime, 0.1);
}

export function stopDangerHum() {
  if (dangerOsc) {
    dangerOsc.stop();
    dangerOsc = null;
    dangerGain = null;
  }
}
