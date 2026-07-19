# 遠い灯、青い夜 — root-cause experiment and framework changes

Date: 2026-07-19  
Run: `tooi-hi-aoi-yoru-ia-20260719-a`

## Listener report

The final song appeared to contain a sharp, separated, noise-like IA texture.
The listener then confirmed that both existing diagnostic anchors were clean:

- `tooi-hi-aoi-yoru-ia-20260719-a-lead_solo-anchor-r38.wav`;
- `tooi-hi-aoi-yoru-ia-20260719-a-lead_harmony-anchor-r39.wav`.

This falsified the initial hypothesis that IA_ROCKS, phrase gate, or the lead
effect chain alone caused the reported final-delivery artifact.

## Layer ablation

The same final-chorus passage was measured at each layer:

| Layer | LUFS | LRA | True peak |
|---|---:|---:|---:|
| processed vocal only | -33.4 | 7.2 | -17.6 dBFS |
| minimal band | -33.4 | 7.2 | -17.6 dBFS |
| full premaster mix | -33.4 | 7.2 | -17.6 dBFS |
| final delivery | -15.5 | 5.8 | -1.5 dBFS |

The 200–1200 Hz, 2.5–5 kHz, and 5–10 kHz mean-band levels of vocal-only and
full premaster differ by approximately 0.0–0.1 dB. The corresponding verse/pre
passage shows the same pattern. The accompaniment therefore is not supported as
the primary source of the vocal texture in these passages.

Final delivery is roughly 18 dB louder in the anchor and has reduced dynamic
range. Mean spectral ratios remain similar, so the evidence points to playback
loudness and/or mastering dynamics, not a newly introduced high-frequency EQ
tilt. Human equal-loudness A/B remains the deciding test.

## Rendered equal-loudness tests

Final-chorus pair, both -19.0 LUFS:

- `build/cold-start-songs/tooi-hi-aoi-yoru-ia-20260719-a/root-cause-ab/mastering-a-premaster-minus19.wav`;
- `build/cold-start-songs/tooi-hi-aoi-yoru-ia-20260719-a/root-cause-ab/mastering-b-delivery-minus19.wav`.

Arrangement control, both -19.0 LUFS:

- `build/cold-start-songs/tooi-hi-aoi-yoru-ia-20260719-a/root-cause-ab/arrangement-a-vocal-only-minus19.wav`;
- `build/cold-start-songs/tooi-hi-aoi-yoru-ia-20260719-a/root-cause-ab/arrangement-b-full-mix-minus19.wav`.

Verse/pre pair, both -20.0 LUFS:

- `build/cold-start-songs/tooi-hi-aoi-yoru-ia-20260719-a/root-cause-ab/verse-mastering-a-premaster-minus20.wav`;
- `build/cold-start-songs/tooi-hi-aoi-yoru-ia-20260719-a/root-cause-ab/verse-mastering-b-delivery-minus20.wav`.

Verse/pre arrangement control, both -20.0 LUFS:

- `build/cold-start-songs/tooi-hi-aoi-yoru-ia-20260719-a/root-cause-ab/verse-arrangement-a-vocal-only-minus20.wav`;
- `build/cold-start-songs/tooi-hi-aoi-yoru-ia-20260719-a/root-cause-ab/verse-arrangement-b-full-mix-minus20.wav`.

The first question is whether mastering B still has the artifact when A and B
are equally loud. The second control asks whether full arrangement B introduces
anything absent from vocal-only A. No final is replaced until that listening
answer exists.

## Human equal-loudness listening result

The user completed the three comparisons on 2026-07-19:

1. mastering B contains slightly more of the noise-like/sharp-separated texture
   than premaster A, but much less than the original report; without direct A/B
   comparison it is difficult to notice and the overall result remains good;
2. the vocal-only versus full-arrangement control revealed no material problem;
3. both verse/pre mastering variants were acceptable.

Disposition: **keep the current delivery and defer mastering changes**. The
mastering transformation is a real but low-severity contributor, not a release
blocker. Do not change IA/IA_ROCKS selection, note gates, global EQ,
arrangement, or the mastering algorithm for this song. Retain the transparency
metrics and equal-loudness A/B requirement so a future song with a stronger
effect can be handled from fresh evidence.

## Scoped framework fix

`masterWav` now reports:

- requested loudness gain;
- peak-safe gain;
- peak reduction required to reach the requested LUFS/TP pair;
- source-to-output LRA change;
- a deterministic transparency-review recommendation.

The delivery artifact stores these values. The MCP delivery tool tells the
agent to compare source and delivery at equal loudness when peak reshaping is
over 1.5 dB or absolute LRA change is over 1.5 LU. The mastering algorithm,
global EQ, note allocation, IA voice selection, arrangement, and existing song
bytes are unchanged.

## Phrase-construction root cause

The lead has 306 notes across 20 phrases. All 20 phrases start at beat 0; 280 of
286 comparable intervals are 1–3 semitone steps; only two intervals repeat the
same pitch. Existing theory analysis already reported 77.9% repeated interval
trigrams, but it was a track-wide info finding without a phrase-choice surface.

The fix is `vocaloid-phrase-grammar/v1`, documented in
`notes/phrase-grammar-dsl.md`. It is an opt-in DSL and separate analyzer, so it
adds future compositional choices without changing existing phrase bytes,
preflight rules, or render defaults.

The DSL is not a melody template. Its IA/genre bundles are unordered option
pools, carry `melody_material=absent`, and cannot compile pitch or rhythm
sequences. The agent remains responsible for the original concrete melody from
the current intent, lyric prosody, harmony, and form.

The implemented analyzer was then run against the unchanged current manifest.
It found 24 phrases across lead and harmony, with no blueprints because this
song predates the DSL. For the 20 lead phrases it measured:

- one distinct beat/tick entry position: all 20 start at `0:0`;
- stepwise ratio `0.979021` and repeated-pitch ratio `0.006993`;
- 13 of 20 phrase maxima in the late third;
- 15 distinct normalized duration fingerprints;
- largest normalized contour cluster 9 of 20.

It therefore emitted only three advisory warnings:
`PHRASE_ENTRY_HOMOGENEITY`, `PHRASE_MOTION_OVERCONCENTRATED`, and
`PHRASE_PEAK_POSITION_CONCENTRATED`. It did not rewrite the song or infer that
all dimensions were homogeneous. This is important: the diagnostic identifies
the measured concentration while leaving the agent responsible for an
intent-preserving new melody.

## Local library decision

The previous production aggregate-profile checkpoint is retired. Local IA
works are not exposed to production agents. Offline analysis may suggest a new
DSL component or bundle, but the tracked result must be human reviewed,
non-reconstructive, source-identity-free, and contain no reference sequence or
next-note continuation material.
