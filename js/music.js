// ── Dreampop / Indie-pop Background Music (Web Audio, procedural) ─
// No audio files — a full 64-bar song form in F major synthesized
// live. Eight 8-bar sections cycle through three chord progressions
// (verse / lift / bridge colors), and on top of that a pentatonic
// lead improvises 2-bar phrases from a phrase bank through a dreamy
// feedback echo, so no two passes play back the same way. Detuned
// triangle keys, a sine sub bass, soft pads, noise hats, a muffled
// kick/rim, and a looped vinyl-crackle bed round out the kit; a slow
// "tape wobble" LFO bends every melodic oscillator a few cents.
//
// The arrangement breathes with play intensity (setIntensity 0..1
// plus bumpActivity() pings on merges):
//   chill  (<0.25) — pads + sparse keys, barely-there percussion
//   mid            — the standard lofi groove
//   hot    (>0.6)  — busier kick, extra hats, a shimmering arp layer
// BPM glides 78→106 with the same signal, so heavy merging audibly
// quickens the groove and idle play lets it drift back down.
//
// Routing goes through audio.js's masterGain, so the existing mute
// toggle silences music for free.
import * as Audio from './audio.js';

const BASE_BPM = 78;
const MAX_BPM = 106;
const LOOKAHEAD_MS = 25;        // scheduler tick
const SCHEDULE_AHEAD_SEC = 0.12; // how far ahead notes are queued
const STEPS_PER_BAR = 16;        // 16th-note grid
const BARS_PER_CHORD = 2;
const BARS_PER_SECTION = 8;      // 4 chords × 2 bars
const STEPS_PER_SECTION = STEPS_PER_BAR * BARS_PER_SECTION;
const MUSIC_GAIN = 0.16;

// Chord voicings as MIDI notes, with a low root for the bass.
const CHORDS = {
  Fmaj7:  { root: 41, notes: [65, 69, 72, 76] }, // F2 | F4 A4 C5 E5
  Am7:    { root: 45, notes: [64, 67, 69, 72] }, // A2 | E4 G4 A4 C5
  Dm9:    { root: 38, notes: [62, 65, 69, 76] }, // D2 | D4 F4 A4 E5
  Bbmaj9: { root: 34, notes: [58, 62, 65, 72] }, // Bb1| Bb3 D4 F4 C5
  Cadd9:  { root: 36, notes: [64, 67, 72, 74] }, // C2 | E4 G4 C5 D5
  Gm9:    { root: 43, notes: [58, 62, 65, 69] }, // G2 | Bb3 D4 F4 A4
};

// Three harmonic colors: A is the mellow home progression, B lifts
// toward the relative-minor/dominant motion, C is a bridge detour.
const PROGRESSIONS = {
  A: ['Fmaj7', 'Am7', 'Dm9', 'Bbmaj9'],
  B: ['Dm9', 'Bbmaj9', 'Fmaj7', 'Cadd9'],
  C: ['Bbmaj9', 'Am7', 'Gm9', 'Cadd9'],
};

// Song form — one entry per 8-bar section. `lift` (0..1) shapes how
// full the arrangement plays regardless of game intensity, giving the
// track its own quiet-verse / big-chorus contour.
const FORM = [
  { prog: 'A', lift: 0.0 },
  { prog: 'A', lift: 0.35 },
  { prog: 'B', lift: 0.7 },
  { prog: 'B', lift: 1.0 },
  { prog: 'A', lift: 0.4 },
  { prog: 'C', lift: 0.6 },
  { prog: 'B', lift: 0.9 },
  { prog: 'A', lift: 0.15 },
];
const TOTAL_STEPS = STEPS_PER_SECTION * FORM.length;

