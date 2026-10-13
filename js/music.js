// ── Fruit Band — adaptive game music (Web Audio, procedural) ────
// No audio files. Songs from song.js played live by a band in which
// every fruit is its own instrument:
//
//   coconut     hard shell         → woodblock clave, the groove's spine
//   peach       soft & fuzzy       → warm marimba on the off-beats
//   red apple   crisp              → bright crunchy pluck on the backbeat
//   lemon       zesty              → zippy square lead — carries the hook
//   lime        tropical, tart     → steel drum answering the hook
//   orange      sunny, juicy       → brassy saw stabs
//   watermelon  big, green, deep   → fat sub bass with a seed-click
//   blueberry   cool               → chilled shimmering pad
//   grape       a bunch of little  → rapid plucked arpeggio cluster
//   grapefruit  bittersweet        → breathy whistle counter-line
//   plum        dusky, rich        → tremolo electric piano
//   dragonfruit exotic             → FM bell answering in the gaps
//   blackberry  dark, glossy       → choir "aah"s swelling over the bar
//   rainbow                        → the whole band, plus a fanfare
//
// The band is the fruit you've UNLOCKED this run. A run starts with
// just the woodblock, marimba and pluck over a soft kick; every new
// fruit you merge your way to brings its instrument in on the next
// bar with a crash and a little signature lick, and the drum kit
// fills out as the band grows. By the dragonfruit it's a full band.
//
// What keeps it fresh:
//  · three songs with their own key, tempo, swing and drum feel — a
//    run starts on one (never the last one played) and long runs
//    move through the songbook
//  · the key steps around each time the form comes back to the verse
//  · repeats of a section vary the hook (octave answers, ornaments)
//    and swap who plays it (the steel drum takes the bridge)
//  · sections rest instruments so the chorus lands harder
//  · intensity (combos/fever) drives tempo, drum density and when the
//    chorus comes; fever cuts to the chorus a whole step up; danger
//    muffles the band under a closing filter
//  · fruit sitting in the cup push their own part forward in the mix,
//    and every merge makes the newborn fruit's instrument play a chord
//    tone on the spot, so combos literally play the song
//
// Routing goes through audio.js's masterGain, so the mute toggle
// silences everything here for free.
import * as Audio from './audio.js';
import { BALL_TIERS, RAINBOW_TIER } from './config.js';
import { SONGS, REGISTER, STEPS_PER_BAR, toRegister, chord } from './song.js';

const FEVER_BPM_BONUS = 4;
const LOOKAHEAD_MS = 25;         // scheduler tick
// How far ahead notes are queued. Generous so a long frame (GC, a
// sprite render on a slow phone) can't starve the scheduler into gaps.
const SCHEDULE_AHEAD_SEC = 0.15;
const MUSIC_GAIN = 0.62;
const HIT_GAIN = 0.55;
const EPS = 0.02;                // stems below this don't schedule notes
const BOOST_BARS = 2;            // a newborn fruit's part rides high this long
const SONG_CYCLES = 2;           // full verse→chorus cycles before the next song

const TIERS = BALL_TIERS.length;
const T = {
  coconut: 0, peach: 1, apple: 2, lemon: 3, lime: 4, orange: 5,
  watermelon: 6, blueberry: 7, grape: 8, grapefruit: 9, plum: 10,
  dragonfruit: 11, blackberry: 12, rainbow: RAINBOW_TIER,
};

// Per-stem trim (how loud each instrument sits in the mix)
const STEM_TRIM = [0.55, 0.40, 0.42, 0.50, 0.42, 0.30, 0.70, 0.35, 0.28, 0.30, 0.34, 0.32, 0.36, 0];
// An unlocked instrument plays at this level; the same fruit sitting
// in the cup (or just merged) brings it the rest of the way up
const UNLOCKED_LEVEL = 0.72;
// Rise fast, fade slow (seconds) so a part never chops off mid-bar
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
let padIn = null;       // blueberry stem input (shared lowpass)
let choirStemIn = null; // blackberry formant banks — one into its stem…
let choirHitIn = null;  // …and one for merge hits
let steelWave = null;
let epWave = null;
let vibLead = null, vibPad = null, vibWhistle = null, vibChoir = null, tremGain = null;
let lite = false;       // slow phones: fewer partials per note

let playing = false;
let timer = null;
let nextStepTime = 0;
let step = 0;           // absolute 16th-note counter
let bpm = 108;
let lastTickAt = 0;

// Gameplay signals
let targetIntensity = 0;
let curIntensity = 0;
let mergeActivity = 0;
let danger = 0;
let feverOn = false;
let feverPending = false; // cut to the chorus at the next bar
let feverLift = 0;        // +2 semitones while frenzying
let keyShift = 0;         // the song's current key step
let transpose = 0;        // keyShift + feverLift, applied to every note

