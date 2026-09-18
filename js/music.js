// ── Fruit Band — adaptive game music (Web Audio, procedural) ────
// No audio files. A written pop tune (see song.js) played live by a
// band in which every fruit tier is an instrument:
//
//   coconut     hard shell        → woodblock clave, the groove's spine
//   peach       soft & fuzzy      → warm marimba on the off-beats
//   apple       crisp, red        → bright crunchy pluck on the backbeat
//   lemon       zesty, yellow     → zippy square lead — carries the hook
//   orange      sunny, juicy      → brassy saw stabs
//   watermelon  big, green, deep  → fat sub bass with a seed-click
//   blueberry   cool, blue        → chilled shimmering pad
//   grape       a bunch of little → rapid plucked arpeggio cluster
//   plum        dusky, rich       → tremolo electric piano
//   dragonfruit exotic, pink      → FM bell answering in the gaps
//   grapefruit  bittersweet (zen) → breathy whistle counter-line
//   rainbow                       → the whole band, plus a fanfare
//
// Which parts you hear depends on which fruit are in the cup right
// now (setCupContents): a fresh cup is drums, a few coconuts and
// peaches; as bigger fruit are earned the bass, chords, pad and arp
// join, and merging a pair away thins its part back out. Every merge
// makes the newborn fruit's instrument play a chord tone on the spot
// and boosts that part for a couple of bars, so combos literally play
// the song. Intensity (combos/fever) drives tempo, drum density and
// which section comes next; fever cuts to the chorus a whole step up;
// danger muffles the band under a closing filter.
//
// Routing goes through audio.js's masterGain, so the mute toggle
// silences everything here for free.
import * as Audio from './audio.js';
import { BALL_TIERS, RAINBOW_TIER } from './config.js';
import {
  SECTIONS, CHORDS, PATTERNS, DRUMS, REGISTER, STEPS_PER_BAR, toRegister,
} from './song.js';

const BASE_BPM = 108;
const MAX_BPM = 126;
const FEVER_BPM_BONUS = 4;
const SWING = 0.18;              // odd 16ths pushed late by this much of a step
const LOOKAHEAD_MS = 25;         // scheduler tick
const SCHEDULE_AHEAD_SEC = 0.12; // how far ahead notes are queued
const MUSIC_GAIN = 0.62;
const HIT_GAIN = 0.55;
const EPS = 0.02;                // stems below this don't schedule notes
const BOOST_BARS = 2;            // a newborn fruit's part rides high this long

const TIERS = BALL_TIERS.length;

// Per-stem trim (how loud each instrument sits in the mix) and the
// presence floor that keeps a bare cup from going silent — a quiet
// bass line and mallets are always there; fruit bring parts forward.
const STEM_TRIM  = [0.55, 0.40, 0.42, 0.50, 0.30, 0.70, 0.35, 0.30, 0.34, 0.32, 0.30, 0];
const STEM_FLOOR = [0,    0.30, 0,    0.25, 0,    0.30, 0,    0,    0,    0,    0,    0];
// Rise fast, fade slow (seconds) so merging a pair away doesn't chop a
// phrase off mid-bar
const RISE_TAU = 0.4;
const FALL_TAU = 2.2;

let ctx = null;
let master = null;      // → Audio master (fade target for start/stop)
let bandFilter = null;  // danger lowpass over the whole band
let comp = null;
let hitBus = null;      // merge hits bypass the band fade/filter
let stems = [];         // per-tier GainNode
let noiseBuffer = null;
let echoDelay = null;
let plumTrem = null;
let vibLead = null, vibPad = null, vibWhistle = null, tremGain = null;

let playing = false;
let timer = null;
let nextStepTime = 0;
let step = 0;           // absolute 16th-note counter
let bpm = BASE_BPM;
let lastTickAt = 0;

// Gameplay signals
let targetIntensity = 0;
let curIntensity = 0;
let mergeActivity = 0;
let danger = 0;
let feverOn = false;
let feverPending = false; // cut to the chorus at the next bar
let transpose = 0;

// Band presence
const presence = new Float32Array(TIERS); // from cup contents
const boost = new Float32Array(TIERS);    // from merges, decays per bar
const level = new Float32Array(TIERS);    // smoothed mix level
const boostUntilBar = new Int32Array(TIERS);

// Song position
let sectionName = 'verse';
let section = SECTIONS.verse;
let barInSection = 0;
let absBar = 0;
let verseLoops = 0;
let chorusLoops = 0;
let curChord = CHORDS.C;
let nextChord = CHORDS.Am;
let leadBar = [];

// Quantized riffs queued by merges: absolute step → [{tier, midi, vel}]
const riffQueue = new Map();

