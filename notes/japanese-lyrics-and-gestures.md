# Japanese lyrics and high-level tuning

This layer turns linguistic and expressive intent into inspectable manifest
objects. It does not call an opaque lyric model or hide a tuning preset.

## Evidence boundary

The phoneme inventory comes from the Japanese table in the bundled
`VOC3_Manual.pdf` (Japanese phonetic symbols, manual pages 115–116) and is
restricted to:

`a i M e o k k' g g' N N' s S z Z dz dZ t t' ts tS d d' n J h h\ C p\ p\' b b' p p' m m' j 4 4' w N\`

Every emitted token is checked against this set. Notable manual-compatible
forms include `k' i` for き, `S i` for し, `tS i` for ち, `p\ M` for ふ,
`4 a` for ら, and `N\` for moraic ん.

The implementation intentionally exposes uncertainty:

- Kanji has no deterministic reading without lexical analysis. If `text`
  contains kanji, `reading` is mandatory and must be kana.
- Spaces in `reading` are explicit word boundaries. They decide when the
  ざ/じ rows use initial `dz`/`dZ` versus medial `z`/`Z` in `position` mode.
- が-row nasalization is never assumed. The agent chooses `plosive` or
  `nasal_between_vowels`.
- The manual chart has no standalone small-っ symbol. G2P returns a `sokuon`
  unit with no invented phoneme. Alignment then requires either a
  position-checked rest slot or the explicitly experimental `attach_next`
  repeated-consonant strategy.
- ヴ is approximated with Japanese `/b/` and reported as a fallback.

## Agent workflow

1. Design pitches and rhythm slots with stable IDs, then call
   `vocaloid_align_japanese_phrase` with the displayed `text` and, for any
   kanji, an explicit kana `reading`. Inspect the returned G2P units,
   fallbacks, and warnings before using the phrase.
2. In `sequential` mode, supply exactly one voiced slot per mora; arbitrary
   rests may sit between them. This is suitable for dense 1/16–1/64 lyrics.
3. In `explicit` mode, set `mora_index` on every voiced slot. Consecutive
   repeated indices compile to native VSQX `-` lyric/phoneme continuations,
   so one lyric can span several pitches.
4. Validate the returned manifest-compatible phrase. For a new vocal part,
   include the first phrase in a `vocaloid_edit_song` `upsert_vocal_part`
   action; for every later line, insert only that phrase with
   `upsert_vocal_phrase`.
5. Apply sparse, intentional expression with the `apply_tuning` action
   (set `materialize_existing: true` only to compile a declared but
   unmaterialized gesture), targeting direct-note or phrase-cell
   stable IDs. Build a new VSQX revision, render an isolated vocal stem, and
   use score-versus-render evidence before revising.

An alignment call with yoon and a final two-note melisma looks like this:

```json
{
  "name": "vocaloid_align_japanese_phrase",
  "arguments": {
    "text": "希望のキャラ",
    "reading": "きぼうの きゃら",
    "phrase_id": "verse-a-line-01",
    "start": { "measure": 8, "beat": 0, "tick": 0 },
    "allocation": "explicit",
    "note_slots": [
      { "id": "verse-a-cell-001", "duration": { "denominator": 16 }, "note_number": 64, "mora_index": 0 },
      { "id": "verse-a-cell-002", "duration": { "denominator": 16 }, "note_number": 66, "mora_index": 1 },
      { "id": "verse-a-cell-003", "duration": { "denominator": 8 }, "note_number": 68, "mora_index": 2 },
      { "id": "verse-a-cell-004", "duration": { "denominator": 16 }, "note_number": 66, "mora_index": 3 },
      { "id": "verse-a-cell-005", "duration": { "denominator": 16 }, "note_number": 68, "mora_index": 4 },
      { "id": "verse-a-cell-006", "duration": { "denominator": 8 }, "note_number": 69, "mora_index": 5 },
      { "id": "verse-a-cell-007", "duration": { "denominator": 8 }, "note_number": 71, "mora_index": 5 }
    ],
    "response_format": "json"
  }
}
```

The last two slots become one sounded mora plus one native melisma
continuation. If there are fewer voiced slots than morae, alignment fails
instead of packing several Japanese morae into one unsupported VSQX note.
The phrase also retains `linguistic_source`: original text, supplied and
normalized reading, affricate/nasal-g decisions, and the small-っ strategy.
The VSQX note lyrics remain pronounceable kana, while the canonical manifest
does not lose the original kanji lyric intent.

## Gesture compiler

Each gesture has its own stable ID and explicit target event IDs. The exact
gesture input is retained in the vocal part, while the compiled native values
and curve points remain directly editable:

| Gesture | Native result |
| --- | --- |
| `articulation` | VEL plus note `accent`, `decay`, `opening`, bend, and rise/fall portamento style values |
| `vibrato` | note vibrato type/length plus normalized depth and rate envelopes |
| `pitch_scoop` | sparse `PBS` and `PIT` points, including a post-note reset for away gestures |
| `dynamics_arc` | three-point `DYN` phrase arc |
| `timbre_arc` | three-point `BRE`, `BRI`, `CLE`, `GEN`, or `POR` arc |

Only one stored curve object per native curve type is allowed in a part.
Generated points merge into it by musical tick, preserving an existing point
ID when that tick already exists. Curve ranges and part bounds are validated.
Gesture IDs are immutable audit IDs: reusing one is rejected; a deliberate
new expressive pass uses a new ID, or the agent replaces the whole vocal part
after inspection.

Pitch depth is explicit rather than a vague adjective. The compiler verifies
`depth_cents <= pitch_bend_sensitivity * 100`, converts it to PIT units, and
keeps PBS in 1–24 semitones. `up_into` starts below target, `down_into` starts
above, `fall_away` ends below, and `rise_away` ends above.

## Verification

Regression coverage includes manual-table phonemes, katakana/yoon/long-vowel
and foreign-kana forms, explicit kanji readings, rapid 1/32 alignment, native
melisma continuations, position-checked small-っ rests, all five gesture types,
stable curve merging, stale-revision refusal, manifest persistence, validated
VSQX compilation, and a real stdio MCP client exercising the complete chain.
