// ── Squishy Fruit — the songbook ────────────────────────────────
// Pure composition data, no audio. music.js is the band that reads
// it. Everything is on a 16th-note grid (16 steps per bar), so every
// part lands on the same chords and the same swing.
//
// There are three songs — a bouncy tropical pop tune, a juice-bar
// disco-funk groove and a laid-back island one-drop — each with its
// own key, tempo, swing, drum kit and a part written for every fruit.
// A run starts on one of them (never the one you just heard), and a
// long run moves through the songbook, changing key every time the
// form comes back around, so the music keeps moving.
//
// Each song has the same four sections:
//   verse   the main motif, laid back
//   pre     a four-bar climb
//   chorus  the big singalong hook
//   bridge  a breather — the steel drum takes the melody
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

// ── Chords ──────────────────────────────────────────────────────
// "C", "Dm", "Bb", "F#m", "Bdim" → { root, notes }: a bass root in
// A1–G#2 and a close mid-register triad. Comping parts refold the
// triad into their own register (toRegister), so only the pitch
// classes and the root matter here.
const QUALITY = { '': [0, 4, 7], m: [0, 3, 7], dim: [0, 3, 6], sus: [0, 5, 7] };
const chordCache = new Map();

export function chord(name) {
  let c = chordCache.get(name);
  if (c) return c;
  const m = /^([A-G])(#|b)?(m|dim|sus)?$/.exec(name);
  if (!m) throw new Error(`bad chord "${name}"`);
  let pc = NOTE_SEMIS[m[1].toLowerCase()];
  if (m[2] === '#') pc++;
  else if (m[2] === 'b') pc--;
  pc = (pc + 12) % 12;
  const notes = QUALITY[m[3] || ''].map((iv) => toRegister(60 + pc + iv, 57)).sort((a, b) => a - b);
  c = { name, root: toRegister(pc, 33), notes };
  chordCache.set(name, c);
  return c;
}

export function toRegister(midi, lo) {
  while (midi < lo) midi += 12;
  while (midi >= lo + 12) midi -= 12;
  return midi;
}

// Register floor (MIDI) each fruit's instrument speaks in — chord
// tones get folded into [lo, lo + 12) so the same chord sounds in the
// right range for every voice.
export const REGISTER = [
  60, // coconut — woodblock (unpitched)
  72, // peach — marimba
  67, // red apple — crisp pluck
  72, // lemon — square lead
  67, // lime — steel drum
  60, // orange — brass
  36, // watermelon — sub bass
  60, // blueberry — pad
  64, // grape — arp
  72, // grapefruit — whistle
  55, // plum — e-piano
  79, // dragonfruit — FM bell
  60, // blackberry — choir
  72, // rainbow squishy — the whole band
];

// ── Parts shared by every song unless a song overrides them ──────
// Step lists on the 16-step bar: 0 = beat 1, 4 = beat 2, 8 = beat 3,
// 12 = beat 4; even steps are 8ths, odd steps are the swung 16ths.
const DEFAULT_PATTERNS = {
  // coconut — son clave (3-2), the woodblock the groove hangs off
  clave: [0, 3, 6, 10, 12],

  // peach — soft mallets on the off-beat 8ths (the bounce), plus the
  // downbeats when the arrangement fills out. malletSeq picks the
  // chord tone for each off-beat hit.
  malletOff: [2, 6, 10, 14],
  malletSeq: [0, 2, 1, 3],
  malletOn: [0, 8],

  // red apple — crisp backbeat "crunch"; a pickup joins when it's hot
  crunch: [4, 12],
  crunchPickup: [15],

  // lime — steel-drum answers in the gaps: [step, chordTone, steps]
  steel: [[10, 2, 2], [12, 1, 2], [14, 0, 2]],
  steelFull: [[3, 2, 1], [6, 1, 2], [10, 2, 2], [12, 1, 2], [14, 0, 2]],

  // orange — sunny brass stabs: [step, durationInSteps]
  brass: [[0, 2], [6, 2], [12, 3]],
  brassFull: [[0, 2], [3, 1], [6, 2], [8, 4], [12, 3]],

  // watermelon — the bass line. role: r root, 5 fifth, o octave,
  // n = approach the next chord's root
  bassChill: [[0, 3, 'r'], [6, 2, 'r'], [8, 4, 'r'], [14, 2, 'n']],
  bassFull: [[0, 3, 'r'], [3, 2, 'r'], [6, 2, 'o'], [8, 2, 'r'],
             [10, 2, '5'], [12, 2, 'r'], [14, 2, 'n']],

  // blueberry — pad chord re-struck every `padEvery` steps
  padEvery: 16,

  // grape — arpeggio: chord-tone index per 16th
  arpSeq: [0, 1, 2, 3, 4, 5, 4, 3, 2, 1, 0, 1, 2, 3, 2, 1],

  // grapefruit — whistle long tones: [step, chordTone, steps]
  whistle: [[0, 1, 8], [8, 2, 8]],

  // plum — rich electric-piano chords, pushed on the "and of 2"
  epChill: [[0, 6], [7, 6]],
  epFull: [[0, 3], [7, 3], [10, 5]],

  // dragonfruit — exotic bell answers in the gaps: [step, chordTone]
  bell: [[3, 2], [11, 0]],
  bellFull: [[3, 2], [7, 1], [11, 0], [14, 2]],

  // blackberry — choir swells: [step, steps]
  choir: [[0, 16]],
  choirFull: [[0, 8], [8, 8]],
};

// Which instruments sit a section out (tier indexes). Arrangement
// breathing: the chorus lands harder because the verse held back.
const DEFAULT_RESTS = {
  verse: [12],       // the choir waits for the big moments
  pre: [],
  chorus: [],
  bridge: [2, 5],    // no backbeat crunch or brass in the breather
};

// ── The songs ───────────────────────────────────────────────────
// Melodies are written for the lead (the lemon; the lime's steel drum
// takes the bridge). Scales are pitch classes used to embellish the
// melody on repeats.
export const SONGS = [
  {
    id: 'fruit-stand',
    title: 'Fruit Stand',
    bpm: [108, 126],
    swing: 0.18,
    scale: [0, 2, 4, 5, 7, 9, 11],
    keyCycle: [0, 2, -1, 3, 1],
    sections: {
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
    },
    patterns: {},
    // Drum kit by energy tier (0 chill, 1 groove, 2 full)
    drums: [
      { kick: [0, 8], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], open: [], snareSoft: true },
      { kick: [0, 6, 8], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], open: [14], snareSoft: false },
      { kick: [0, 4, 8, 12], snare: [4, 12], hat: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], open: [6, 14], snareSoft: false },
    ],
  },

  {
    id: 'juice-bar-funk',
    title: 'Juice Bar Funk',
    bpm: [112, 128],
    swing: 0.06,
    // F major / D dorian
    scale: [0, 2, 4, 5, 7, 9, 10],
    keyCycle: [0, -2, 1, 3, -1],
    sections: {
      verse: {
        chords: ['Dm', 'G', 'Dm', 'G', 'Bb', 'C', 'Dm', 'A'],
        lead: [
          'd5:2 r:1 d5:1 f5:2 a5:2 g5:1 f5:1 d5:2 r:2 c5:2',
          'r:2 b4:2 d5:2 g5:3 f5:1 d5:2 b4:2 r:2',
          'd5:2 r:1 d5:1 f5:2 a5:2 c6:2 a5:2 g5:2 f5:2',
          'g5:4 r:2 f5:1 e5:1 d5:4 b4:4',
          'bb4:2 d5:2 f5:2 bb5:4 a5:2 f5:2 d5:2',
          'c5:2 e5:2 g5:2 c6:4 bb5:2 g5:2 e5:2',
          'a5:3 f5:3 d5:2 f5:2 e5:2 d5:4',
          'c#5:2 e5:2 a5:2 g5:2 e5:2 c#5:2 a4:4',
        ],
        energy: 0.35,
      },
      pre: {
        chords: ['Gm', 'Am', 'Bb', 'C'],
        lead: [
          'g5:2 g5:2 bb5:2 g5:2 d5:4 r:4',
          'a5:2 a5:2 c6:2 a5:2 e5:4 r:4',
          'bb5:2 bb5:2 d6:2 bb5:2 f5:2 g5:2 a5:4',
          'c6:2 r:2 c6:2 r:2 bb5:2 a5:2 g5:4',
        ],
        energy: 0.6,
      },
      chorus: {
        chords: ['F', 'C', 'Dm', 'Bb', 'F', 'C', 'Bb', 'C'],
        lead: [
          'a5:2 c6:2 a5:2 f5:2 c6:4 a5:4',
          'g5:2 c6:2 g5:2 e5:2 c6:4 g5:4',
          'f5:2 a5:2 f5:2 d5:2 a5:3 g5:3 f5:2',
          'f5:2 d5:2 bb4:4 c5:2 d5:2 f5:4',
          'a5:2 c6:2 a5:2 f5:2 c6:4 d6:2 c6:2',
          'e6:3 d6:3 c6:2 g5:4 e5:4',
          'd6:2 c6:2 bb5:2 a5:2 bb5:2 a5:2 g5:2 f5:2',
          'g5:2 r:2 g5:2 a5:2 bb5:2 c6:6',
        ],
        energy: 0.9,
      },
      bridge: {
        chords: ['Dm', 'Bb', 'F', 'C', 'Dm', 'Bb', 'Gm', 'A'],
        lead: [
          'd5:6 f5:2 a5:8',
          'bb4:6 d5:2 f5:8',
          'a4:4 c5:4 f5:8',
          'e5:4 g5:4 c5:8',
          'd5:4 f5:4 a5:4 g5:2 f5:2',
          'f5:4 d5:4 bb4:8',
          'g4:4 bb4:4 d5:4 g5:4',
          'e5:4 c#5:4 a4:4 r:4',
        ],
        energy: 0.45,
      },
    },
    patterns: {
      clave: [0, 3, 7, 10, 12],               // cowbell-ish woodblock
      crunch: [4, 12],                        // funk guitar "chank"…
      crunchPickup: [6, 14, 15],              // …with 16th ghosts
      steel: [[1, 2, 1], [2, 1, 1], [9, 2, 1], [10, 0, 2]],
      steelFull: [[1, 2, 1], [2, 1, 1], [9, 2, 1], [10, 0, 2], [13, 1, 1], [14, 2, 2]],
      brass: [[0, 1], [3, 1], [6, 2], [12, 2]],
      brassFull: [[0, 1], [3, 1], [6, 2], [10, 1], [11, 1], [12, 2], [15, 1]],
      bassChill: [[0, 2, 'r'], [3, 1, 'o'], [6, 2, 'r'], [8, 2, 'r'],
                  [10, 1, 'o'], [11, 2, '5'], [14, 2, 'n']],
      bassFull: [[0, 1, 'r'], [2, 1, 'o'], [3, 1, 'r'], [6, 1, 'o'], [7, 1, 'r'],
                 [8, 2, 'r'], [10, 1, 'o'], [11, 1, '5'], [12, 2, 'r'], [14, 1, '5'], [15, 1, 'n']],
      arpSeq: [0, 2, 1, 3, 2, 4, 3, 5, 4, 3, 2, 4, 1, 3, 0, 2],
      epChill: [[0, 3], [6, 2], [10, 4]],
      epFull: [[0, 2], [3, 2], [6, 2], [10, 2], [13, 2]],
      bell: [[7, 2], [15, 0]],
      bellFull: [[3, 2], [7, 1], [11, 0], [15, 2]],
      whistle: [[0, 2, 6], [8, 1, 6]],
    },
    drums: [
      { kick: [0, 8], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], open: [], snareSoft: true },
      { kick: [0, 4, 8, 12], snare: [4, 12], hat: [0, 4, 8, 12], open: [2, 6, 10, 14], snareSoft: false },
      { kick: [0, 4, 8, 12], snare: [4, 12], hat: [0, 1, 3, 4, 5, 7, 8, 9, 11, 12, 13, 15], open: [2, 6, 10, 14], snareSoft: false },
    ],
  },

  {
    id: 'island-daydream',
    title: 'Island Daydream',
    bpm: [92, 112],
    swing: 0.3,
    // G major
    scale: [0, 2, 4, 6, 7, 9, 11],
    keyCycle: [0, 2, -2, 1, 3],
    sections: {
      verse: {
        chords: ['G', 'Em', 'C', 'D', 'G', 'Em', 'Am', 'D'],
        lead: [
          'd5:3 b4:3 g4:2 a4:2 b4:2 d5:4',
          'e5:6 d5:2 b4:4 g4:4',
          'e5:3 c5:3 g4:2 a4:2 c5:2 e5:4',
          'f#5:6 e5:2 d5:4 a4:4',
          'd5:3 b4:3 g4:2 a4:2 b4:2 d5:4',
          'g5:6 f#5:2 e5:4 b4:4',
          'c5:3 e5:3 a5:2 g5:2 e5:2 c5:4',
          'd5:4 f#5:4 a5:6 r:2',
        ],
        energy: 0.25,
      },
      pre: {
        chords: ['Am', 'Bm', 'C', 'D'],
        lead: [
          'a4:2 c5:2 e5:2 a5:2 g5:4 e5:4',
          'b4:2 d5:2 f#5:2 b5:2 a5:4 f#5:4',
          'c5:2 e5:2 g5:2 c6:2 b5:2 a5:2 g5:4',
          'a5:2 r:2 a5:2 r:2 b5:2 c6:2 d6:4',
        ],
        energy: 0.5,
      },
      chorus: {
        chords: ['G', 'D', 'Em', 'C', 'G', 'D', 'C', 'D'],
        lead: [
          'd6:4 b5:2 g5:2 b5:4 d6:4',
          'a5:4 f#5:2 d5:2 f#5:4 a5:4',
          'b5:3 g5:3 e5:2 g5:2 b5:2 e6:4',
          'e6:4 d6:2 c6:2 g5:8',
          'd6:4 b5:2 g5:2 b5:4 d6:4',
          'a5:2 b5:2 d6:4 e6:4 d6:4',
          'e6:3 d6:3 c6:2 b5:2 a5:2 g5:4',
          'a5:4 f#5:4 d5:4 r:4',
        ],
        energy: 0.8,
      },
      bridge: {
        chords: ['Em', 'C', 'G', 'D', 'Em', 'C', 'Am', 'D'],
        lead: [
          'b4:8 e5:8',
          'c5:8 e5:4 g5:4',
          'd5:8 b4:8',
          'a4:4 d5:4 f#5:8',
          'g5:8 e5:4 b4:4',
          'g5:4 e5:4 c5:8',
          'a4:4 c5:4 e5:4 a5:4',
          'f#5:8 d5:4 r:4',
        ],
        energy: 0.35,
      },
    },
    patterns: {
      clave: [3, 6, 10, 14],                  // sparse rim knocks
      malletOff: [0, 3, 8, 11],               // marimba on the dotted beat…
      malletSeq: [0, 1, 2, 1],
      malletOn: [6, 14],
      crunch: [2, 6, 10, 14],                 // …and the apple skanks the off-beats
      crunchPickup: [7, 15],
      steel: [[4, 0, 2], [6, 1, 2], [12, 2, 4]],
      steelFull: [[0, 2, 2], [4, 0, 2], [6, 1, 2], [9, 2, 1], [12, 2, 4]],
      brass: [[0, 4], [8, 4]],
      brassFull: [[0, 2], [3, 1], [6, 2], [8, 4], [14, 2]],
      bassChill: [[2, 3, 'r'], [6, 2, 'o'], [8, 3, 'r'], [12, 2, '5'], [14, 2, 'n']],
      bassFull: [[0, 2, 'r'], [3, 2, 'r'], [6, 2, 'o'], [8, 2, 'r'],
                 [10, 2, '5'], [12, 2, 'o'], [14, 2, 'n']],
      padEvery: 8,
      arpSeq: [0, 2, 4, 2, 1, 3, 5, 3, 0, 2, 4, 6, 5, 3, 2, 1],
      epChill: [[0, 8], [8, 8]],
      // reggae organ "bubble"
      epFull: [[2, 1], [3, 1], [6, 1], [7, 1], [10, 1], [11, 1], [14, 1], [15, 1]],
      bell: [[11, 2]],
      bellFull: [[3, 2], [11, 0], [14, 1]],
      choir: [[0, 16]],
      choirFull: [[0, 16]],
    },
    // One-drop: the kick and rim land together on beat 3; steppers
    // four-on-the-floor when it's hot
    drums: [
      { kick: [8], snare: [8], hat: [0, 4, 8, 12], open: [], snareSoft: true },
      { kick: [8], snare: [8], hat: [0, 2, 4, 6, 8, 10, 12, 14], open: [14], snareSoft: false },
      { kick: [0, 4, 8, 12], snare: [8], hat: [0, 2, 4, 6, 8, 10, 12, 14], open: [6, 14], snareSoft: false },
    ],
  },
];

