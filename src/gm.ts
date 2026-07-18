const FAMILIES = [
  "Piano",
  "Chromatic Percussion",
  "Organ",
  "Guitar",
  "Bass",
  "Strings",
  "Ensemble",
  "Brass",
  "Reed",
  "Pipe",
  "Synth Lead",
  "Synth Pad",
  "Synth Effects",
  "Ethnic",
  "Percussive",
  "Sound Effects",
] as const;

const PROGRAM_NAMES = [
  "Acoustic Grand Piano", "Bright Acoustic Piano", "Electric Grand Piano", "Honky-tonk Piano",
  "Electric Piano 1", "Electric Piano 2", "Harpsichord", "Clavinet",
  "Celesta", "Glockenspiel", "Music Box", "Vibraphone", "Marimba", "Xylophone", "Tubular Bells", "Dulcimer",
  "Drawbar Organ", "Percussive Organ", "Rock Organ", "Church Organ", "Reed Organ", "Accordion", "Harmonica", "Tango Accordion",
  "Acoustic Guitar (nylon)", "Acoustic Guitar (steel)", "Electric Guitar (jazz)", "Electric Guitar (clean)",
  "Electric Guitar (muted)", "Overdriven Guitar", "Distortion Guitar", "Guitar Harmonics",
  "Acoustic Bass", "Electric Bass (finger)", "Electric Bass (pick)", "Fretless Bass", "Slap Bass 1", "Slap Bass 2", "Synth Bass 1", "Synth Bass 2",
  "Violin", "Viola", "Cello", "Contrabass", "Tremolo Strings", "Pizzicato Strings", "Orchestral Harp", "Timpani",
  "String Ensemble 1", "String Ensemble 2", "Synth Strings 1", "Synth Strings 2", "Choir Aahs", "Voice Oohs", "Synth Voice", "Orchestra Hit",
  "Trumpet", "Trombone", "Tuba", "Muted Trumpet", "French Horn", "Brass Section", "Synth Brass 1", "Synth Brass 2",
  "Soprano Sax", "Alto Sax", "Tenor Sax", "Baritone Sax", "Oboe", "English Horn", "Bassoon", "Clarinet",
  "Piccolo", "Flute", "Recorder", "Pan Flute", "Blown Bottle", "Shakuhachi", "Whistle", "Ocarina",
  "Lead 1 (square)", "Lead 2 (sawtooth)", "Lead 3 (calliope)", "Lead 4 (chiff)", "Lead 5 (charang)", "Lead 6 (voice)", "Lead 7 (fifths)", "Lead 8 (bass + lead)",
  "Pad 1 (new age)", "Pad 2 (warm)", "Pad 3 (polysynth)", "Pad 4 (choir)", "Pad 5 (bowed)", "Pad 6 (metallic)", "Pad 7 (halo)", "Pad 8 (sweep)",
  "FX 1 (rain)", "FX 2 (soundtrack)", "FX 3 (crystal)", "FX 4 (atmosphere)", "FX 5 (brightness)", "FX 6 (goblins)", "FX 7 (echoes)", "FX 8 (sci-fi)",
  "Sitar", "Banjo", "Shamisen", "Koto", "Kalimba", "Bag Pipe", "Fiddle", "Shanai",
  "Tinkle Bell", "Agogo", "Steel Drums", "Woodblock", "Taiko Drum", "Melodic Tom", "Synth Drum", "Reverse Cymbal",
  "Guitar Fret Noise", "Breath Noise", "Seashore", "Bird Tweet", "Telephone Ring", "Helicopter", "Applause", "Gunshot",
] as const;