const mtof = (n) => 440 * Math.pow(2, (n - 69) / 12);

// ── Graph ───────────────────────────────────────────────────────
function ensureNodes() {
  ctx = Audio.getContext();
  if (master) return;

  master = ctx.createGain();
  master.gain.value = 0;
  master.connect(Audio.getMasterGain());

  // Glue compressor keeps a full band from clipping when everything
  // plays at once
  comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20;
  comp.knee.value = 12;
  comp.ratio.value = 4;
  comp.attack.value = 0.004;
  comp.release.value = 0.16;
  comp.connect(master);

  bandFilter = ctx.createBiquadFilter();
  bandFilter.type = 'lowpass';
  bandFilter.frequency.value = 18000;
  bandFilter.Q.value = 0.7;
  bandFilter.connect(comp);

  // Merge hits go straight to the master: they must stay crisp under
  // danger's muffling and keep ringing through the end-of-run fade
  hitBus = ctx.createGain();
  hitBus.gain.value = HIT_GAIN;
  hitBus.connect(Audio.getMasterGain());

  // Tempo-synced echo (dotted 8th) for the lead, bell and arp
  const delay = ctx.createDelay(1);
  delay.delayTime.value = (60 / bpm / 4) * 3;
  const fb = ctx.createGain();
  fb.gain.value = 0.3;
  const damp = ctx.createBiquadFilter();
  damp.type = 'lowpass';
  damp.frequency.value = 2600;
  delay.connect(damp).connect(fb).connect(delay);
  const wet = ctx.createGain();
  wet.gain.value = 0.35;
  damp.connect(wet).connect(bandFilter);
  echoDelay = delay;

  // One gain node per fruit — the mixer the cup contents drive.
  // Sends to the echo are post-fader so a faded part's tail fades too.
  const sendAmt = [0, 0, 0, 0.5, 0, 0, 0.15, 0.35, 0.1, 0.7, 0.3, 0];
  stems = [];
  for (let t = 0; t < TIERS; t++) {
    const g = ctx.createGain();
    g.gain.value = 0;
    g.connect(bandFilter);
    if (sendAmt[t] > 0) {
      const s = ctx.createGain();
      s.gain.value = sendAmt[t];
      g.connect(s).connect(echoDelay);
    }
    stems.push(g);
  }

  // Shared LFOs: lead vibrato, slow pad wobble, whistle vibrato,
  // e-piano tremolo
  const lfo = (freq, amount) => {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = amount;
    o.connect(g);
    o.start();
    return g;
  };
  vibLead = lfo(6, 9);        // cents
  vibPad = lfo(0.6, 6);
  vibWhistle = lfo(5.2, 16);
  tremGain = lfo(4.6, 0.3);   // gain offset (see vPlum)

  // The plum's tremolo lives on its stem, not per note, so notes don't
  // leave LFO-driven gain nodes behind
  plumTrem = ctx.createGain();
  plumTrem.gain.value = 0.7;
  tremGain.connect(plumTrem.gain);
  plumTrem.connect(stems[8]);

  const len = Math.floor(ctx.sampleRate * 1.0);
  noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noiseBuffer.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
}

// ── Synth building blocks ───────────────────────────────────────
// One oscillator → optional filter → envelope gain → bus
function tone(bus, {
  type = 'sine', freq, when, vel = 0.2, attack = 0.005, decay = 0.3,
  hold = 0, detune = 0, vib = null, filter = null, freqEnv = null,
  release = null,
}) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  if (freqEnv) {
    o.frequency.setValueAtTime(freqEnv.from, when);
    o.frequency.exponentialRampToValueAtTime(freq, when + freqEnv.time);
  }
  if (detune) o.detune.value = detune;
  if (vib) {
    vib.connect(o.detune);
    o.onended = () => vib.disconnect(o.detune);
  }

  let node = o;
  if (filter) {
    const f = ctx.createBiquadFilter();
    f.type = filter.type || 'lowpass';
    f.Q.value = filter.q || 0.7;
    if (filter.to) {
      f.frequency.setValueAtTime(filter.from, when);
      f.frequency.exponentialRampToValueAtTime(filter.to, when + (filter.time || decay));
    } else {
      f.frequency.value = filter.from;
    }
    node = o.connect(f);
  }

  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, when);
  g.gain.linearRampToValueAtTime(vel, when + attack);
  const endHold = when + attack + hold;
  if (hold > 0) g.gain.setValueAtTime(vel, endHold);
  const rel = release == null ? decay : release;
  g.gain.exponentialRampToValueAtTime(0.0001, endHold + rel);
  node.connect(g).connect(bus);
  o.start(when);
  o.stop(endHold + rel + 0.03);
  return g;
}

