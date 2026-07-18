import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";


const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const PRODUCTION_TOOLS = [
  "vocaloid_align_japanese_phrase",
  "vocaloid_analyze_vocal_stem",
  "vocaloid_analyze_wav",
  "vocaloid_build_song_manifest",
  "vocaloid_create_song_manifest",
  "vocaloid_edit_song",
  "vocaloid_get_song_section",
  "vocaloid_host_readiness",
  "vocaloid_import_vsqx_manifest",
  "vocaloid_inspect_song_manifest",
  "vocaloid_manifest_history",
  "vocaloid_master_manifest_delivery",
  "vocaloid_preflight_song",
  "vocaloid_probe_voice",
  "vocaloid_render_instrument_stems",
  "vocaloid_render_manifest_master",
  "vocaloid_render_stem_mix",
  "vocaloid_render_vocal_stems",
  "vocaloid_review_audio",
  "vocaloid_review_song",
];

test("production MCP is compact, fully typed, and exposes workflow resources", async (context) => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(ROOT, "dist/src/index.js")],
    env: { VOCALOID_MCP_PROFILE: "production" },
    stderr: "pipe",
  });
  const client = new Client({ name: "vocaloid-mcp-production-contract", version: "0.1.0" });
  context.after(async () => client.close());
  await client.connect(transport);

  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), PRODUCTION_TOOLS);
  assert.ok(Buffer.byteLength(JSON.stringify(tools)) < 80_000, "production tools/list exceeded 80 KB");
  for (const tool of tools.tools) {
    assert.ok(tool.outputSchema, `${tool.name} has no MCP output schema`);
    assert.doesNotMatch(JSON.stringify(tool.outputSchema), /"data":\{\}/u, `${tool.name} exposes unknown data`);
  }
  const editTool = tools.tools.find((tool) => tool.name === "vocaloid_edit_song");
  assert.equal(editTool?.annotations?.destructiveHint, false, "recoverable dry-runs/writes must not trigger destructive-call cancellation");

  const capabilities = await client.readResource({ uri: "vocaloid://capabilities" });
  const capabilityEntry = capabilities.contents[0];
  const capabilityText = capabilityEntry && "text" in capabilityEntry ? capabilityEntry.text : undefined;
  assert.equal(typeof capabilityText, "string");
  assert.equal(JSON.parse(capabilityText as string).profile, "production");

  const lyricResource = await client.readResource({ uri: "vocaloid://lyrics/hanairo-biyori" });
  const suppliedLyrics = await readFile(join(ROOT, "artifacts/evals/[Lyrics] Hanairo Biyori.txt"), "utf8");
  const lyricEntry = lyricResource.contents[0];
  assert.equal(lyricEntry && "text" in lyricEntry ? lyricEntry.text : undefined, suppliedLyrics);

  const exampleResource = await client.readResource({ uri: "vocaloid://examples/from-zero" });
  const exampleEntry = exampleResource.contents[0];
  const example = JSON.parse(exampleEntry && "text" in exampleEntry ? exampleEntry.text : "null");
  assert.equal(example.calls[2].arguments.voice.component_id, "BDREB7P2KTWKYDC5");
  assert.equal(example.calls[2].arguments.dry_run, true);
});