// Band line-up
const unlocked = new Uint8Array(TIERS);
const entryBar = new Int32Array(TIERS);    // unlocked parts come in on this bar
const presence = new Float32Array(TIERS);  // from cup contents
const boost = new Float32Array(TIERS);     // from merges, decays per bar
const level = new Float32Array(TIERS);     // smoothed mix level
const sentLevel = new Float32Array(TIERS); // last level handed to the stem's gain
const boostUntilBar = new Int32Array(TIERS);
let bandSize = 0;
// Entrances waiting for their downbeat: tier → bar
const pendingLicks = new Map();
let fillBar = -1;       // drum fill into an entrance

// Song position
let lastSongIndex = -1;
let song = SONGS[0];
let sectionName = 'verse';
let section = song.sections.verse;
let barInSection = 0;
let absBar = 0;
let verseLoops = 0;
let chorusLoops = 0;
let chorusesDone = 0;
let cyclesInSong = 0;
let keyIndex = 0;
const passes = { verse: 0, pre: 0, chorus: 0, bridge: 0 };
let leadVariant = 0;
let curChord = chord('C');
let nextChord = chord('Am');
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

  // Tempo-synced echo (dotted 8th) for the lead, steel, bell and arp
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

  // One gain node per fruit — the mixer the line-up drives. Sends to
  // the echo are post-fader so a faded part's tail fades too.
  const sendAmt = [0, 0, 0, 0.5, 0.35, 0, 0, 0.15, 0.35, 0.3, 0.1, 0.7, 0.2, 0];
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

  // Shared LFOs: lead vibrato, slow pad wobble, whistle and choir
  // vibrato, e-piano tremolo
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
  vibChoir = lfo(4.8, 11);
  tremGain = lfo(4.6, 0.3);   // gain offset (see vPlum)

  // The plum's tremolo lives on its stem, not per note, so notes don't
  // leave LFO-driven gain nodes behind
  plumTrem = ctx.createGain();
  plumTrem.gain.value = 0.7;
  tremGain.connect(plumTrem.gain);
  plumTrem.connect(stems[T.plum]);

  // The pad's lowpass is static, so one filter on the stem replaces a
  // filter per note (three per chord tone)
  padIn = ctx.createBiquadFilter();
  padIn.type = 'lowpass';
  padIn.frequency.value = 1400;
  padIn.Q.value = 0.5;
  padIn.connect(stems[T.blueberry]);

  // Choir: sawtooth voices through vowel formants ("aah": ~700 Hz,
  // ~1150 Hz, plus a little presence at 2.6 kHz)
  const formantBank = (out) => {
    const input = ctx.createGain();
    const sum = ctx.createGain();
    sum.gain.value = 2.4; // bandpasses throw most of the saw away
    for (const [f, q, g] of [[700, 5, 1], [1150, 6, 0.7], [2600, 8, 0.25]]) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = q;
      const lvl = ctx.createGain();
      lvl.gain.value = g;
      input.connect(bp).connect(lvl).connect(sum);
    }
    sum.connect(out);
    return input;
  };
  choirStemIn = formantBank(stems[T.blackberry]);
  choirHitIn = formantBank(hitBus);

  // Single-oscillator timbres: a harmonic stack in one PeriodicWave is
  // one node per note instead of three or four
  const wave = (harmonics) => {
    const imag = new Float32Array([0, ...harmonics]);
    return ctx.createPeriodicWave(new Float32Array(imag.length), imag);
  };
  steelWave = wave([1, 0.65, 0.28, 0.12, 0.06]);
  epWave = wave([1, 0.42, 0.16, 0.05]);

  const len = Math.floor(ctx.sampleRate * 1.0);
  noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noiseBuffer.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
}

// ── Synth building blocks ───────────────────────────────────────
// One oscillator → optional filter → envelope gain → bus
function tone(bus, {
  type = 'sine', wave = null, freq, when, vel = 0.2, attack = 0.005, decay = 0.3,
  hold = 0, detune = 0, vib = null, filter = null, freqEnv = null,
  release = null,
}) {
  const o = ctx.createOscillator();
  if (wave) o.setPeriodicWave(wave);
  else o.type = type;
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
  // Start somewhere random in the buffer so back-to-back hits aren't
  // the identical noise grain
  const offset = Math.random() * 0.9;
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
  src.start(when, offset);
  src.stop(when + attack + decay + 0.02);
}

// ── The fruit voices ────────────────────────────────────────────
// All share the signature (bus, midi, when, dur, vel).