function noise(bus, { when, vel = 0.2, decay = 0.05, filter = null, attack = 0.001 }) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;
  let node = src;
  if (filter) {
    const f = ctx.createBiquadFilter();
    f.type = filter.type || 'bandpass';
    f.frequency.value = filter.from;
    f.Q.value = filter.q || 1;
    if (filter.to) {
      f.frequency.setValueAtTime(filter.from, when);
      f.frequency.exponentialRampToValueAtTime(filter.to, when + decay);
    }
    node = src.connect(f);
  }
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, when);
  g.gain.linearRampToValueAtTime(vel, when + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, when + attack + decay);
  node.connect(g).connect(bus);
  src.start(when);
  src.stop(when + attack + decay + 0.02);
}

// ── The fruit voices ────────────────────────────────────────────
// All share the signature (bus, midi, when, dur, vel).

// coconut: woodblock — a hard "tok" with a lower shell knock
function vCoconut(bus, midi, when, dur, vel) {
  tone(bus, { type: 'sine', freq: 900, when, vel, attack: 0.001, decay: 0.07,
              freqEnv: { from: 1500, time: 0.015 } });
  tone(bus, { type: 'triangle', freq: 330, when, vel: vel * 0.5, attack: 0.001, decay: 0.05 });
  noise(bus, { when, vel: vel * 0.25, decay: 0.012, filter: { from: 3500, q: 0.8 } });
}

// peach: soft marimba — fundamental + the bar's 4th partial, a fuzzy
// felt-mallet transient
function vPeach(bus, midi, when, dur, vel) {
  const f = mtof(midi);
  tone(bus, { type: 'sine', freq: f, when, vel, attack: 0.003, decay: 0.32 });
  tone(bus, { type: 'sine', freq: f * 4, when, vel: vel * 0.22, attack: 0.002, decay: 0.07 });
  noise(bus, { when, vel: vel * 0.12, decay: 0.015, filter: { from: 1800, q: 0.6 } });
}

// apple: crisp pluck — square through a snapping lowpass, with a
// crunchy bite of noise on the attack
function vApple(bus, midi, when, dur, vel) {
  const f = mtof(midi);
  tone(bus, { type: 'square', freq: f, when, vel: vel * 0.55, attack: 0.002, decay: 0.16,
              filter: { from: 5000, to: 500, time: 0.12, q: 2 } });
  tone(bus, { type: 'triangle', freq: f * 2, when, vel: vel * 0.25, attack: 0.002, decay: 0.08 });
  noise(bus, { when, vel: vel * 0.35, decay: 0.02, filter: { type: 'highpass', from: 4000, q: 0.5 } });
}

// lemon: zesty lead — detuned square + saw, a pitch zip on the
// attack, vibrato blooming in, bright but rounded
function vLemon(bus, midi, when, dur, vel) {
  const f = mtof(midi);
  const d = Math.max(0.12, dur - 0.03);
  tone(bus, { type: 'square', freq: f, when, vel: vel * 0.5, attack: 0.012, hold: d * 0.6,
              release: d * 0.4, detune: -4, vib: vibLead,
              freqEnv: { from: f * 1.03, time: 0.035 },
              filter: { from: 4200, to: 1800, time: d, q: 1.2 } });
  tone(bus, { type: 'sawtooth', freq: f, when, vel: vel * 0.32, attack: 0.012, hold: d * 0.6,
              release: d * 0.4, detune: 5, vib: vibLead,
              freqEnv: { from: f * 1.03, time: 0.035 },
              filter: { from: 3600, to: 1500, time: d, q: 1 } });
}

// orange: juicy brass — two detuned saws with a filter swell
function vOrange(bus, midi, when, dur, vel) {
  const f = mtof(midi);
  const d = Math.max(0.1, dur);
  for (const det of [-6, 6]) {
    tone(bus, { type: 'sawtooth', freq: f, when, vel: vel * 0.5, attack: 0.03, hold: d * 0.5,
                release: d * 0.5, detune: det,
                filter: { from: 500, to: 2400, time: 0.08, q: 1.4 } });
  }
}

// watermelon: fat bass — sine sub, a saw an octave up under a low
// filter, and a seed-click so it cuts through on phones
function vWatermelon(bus, midi, when, dur, vel) {
  const f = mtof(midi);
  const d = Math.max(0.12, dur);
  tone(bus, { type: 'sine', freq: f, when, vel, attack: 0.006, hold: d * 0.5, release: d * 0.5 });
  tone(bus, { type: 'sawtooth', freq: f * 2, when, vel: vel * 0.32, attack: 0.006, hold: d * 0.3,
              release: d * 0.5, filter: { from: 900, to: 220, time: 0.18, q: 1.5 } });
  noise(bus, { when, vel: vel * 0.3, decay: 0.008, filter: { from: 2500, q: 0.7 } });
}