const DRUM_NAMES: Record<number, string> = {
  35: "Acoustic Bass Drum", 36: "Bass Drum 1", 37: "Side Stick", 38: "Acoustic Snare",
  39: "Hand Clap", 40: "Electric Snare", 41: "Low Floor Tom", 42: "Closed Hi-Hat",
  43: "High Floor Tom", 44: "Pedal Hi-Hat", 45: "Low Tom", 46: "Open Hi-Hat",
  47: "Low-Mid Tom", 48: "Hi-Mid Tom", 49: "Crash Cymbal 1", 50: "High Tom",
  51: "Ride Cymbal 1", 52: "Chinese Cymbal", 53: "Ride Bell", 54: "Tambourine",
  55: "Splash Cymbal", 56: "Cowbell", 57: "Crash Cymbal 2", 58: "Vibraslap",
  59: "Ride Cymbal 2", 60: "Hi Bongo", 61: "Low Bongo", 62: "Mute Hi Conga",
  63: "Open Hi Conga", 64: "Low Conga", 65: "High Timbale", 66: "Low Timbale",
  67: "High Agogo", 68: "Low Agogo", 69: "Cabasa", 70: "Maracas", 71: "Short Whistle",
  72: "Long Whistle", 73: "Short Guiro", 74: "Long Guiro", 75: "Claves", 76: "Hi Wood Block",
  77: "Low Wood Block", 78: "Mute Cuica", 79: "Open Cuica", 80: "Mute Triangle", 81: "Open Triangle",
};

export interface GeneralMidiProgram {
  program: number;
  bankMsb: number;
  bankLsb: number;
  name: string;
  family: string;
}

export interface GeneralMidiDrum {
  noteNumber: number;
  name: string;
}

export interface FeaturedInstrumentPreset {
  name: string;
  bankMsb: number;
  bankLsb: number;
  program: number;
  role: string;
}

const JAPANESE_PALETTE: FeaturedInstrumentPreset[] = [
  { name: "Shakuhachi", bankMsb: 0, bankLsb: 0, program: 77, role: "breathy lead, intro, and response phrases" },
  { name: "Shamisen", bankMsb: 0, bankLsb: 0, program: 106, role: "plucked ostinato and rhythmic riffs" },
  { name: "Koto", bankMsb: 0, bankLsb: 0, program: 107, role: "arpeggios, glissando-like runs, and chord color" },
  { name: "Taisho Koto", bankMsb: 0, bankLsb: 8, program: 107, role: "brighter alternate koto color in FluidR3" },
  { name: "Taiko Drum", bankMsb: 0, bankLsb: 0, program: 116, role: "pitched taiko accents on a melodic channel" },
  { name: "Timpani", bankMsb: 0, bankLsb: 0, program: 47, role: "low ceremonial transitions and chorus impacts" },
  { name: "Woodblock", bankMsb: 0, bankLsb: 0, program: 115, role: "dry rhythmic punctuation" },
  { name: "Shanai", bankMsb: 0, bankLsb: 0, program: 111, role: "piercing folk lead color" },
];

export function listGeneralMidi(search?: string): {
  programs: GeneralMidiProgram[];
  drums: GeneralMidiDrum[];
  featuredPalettes: { japanese: FeaturedInstrumentPreset[] };
} {
  const needle = search?.trim().toLocaleLowerCase() ?? "";
  const programs = PROGRAM_NAMES.map((name, program) => ({
    program,
    bankMsb: 0,
    bankLsb: 0,
    name,
    family: FAMILIES[Math.floor(program / 8)]!,
  })).filter((entry) =>
    !needle || entry.name.toLocaleLowerCase().includes(needle) || entry.family.toLocaleLowerCase().includes(needle),
  );
  const drums = Object.entries(DRUM_NAMES)
    .map(([noteNumber, name]) => ({ noteNumber: Number(noteNumber), name }))
    .filter((entry) => !needle || entry.name.toLocaleLowerCase().includes(needle));
  const japanese = JAPANESE_PALETTE.filter((entry) =>
    !needle
    || [entry.name, entry.role, "japanese", "wafuu", "和風"]
      .some((value) => value.toLocaleLowerCase().includes(needle)),
  );
  return { programs, drums, featuredPalettes: { japanese } };
}