// coconut: woodblock — a hard "tok" with a lower shell knock
function vCoconut(bus, midi, when, dur, vel) {
  tone(bus, { type: 'sine', freq: 900, when, vel, attack: 0.001, decay: 0.07,
              freqEnv: { from: 1500, time: 0.015 } });
  tone(bus, { type: 'triangle', freq: 330, when, vel: vel * 0.5, attack: 0.001, decay: 0.05 });
  if (!lite) noise(bus, { when, vel: vel * 0.25, decay: 0.012, filter: { from: 3500, q: 0.8 } });
}

// peach: soft marimba — fundamental + the bar's 4th partial, a fuzzy
// felt-mallet transient
function vPeach(bus, midi, when, dur, vel) {
  const f = mtof(midi);
  tone(bus, { type: 'sine', freq: f, when, vel, attack: 0.003, decay: 0.32 });
  tone(bus, { type: 'sine', freq: f * 4, when, vel: vel * 0.22, attack: 0.002, decay: 0.07 });
  if (!lite) noise(bus, { when, vel: vel * 0.12, decay: 0.015, filter: { from: 1800, q: 0.6 } });
}

// red apple: crisp pluck — square through a snapping lowpass, with a
// crunchy bite of noise on the attack
function vApple(bus, midi, when, dur, vel) {
  const f = mtof(midi);
  tone(bus, { type: 'square', freq: f, when, vel: vel * 0.55, attack: 0.002, decay: 0.16,
              filter: { from: 5000, to: 500, time: 0.12, q: 2 } });
  if (!lite) tone(bus, { type: 'triangle', freq: f * 2, when, vel: vel * 0.25, attack: 0.002, decay: 0.08 });
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
  if (lite) return;
  tone(bus, { type: 'sawtooth', freq: f, when, vel: vel * 0.32, attack: 0.012, hold: d * 0.6,
              release: d * 0.4, detune: 5, vib: vibLead,
              freqEnv: { from: f * 1.03, time: 0.035 },
              filter: { from: 3600, to: 1500, time: d, q: 1 } });
}

// lime: steel drum — a bright metallic strike whose upper partials
// die almost at once, over the pan's ringing fundamental
function vLime(bus, midi, when, dur, vel) {
  const f = mtof(midi);
  tone(bus, { wave: steelWave, freq: f, when, vel: vel * 0.5, attack: 0.002, decay: 0.16,
              freqEnv: { from: f * 1.025, time: 0.03 } });
  tone(bus, { type: 'sine', freq: f, when, vel: vel * 0.7, attack: 0.003,
              decay: Math.max(0.35, Math.min(1.2, dur * 1.3)) });
  if (!lite) tone(bus, { type: 'sine', freq: f * 3.01, when, vel: vel * 0.1, attack: 0.002, decay: 0.07 });
}