// blueberry: cool pad — three slightly detuned triangles with a slow
// wobble and a soft lowpass, blooming in over the bar
function vBlueberry(bus, midi, when, dur, vel) {
  const f = mtof(midi);
  for (const det of [-9, 0, 9]) {
    tone(bus, { type: 'triangle', freq: f, when, vel: vel * 0.4, attack: dur * 0.3,
                hold: dur * 0.35, release: dur * 0.4, detune: det, vib: vibPad,
                filter: { from: 1400, q: 0.5 } });
  }
}

// grape: little plucks in a bunch — short, bright, staccato
function vGrape(bus, midi, when, dur, vel) {
  const f = mtof(midi);
  tone(bus, { type: 'triangle', freq: f, when, vel, attack: 0.002, decay: 0.11 });
  tone(bus, { type: 'square', freq: f, when, vel: vel * 0.18, attack: 0.002, decay: 0.05,
              filter: { from: 2500, q: 0.8 } });
}

// plum: rich electric piano — sine stack with tremolo, dusky and warm
function vPlum(bus, midi, when, dur, vel) {
  const f = mtof(midi);
  // Stem notes run through the shared tremolo stage (0.7 ± 0.3)
  const trem = bus === stems[8] ? plumTrem : bus;
  const d = Math.max(0.3, dur);
  tone(trem, { type: 'sine', freq: f, when, vel, attack: 0.008, decay: d });
  tone(trem, { type: 'sine', freq: f * 2, when, vel: vel * 0.4, attack: 0.008, decay: d * 0.6 });
  tone(trem, { type: 'sine', freq: f * 3, when, vel: vel * 0.15, attack: 0.008, decay: d * 0.35 });
  tone(trem, { type: 'triangle', freq: f * 0.5, when, vel: vel * 0.25, attack: 0.008, decay: d });
}

// dragonfruit: exotic bell — FM with an inharmonic ratio, a spiky
// bright attack that rings out long
function vDragonfruit(bus, midi, when, dur, vel) {
  const f = mtof(midi);
  const carrier = ctx.createOscillator();
  carrier.type = 'sine';
  carrier.frequency.value = f;
  const mod = ctx.createOscillator();
  mod.type = 'sine';
  mod.frequency.value = f * 3.53;
  const modGain = ctx.createGain();
  modGain.gain.setValueAtTime(f * 1.6, when);
  modGain.gain.exponentialRampToValueAtTime(f * 0.05, when + 0.5);
  mod.connect(modGain).connect(carrier.frequency);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, when);
  g.gain.linearRampToValueAtTime(vel, when + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 1.1);
  carrier.connect(g).connect(bus);
  mod.start(when);
  carrier.start(when);
  mod.stop(when + 1.15);
  carrier.stop(when + 1.15);
  tone(bus, { type: 'sine', freq: f * 2, when, vel: vel * 0.2, attack: 0.003, decay: 0.25 });
}

// grapefruit: breathy whistle — sine with wide vibrato and a wisp of
// filtered air
function vGrapefruit(bus, midi, when, dur, vel) {
  const f = mtof(midi);
  const d = Math.max(0.3, dur);
  tone(bus, { type: 'sine', freq: f, when, vel, attack: 0.09, hold: d * 0.55, release: d * 0.45,
              vib: vibWhistle, freqEnv: { from: f * 0.97, time: 0.09 } });
  noise(bus, { when, vel: vel * 0.12, attack: 0.09, decay: d,
               filter: { from: f * 1.02, q: 12 } });
}

const VOICES = [
  vCoconut, vPeach, vApple, vLemon, vOrange, vWatermelon,
  vBlueberry, vGrape, vPlum, vDragonfruit, vGrapefruit, vLemon,
];

// ── Drum kit ────────────────────────────────────────────────────
function kick(when, vel = 0.5) {
  tone(bandFilter, { type: 'sine', freq: 48, when, vel, attack: 0.002, decay: 0.16,
                     freqEnv: { from: 160, time: 0.05 } });
  noise(bandFilter, { when, vel: vel * 0.25, decay: 0.01, filter: { from: 1800, q: 0.5 } });
}

function snare(when, vel = 0.35, soft = false) {
  noise(bandFilter, { when, vel: vel * (soft ? 0.4 : 1), decay: soft ? 0.05 : 0.13,
                      filter: { type: 'bandpass', from: soft ? 2600 : 1500, q: soft ? 2.5 : 0.8 } });
  if (!soft) {
    tone(bandFilter, { type: 'triangle', freq: 190, when, vel: vel * 0.7, attack: 0.001, decay: 0.09,
                       freqEnv: { from: 260, time: 0.03 } });
  }
}