// Lead phrase bank — 2-bar phrases in F major pentatonic, written as
// [stepIn2Bars, midi, durationInSteps]. The sequencer picks (or rests)
// per 2-bar slot with a seeded random, so melodies vary every pass.
const PHRASES = [
  [[0, 77, 3], [4, 79, 3], [8, 81, 6], [16, 84, 4], [22, 81, 2], [24, 79, 6]],
  [[0, 81, 3], [6, 79, 2], [8, 77, 6], [16, 74, 4], [24, 77, 6]],
  [[0, 84, 4], [6, 81, 2], [8, 79, 4], [14, 77, 2], [16, 79, 10]],
  [[4, 72, 3], [8, 74, 3], [12, 77, 3], [16, 79, 8], [26, 77, 4]],
  [[0, 79, 2], [2, 81, 2], [4, 84, 6], [12, 86, 3], [16, 84, 4], [24, 79, 6]],
  [[8, 77, 6], [20, 81, 3], [24, 74, 6]],
  [[0, 74, 3], [4, 77, 3], [8, 79, 8], [20, 77, 3], [24, 72, 6]],
];

let ctx = null;
let musicGain = null;
let keysFilter = null;
let leadFilter = null;
let delaySend = null;
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
let curIntensity = 0;   // smoothed — gates layers without flicker
let mergeActivity = 0;  // decaying pulse fed by bumpActivity()
let lastTickAt = 0;
let seedBase = 0;       // re-rolled per run so melodies differ

function midiToFreq(n) {
  return 440 * Math.pow(2, (n - 69) / 12);
}

// Deterministic per-slot random — stable while a note's 2-bar slot is
// being scheduled, different across slots and across runs (seedBase).
function seeded(n) {
  const x = Math.sin((n + seedBase) * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
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

  // Lead/arp go through their own gentler lowpass so they sit on top
  leadFilter = ctx.createBiquadFilter();
  leadFilter.type = 'lowpass';
  leadFilter.frequency.value = 2600;
  leadFilter.Q.value = 0.5;
  leadFilter.connect(musicGain);

  // Dreamy feedback echo for the lead — dotted-ish delay, darkened
  // each repeat so tails wash out instead of cluttering
  const delay = ctx.createDelay(1);
  delay.delayTime.value = 0.34;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.32;
  const delayDamp = ctx.createBiquadFilter();
  delayDamp.type = 'lowpass';
  delayDamp.frequency.value = 2000;
  delay.connect(delayDamp).connect(feedback).connect(delay);
  const delayOut = ctx.createGain();
  delayOut.gain.value = 0.5;
  delayDamp.connect(delayOut).connect(musicGain);
  delaySend = ctx.createGain();
  delaySend.gain.value = 1;
  delaySend.connect(delay);

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

function playChord(chord, when, dur = 1.8, vel = 0.05) {
  // Gentle strum: chord tones staggered 25 ms
  chord.notes.forEach((n, i) => {
    playKeyNote(midiToFreq(n), when + i * 0.025, dur, vel);
  });
}

// Soft sustained bed under the chill sections — slow attack, low gain
function playPad(chord, when, dur) {
  for (const n of chord.notes) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = midiToFreq(n);
    tapeLFOGain.connect(osc.detune);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(0.02, when + dur * 0.35);
    g.gain.setValueAtTime(0.02, when + dur * 0.7);
    g.gain.linearRampToValueAtTime(0.0001, when + dur);
    osc.connect(g).connect(keysFilter);
    osc.start(when);
    osc.stop(when + dur + 0.05);
  }
}

// Plucky lead — triangle + quiet octave sine, fed into the echo
function playLead(midi, when, dur, vel = 0.055) {
  const freq = midiToFreq(midi);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, when);
  g.gain.linearRampToValueAtTime(vel, when + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  g.connect(leadFilter);
  g.connect(delaySend);

  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = freq;
  osc.detune.value = 5;
  tapeLFOGain.connect(osc.detune);
  osc.connect(g);
  osc.start(when);
  osc.stop(when + dur + 0.05);

  const shimmer = ctx.createOscillator();
  shimmer.type = 'sine';
  shimmer.frequency.value = freq * 2;
  tapeLFOGain.connect(shimmer.detune);
  const sg = ctx.createGain();
  sg.gain.value = 0.25;
  shimmer.connect(sg).connect(g);
  shimmer.start(when);
  shimmer.stop(when + dur + 0.05);
}

function playBass(midi, when, dur, vel = 0.2) {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = midiToFreq(midi);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, when);
  g.gain.linearRampToValueAtTime(vel, when + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  osc.connect(g).connect(musicGain);
  osc.start(when);
  osc.stop(when + dur + 0.05);
}

function playHat(when, vel, dur = 0.045) {
  // Tiny timing/level humanization keeps long stretches from
  // sounding machine-stamped
  when += (Math.random() - 0.5) * 0.008;
  vel *= 0.85 + Math.random() * 0.3;
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

function playKick(when, vel = 0.16) {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(110, when);
  osc.frequency.exponentialRampToValueAtTime(45, when + 0.1);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vel, when);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.12);
  osc.connect(g).connect(musicGain);
  osc.start(when);
  osc.stop(when + 0.15);
}