test("stdio MCP lists and executes the core VSQX workflow", async (context) => {
  const temporary = await mkdtemp(join(ROOT, ".test-mcp-"));
  context.after(async () => rm(temporary, { recursive: true, force: true }));
  const outputPath = join(temporary, "mcp-created.vsqx");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(ROOT, "dist/src/index.js")],
    env: { VOCALOID_MCP_PROFILE: "full" },
    stderr: "pipe",
  });
  const client = new Client({ name: "vocaloid-mcp-smoke", version: "0.1.0" });
  context.after(async () => client.close());
  await client.connect(transport);

  const tools = await client.listTools();
  assert.deepEqual(
    tools.tools.map((tool) => tool.name).sort(),
    [
      "vocaloid_add_control_points",
      "vocaloid_add_notes",
      "vocaloid_align_japanese_phrase",
      "vocaloid_analyze_vocal_stem",
      "vocaloid_analyze_wav",
      "vocaloid_apply_groove",
      "vocaloid_apply_tuning_gestures",
      "vocaloid_build_song_manifest",
      "vocaloid_compile_vocal_phrase",
      "vocaloid_create_project",
      "vocaloid_create_song",
      "vocaloid_create_song_manifest",
      "vocaloid_edit_song",
      "vocaloid_get_song_section",
      "vocaloid_host_readiness",
      "vocaloid_import_vsqx_manifest",
      "vocaloid_inspect_mixer",
      "vocaloid_inspect_project",
      "vocaloid_inspect_song_manifest",
      "vocaloid_japanese_g2p",
      "vocaloid_list_control_points",
      "vocaloid_list_instruments",
      "vocaloid_list_notes",
      "vocaloid_list_voices",
      "vocaloid_manifest_history",
      "vocaloid_master_manifest_delivery",
      "vocaloid_master_wav",
      "vocaloid_preflight_song",
      "vocaloid_probe_voice",
      "vocaloid_remove_song_objects",
      "vocaloid_render_accompaniment",
      "vocaloid_render_instrument_stems",
      "vocaloid_render_manifest_master",
      "vocaloid_render_stem_mix",
      "vocaloid_render_vocal_stems",
      "vocaloid_render_wav",
      "vocaloid_review_audio",
      "vocaloid_review_song",
      "vocaloid_song_timeline",
      "vocaloid_transform_song_events",
      "vocaloid_update_mixer",
      "vocaloid_update_note_expressions",
      "vocaloid_upsert_manifest_arrangement_track",
      "vocaloid_upsert_manifest_effect_chain",
      "vocaloid_upsert_manifest_section_dynamic",
      "vocaloid_upsert_manifest_vocal_part",
      "vocaloid_upsert_manifest_vocal_phrase",
      "vocaloid_upsert_song_section",
      "vocaloid_validate_project",
    ],
  );

  const instruments = await client.callTool({
    name: "vocaloid_list_instruments",
    arguments: { search: "bass", response_format: "json" },
  });
  assert.notEqual(instruments.isError, true);
  const instrumentData = instruments.structuredContent as {
    data?: { programs?: Array<{ program?: number; name?: string }> };
  };
  assert.ok(instrumentData.data?.programs?.some((entry) => entry.program === 33));

  const voices = await client.callTool({
    name: "vocaloid_list_voices",
    arguments: { response_format: "json" },
  });
  assert.notEqual(voices.isError, true);
  const voiceData = voices.structuredContent as {
    data?: { editor_availability?: string; voices?: Array<{ componentId?: string }> };
  };
  assert.equal(voiceData.data?.editor_availability, "unverified_until_render");
  assert.ok(voiceData.data?.voices?.some((voice) => voice.componentId === "BLRGDDR4M3WM2LC6"));

  const phrase = await client.callTool({
    name: "vocaloid_compile_vocal_phrase",
    arguments: {
      phrase: {
        start: { measure: 0, beat: 0 },
        allocation: "explicit",
        lyrics: [
          { lyric: "そ", phonemes: "s o" },
          { lyric: "ら", phonemes: "4 a" },
        ],
        cells: [
          { duration: { denominator: 16 }, note_number: 67, lyric_index: 0 },
          { duration: { denominator: 16 }, note_number: 69, lyric_index: 0 },
          { duration: { denominator: 16 }, note_number: 71, lyric_index: 1 },
        ],
      },
      response_format: "json",
    },
  });
  assert.notEqual(phrase.isError, true);
  const phraseData = phrase.structuredContent as {
    data?: { noteCells?: number; continuations?: number; fastestNoteTicks?: number };
  };
  assert.deepEqual(
    {
      notes: phraseData.data?.noteCells,
      continuations: phraseData.data?.continuations,
      fastest: phraseData.data?.fastestNoteTicks,
    },
    { notes: 3, continuations: 1, fastest: 120 },
  );

  const japanese = await client.callTool({
    name: "vocaloid_japanese_g2p",
    arguments: {
      text: "希望のキャラ",
      reading: "きぼうの きゃら",
      response_format: "json",
    },
  });
  assert.notEqual(japanese.isError, true);
  const japaneseData = japanese.structuredContent as {
    data?: { units?: Array<{ surface?: string; phonemes?: string | null }>; fallback_count?: number };
  };
  assert.deepEqual(
    japaneseData.data?.units?.map((unit) => [unit.surface, unit.phonemes]),
    [["き", "k' i"], ["ぼ", "b o"], ["う", "M"], ["の", "n o"], ["きゃ", "k' a"], ["ら", "4 a"]],
  );
  assert.equal(japaneseData.data?.fallback_count, 0);

  const japaneseAlignment = await client.callTool({
    name: "vocaloid_align_japanese_phrase",
    arguments: {
      text: "きゃら",
      phrase_id: "jp-phrase",
      start: { measure: 0, beat: 2 },
      allocation: "sequential",
      note_slots: [
        { id: "jp-cell-1", duration: 240, note_number: 64 },
        { id: "jp-cell-2", duration: 240, note_number: 65 },
      ],
      response_format: "json",
    },
  });
  assert.notEqual(japaneseAlignment.isError, true);
  const japaneseAlignmentData = japaneseAlignment.structuredContent as {
    data?: {
      phrase?: Record<string, unknown>;
      alignment?: { lyric_units?: number; voiced_slots?: number };
    };
  };
  assert.deepEqual(
    japaneseAlignmentData.data?.alignment,
    {
      lyric_units: 2,
      voiced_slots: 2,
      rest_slots: 0,
      continuations: 0,
      sokuon_count: 0,
      sokuon_strategy: "not_needed",
    },
  );
  assert.ok(japaneseAlignmentData.data?.phrase);

  const manifestPath = join(temporary, "mcp-agent-song.song.json");
  const manifestCreated = await client.callTool({
    name: "vocaloid_create_song_manifest",
    arguments: {
      output_path: manifestPath,
      song_id: "mcp-agent-song",
      slug: "mcp-agent-song",
      title: "MCP Agent Song",
      sections: [{
        id: "verse",
        name: "Verse",
        kind: "verse",
        start: { measure: 0, beat: 0 },
        end: { measure: 1, beat: 0 },
      }],
      key_changes: [{
        id: "key-cmaj",
        position: { measure: 0, beat: 0 },
        tonic: "C",
        mode: "major",
      }],
      response_format: "json",
    },
  });
  assert.notEqual(manifestCreated.isError, true);
  assert.equal(
    (manifestCreated.structuredContent as { data?: { revision?: number } }).data?.revision,
    1,
  );

  const vocalUpsert = await client.callTool({
    name: "vocaloid_upsert_manifest_vocal_part",
    arguments: {
      input_path: manifestPath,
      output_path: manifestPath,
      expected_revision: 1,
      overwrite: true,
      voice: { id: "voice-ia", name: "IA", component_id: "BLRGDDR4M3WM2LC6" },
      track: { id: "lead", name: "Lead", voice_id: "voice-ia" },
      part: {
        id: "verse-lead",
        section_id: "verse",
        name: "Verse Lead",
        start: { measure: 0, beat: 0 },
        end: { measure: 1, beat: 0 },
        notes: [
          {
            id: "lead-note-1",
            position: { measure: 0, beat: 0 },
            duration: 480,
            note_number: 60,
            lyric: "ら",
            phonemes: "4 a",
          },
          {
            id: "lead-note-2",
            position: { measure: 0, beat: 1 },
            duration: 480,
            note_number: 62,
            lyric: "ら",
            phonemes: "4 a",
          },
        ],
      },
      response_format: "json",
    },
  });
  assert.notEqual(vocalUpsert.isError, true);

  const phraseUpsert = await client.callTool({
    name: "vocaloid_upsert_manifest_vocal_phrase",
    arguments: {
      input_path: manifestPath,
      output_path: manifestPath,
      expected_revision: 2,
      overwrite: true,
      vocal_track_id: "lead",
      vocal_part_id: "verse-lead",
      phrase: japaneseAlignmentData.data?.phrase,
      response_format: "json",
    },
  });
  assert.notEqual(phraseUpsert.isError, true);
  assert.equal(
    (phraseUpsert.structuredContent as { data?: { write?: { revision?: number } } }).data?.write?.revision,
    3,
  );

  const tuningGestures = await client.callTool({
    name: "vocaloid_apply_tuning_gestures",
    arguments: {
      input_path: manifestPath,
      output_path: manifestPath,
      expected_revision: 3,
      overwrite: true,
      vocal_track_id: "lead",
      vocal_part_id: "verse-lead",
      gestures: [
        {
          id: "mcp-articulation",
          type: "articulation",
          event_ids: ["lead-note-1", "jp-cell-1"],
          accent: 72,
          opening: 110,
          consonant_velocity: 78,
        },
        {
          id: "mcp-vibrato",
          type: "vibrato",
          event_ids: ["jp-cell-2"],
          vibrato_type: 13,
          length_percent: 55,
        },
        {
          id: "mcp-scoop",
          type: "pitch_scoop",
          event_ids: ["lead-note-1"],
          direction: "up_into",
          depth_cents: 70,
          duration_percent: 25,
          pitch_bend_sensitivity: 2,
        },
        {
          id: "mcp-dynamics",
          type: "dynamics_arc",
          event_ids: ["lead-note-1", "jp-cell-1", "jp-cell-2"],
          start_value: 60,
          peak_value: 82,
          end_value: 68,
        },
        {
          id: "mcp-brightness",
          type: "timbre_arc",
          event_ids: ["jp-cell-1", "jp-cell-2"],
          curve: "BRI",
          start_value: 52,
          peak_value: 74,
          end_value: 58,
        },
      ],
      response_format: "json",
    },
  });
  assert.notEqual(tuningGestures.isError, true);
  const tuningData = tuningGestures.structuredContent as {
    data?: {
      write?: { revision?: number };
      applied?: { gestures?: number; curve_point_writes?: number };
    };
  };
  assert.equal(tuningData.data?.write?.revision, 4);
  assert.equal(tuningData.data?.applied?.gestures, 5);
  assert.ok((tuningData.data?.applied?.curve_point_writes ?? 0) >= 8);

  const arrangementUpsert = await client.callTool({
    name: "vocaloid_upsert_manifest_arrangement_track",
    arguments: {
      input_path: manifestPath,
      output_path: manifestPath,
      expected_revision: 4,
      overwrite: true,
      track: {
        kind: "pitched",
        id: "piano",
        name: "Piano",
        program: 0,
        notes: [
          { id: "piano-c", position: { measure: 0, beat: 0 }, duration: 480, note_number: 48 },
          { id: "piano-g", position: { measure: 0, beat: 2 }, duration: 480, note_number: 55 },
        ],
      },
      response_format: "json",
    },
  });
  assert.notEqual(arrangementUpsert.isError, true);

  const sectionUpsert = await client.callTool({
    name: "vocaloid_upsert_song_section",
    arguments: {
      input_path: manifestPath,
      output_path: manifestPath,
      expected_revision: 5,
      overwrite: true,
      section: {
        id: "verse",
        name: "Verse",
        kind: "verse",
        start: { measure: 0, beat: 0 },
        end: { measure: 1, beat: 0 },
        energy: 0.72,
        description: "Agent revised this section without replacing the whole song",
      },
      response_format: "json",
    },
  });
  assert.notEqual(sectionUpsert.isError, true);

  const manifestSection = await client.callTool({
    name: "vocaloid_get_song_section",
    arguments: { path: manifestPath, section_id: "verse", response_format: "json" },
  });
  assert.notEqual(manifestSection.isError, true);
  const manifestSectionData = manifestSection.structuredContent as {
    data?: { revision?: number; section?: { energy?: number }; vocalTracks?: unknown[] };
  };
  assert.equal(manifestSectionData.data?.revision, 6);
  assert.equal(manifestSectionData.data?.section?.energy, 0.72);
  assert.equal(manifestSectionData.data?.vocalTracks?.length, 1);

  const transformedManifest = await client.callTool({
    name: "vocaloid_transform_song_events",
    arguments: {
      input_path: manifestPath,
      output_path: manifestPath,
      expected_revision: 6,
      overwrite: true,
      transform: {
        vocal_track_id: "lead",
        event_ids: ["lead-note-1"],
        targets: ["vocal_notes"],
        transpose: 2,
      },
      response_format: "json",
    },
  });
  assert.notEqual(transformedManifest.isError, true);
  assert.equal(
    (transformedManifest.structuredContent as { data?: { changed?: number } }).data?.changed,
    1,
  );

  const removedManifestEvent = await client.callTool({
    name: "vocaloid_remove_song_objects",
    arguments: {
      input_path: manifestPath,
      output_path: manifestPath,
      expected_revision: 7,
      overwrite: true,
      removal: { object_type: "event", object_ids: ["lead-note-2"] },
      response_format: "json",
    },
  });
  assert.notEqual(removedManifestEvent.isError, true);
  assert.equal(
    (removedManifestEvent.structuredContent as { data?: { removed?: number } }).data?.removed,
    1,
  );

  const manifestInspect = await client.callTool({
    name: "vocaloid_inspect_song_manifest",
    arguments: { path: manifestPath, response_format: "json" },
  });
  assert.notEqual(manifestInspect.isError, true);
  assert.equal(
    (manifestInspect.structuredContent as { data?: { revision?: number } }).data?.revision,
    8,
  );

  const manifestBackingPath = join(temporary, "mcp-agent-song-backing-r8.wav");
  const manifestProjectPath = join(temporary, "mcp-agent-song-r8.vsqx");
  const manifestBuild = await client.callTool({
    name: "vocaloid_build_song_manifest",
    arguments: {
      manifest_path: manifestPath,
      expected_revision: 8,
      backing_output_path: manifestBackingPath,
      project_output_path: manifestProjectPath,
      response_format: "json",
    },
  });
  assert.notEqual(manifestBuild.isError, true);
  const manifestBuildData = manifestBuild.structuredContent as {
    data?: {
      sourceRevision?: number;
      manifestRevision?: number;
      backing?: { channels?: number; silent?: boolean };
      validation?: { valid?: boolean };
      artifacts?: unknown[];
    };
  };
  assert.deepEqual(
    {
      source: manifestBuildData.data?.sourceRevision,
      manifest: manifestBuildData.data?.manifestRevision,
      channels: manifestBuildData.data?.backing?.channels,
      silent: manifestBuildData.data?.backing?.silent,
      valid: manifestBuildData.data?.validation?.valid,
      artifacts: manifestBuildData.data?.artifacts?.length,
    },
    { source: 8, manifest: 9, channels: 2, silent: false, valid: true, artifacts: 2 },
  );

  const manifestInstrumentStems = await client.callTool({
    name: "vocaloid_render_instrument_stems",
    arguments: {
      manifest_path: manifestPath,
      expected_revision: 9,
      output_directory: temporary,
      track_ids: ["piano"],
      preserve_pan: false,
      include_renderer_effects: false,
      response_format: "json",
    },
  });
  assert.notEqual(manifestInstrumentStems.isError, true);
  const manifestInstrumentStemData = manifestInstrumentStems.structuredContent as {
    data?: {
      manifestRevision?: number;
      stems?: Array<{ trackId?: string; channels?: number; silent?: boolean }>;
      artifacts?: Array<{ source_composition_hash?: string }>;
    };
  };
  assert.equal(manifestInstrumentStemData.data?.manifestRevision, 10);
  assert.deepEqual(
    manifestInstrumentStemData.data?.stems?.map((stem) => [stem.trackId, stem.channels, stem.silent]),
    [["piano", 2, false]],
  );
  assert.match(
    manifestInstrumentStemData.data?.artifacts?.[0]?.source_composition_hash ?? "",
    /^[a-f0-9]{64}$/u,
  );

  const manifestEffectChain = await client.callTool({
    name: "vocaloid_upsert_manifest_effect_chain",
    arguments: {
      input_path: manifestPath,
      output_path: manifestPath,
      expected_revision: 10,
      overwrite: true,
      effect_chain: {
        id: "piano-mix-chain",
        target_id: "piano",
        effects: [
          { id: "piano-mix-gain", type: "gain", parameters: { gain_db: -3 } },
          { id: "piano-mix-pan", type: "pan", parameters: { pan: -0.2 } },
        ],
      },
      response_format: "json",
    },
  });
  assert.notEqual(manifestEffectChain.isError, true);

  const manifestSectionDynamic = await client.callTool({
    name: "vocaloid_upsert_manifest_section_dynamic",
    arguments: {
      input_path: manifestPath,
      output_path: manifestPath,
      expected_revision: 11,
      overwrite: true,
      section_dynamic: {
        id: "piano-verse-lift",
        target_id: "piano",
        section_id: "verse",
        gain_db: 1.5,
        ramp_ms: 60,
      },
      response_format: "json",
    },
  });
  assert.notEqual(manifestSectionDynamic.isError, true);

  const manifestMixPath = join(temporary, "mcp-agent-song-mix-r12.wav");
  const manifestStemMix = await client.callTool({
    name: "vocaloid_render_stem_mix",
    arguments: {
      manifest_path: manifestPath,
      expected_revision: 12,
      stem_artifact_ids: ["instrument-stem-piano-r9"],
      output_path: manifestMixPath,
      sample_rate: 44_100,
      bit_depth: 24,
      reference_lufs: -16,
      reference_true_peak_dbfs: -1,
      response_format: "json",
    },
  });
  assert.notEqual(manifestStemMix.isError, true);
  const manifestStemMixData = manifestStemMix.structuredContent as {
    data?: {
      manifestRevision?: number;
      sourceMixHash?: string;
      inputs?: unknown[];
      quality?: { bitsPerSample?: number; channels?: number; silent?: boolean };
    };
  };
  assert.equal(manifestStemMixData.data?.manifestRevision, 13);
  assert.match(manifestStemMixData.data?.sourceMixHash ?? "", /^[a-f0-9]{64}$/u);
  assert.equal(manifestStemMixData.data?.inputs?.length, 1);
  assert.deepEqual(
    {
      bits: manifestStemMixData.data?.quality?.bitsPerSample,
      channels: manifestStemMixData.data?.quality?.channels,
      silent: manifestStemMixData.data?.quality?.silent,
    },
    { bits: 24, channels: 2, silent: false },
  );

  const accompanimentPath = join(temporary, "mcp-backing.wav");
  const accompaniment = await client.callTool({
    name: "vocaloid_render_accompaniment",
    arguments: {
      output_path: accompanimentPath,
      end: { measure: 1, beat: 0 },
      tracks: [
        {
          name: "Piano",
          program: 0,
          notes: [
            { position: { measure: 0, beat: 0 }, duration: 960, note_number: 60 },
            { position: { measure: 0, beat: 2 }, duration: 960, note_number: 67 },
          ],
        },
      ],
      drums: [
        { position: { measure: 0, beat: 0 }, note_number: 36 },
        { position: { measure: 0, beat: 2 }, note_number: 38 },
      ],
      response_format: "json",
    },
  });
  assert.notEqual(accompaniment.isError, true);
  const accompanimentData = accompaniment.structuredContent as {
    data?: { audioFormat?: string; channels?: number; bitsPerSample?: number; silent?: boolean };
  };
  assert.deepEqual(
    {
      format: accompanimentData.data?.audioFormat,
      channels: accompanimentData.data?.channels,
      bits: accompanimentData.data?.bitsPerSample,
      silent: accompanimentData.data?.silent,
    },
    { format: "pcm", channels: 2, bits: 16, silent: false },
  );

  const quality = await client.callTool({
    name: "vocaloid_analyze_wav",
    arguments: { path: accompanimentPath, target_lufs: -16, response_format: "json" },
  });
  assert.notEqual(quality.isError, true);
  const qualityData = quality.structuredContent as {
    data?: { integratedLufs?: number; truePeakDbfs?: number; clippedSampleValues?: number };
  };
  assert.ok(Number.isFinite(qualityData.data?.integratedLufs));
  assert.ok(Number.isFinite(qualityData.data?.truePeakDbfs));

  const masteredPath = join(temporary, "mcp-backing-mastered.wav");
  const mastered = await client.callTool({
    name: "vocaloid_master_wav",
    arguments: {
      input_path: accompanimentPath,
      output_path: masteredPath,
      target_lufs: -16,
      target_true_peak_dbfs: -1,
      response_format: "json",
    },
  });
  assert.notEqual(mastered.isError, true);
  const masteredData = mastered.structuredContent as {
    data?: { output?: { integratedLufs?: number; truePeakDbfs?: number; clippedSampleValues?: number } };
  };
  assert.ok(Math.abs((masteredData.data?.output?.integratedLufs ?? 0) - -16) <= 0.6);
  assert.ok((masteredData.data?.output?.truePeakDbfs ?? 0) <= -0.8);
  assert.equal(masteredData.data?.output?.clippedSampleValues, 0);

  const created = await client.callTool({
    name: "vocaloid_create_project",
    arguments: {
      output_path: outputPath,
      format: "vsq4",
      voice: { name: "IA", component_id: "BLRGDDR4M3WM2LC6" },
      sequence_name: "MCP Protocol Smoke",
      notes: [
        {
          tick: 0,
          duration: 480,
          note_number: 60,
          lyric: "ら",
          phonemes: "a",
          vibrato: {
            type: 13,
            length: 50,
            depth: [{ position: 32768, value: 55 }],
            rate: [{ position: 32768, value: 52 }],
          },
        },
        { tick: 480, duration: 480, note_number: 62, lyric: "ら", phonemes: "a" },
      ],
      control_curves: [
        { curve: "DYN", points: [{ tick: 0, value: 64 }, { tick: 480, value: 72 }] },
      ],
      response_format: "json",
    },
  });
  assert.notEqual(created.isError, true);
  assert.equal((created.structuredContent as { ok?: boolean } | undefined)?.ok, true);

  const songPath = join(temporary, "mcp-structured-song.vsqx");
  const structured = await client.callTool({
    name: "vocaloid_create_song",
    arguments: {
      output_path: songPath,
      sequence_name: "Structured MCP Smoke",
      tracks: [
        {
          name: "Lead",
          voice: { name: "IA", component_id: "BLRGDDR4M3WM2LC6" },
          parts: [
            {
              name: "Verse",
              start: { measure: 0, beat: 0 },
              end: { measure: 4, beat: 0 },
              notes: [
                {
                  position: { measure: 0, beat: 0 },
                  duration: 480,
                  note_number: 60,
                  lyric: "ら",
                  phonemes: "4 a",
                },
              ],
            },
          ],
        },
      ],
      response_format: "json",
    },
  });
  assert.notEqual(structured.isError, true);
  assert.equal((structured.structuredContent as { ok?: boolean } | undefined)?.ok, true);

  const mixer = await client.callTool({
    name: "vocaloid_inspect_mixer",
    arguments: { path: songPath, response_format: "json" },
  });
  assert.notEqual(mixer.isError, true);
  const mixerData = mixer.structuredContent as {
    data?: { vocalUnits?: Array<{ trackNumber?: number; pan?: number; panPosition?: string }> };
  };
  assert.deepEqual(mixerData.data?.vocalUnits?.map((unit) => [unit.trackNumber, unit.pan]), [[0, 64]]);

  const remixedSongPath = join(temporary, "mcp-structured-song-remixed.vsqx");
  const remixed = await client.callTool({
    name: "vocaloid_update_mixer",
    arguments: {
      input_path: songPath,
      output_path: remixedSongPath,
      updates: [{ track_number: 0, pan: 72, volume: -120 }],
      response_format: "json",
    },
  });
  assert.notEqual(remixed.isError, true);
  const remixedData = remixed.structuredContent as {
    data?: { after?: Array<{ trackNumber?: number; pan?: number; volume?: number }> };
  };
  assert.deepEqual(
    remixedData.data?.after?.map((unit) => [unit.trackNumber, unit.pan, unit.volume]),
    [[0, 72, -120]],
  );

  const validation = await client.callTool({
    name: "vocaloid_validate_project",
    arguments: { path: outputPath, response_format: "json" },
  });
  assert.notEqual(validation.isError, true);
  const validationData = validation.structuredContent as {
    data?: { valid?: boolean; format?: string };
  };
  assert.equal(validationData.data?.valid, true);
  assert.equal(validationData.data?.format, "vsq4");

  const notes = await client.callTool({
    name: "vocaloid_list_notes",
    arguments: { path: outputPath, limit: 1, response_format: "json" },
  });
  assert.notEqual(notes.isError, true);
  const noteData = notes.structuredContent as {
    data?: { page?: { total?: number; count?: number; has_more?: boolean } };
  };
  assert.equal(noteData.data?.page?.total, 2);
  assert.equal(noteData.data?.page?.count, 1);
  assert.equal(noteData.data?.page?.has_more, true);

  const tunedPath = join(temporary, "mcp-tuned.vsqx");
  const tuned = await client.callTool({
    name: "vocaloid_update_note_expressions",
    arguments: {
      input_path: outputPath,
      output_path: tunedPath,
      updates: [
        {
          note_index: 1,
          velocity: 55,
          expression: {
            accent: 70,
            decay: 45,
            bend_depth: 15,
            bend_length: 20,
            rise_portamento: true,
          },
          vibrato: { type: 1, length: 60 },
        },
      ],
      response_format: "json",
    },
  });
  assert.notEqual(tuned.isError, true);
  assert.equal((tuned.structuredContent as { ok?: boolean } | undefined)?.ok, true);

  const refusedRender = await client.callTool({
    name: "vocaloid_render_wav",
    arguments: {
      input_path: join(temporary, "missing.vsqx"),
      output_path: join(temporary, "must-not-exist.wav"),
      response_format: "json",
    },
  });
  assert.equal(refusedRender.isError, true);
});