function hat(when, vel = 0.14, open = false) {
  // Tiny humanization so long stretches don't sound machine-stamped
  when += (Math.random() - 0.5) * 0.006;
  noise(bandFilter, { when, vel: vel * (0.85 + Math.random() * 0.3), decay: open ? 0.22 : 0.035,
                      filter: { type: 'highpass', from: 7000, q: 0.6 } });
}

function crash(when, vel = 0.22) {
  noise(bandFilter, { when, vel, decay: 1.2, filter: { type: 'highpass', from: 3500, q: 0.4 } });
  noise(bandFilter, { when, vel: vel * 0.6, decay: 0.6, filter: { type: 'bandpass', from: 6000, q: 0.7 } });
}

// ── Song position ───────────────────────────────────────────────
// Pure: what would come after the current section, given how hot
// the run is right now. A quiet run loops the verse (with a bridge
// every third time); a busy one climbs pre → chorus and can repeat
// the chorus once before easing off.
function peekNextSection() {
  if (feverOn || feverPending) return 'chorus';
  const hot = curIntensity;
  switch (sectionName) {
    case 'verse':
      if (hot > 0.3) return 'pre';
      return (verseLoops + 1) % 3 === 0 ? 'bridge' : 'verse';
    case 'pre':
      return 'chorus';
    case 'chorus':
      if (hot > 0.55 && chorusLoops < 1) return 'chorus';
      return hot > 0.35 ? 'bridge' : 'verse';
    case 'bridge':
      return hot > 0.3 ? 'pre' : 'verse';
  }
  return 'verse';
}

function setSection(name) {
  verseLoops = name === 'verse' ? (sectionName === 'verse' ? verseLoops + 1 : 0) : 0;
  chorusLoops = name === 'chorus' ? (sectionName === 'chorus' ? chorusLoops + 1 : 0) : 0;
  sectionName = name;
  section = SECTIONS[name];
  barInSection = 0;
}

// Runs on every downbeat: advance the form, pick the chord, and let
// a pending fever cut straight to the chorus a whole step up
function advanceBar(stepIndex) {
  absBar = Math.floor(stepIndex / STEPS_PER_BAR);
  if (stepIndex > 0) barInSection++;
  if (feverPending) {
    feverPending = false;
    setSection('chorus');
    transpose = 2;
  } else if (barInSection >= section.chords.length) {
    setSection(peekNextSection());
  }
  if (!feverOn && transpose !== 0) transpose = 0; // ease back down on a barline

  curChord = CHORDS[section.chords[barInSection]];
  // The bass walks toward the next chord — on the last bar that's the
  // first chord of whatever section is most likely next
  const nextName = barInSection + 1 < section.chords.length
    ? section.chords[barInSection + 1]
    : SECTIONS[peekNextSection()].chords[0];
  nextChord = CHORDS[nextName];
  leadBar = section.leadNotes[barInSection];

  // Merge boosts wear off after a couple of bars
  for (let t = 0; t < TIERS; t++) {
    if (boost[t] > 0 && absBar >= boostUntilBar[t]) boost[t] = 0;
  }
}

// ── Sequencer ───────────────────────────────────────────────────
function chordTone(i, lo) {
  const folded = curChord.notes.map((n) => toRegister(n, lo)).sort((a, b) => a - b);
  return folded[((i % 3) + 3) % 3] + 12 * Math.floor(i / 3) + transpose;
}

