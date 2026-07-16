// ── Dreampop / Lofi Background Music (Web Audio, procedural) ─────
// No audio files — an 8-bar loop in F major (Fmaj7 → Am7 → Dm9 →
// Bbmaj9) synthesized live: detuned triangle keys through a lowpass,
// a sine sub bass, soft noise hats, a muffled kick/rim, and a looped
// vinyl-crackle bed. A slow "tape wobble" LFO bends every melodic
// oscillator a few cents for the dreampop shimmer.
//
// Tempo reacts to play intensity: setIntensity(0..1) glides the BPM
// from 84 up to 96 (and brightens the keys) over a couple of seconds,
// so big combos audibly quicken the groove without ever jerking.
//
// Routing goes through audio.js's masterGain, so the existing mute
// toggle silences music for free.
import * as Audio from './audio.js';

const BASE_BPM = 84;
const MAX_BPM = 96;
const LOOKAHEAD_MS = 25;        // scheduler tick
const SCHEDULE_AHEAD_SEC = 0.12; // how far ahead notes are queued
const STEPS_PER_BAR = 16;        // 16th-note grid
const BARS_PER_CHORD = 2;
const MUSIC_GAIN = 0.16;

// Chord voicings as MIDI notes, with a low root for the bass.
const CHORDS = [
  { root: 41, notes: [65, 69, 72, 76] }, // Fmaj7  (F2 | F4 A4 C5 E5)
  { root: 45, notes: [64, 67, 69, 72] }, // Am7    (A2 | E4 G4 A4 C5)
  { root: 38, notes: [62, 65, 69, 76] }, // Dm9    (D2 | D4 F4 A4 E5)
  { root: 34, notes: [58, 62, 65, 72] }, // Bbmaj9 (Bb1| Bb3 D4 F4 C5)
];

let ctx = null;
let musicGain = null;
let keysFilter = null;
let tapeLFO = null;
let tapeLFOGain = null;
let noiseBuffer = null;
let crackleSource = null;

let playing = false;
let timer = null;
let nextStepTime = 0;
let step = 0;
let bpm = BASE_BPM;
let targetIntensity = 0;

function midiToFreq(n) {
  return 440 * Math.pow(2, (n - 69) / 12);
}

function ensureNodes() {
  ctx = Audio.getContext();
  if (musicGain) return;

  musicGain = ctx.createGain();
  musicGain.gain.value = 0;
  musicGain.connect(Audio.getMasterGain());

  // Keys share one lowpass — intensity opens it up for a brighter feel
  keysFilter = ctx.createBiquadFilter();
  keysFilter.type = 'lowpass';
  keysFilter.frequency.value = 1200;
  keysFilter.Q.value = 0.6;
  keysFilter.connect(musicGain);

  // Tape wobble: ±4 cents at 0.5 Hz, patched into oscillator detune
  tapeLFO = ctx.createOscillator();
  tapeLFO.type = 'sine';
  tapeLFO.frequency.value = 0.5;
  tapeLFOGain = ctx.createGain();
  tapeLFOGain.gain.value = 4;
  tapeLFO.connect(tapeLFOGain);
  tapeLFO.start();

  // Shared white-noise buffer for hats and rim
  const len = Math.floor(ctx.sampleRate * 0.2);
  noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
}

// Sparse random pops, looped — the vinyl surface noise
function buildCrackleBuffer() {
  const dur = 2;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < 40; i++) {
    const at = Math.floor(Math.random() * (len - 8));
    const amp = (Math.random() * 2 - 1) * (0.3 + Math.random() * 0.7);
    for (let j = 0; j < 6; j++) {
      data[at + j] += amp * (1 - j / 6);
    }
  }
  return buf;
}

function startCrackle() {
  crackleSource = ctx.createBufferSource();
  crackleSource.buffer = buildCrackleBuffer();
  crackleSource.loop = true;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 4000;
  const g = ctx.createGain();
  g.gain.value = 0.018;
  crackleSource.connect(lp).connect(g).connect(musicGain);
  crackleSource.start();
}

// ── Voices ──────────────────────────────────────────────────────
function playKeyNote(freq, when, dur, vel) {
  for (const det of [-7, 7]) {
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    osc.detune.value = det;
    tapeLFOGain.connect(osc.detune);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(vel, when + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    osc.connect(g).connect(keysFilter);
    osc.start(when);
    osc.stop(when + dur + 0.05);
  }
}

function playChord(chord, when) {
  // Gentle strum: chord tones staggered 25 ms
  chord.notes.forEach((n, i) => {
    playKeyNote(midiToFreq(n), when + i * 0.025, 1.8, 0.05);
  });
}

function playBass(midi, when, dur) {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = midiToFreq(midi);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, when);
  g.gain.linearRampToValueAtTime(0.2, when + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  osc.connect(g).connect(musicGain);
  osc.start(when);
  osc.stop(when + dur + 0.05);
}

function playHat(when, vel, dur = 0.045) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 6500;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vel, when);
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  src.connect(hp).connect(g).connect(musicGain);
  src.start(when);
  src.stop(when + dur + 0.02);
}