// ── Melody variations ───────────────────────────────────────────
// The hook is the same every time (that's what makes it stick), but
// a section heard again comes back dressed differently:
//   0 — as written
//   1 — call and response: every other bar answers an octave up
//   2 — ornamented: long notes break into the note plus a quick
//       upper neighbor from the song's scale, so the line skips
const MAX_LEAD_MIDI = 86; // D6 — anything above gets shrill on a phone

function upperNeighbor(midi, scale) {
  for (let up = 1; up <= 2; up++) {
    if (scale.includes((midi + up) % 12)) return midi + up;
  }
  return midi + 2;
}

function makeVariants(bars, scale) {
  const octave = bars.map((bar, i) => (i % 2 === 1
    ? bar.map((n) => (n.midi + 12 <= MAX_LEAD_MIDI ? { ...n, midi: n.midi + 12 } : n))
    : bar));
  const ornate = bars.map((bar) => {
    const out = [];
    for (const n of bar) {
      if (n.dur >= 4) {
        out.push({ ...n, dur: n.dur - 2 });
        out.push({ step: n.step + n.dur - 2, midi: upperNeighbor(n.midi, scale), dur: 2 });
      } else {
        out.push(n);
      }
    }
    return out;
  });
  return [bars, octave, ornate];
}

// Pre-parse every melody bar once at load (and validate the sheet),
// fill in default parts and rests
for (const song of SONGS) {
  song.patterns = { ...DEFAULT_PATTERNS, ...song.patterns };
  for (const [name, sec] of Object.entries(song.sections)) {
    if (sec.lead.length !== sec.chords.length) {
      throw new Error(`${song.id}/${name}: melody/chord bar count mismatch`);
    }
    sec.chords.forEach(chord);
    sec.leadVariants = makeVariants(sec.lead.map(parseBar), song.scale);
    sec.rest = new Set(sec.rest || DEFAULT_RESTS[name] || []);
  }
}