function scheduleStep(stepIndex, when) {
  const inBar = stepIndex % STEPS_PER_BAR;
  if (inBar === 0) advanceBar(stepIndex);
  if (inBar % 2 === 1) when += SWING * (60 / bpm / 4); // swing the off 16ths

  const stepSec = (60 / bpm) / 4;
  const full = Math.max(section.energy, curIntensity); // arrangement fullness
  const lastBar = barInSection === section.chords.length - 1;
  const T = transpose;
  const on = (t) => level[t] > EPS;
  const play = (t, midi, at, dur, vel) => VOICES[t](stems[t], midi, at, dur, vel);

  // coconut — clave
  if (on(0) && PATTERNS.clave.includes(inBar)) {
    play(0, 0, when, 0, inBar === 0 || inBar === 6 ? 0.5 : 0.36);
  }

  // peach — mallets on the off-beat 8ths, downbeats too when fuller
  if (on(1)) {
    if (PATTERNS.malletOff.includes(inBar)) {
      const i = PATTERNS.malletOff.indexOf(inBar);
      play(1, chordTone([0, 2, 1, 3][i], REGISTER[1]), when, stepSec * 2, 0.28);
    } else if (full > 0.5 && PATTERNS.malletOn.includes(inBar)) {
      play(1, chordTone(0, REGISTER[1] - 12), when, stepSec * 2, 0.2);
    }
  }

  // apple — backbeat crunch on the chord's top note
  if (on(2)) {
    if (PATTERNS.crunch.includes(inBar)) {
      play(2, chordTone(2, REGISTER[2]), when, stepSec, 0.42);
    } else if (full > 0.6 && PATTERNS.crunchPickup.includes(inBar)) {
      play(2, chordTone(1, REGISTER[2]), when, stepSec, 0.25);
    }
  }

  // lemon — the written lead
  if (on(3)) {
    for (const n of leadBar) {
      if (n.step === inBar) {
        play(3, n.midi + T, when, n.dur * stepSec, 0.34 + full * 0.06);
      }
    }
  }

  // orange — brass stabs
  if (on(4)) {
    const pat = full > 0.6 ? PATTERNS.brassFull : PATTERNS.brass;
    for (const [s, d] of pat) {
      if (s !== inBar) continue;
      const vel = s === 0 ? 0.3 : 0.22;
      play(4, chordTone(0, REGISTER[4]), when, d * stepSec, vel);
      play(4, chordTone(1, REGISTER[4]), when + 0.006, d * stepSec, vel * 0.8);
      play(4, chordTone(2, REGISTER[4]), when + 0.012, d * stepSec, vel * 0.8);
    }
  }

  // watermelon — bass line
  if (on(5)) {
    const pat = full > 0.45 ? PATTERNS.bassFull : PATTERNS.bassChill;
    for (const [s, d, role] of pat) {
      if (s !== inBar) continue;
      let midi = curChord.root;
      if (role === '5') midi += 7;
      else if (role === 'o') midi += 12;
      else if (role === 'n') {
        // Walk into the next chord from a step below or above
        const nr = nextChord.root;
        midi = nr === curChord.root ? nr + 12 : (nr > curChord.root ? nr - 1 : nr + 2);
      }
      play(5, midi + T, when, d * stepSec, role === 'r' && s === 0 ? 0.5 : 0.4);
    }
  }

  // blueberry — a pad chord that blooms across the bar
  if (on(6) && inBar === 0) {
    const barSec = stepSec * STEPS_PER_BAR;
    for (let i = 0; i < 3; i++) {
      play(6, chordTone(i, REGISTER[6]), when, barSec * 1.05, 0.22);
    }
    play(6, chordTone(0, REGISTER[6] + 12), when, barSec * 1.05, 0.14);
  }

  // grape — arpeggio cluster; 16ths when hot, 8ths otherwise
  if (on(7) && (full > 0.55 || inBar % 2 === 0)) {
    const seq = [0, 1, 2, 3, 4, 5, 4, 3, 2, 1, 0, 1, 2, 3, 2, 1];
    const idx = full > 0.55 ? inBar : inBar / 2;
    play(7, chordTone(seq[idx], REGISTER[7]), when, stepSec, inBar % 4 === 0 ? 0.3 : 0.2);
  }

  // plum — e-piano comping
  if (on(8)) {
    const pat = full > 0.55 ? PATTERNS.epFull : PATTERNS.epChill;
    for (const [s, d] of pat) {
      if (s !== inBar) continue;
      for (let i = 0; i < 3; i++) {
        play(8, chordTone(i, REGISTER[8]), when + i * 0.012, d * stepSec, s === 0 ? 0.3 : 0.22);
      }
    }
  }

  // dragonfruit — bell answers in the gaps
  if (on(9)) {
    const pat = full > 0.6 ? PATTERNS.bellFull : PATTERNS.bell;
    for (const [s, ct] of pat) {
      if (s === inBar) play(9, chordTone(ct, REGISTER[9]), when, stepSec * 3, 0.3);
    }
  }

  // grapefruit — whistle holds the 3rd, then the 5th, over each bar
  if (on(10) && (inBar === 0 || inBar === 8)) {
    play(10, chordTone(inBar === 0 ? 1 : 2, REGISTER[10]), when, stepSec * 8, 0.24);
  }

  // Merge riffs quantized onto the grid
  const riff = riffQueue.get(stepIndex);
  if (riff) {
    riffQueue.delete(stepIndex);
    for (const r of riff) VOICES[r.tier](hitBus, r.midi, when, stepSec * 1.5, r.vel);
  }

  // Drums — energy tier from intensity; danger strips it to a pulse
  if (danger > 0.55) {
    if (inBar === 0 || inBar === 8) kick(when, 0.45);
    if (inBar === 4 || inBar === 12) snare(when, 0.2, true);
    return;
  }
  const tier = curIntensity < 0.3 ? 0 : curIntensity < 0.62 ? 1 : 2;
  const kit = DRUMS[tier];
  if (kit.kick.includes(inBar)) kick(when, inBar === 0 ? 0.55 : 0.45);
  if (kit.snare.includes(inBar)) snare(when, 0.32 + tier * 0.04, kit.snareSoft);
  if (kit.open.includes(inBar)) hat(when, 0.1, true);
  else if (kit.hat.includes(inBar)) {
    hat(when, inBar % 4 === 0 ? 0.13 : inBar % 2 === 0 ? 0.09 : 0.05);
  }
  if (feverOn && inBar % 2 === 1) hat(when, 0.05); // fever shaker
  // Snare fill walking into the next section, crash on its downbeat
  if (lastBar && tier >= 1 && inBar >= 12) snare(when, 0.14 + (inBar - 12) * 0.06);
  if (inBar === 0 && barInSection === 0 && tier >= 1 && absBar > 0) crash(when, 0.2);
}