function playRim(when, vel = 0.07) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1800;
  bp.Q.value = 1.2;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vel, when);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.07);
  src.connect(bp).connect(g).connect(musicGain);
  src.start(when);
  src.stop(when + 0.09);
}

// ── Sequencer ───────────────────────────────────────────────────
function scheduleStep(stepIndex, when) {
  const s = stepIndex % TOTAL_STEPS;
  const inBar = s % STEPS_PER_BAR;
  const barInSong = Math.floor(s / STEPS_PER_BAR);
  const section = FORM[Math.floor(s / STEPS_PER_SECTION)];
  const barInSection = barInSong % BARS_PER_SECTION;
  const prog = PROGRESSIONS[section.prog];
  const chordIndex = Math.floor(barInSection / BARS_PER_CHORD) % prog.length;
  const chord = CHORDS[prog[chordIndex]];
  const stepSec = (60 / bpm) / 4;
  const fullness = Math.max(section.lift, curIntensity); // arrangement energy
  // Absolute counters seed the melody/keys randomness so patterns
  // vary between passes through the form, not just within one
  const absBar = Math.floor(stepIndex / STEPS_PER_BAR);
  const absSlot = Math.floor(stepIndex / (STEPS_PER_BAR * 2)); // 2-bar slot

  // Keys: comping pattern varies per bar — sustained, pushed, or
  // resting on the pad, chosen by seeded random weighted by fullness
  const compRoll = seeded(absBar * 3.7);
  if (inBar === 0) {
    if (compRoll > 0.82 && fullness < 0.5) {
      // let the pad carry this bar — keys sit out
    } else {
      playChord(chord, when);
    }
  } else if (inBar === 10 && compRoll > 0.25) {
    playChord(chord, when, 1.4, 0.04);
  } else if (inBar === 6 && compRoll > 0.6 && fullness > 0.45) {
    playChord(chord, when, 0.8, 0.035); // pushed stab in fuller bars
  }

  // Pad: a dreamy bed under each chord when things are chill —
  // fades away as the game (or the song form) heats up
  if (inBar === 0 && barInSection % BARS_PER_CHORD === 0 && curIntensity < 0.5) {
    playPad(chord, when, stepSec * STEPS_PER_BAR * BARS_PER_CHORD);
  }

  // Lead melody: each 2-bar slot rolls whether to play a phrase, and
  // which one — livelier sections and hot play speak up more often
  const slotStep = stepIndex % (STEPS_PER_BAR * 2);
  const playRoll = seeded(absSlot * 7.13);
  const chance = 0.35 + section.lift * 0.3 + curIntensity * 0.15;
  if (playRoll < chance) {
    const phrase = PHRASES[Math.floor(seeded(absSlot * 13.7) * PHRASES.length)];
    for (const [noteStep, midi, durSteps] of phrase) {
      if (noteStep === slotStep) {
        playLead(midi, when, durSteps * stepSec + 0.15,
                 0.045 + fullness * 0.015);
      }
    }
  }

  // Bass: roots on 1 and 3, a passing 8th into the next chord, and an
  // octave bounce on the "and" of 4 when the groove is hot
  const lastBarOfSection = barInSection === BARS_PER_SECTION - 1;
  if (inBar === 0 || inBar === 8) {
    playBass(chord.root, when, 0.5);
  } else if (inBar === 14 && barInSection % BARS_PER_CHORD === 1) {
    // Walk into whatever chord comes next — within this progression,
    // or the first chord of the next section on a section boundary
    const nextChord = lastBarOfSection
      ? CHORDS[PROGRESSIONS[FORM[(Math.floor(s / STEPS_PER_SECTION) + 1) % FORM.length].prog][0]]
      : CHORDS[prog[(chordIndex + 1) % prog.length]];
    playBass(nextChord.root, when, 0.3);
  } else if (inBar === 14 && curIntensity > 0.5) {
    playBass(chord.root + 12, when, 0.18, 0.12);
  }

  // Arp: shimmering 8th-note sparkle that only joins at high energy
  if (curIntensity > 0.55 && inBar % 2 === 0) {
    const arpNotes = chord.notes;
    const pos = (inBar / 2) % arpNotes.length;
    playLead(arpNotes[pos] + 12, when + 0.005, stepSec * 1.6, 0.018);
  }

  // Drums: three energy tiers so idle play stays airy and heavy
  // merging gets a driving kit
  if (curIntensity < 0.25) {
    // Chill: whispered hats on the downbeats, occasional rim
    if (inBar === 0 || inBar === 8) playHat(when, 0.02);
    if (inBar === 12 && seeded(absBar * 5.3) > 0.55) playRim(when, 0.04);
  } else if (curIntensity < 0.6) {
    // Standard lofi groove
    if (inBar % 2 === 0) playHat(when, inBar % 4 === 0 ? 0.05 : 0.028);
    if (inBar === 10 && barInSong % 4 === 3) playHat(when, 0.045, 0.12);
    if (inBar === 0 || inBar === 8) playKick(when);
    if (inBar === 4 || inBar === 12) playRim(when);
  } else {
    // Hot: pushed kick, brighter hats, 16th pickups
    if (inBar % 2 === 0) playHat(when, inBar % 4 === 0 ? 0.055 : 0.032);
    if (inBar === 7 || inBar === 15) playHat(when, 0.022);
    if (inBar === 10) playHat(when, 0.05, 0.12);
    if (inBar === 0 || inBar === 6 || inBar === 8) playKick(when, 0.17);
    if (inBar === 4 || inBar === 12) playRim(when, 0.08);
  }

  // Little hat fill walking into the next section
  if (lastBarOfSection && curIntensity >= 0.25 && inBar >= 12) {
    playHat(when, 0.02 + (inBar - 12) * 0.008);
  }
}