// orange: juicy brass — two detuned saws with a filter swell
function vOrange(bus, midi, when, dur, vel) {
  const f = mtof(midi);
  const d = Math.max(0.1, dur);
  for (const det of lite ? [0] : [-6, 6]) {
    tone(bus, { type: 'sawtooth', freq: f, when, vel: vel * (lite ? 0.8 : 0.5), attack: 0.03,
                hold: d * 0.5, release: d * 0.5, detune: det,
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
  if (!lite) noise(bus, { when, vel: vel * 0.3, decay: 0.008, filter: { from: 2500, q: 0.7 } });
}

// blueberry: cool pad — slightly detuned triangles with a slow wobble
// and a soft lowpass, blooming in over the bar
function vBlueberry(bus, midi, when, dur, vel) {
  const f = mtof(midi);
  const into = bus === stems[T.blueberry] ? padIn : bus;
  for (const det of lite ? [-6, 6] : [-9, 0, 9]) {
    tone(into, { type: 'triangle', freq: f, when, vel: vel * 0.4, attack: dur * 0.3,
                 hold: dur * 0.35, release: dur * 0.4, detune: det, vib: vibPad,
                 filter: into === padIn ? null : { from: 1400, q: 0.5 } });
  }
}

// grape: little plucks in a bunch — short, bright, staccato
function vGrape(bus, midi, when, dur, vel) {
  const f = mtof(midi);
  tone(bus, { type: 'triangle', freq: f, when, vel, attack: 0.002, decay: 0.11 });
  if (lite) return;
  tone(bus, { type: 'square', freq: f, when, vel: vel * 0.18, attack: 0.002, decay: 0.05,
              filter: { from: 2500, q: 0.8 } });
}

// grapefruit: breathy whistle — sine with wide vibrato and a wisp of
// filtered air
function vGrapefruit(bus, midi, when, dur, vel) {
  const f = mtof(midi);
  const d = Math.max(0.3, dur);
  tone(bus, { type: 'sine', freq: f, when, vel, attack: 0.09, hold: d * 0.55, release: d * 0.45,
              vib: vibWhistle, freqEnv: { from: f * 0.97, time: 0.09 } });
  if (!lite) {
    noise(bus, { when, vel: vel * 0.12, attack: 0.09, decay: d,
                 filter: { from: f * 1.02, q: 12 } });
  }
}

// plum: rich electric piano — a tine stack with tremolo, dusky and warm
function vPlum(bus, midi, when, dur, vel) {
  const f = mtof(midi);
  // Stem notes run through the shared tremolo stage (0.7 ± 0.3)
  const trem = bus === stems[T.plum] ? plumTrem : bus;
  const d = Math.max(0.3, dur);
  tone(trem, { wave: epWave, freq: f, when, vel, attack: 0.008, decay: d });
  tone(trem, { type: 'sine', freq: f * 2, when, vel: vel * 0.25, attack: 0.004, decay: d * 0.3 });
  if (!lite) tone(trem, { type: 'triangle', freq: f * 0.5, when, vel: vel * 0.22, attack: 0.008, decay: d });
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
  if (!lite) tone(bus, { type: 'sine', freq: f * 2, when, vel: vel * 0.2, attack: 0.003, decay: 0.25 });
}

// blackberry: choir — detuned saws sung through vowel formants,
// swelling in slowly with a gentle vibrato
function vBlackberry(bus, midi, when, dur, vel) {
  const f = mtof(midi);
  const into = bus === stems[T.blackberry] ? choirStemIn
             : bus === hitBus ? choirHitIn : bus;
  const d = Math.max(0.5, dur);
  for (const det of lite ? [0] : [-8, 7]) {
    tone(into, { type: 'sawtooth', freq: f, when, vel: vel * (lite ? 0.7 : 0.5),
                 attack: Math.min(0.5, d * 0.35), hold: d * 0.3, release: d * 0.45,
                 detune: det, vib: vibChoir });
  }
}

const VOICES = [
  vCoconut, vPeach, vApple, vLemon, vLime, vOrange, vWatermelon,
  vBlueberry, vGrape, vGrapefruit, vPlum, vDragonfruit, vBlackberry, vLemon,
];

// ── Drum kit ────────────────────────────────────────────────────
function kick(when, vel = 0.5) {
  tone(bandFilter, { type: 'sine', freq: 48, when, vel, attack: 0.002, decay: 0.16,
                     freqEnv: { from: 160, time: 0.05 } });
  if (!lite) noise(bandFilter, { when, vel: vel * 0.25, decay: 0.01, filter: { from: 1800, q: 0.5 } });
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
  if (!lite) {
    noise(bandFilter, { when, vel: vel * 0.6, decay: 0.6, filter: { type: 'bandpass', from: 6000, q: 0.7 } });
  }
}

// ── Song position ───────────────────────────────────────────────
// Pure: what would come after the current section, given how hot the
// run is right now. Every section comes around even in a calm run —
// the verse plays twice, climbs the pre into the chorus, and the
// chorus alternates between the bridge and a fresh verse. A hot run
// skips the second verse and can double the chorus.
function peekNextSection() {
  if (feverOn || feverPending) return 'chorus';
  const hot = curIntensity;
  switch (sectionName) {
    case 'verse':
      return verseLoops >= 1 || hot > 0.3 ? 'pre' : 'verse';
    case 'pre':
      return 'chorus';
    case 'chorus':
      if (hot > 0.55 && chorusLoops < 1) return 'chorus';
      return chorusesDone % 2 === 0 ? 'bridge' : 'verse';
    case 'bridge':
      return hot > 0.3 ? 'pre' : 'verse';
  }
  return 'verse';
}

function setSection(name) {
  const prev = sectionName;
  if (prev === 'chorus' && name !== 'chorus') chorusesDone++;
  // A new trip around the form: step the key, and after a couple of
  // cycles move on to the next song in the book
  if (name === 'verse' && prev && prev !== 'verse') {
    cyclesInSong++;
    if (cyclesInSong >= SONG_CYCLES) {
      pickSong();
    } else {
      keyIndex++;
      keyShift = song.keyCycle[keyIndex % song.keyCycle.length];
    }
  }
  verseLoops = name === 'verse' ? (prev === 'verse' ? verseLoops + 1 : 0) : 0;
  chorusLoops = name === 'chorus' ? (prev === 'chorus' ? chorusLoops + 1 : 0) : 0;
  sectionName = name;
  section = song.sections[name];
  barInSection = 0;
  leadVariant = passes[name] % 3;
  passes[name]++;
}

// Any song but the one just played (a preferred one if it's allowed)
function pickSong(preferId = null) {
  let next = SONGS.findIndex((sg) => sg.id === preferId);
  if (next < 0 || next === lastSongIndex) {
    next = Math.floor(Math.random() * SONGS.length);
    if (SONGS.length > 1 && next === lastSongIndex) {
      next = (next + 1 + Math.floor(Math.random() * (SONGS.length - 1))) % SONGS.length;
    }
  }
  lastSongIndex = next;
  song = SONGS[next];
  cyclesInSong = 0;
  keyIndex = 0;
  keyShift = song.keyCycle[0];
  for (const k in passes) passes[k] = 0;
}

// Runs on every downbeat: advance the form, pick the chord, and let
// a pending fever cut straight to the chorus a whole step up
function advanceBar(stepIndex) {
  absBar = Math.floor(stepIndex / STEPS_PER_BAR);
  if (stepIndex > 0) barInSection++;
  if (feverPending) {
    feverPending = false;
    setSection('chorus');
    feverLift = 2;
  } else if (barInSection >= section.chords.length) {
    setSection(peekNextSection());
  }
  if (!feverOn) feverLift = 0; // ease back down on a barline
  transpose = keyShift + feverLift;

  curChord = chord(section.chords[barInSection]);
  // The bass walks toward the next chord — on the last bar that's the
  // first chord of whatever section is most likely next
  const nextName = barInSection + 1 < section.chords.length
    ? section.chords[barInSection + 1]
    : song.sections[peekNextSection()].chords[0];
  nextChord = chord(nextName);
  leadBar = section.leadVariants[leadVariant][barInSection];

  // Merge boosts wear off after a couple of bars
  for (let t = 0; t < TIERS; t++) {
    if (boost[t] > 0 && absBar >= boostUntilBar[t]) boost[t] = 0;
  }
}

// ── Sequencer ───────────────────────────────────────────────────
function chordTone(i, lo) {
  const n = curChord.notes;
  const a = toRegister(n[0], lo);
  const b = toRegister(n[1], lo);
  const c = toRegister(n[2], lo);
  // Sort three without allocating (this runs dozens of times a bar)
  const lo1 = Math.min(a, b, c);
  const hi1 = Math.max(a, b, c);
  const mid = a + b + c - lo1 - hi1;
  const k = ((i % 3) + 3) % 3;
  return (k === 0 ? lo1 : k === 1 ? mid : hi1) + 12 * Math.floor(i / 3) + transpose;
}

function scheduleStep(stepIndex, when) {
  const inBar = stepIndex % STEPS_PER_BAR;
  if (inBar === 0) advanceBar(stepIndex);
  const stepSec = (60 / bpm) / 4;
  if (inBar % 2 === 1) when += song.swing * stepSec; // swing the off 16ths

  const pat = song.patterns;
  const full = Math.max(section.energy, curIntensity); // arrangement fullness
  const lastBar = barInSection === section.chords.length - 1;
  const Tr = transpose;
  const rest = section.rest;
  const on = (t) => level[t] > EPS && !rest.has(t);
  const play = (t, midi, at, dur, vel) => VOICES[t](stems[t], midi, at, dur, vel);

  // An instrument that just joined announces itself on its first downbeat
  if (inBar === 0 && pendingLicks.size) {
    for (const [t, bar] of pendingLicks) {
      if (absBar >= bar) {
        pendingLicks.delete(t);
        introLick(t, when, stepSec);
      }
    }
  }

  // coconut — clave
  if (on(T.coconut) && pat.clave.includes(inBar)) {
    play(T.coconut, 0, when, 0, inBar === pat.clave[0] ? 0.5 : 0.36);
  }

  // peach — mallets on the off-beat 8ths, downbeats too when fuller
  if (on(T.peach)) {
    const i = pat.malletOff.indexOf(inBar);
    if (i >= 0) {
      play(T.peach, chordTone(pat.malletSeq[i % pat.malletSeq.length], REGISTER[T.peach]), when, stepSec * 2, 0.28);
    } else if (full > 0.5 && pat.malletOn.includes(inBar)) {
      play(T.peach, chordTone(0, REGISTER[T.peach] - 12), when, stepSec * 2, 0.2);
    }
  }

  // red apple — backbeat crunch on the chord's top note
  if (on(T.apple)) {
    if (pat.crunch.includes(inBar)) {
      play(T.apple, chordTone(2, REGISTER[T.apple]), when, stepSec, 0.42);
    } else if (full > 0.6 && pat.crunchPickup.includes(inBar)) {
      play(T.apple, chordTone(1, REGISTER[T.apple]), when, stepSec, 0.25);
    }
  }

  // The hook: the lemon sings it, except in the bridge where the
  // lime's steel drum takes over (if it's in the band)
  const steelLeads = sectionName === 'bridge' && on(T.lime);
  const leadTier = steelLeads ? T.lime : T.lemon;
  if (on(leadTier)) {
    for (const n of leadBar) {
      if (n.step === inBar) {
        play(leadTier, n.midi + Tr, when, n.dur * stepSec,
             (steelLeads ? 0.4 : 0.34) + full * 0.06);
      }
    }
  }

  // lime — steel-drum answers in the gaps of the hook
  if (on(T.lime) && !steelLeads) {
    for (const [s, ct, d] of full > 0.55 ? pat.steelFull : pat.steel) {
      if (s === inBar) play(T.lime, chordTone(ct, REGISTER[T.lime]), when, d * stepSec, 0.3);
    }
  }

  // orange — brass stabs (one voice per chord tone; two on slow phones)
  if (on(T.orange)) {
    for (const [s, d] of full > 0.6 ? pat.brassFull : pat.brass) {
      if (s !== inBar) continue;
      const vel = s === 0 ? 0.3 : 0.22;
      play(T.orange, chordTone(0, REGISTER[T.orange]), when, d * stepSec, vel);
      play(T.orange, chordTone(2, REGISTER[T.orange]), when + 0.012, d * stepSec, vel * 0.8);
      if (!lite) play(T.orange, chordTone(1, REGISTER[T.orange]), when + 0.006, d * stepSec, vel * 0.8);
    }
  }

  // watermelon — bass line
  if (on(T.watermelon)) {
    for (const [s, d, role] of full > 0.45 ? pat.bassFull : pat.bassChill) {
      if (s !== inBar) continue;
      let midi = curChord.root;
      if (role === '5') midi += 7;
      else if (role === 'o') midi += 12;
      else if (role === 'n') {
        // Walk into the next chord from a step below or above
        const nr = nextChord.root;
        midi = nr === curChord.root ? nr + 12 : (nr > curChord.root ? nr - 1 : nr + 2);
      }
      play(T.watermelon, midi + Tr, when, d * stepSec, role === 'r' && s === 0 ? 0.5 : 0.4);
    }
  }

  // blueberry — a pad chord that blooms across the bar
  if (on(T.blueberry) && inBar % pat.padEvery === 0) {
    const len = stepSec * pat.padEvery * 1.05;
    for (let i = 0; i < 3; i++) {
      play(T.blueberry, chordTone(i, REGISTER[T.blueberry]), when, len, 0.22);
    }
    if (!lite) play(T.blueberry, chordTone(0, REGISTER[T.blueberry] + 12), when, len, 0.14);
  }

  // grape — arpeggio cluster; 16ths when hot, 8ths otherwise (and on
  // slow phones)
  const arp16 = full > 0.55 && !lite;
  if (on(T.grape) && (arp16 || inBar % 2 === 0)) {
    play(T.grape, chordTone(pat.arpSeq[inBar], REGISTER[T.grape]), when, stepSec,
         inBar % 4 === 0 ? 0.3 : 0.2);
  }

  // grapefruit — whistle long tones over the chord
  if (on(T.grapefruit)) {
    for (const [s, ct, d] of pat.whistle) {
      if (s === inBar) play(T.grapefruit, chordTone(ct, REGISTER[T.grapefruit]), when, d * stepSec, 0.24);
    }
  }

  // plum — e-piano comping
  if (on(T.plum)) {
    for (const [s, d] of full > 0.55 ? pat.epFull : pat.epChill) {
      if (s !== inBar) continue;
      for (let i = 0; i < 3; i++) {
        play(T.plum, chordTone(i, REGISTER[T.plum]), when + i * 0.012, d * stepSec, s === 0 ? 0.3 : 0.22);
      }
    }
  }

  // dragonfruit — bell answers in the gaps
  if (on(T.dragonfruit)) {
    for (const [s, ct] of full > 0.6 ? pat.bellFull : pat.bell) {
      if (s === inBar) play(T.dragonfruit, chordTone(ct, REGISTER[T.dragonfruit]), when, stepSec * 3, 0.3);
    }
  }

  // blackberry — choir: the chord's top two notes, swelling
  if (on(T.blackberry)) {
    for (const [s, d] of full > 0.6 ? pat.choirFull : pat.choir) {
      if (s !== inBar) continue;
      play(T.blackberry, chordTone(1, REGISTER[T.blackberry]), when, d * stepSec, 0.26);
      play(T.blackberry, chordTone(2, REGISTER[T.blackberry]), when, d * stepSec, 0.22);
    }
  }

  // Merge riffs quantized onto the grid
  const riff = riffQueue.get(stepIndex);
  if (riff) {
    riffQueue.delete(stepIndex);
    for (const r of riff) VOICES[r.tier](hitBus, r.midi, when, stepSec * 1.5, r.vel);
  }

  scheduleDrums(inBar, when, lastBar);
}

// The kit grows with the band: a soft kick to start, hats once the
// hook arrives, a real snare a little later, and the busier patterns,
// fills and crashes once the band is properly big
function scheduleDrums(inBar, when, lastBar) {
  // Fill into a new instrument's entrance
  if (absBar === fillBar && inBar >= 12 && bandSize >= 4) {
    snare(when, 0.1 + (inBar - 12) * 0.05, inBar < 14);
  }

  if (danger > 0.55) {
    if (inBar === 0 || inBar === 8) kick(when, 0.45);
    if (inBar === 4 || inBar === 12) snare(when, 0.2, true);
    return;
  }
  const cap = bandSize < 4 ? 0 : bandSize < 7 ? 1 : 2;
  const tier = Math.min(cap, curIntensity < 0.3 ? 0 : curIntensity < 0.62 ? 1 : 2);
  const kit = song.drums[tier];
  // The bridge breathes: half-time kick, no busy hats
  const bridge = sectionName === 'bridge';

  if (kit.kick.includes(inBar) && (!bridge || inBar % 8 === 0)) {
    kick(when, (inBar === 0 ? 0.55 : 0.45) * (bandSize < 4 ? 0.8 : 1));
  }
  if (bandSize >= 6 && kit.snare.includes(inBar)) snare(when, 0.32 + tier * 0.04, kit.snareSoft);
  if (bandSize >= 4) {
    if (kit.open.includes(inBar) && !bridge) hat(when, 0.1, true);
    else if (kit.hat.includes(inBar) && (!bridge || inBar % 4 === 2)) {
      hat(when, inBar % 4 === 0 ? 0.13 : inBar % 2 === 0 ? 0.09 : 0.05);
    }
  }
  if (feverOn && inBar % 2 === 1) hat(when, 0.05); // fever shaker
  // Snare fill walking into the next section, crash on its downbeat
  if (bandSize >= 5) {
    if (lastBar && tier >= 1 && inBar >= 12) snare(when, 0.14 + (inBar - 12) * 0.06);
    if (inBar === 0 && barInSection === 0 && tier >= 1 && absBar > 0) crash(when, 0.2);
  }
}

// A new instrument's hello: a crash and a short signature phrase in
// its own voice, on the downbeat it joins
function introLick(t, when, stepSec) {
  if (bandSize >= 4) crash(when, 0.16);
  const lo = REGISTER[t];
  const v = VOICES[t];
  switch (t) {
    case T.coconut:
      for (const s of [0, 1, 2, 3, 6]) v(hitBus, 0, when + s * stepSec, 0, 0.4);
      break;
    case T.watermelon:
      // The low end drops in: root, octave, root
      v(hitBus, curChord.root + transpose, when, stepSec * 3, 0.5);
      v(hitBus, curChord.root + 12 + transpose, when + stepSec * 3, stepSec * 2, 0.4);
      v(hitBus, curChord.root + transpose, when + stepSec * 6, stepSec * 4, 0.45);
      break;
    case T.blueberry:
    case T.blackberry:
      for (let i = 0; i < 3; i++) v(hitBus, chordTone(i, lo), when, stepSec * 16, 0.24);
      break;
    case T.grapefruit:
      v(hitBus, chordTone(2, lo), when, stepSec * 6, 0.28);
      v(hitBus, chordTone(4, lo), when + stepSec * 6, stepSec * 8, 0.26);
      break;
    case T.plum:
      for (let i = 0; i < 3; i++) v(hitBus, chordTone(i, lo), when + i * 0.03, stepSec * 6, 0.28);
      break;
    default:
      // Melodic fruit run up the chord in 8ths
      for (let i = 0; i < 4; i++) {
        v(hitBus, chordTone(i, lo), when + i * stepSec * 2, stepSec * 2, 0.32 + i * 0.03);
      }
  }
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
  // steps move). A song change glides to the new song's tempo.
  const [lo, hi] = song.bpm;
  const targetBpm = lo + (hi - lo) * curIntensity + (feverOn ? FEVER_BPM_BONUS : 0);
  bpm += (targetBpm - bpm) * Math.min(1, dt * 0.8);
  echoDelay.delayTime.setTargetAtTime((60 / bpm / 4) * 3, now, 0.4);

  // Danger muffles the band; the run's energy lifts it a touch. A small
  // band gets some makeup gain so the sparse opening is sparse, not
  // faint — it eases off as instruments join and fill the mix.
  const cutoff = 18000 * Math.pow(400 / 18000, Math.min(1, danger * 1.15));
  bandFilter.frequency.setTargetAtTime(cutoff, now, 0.15);
  const makeup = 1 + 0.09 * Math.max(0, 9 - bandSize);
  master.gain.setTargetAtTime(
    (MUSIC_GAIN * makeup) * (1 - danger * 0.3) + 0.06 * curIntensity, now, 0.4);

  // Mixer: an unlocked fruit plays from its entrance bar on; the same
  // fruit in the cup (or a fresh merge) pushes it forward. Parts rise
  // fast and fade slow.
  for (let t = 0; t < TIERS; t++) {
    const inBand = unlocked[t] && absBar >= entryBar[t];
    const target = inBand ? Math.min(1, Math.max(UNLOCKED_LEVEL, presence[t], boost[t])) : 0;
    const tau = target > level[t] ? RISE_TAU : FALL_TAU;
    const next = level[t] + (target - level[t]) * Math.min(1, dt / tau);
    level[t] = next < 0.001 ? 0 : next;
    // Only touch the AudioParam when the level has moved audibly since
    // the last update — 14 automation events every 25 ms add up on a
    // phone. Silence is always sent exactly.
    const diff = Math.abs(level[t] - sentLevel[t]);
    if (diff > 0.004 || (diff > 0 && (level[t] === 0 || level[t] === target))) {
      stems[t].gain.setTargetAtTime(level[t] * STEM_TRIM[t], now, 0.05);
      sentLevel[t] = level[t];
    }
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
// `lineup`: the tiers the band starts with (the run's starting fruit).
// `songId` picks the opening song (random when omitted).
export function start(modeId = 'classic', lineup = [], songId = null) {
  if (playing) return;
  ensureNodes();
  playing = true;
  step = 0;
  absBar = 0;
  targetIntensity = 0;
  curIntensity = 0;
  mergeActivity = 0;
  danger = 0;
  feverOn = false;
  feverPending = false;
  feverLift = 0;
  verseLoops = 0;
  chorusLoops = 0;
  chorusesDone = 0;
  presence.fill(0);
  boost.fill(0);
  level.fill(0);
  sentLevel.fill(0);
  unlocked.fill(0);
  entryBar.fill(0);
  bandSize = 0;
  pendingLicks.clear();
  fillBar = -1;
  for (const t of lineup) {
    if (t >= 0 && t < TIERS && !unlocked[t]) { unlocked[t] = 1; bandSize++; }
  }
  for (let t = 0; t < TIERS; t++) stems[t].gain.value = 0;
  riffQueue.clear();
  // Zen opens on the laid-back song; everything else is a surprise
  pickSong(songId || (modeId === 'zen' ? 'island-daydream' : null));
  bpm = song.bpm[0];
  transpose = keyShift;
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

// Slow phones: fewer oscillators per note, simpler drums
export function setLite(on) {
  lite = !!on;
}

// A new fruit joined the run: its instrument comes in on the next bar
// (with a drum fill into it and a hello lick on the downbeat). The
// rainbow is the whole band, so it has no part of its own.
export function onUnlock(tier) {
  if (tier < 0 || tier >= RAINBOW_TIER || unlocked[tier]) return;
  unlocked[tier] = 1;
  bandSize++;
  if (!playing) return;
  // Come in on the first downbeat the scheduler hasn't queued yet
  const bar = Math.ceil(step / STEPS_PER_BAR);
  entryBar[tier] = bar;
  fillBar = bar - 1;
  pendingLicks.set(tier, bar);
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
// every frame by main.js; cheap. One fruit pushes its part forward, a
// few more bring it to full volume.
export function setCupContents(counts) {
  for (let t = 0; t < TIERS; t++) {
    const c = counts[t] || 0;
    presence[t] = c > 0 ? 0.85 + 0.15 * Math.min(1, (c - 1) / 3) : 0;
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
  if (tier >= T.watermelon) {
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
      riffQueue.get(s).push({ tier: T.dragonfruit, midi: chordTone(0, 84), vel: 0.35 });
    }
  }
}

// The rainbow squishy: every fruit at once. A crash, the bass drops
// the root, the lead and steel drum run the scale up two octaves, and
// brass, bells, pad and choir land the big chord.
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
      if (i % 2 === 0) vLime(hitBus, midi + 12, at, 0.1, 0.22);
      i++;
    }
  }
  const top = now + 0.06 + i * 0.055;
  for (let k = 0; k < 3; k++) {
    vOrange(hitBus, chordTone(k, 60), top, 1.4, 0.32);
    vDragonfruit(hitBus, chordTone(k, 84), top + k * 0.05, 1, 0.3);
    vBlackberry(hitBus, chordTone(k, 60), top, 2.2, 0.22);
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

// Read-only peek at the band for debugging/tests
export function getDebugState() {
  return {
    song: song.id, section: sectionName, bar: absBar, bpm, transpose,
    bandSize, unlocked: Array.from(unlocked), level: Array.from(level),
  };
}