function playKick(when) {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(110, when);
  osc.frequency.exponentialRampToValueAtTime(45, when + 0.1);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.16, when);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.12);
  osc.connect(g).connect(musicGain);
  osc.start(when);
  osc.stop(when + 0.15);
}

function playRim(when) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1800;
  bp.Q.value = 1.2;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.07, when);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.07);
  src.connect(bp).connect(g).connect(musicGain);
  src.start(when);
  src.stop(when + 0.09);
}

// ── Sequencer ───────────────────────────────────────────────────
function scheduleStep(stepIndex, when) {
  const totalSteps = STEPS_PER_BAR * BARS_PER_CHORD * CHORDS.length;
  const s = stepIndex % totalSteps;
  const inBar = s % STEPS_PER_BAR;
  const bar = Math.floor(s / STEPS_PER_BAR);
  const chordIndex = Math.floor(bar / BARS_PER_CHORD) % CHORDS.length;
  const chord = CHORDS[chordIndex];

  // Keys: beat 1 and the "and" of 3, every bar
  if (inBar === 0 || inBar === 10) {
    playChord(chord, when);
  }

  // Bass: roots on 1 and 3, plus a passing 8th leading into the next
  // chord at the end of its second bar
  if (inBar === 0 || inBar === 8) {
    playBass(chord.root, when, 0.5);
  } else if (inBar === 14 && bar % BARS_PER_CHORD === 1) {
    const next = CHORDS[(chordIndex + 1) % CHORDS.length];
    playBass(next.root, when, 0.3);
  }

  // Hats on every 8th, velocity see-sawing; an open hat rings out on
  // the "and" of 3 every 4th bar
  if (inBar % 2 === 0) {
    playHat(when, inBar % 4 === 0 ? 0.05 : 0.028);
  }
  if (inBar === 10 && bar % 4 === 3) {
    playHat(when, 0.045, 0.12);
  }

  // Lofi kit, quiet under the SFX: kick on 1 & 3, rim on 2 & 4
  if (inBar === 0 || inBar === 8) playKick(when);
  if (inBar === 4 || inBar === 12) playRim(when);
}

function schedulerTick() {
  // Ease BPM toward the intensity target (~2-3 s glide, click-free
  // because tempo only affects *future* step times)
  const targetBpm = BASE_BPM + (MAX_BPM - BASE_BPM) * targetIntensity;
  bpm += (targetBpm - bpm) * 0.015;

  // Intensity also lifts the music slightly and opens the keys filter
  musicGain.gain.setTargetAtTime(MUSIC_GAIN + 0.03 * targetIntensity, ctx.currentTime, 0.5);
  keysFilter.frequency.setTargetAtTime(1200 + 600 * targetIntensity, ctx.currentTime, 0.5);

  while (nextStepTime < ctx.currentTime + SCHEDULE_AHEAD_SEC) {
    scheduleStep(step, nextStepTime);
    step++;
    nextStepTime += (60 / bpm) / 4; // 16th note
  }
}

function startScheduler() {
  nextStepTime = ctx.currentTime + 0.05;
  timer = setInterval(schedulerTick, LOOKAHEAD_MS);
}

// Chrome throttles timers in hidden tabs far past our lookahead, which
// would leave gaps — pause cleanly and pick the groove back up on return
document.addEventListener('visibilitychange', () => {
  if (!playing) return;
  if (document.hidden) {
    clearInterval(timer);
    timer = null;
  } else if (!timer) {
    startScheduler();
  }
});

// ── Public API ──────────────────────────────────────────────────
export function start() {
  if (playing) return;
  ensureNodes();
  playing = true;
  step = 0;
  bpm = BASE_BPM;
  targetIntensity = 0;
  // No explicit fade-in: the scheduler tick's setTargetAtTime eases the
  // gain up from silence (~1.5 s), which doubles as the intro fade
  musicGain.gain.cancelScheduledValues(ctx.currentTime);
  musicGain.gain.setValueAtTime(0.0001, ctx.currentTime);
  startCrackle();
  if (!document.hidden) startScheduler();
}

export function stop(fadeSec = 1) {
  if (!playing) return;
  playing = false;
  clearInterval(timer);
  timer = null;
  musicGain.gain.cancelScheduledValues(ctx.currentTime);
  musicGain.gain.setValueAtTime(Math.max(musicGain.gain.value, 0.0001), ctx.currentTime);
  musicGain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + fadeSec);
  if (crackleSource) {
    crackleSource.stop(ctx.currentTime + fadeSec);
    crackleSource = null;
  }
}

// 0..1 — how hard the run is going right now (combo streaks, fever)
export function setIntensity(v) {
  targetIntensity = Math.max(0, Math.min(1, v));
}
