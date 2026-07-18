# Reproducible stem mix workflow

Raw performance artifacts and downstream mix intent have different validity
boundaries:

- `composition_hash` covers score, vocal performance source, arrangement, and
  renderer settings. Vocal/instrument stems depend on this hash.
- `mix_hash` covers `composition_hash` plus effect chains and section dynamics.
  A mix depends on both, so changing EQ invalidates the mix without forcing the
  original Editor to synthesize vocals again.

## Ordering and alignment

Every selected artifact is verified against its SHA-256 and composition hash.
Instrument stems use `timeline_origin=song_start`; the mixer inserts the exact
pre-measure duration derived from meter and initial tempo. Original-Editor vocal
stems use `project_start` and need no delay.

The deterministic render order is:

1. resample/convert one stem to stereo float;
2. apply that track's section gain automation with explicit edge ramps;
3. apply enabled effects in manifest order;
4. sum tracks with `normalize=0`;
5. apply mix-bus section automation;
6. apply enabled mix-bus effects in order;
7. encode 16- or 24-bit PCM and measure the result.

Automation is pre-effect, so a reverb/delay tail follows the level driven into
the effect. No limiter, normalization, makeup, pan correction, or stereo centering
is hidden. If the agent wants one, it must be present in the manifest.

## Typed effects

- `gain`: dB;
- `pan`: normalized −1 left to +1 right power balance;
- `highpass` / `lowpass`: cutoff, Q, one/two poles;
- `equalizer`: center frequency, Q, dB gain, wet mix;
- `compressor`: threshold dB, ratio, attack/release, makeup, knee, detector, mix;
- `deesser`: normalized intensity, maximum de-essing, frequency focus;
- `reverb`: reproducible two-tap room approximation;
- `delay`: delay time and feedback decay;
- `limiter`: ceiling, attack, release, with latency compensation and no auto gain.

The room effect is deliberately described as a bounded multi-tap approximation,
not a studio convolution reverb. High-quality VST/DAW rendering remains outside
the requested scope.

## Minimal sequence

1. Inspect the manifest and select current stem artifact IDs.
2. Upsert one chain per target with `vocaloid_upsert_manifest_effect_chain`.
3. Upsert individual section decisions with
   `vocaloid_upsert_manifest_section_dynamic`.
4. Inspect the new `mix_hash`.
5. Call `vocaloid_render_stem_mix` with explicit sample rate and bit depth.
6. Inspect returned LUFS/LRA, true/sample peak, clipping, per-channel RMS, and
   filter graph. Revise the manifest and render a new slugged revision when the
   measurements or listening intent call for it.

```json
{
  "name": "vocaloid_render_stem_mix",
  "arguments": {
    "manifest_path": "songs/ame-no-ato.song.json",
    "expected_revision": 27,
    "stem_artifact_ids": [
      "vocal-stem-lead-r22",
      "vocal-stem-harmony-r22",
      "instrument-stem-shamisen-r23",
      "instrument-stem-taiko-r23"
    ],
    "output_path": "artifacts/ame-no-ato-mix-r27.wav",
    "sample_rate": 48000,
    "bit_depth": 24,
    "reference_lufs": -16,
    "reference_true_peak_dbfs": -1,
    "response_format": "json"
  }
}
```

The loudness and peak targets in this call are analysis references only. They do
not normalize the mix. Use an explicit gain/compressor/limiter revision or the
separate two-pass mastering tool after the source mix is clean.