function schedulerTick() {
  const now = ctx.currentTime;
  const dt = lastTickAt ? Math.min(0.25, now - lastTickAt) : 0;
  lastTickAt = now;

  // Merge pings decay over a few seconds — a flurry of merging holds
  // the energy up, then it drifts back down when play slows
  mergeActivity *= Math.exp(-dt / 3.5);
  const intensity = Math.min(1, targetIntensity + mergeActivity * 0.6 + (feverOn ? 0.4 : 0));
  curIntensity += (intensity - curIntensity) * Math.min(1, dt * 1.5);

  // Tempo eases toward the intensity target (click-free: only future
  // steps move)
  const targetBpm = BASE_BPM + (MAX_BPM - BASE_BPM) * curIntensity + (feverOn ? FEVER_BPM_BONUS : 0);
  bpm += (targetBpm - bpm) * Math.min(1, dt * 0.8);
  echoDelay.delayTime.setTargetAtTime((60 / bpm / 4) * 3, now, 0.4);

  // Danger muffles the band; the run's energy lifts it a touch
  const cutoff = 18000 * Math.pow(400 / 18000, Math.min(1, danger * 1.15));
  bandFilter.frequency.setTargetAtTime(cutoff, now, 0.15);
  master.gain.setTargetAtTime(MUSIC_GAIN * (1 - danger * 0.3) + 0.06 * curIntensity, now, 0.4);

  // Mixer: each fruit's stem follows its presence in the cup (plus
  // merge boosts), rising fast and fading slow
  for (let t = 0; t < TIERS; t++) {
    const target = Math.min(1, Math.max(STEM_FLOOR[t], presence[t], boost[t]));
    const tau = target > level[t] ? RISE_TAU : FALL_TAU;
    level[t] += (target - level[t]) * Math.min(1, dt / tau);
    if (level[t] < 0.001) level[t] = 0;
    stems[t].gain.setTargetAtTime(level[t] * STEM_TRIM[t], now, 0.05);
  }

  while (nextStepTime < now + SCHEDULE_AHEAD_SEC) {
    scheduleStep(step, nextStepTime);
    step++;
    nextStepTime += (60 / bpm) / 4;
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
  danger = 0;
  feverOn = false;
  feverPending = false;
  transpose = 0;
  verseLoops = 0;
  chorusLoops = 0;
  presence.fill(0);
  boost.fill(0);
  level.fill(0);
  riffQueue.clear();
  sectionName = '';
  setSection('verse');
  master.gain.cancelScheduledValues(ctx.currentTime);
  master.gain.setValueAtTime(0.0001, ctx.currentTime);
  if (!document.hidden) startScheduler();
}

export function stop(fadeSec = 1) {
  if (!playing) return;
  playing = false;
  clearInterval(timer);
  timer = null;
  master.gain.cancelScheduledValues(ctx.currentTime);
  master.gain.setValueAtTime(Math.max(master.gain.value, 0.0001), ctx.currentTime);
  master.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + fadeSec);
}

export function isPlaying() {
  return playing;
}

// 0..1 — how hard the run is going right now (combo streaks, fever)
export function setIntensity(v) {
  targetIntensity = Math.max(0, Math.min(1, v));
}

// Ping on every merge — a flurry pushes the groove faster and fuller
// even before a big combo builds, and it relaxes on its own
export function bumpActivity(amount = 0.15) {
  mergeActivity = Math.min(1, mergeActivity + amount);
}

// 0..1 — how close the cup is to overflowing. The band muffles and
// drops to a pulse as it climbs, and swells back when the pile clears.
export function setDanger(v) {
  danger = Math.max(0, Math.min(1, v));
}