function schedulerTick() {
  const now = ctx.currentTime;
  const dt = lastTickAt ? Math.min(0.25, now - lastTickAt) : 0;
  lastTickAt = now;

  // Merge pings decay over a few seconds — a burst of merging holds
  // the energy up, then it drifts back down when play slows
  mergeActivity *= Math.exp(-dt / 3.5);
  const intensity = Math.min(1, targetIntensity + mergeActivity * 0.6);
  curIntensity += (intensity - curIntensity) * Math.min(1, dt * 1.5);

  // Ease BPM toward the intensity target (~2-3 s glide, click-free
  // because tempo only affects *future* step times)
  const targetBpm = BASE_BPM + (MAX_BPM - BASE_BPM) * intensity;
  bpm += (targetBpm - bpm) * 0.015;

  // Intensity also lifts the music slightly and opens the keys filter
  musicGain.gain.setTargetAtTime(MUSIC_GAIN + 0.03 * intensity, now, 0.5);
  keysFilter.frequency.setTargetAtTime(1200 + 600 * intensity, now, 0.5);

  while (nextStepTime < now + SCHEDULE_AHEAD_SEC) {
    scheduleStep(step, nextStepTime);
    step++;
    nextStepTime += (60 / bpm) / 4; // 16th note
  }
}

function startScheduler() {
  nextStepTime = ctx.currentTime + 0.05;
  lastTickAt = 0;
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
  curIntensity = 0;
  mergeActivity = 0;
  seedBase = Math.floor(Math.random() * 100000); // fresh melodies per run
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

// Ping on every merge — a flurry of merges pushes the groove faster
// and fuller even before a big combo builds, and it relaxes on its own
export function bumpActivity(amount = 0.15) {
  mergeActivity = Math.min(1, mergeActivity + amount);
}
