// ── Squishy Fruit — the song sheet ──────────────────────────────
// Pure composition data, no audio. music.js is the band that reads
// it. Everything is on a 16th-note grid (16 steps per bar) in C major,
// so every part lands on the same chords and the same swing.
//
// The tune is a bouncy tropical pop song with a fixed, written hook —
// the same melody every run, so it gets stuck in your head — while
// the *arrangement* is decided live by the fruit in the cup (see
// music.js). Sections:
//   verse   I – vi – IV – V, laid back, the main motif
//   pre     ii – iii – IV – V, a four-bar climb into the chorus
//   chorus  IV – V – iii – vi / IV – V – I – I, the big singalong hook
//   bridge  vi – IV – I – V, low and dreamy, a breather
// music.js walks between them based on how hot the run is.

const NOTE_SEMIS = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

export function noteToMidi(name) {
  const m = /^([a-g])(#|b)?(\d)$/.exec(name);
  if (!m) throw new Error(`bad note "${name}"`);
  let n = NOTE_SEMIS[m[1]];
  if (m[2] === '#') n++;
  else if (m[2] === 'b') n--;
  return 12 * (parseInt(m[3], 10) + 1) + n;
}

// "g4:3 c5:3 r:2 e5:8" → [{ step, midi, dur }]  (r = rest). Each bar
// must add up to exactly 16 sixteenths — parse throws otherwise, so a
// typo in the sheet fails loudly at load instead of drifting the song.
export function parseBar(str) {
  const out = [];
  let pos = 0;
  for (const tok of str.trim().split(/\s+/)) {
    const [name, d] = tok.split(':');
    const dur = parseInt(d, 10);
    if (!(dur > 0)) throw new Error(`bad duration in "${tok}"`);
    if (name !== 'r') out.push({ step: pos, midi: noteToMidi(name), dur });
    pos += dur;
  }
  if (pos !== 16) throw new Error(`bar "${str}" has ${pos} steps, want 16`);
  return out;
}

export const STEPS_PER_BAR = 16;

// C major, for combo runs and fills
export const SCALE = [0, 2, 4, 5, 7, 9, 11];

// Chord voicings: a bass root (octave 1–2) and a close mid-register
// triad, voice-led so comping parts barely move between chords.
export const CHORDS = {
  C:  { root: 36, notes: [60, 64, 67] }, // C E G
  Dm: { root: 38, notes: [62, 65, 69] }, // D F A
  Em: { root: 40, notes: [59, 64, 67] }, // B E G
  F:  { root: 41, notes: [57, 60, 65] }, // A C F
  G:  { root: 43, notes: [59, 62, 67] }, // B D G
  Am: { root: 33, notes: [57, 60, 64] }, // A C E
};

// Lead melody per bar, written for the lemon (the zesty lead voice).
// Motif: a rising 3-3-2 "tresillo" figure that climbs the chord, then
// a falling answer. The chorus is a three-step sequence that lands on
// a long high note — the singalong bit.
export const SECTIONS = {
  verse: {
    chords: ['C', 'Am', 'F', 'G', 'C', 'Am', 'F', 'G'],
    lead: [
      'g4:3 c5:3 e5:2 g5:4 e5:4',
      'r:2 e5:2 d5:2 c5:2 a4:6 r:2',
      'a4:3 c5:3 f5:2 e5:4 c5:4',
      'r:2 d5:2 e5:2 d5:2 b4:4 g4:4',
      'g4:3 c5:3 e5:2 g5:4 e5:4',
      'r:2 e5:2 d5:2 c5:2 a4:2 c5:2 d5:4',
      'e5:3 f5:3 e5:2 c5:4 a4:4',
      'b4:2 d5:2 g5:4 r:2 f5:2 e5:2 d5:2',
    ],
    energy: 0.3,
  },
  pre: {
    chords: ['Dm', 'Em', 'F', 'G'],
    lead: [
      'd5:2 d5:2 f5:2 d5:2 a4:4 r:4',
      'e5:2 e5:2 g5:2 e5:2 b4:4 r:4',
      'f5:2 f5:2 a5:2 f5:2 c5:2 d5:2 e5:4',
      'g5:2 r:2 g5:2 r:2 a5:2 b5:2 d6:4',
    ],
    energy: 0.55,
  },
  chorus: {
    chords: ['F', 'G', 'Em', 'Am', 'F', 'G', 'C', 'C'],
    lead: [
      'f5:2 f5:2 f5:2 a5:2 c6:6 a5:2',
      'g5:2 g5:2 g5:2 b5:2 d6:6 b5:2',
      'e5:2 e5:2 e5:2 g5:2 b5:6 g5:2',
      'a5:4 g5:2 e5:2 c5:4 r:4',
      'f5:2 f5:2 f5:2 a5:2 c6:6 a5:2',
      'g5:2 g5:2 g5:2 b5:2 d6:4 e6:2 d6:2',
      'c6:6 g5:2 e5:4 g5:4',
      'c6:2 r:2 c6:2 r:2 e6:2 d6:2 c6:4',
    ],
    energy: 0.85,
  },
  bridge: {
    chords: ['Am', 'F', 'C', 'G', 'Am', 'F', 'C', 'G'],
    lead: [
      'e5:4 c5:4 a4:8',
      'c5:4 a4:4 f4:8',
      'e5:2 g5:2 e5:4 c5:8',
      'd5:4 b4:4 g4:4 a4:2 b4:2',
      'e5:4 c5:4 a4:4 c5:4',
      'c5:4 a4:4 f4:4 a4:4',
      'e5:2 g5:2 e5:4 c5:4 d5:4',
      'b4:4 d5:4 g5:4 r:4',
    ],
    energy: 0.4,
  },
};

// Pre-parse every melody bar once at load (and validate the sheet).
for (const sec of Object.values(SECTIONS)) {
  if (sec.lead.length !== sec.chords.length) {
    throw new Error('section melody/chord bar count mismatch');
  }
  sec.leadNotes = sec.lead.map(parseBar);
}

// ── Rhythm parts ────────────────────────────────────────────────
// Step lists on the 16-step bar: 0 = beat 1, 4 = beat 2, 8 = beat 3,
// 12 = beat 4; even steps are 8ths, odd steps are the swung 16ths.
export const PATTERNS = {
  // coconut — son clave (3-2). The hard little shell is the band's
  // woodblock and the whole groove hangs off it.
  clave: [0, 3, 6, 10, 12],

  // peach — soft mallets on the off-beat 8ths (the bounce), plus the
  // downbeats when the arrangement fills out
  malletOff: [2, 6, 10, 14],
  malletOn: [0, 8],

  // apple — crisp backbeat "crunch"; a pickup joins when it's hot
  crunch: [4, 12],
  crunchPickup: [15],

  // orange — sunny brass stabs: [step, durationInSteps]
  brass: [[0, 2], [6, 2], [12, 3]],
  brassFull: [[0, 2], [3, 1], [6, 2], [8, 4], [12, 3]],

  // watermelon — the bass line. role: r root, 5 fifth, o octave,
  // n = approach the next chord's root
  bassChill: [[0, 3, 'r'], [6, 2, 'r'], [8, 4, 'r'], [14, 2, 'n']],
  bassFull: [[0, 3, 'r'], [3, 2, 'r'], [6, 2, 'o'], [8, 2, 'r'],
             [10, 2, '5'], [12, 2, 'r'], [14, 2, 'n']],

  // plum — rich electric-piano chords, pushed on the "and of 2"
  epChill: [[0, 6], [7, 6]],
  epFull: [[0, 3], [7, 3], [10, 5]],

  // dragonfruit — exotic bell answers in the gaps: [step, chordTone]
  bell: [[3, 2], [11, 0]],
  bellFull: [[3, 2], [7, 1], [11, 0], [14, 2]],
};

// Drum kit patterns by energy tier (0 chill, 1 groove, 2 full)
export const DRUMS = [
  { kick: [0, 8], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], open: [], snareSoft: true },
  { kick: [0, 6, 8], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], open: [14], snareSoft: false },
  { kick: [0, 4, 8, 12], snare: [4, 12], hat: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], open: [6, 14], snareSoft: false },
];

// Register floor (MIDI) each fruit's instrument speaks in — chord
// tones get folded into [lo, lo + 12) so the same chord sounds in the
// right range for every voice.
export const REGISTER = [
  60, // coconut (unpitched, unused)
  72, // peach mallets
  67, // apple pluck
  72, // lemon lead
  60, // orange brass
  36, // watermelon bass
  60, // blueberry pad
  64, // grape arp
  55, // plum e-piano
  79, // dragonfruit bell
  72, // grapefruit whistle
  72, // rainbow
];

export function toRegister(midi, lo) {
  while (midi < lo) midi += 12;
  while (midi >= lo + 12) midi -= 12;
  return midi;
}