// Fever: cut to the chorus a whole step up on the next barline, and
// drop back down on the barline after it ends
export function setFever(active) {
  active = !!active;
  if (active === feverOn) return;
  feverOn = active;
  feverPending = active;
}

// counts[tier] = how many of that fruit are sitting in the cup. Called
// every frame by main.js; cheap. One fruit brings its part in, a few
// more bring it to full volume.
export function setCupContents(counts) {
  for (let t = 0; t < TIERS; t++) {
    const c = counts[t] || 0;
    presence[t] = c > 0 ? 0.6 + 0.4 * Math.min(1, (c - 1) / 3) : 0;
  }
}

// A merge just made a fruit of `tier`. Its instrument plays a chord
// tone immediately (tuned to what the band is playing right now), a
// combo continues as a rising run on the 16th grid, and the part is
// held up in the mix for a couple of bars. Falls back to the plain
// chime when the band isn't playing.
export function onMerge(tier, combo = 1) {
  if (!playing) {
    if (tier === RAINBOW_TIER) Audio.playWin();
    else Audio.playMerge(tier, combo);
    return;
  }
  tier = Math.max(1, Math.min(RAINBOW_TIER, tier));
  const now = ctx.currentTime;

  if (tier === RAINBOW_TIER) {
    rainbowFanfare(now);
    return;
  }

  boost[tier] = 1;
  boostUntilBar[tier] = absBar + BOOST_BARS + 1;

  const lo = REGISTER[tier];
  const c = Math.max(1, combo);
  const hitVel = 0.45 + Math.min(4, tier) * 0.03;
  // The hit: this fruit's voice on a chord tone, brightened by a little
  // sparkle so it always reads as "good thing happened"
  VOICES[tier](hitBus, chordTone((c - 1) % 3, lo), now, 0.3, hitVel);
  if (tier >= 5) {
    // Big fruit land with a thump underneath
    kick(now, 0.3);
    tone(hitBus, { type: 'sine', freq: mtof(chordTone(0, 84)), when: now, vel: 0.12,
                   attack: 0.003, decay: 0.35 });
  } else {
    tone(hitBus, { type: 'sine', freq: mtof(chordTone(2, 84)), when: now, vel: 0.08,
                   attack: 0.003, decay: 0.2 });
  }

  // Combo run: each further merge in the chain climbs the chord on
  // the next 16ths, so a chain reaction plays an arpeggio
  if (c > 1) {
    const runLen = Math.min(5, c);
    const startStep = step; // next unscheduled step is always ≥ now
    for (let i = 1; i < runLen; i++) {
      const s = startStep + i;
      if (!riffQueue.has(s)) riffQueue.set(s, []);
      riffQueue.get(s).push({
        tier, midi: chordTone((c - 1) % 3 + i, lo), vel: hitVel * (0.75 + i * 0.06),
      });
    }
    if (c >= 4) {
      const s = startStep + runLen;
      if (!riffQueue.has(s)) riffQueue.set(s, []);
      riffQueue.get(s).push({ tier: 9, midi: chordTone(0, 84), vel: 0.35 });
    }
  }
}

// The rainbow: a crash, the bass drops the root, and the lead, brass
// and bell run the scale up two octaves together
function rainbowFanfare(now) {
  crash(now, 0.3);
  kick(now, 0.5);
  vWatermelon(hitBus, curChord.root + transpose, now, 1.2, 0.5);
  const root = toRegister(curChord.root, 60) + transpose;
  let i = 0;
  for (let oct = 0; oct < 2; oct++) {
    for (const deg of [0, 2, 4, 5, 7, 9, 11]) {
      const at = now + 0.06 + i * 0.055;
      const midi = root + deg + oct * 12;
      vLemon(hitBus, midi, at, 0.18, 0.28);
      if (i % 2 === 0) vGrape(hitBus, midi + 12, at, 0.1, 0.2);
      i++;
    }
  }
  const top = now + 0.06 + i * 0.055;
  for (let k = 0; k < 3; k++) {
    vOrange(hitBus, chordTone(k, 60), top, 1.4, 0.32);
    vDragonfruit(hitBus, chordTone(k, 84), top + k * 0.05, 1, 0.3);
  }
  vBlueberry(hitBus, root + 12, top, 2.2, 0.35);
  for (let t = 1; t < RAINBOW_TIER; t++) {
    boost[t] = 1;
    boostUntilBar[t] = absBar + 4;
  }
}

// Advance the scheduler by hand (offline rendering / tests). In the
// game the interval timer calls this.
export function pump() {
  if (playing) schedulerTick();
}
