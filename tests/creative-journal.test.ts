import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
  creativeJournalPath,
  listCreativeDecisions,
  publishCreativeRecordPackage,
  recordCreativeDecision,
  recordCreativeDecisionIfAbsent,
  writeCreativeJournalReport,
} from "../src/creative-journal.js";
import {
  createSongManifest,
  fileSha256,
  loadSongManifest,
  recordSongManifestArtifacts,
  upsertSongManifestSection,
} from "../src/song-manifest.js";


test("creative decisions remain hash-chained, paginated, freshness-aware, and publishable", async (context) => {
  const temporary = await mkdtemp(join(process.cwd(), ".test-creative-journal-"));
  context.after(async () => rm(temporary, { recursive: true, force: true }));
  const manifestPath = join(temporary, "journal-song.song.json");
  await createSongManifest({
    outputPath: manifestPath,
    songId: "journal-song",
    slug: "journal-song",
    title: "Journal Song",
    format: "vsq3",
    preMeasure: 1,
    timeSignatures: [{ measure: 0, numerator: 4, denominator: 4 }],
    tempos: [{ position: { measure: 0, beat: 0 }, bpm: 120 }],
    sections: [{
      id: "verse",
      name: "Verse",
      kind: "verse",
      start: { measure: 0, beat: 0 },
      end: { measure: 2, beat: 0 },
      description: "A restrained opening",
    }],
    sampleRate: 44_100,
    gain: 0.2,
    reverb: false,
    chorus: false,
    overwrite: false,
  });
  const initial = (await loadSongManifest(manifestPath)).manifest;
  const songPath = join(temporary, "journal-song.wav");
  const mixPath = join(temporary, "journal-song-mix.wav");
  const vsqxPath = join(temporary, "journal-song.vsqx");
  await writeFile(songPath, "audible-song-fixture");
  await writeFile(mixPath, "audible-mix-fixture");
  await writeFile(vsqxPath, "vsqx-fixture");
  const songDigest = await fileSha256(songPath);
  const mixDigest = await fileSha256(mixPath);
  const vsqxDigest = await fileSha256(vsqxPath);
  await recordSongManifestArtifacts(manifestPath, initial.revision, initial.composition_hash, [
    {
      id: "delivery-final",
      role: "delivery",
      path: songPath,
      ...songDigest,
      source_revision: initial.revision,
      source_composition_hash: initial.composition_hash,
      dependencies: ["mix-final"],
      metadata: {},
      created_at: new Date().toISOString(),
    },
    {
      id: "mix-final",
      role: "mix",
      path: mixPath,
      ...mixDigest,
      source_revision: initial.revision,
      source_composition_hash: initial.composition_hash,
      dependencies: [],
      metadata: { source_mix_hash: initial.mix_hash },
      created_at: new Date().toISOString(),
    },
    {
      id: "vsqx-final",
      role: "vsqx",
      path: vsqxPath,
      ...vsqxDigest,
      source_revision: initial.revision,
      source_composition_hash: initial.composition_hash,
      dependencies: [],
      metadata: {},
      created_at: new Date().toISOString(),
    },
  ]);
  const withArtifacts = (await loadSongManifest(manifestPath)).manifest;

  const phases = [
    "intent", "form", "meter_tempo", "harmony", "melody",
    "note_allocation", "ia_delivery", "arrangement",
  ] as const;
  let firstDecision: Parameters<typeof recordCreativeDecision>[0]["decision"] | undefined;
  for (const [index, phase] of phases.entries()) {
    const decision: Parameters<typeof recordCreativeDecision>[0]["decision"] = {
      id: `decision-${phase.replaceAll("_", "-")}`,
      phase,
      kind: "selection",
      title: `${phase} decision`,
      objective: `Make the ${phase} stage serve the restrained opening.`,
      decision: `Use bounded ${phase} material with a clear relation to the verse.`,
      rationale: "The stable verse object and current composition hash provide auditable evidence for this bounded choice.",
      alternatives: [{
        option: "Use a denser realization",
        disposition: "rejected",
        reason: "It would obscure the intended restraint.",
      }],
      expected_audible_effect: "The opening should remain clear and leave room for IA's lyric delivery.",
      actual_result: "The implementation is present in the current test manifest evidence.",
      affected_object_ids: ["verse"],
      artifact_ids: index === phases.length - 1 ? ["delivery-final", "vsqx-final"] : [],
      hash_dependencies: ["composition"],
      supersedes_decision_ids: [],
      evidence: {
        constraints: ["Do not treat declaration as render proof."],
        observations: [`The ${phase} choice is bound to the current verse fingerprint.`],
        theory_issue_codes: [],
        metric_deltas: [],
      },
      outcome: index === phases.length - 1 ? "delivered" : "implemented",
      author: { type: "agent", name: "test-agent" },
    };
    if (index === 0) firstDecision = decision;
    const result = await recordCreativeDecision({
      manifestPath,
      expectedRevision: withArtifacts.revision,
      decision,
    });
    assert.equal(result.entry.sequence, index + 1);
  }

  assert.ok(firstDecision);
  const resumed = await recordCreativeDecisionIfAbsent({
    manifestPath,
    expectedRevision: withArtifacts.revision,
    decision: firstDecision,
  });
  assert.equal(resumed.alreadyExisted, true);
  assert.equal(resumed.entryCount, phases.length);
  await assert.rejects(
    recordCreativeDecisionIfAbsent({
      manifestPath,
      expectedRevision: withArtifacts.revision,
      decision: { ...firstDecision, title: "changed intent decision" },
    }),
    /already exists with different content/iu,
  );

  const firstPage = await listCreativeDecisions({ manifestPath, offset: 0, limit: 3 });
  assert.equal(firstPage.count, 3);
  assert.equal(firstPage.total, 8);
  assert.equal(firstPage.nextOffset, 3);
  assert.equal(firstPage.completeness.coreReady, true);
  const secondPage = await listCreativeDecisions({ manifestPath, offset: firstPage.nextOffset, limit: 10 });
  assert.equal(secondPage.count, 5);
  assert.equal(secondPage.hasMore, false);
  assert.equal(secondPage.items[0]?.entry.previous_entry_hash, firstPage.items.at(-1)?.entry.entry_hash);

  await assert.rejects(
    recordCreativeDecision({
      manifestPath,
      expectedRevision: withArtifacts.revision,
      decision: {
        id: "decision-intent",
        phase: "intent",
        kind: "selection",
        title: "duplicate decision",
        objective: "Verify append-only stable IDs.",
        decision: "Attempt to reuse an existing decision ID.",
        rationale: "Duplicate IDs would make supersession and audit references ambiguous.",
        alternatives: [],
        expected_audible_effect: "No audible change is expected.",
        affected_object_ids: ["verse"],
        artifact_ids: [],
        hash_dependencies: ["composition"],
        supersedes_decision_ids: [],
        evidence: {
          constraints: [],
          observations: ["The ID already exists."],
          theory_issue_codes: [],
          metric_deltas: [],
        },
        outcome: "implemented",
        author: { type: "agent", name: "test-agent" },
      },
    }),
    /already exists/iu,
  );

  const reportPath = join(temporary, "journal-song-report.md");
  const report = await writeCreativeJournalReport({ manifestPath, outputPath: reportPath });
  assert.equal(report.entryCount, 8);
  assert.match(await readFile(reportPath, "utf8"), /intent → theory → note allocation → IA delivery → arrangement/u);

  const packageDirectory = join(temporary, "published-record");
  const published = await publishCreativeRecordPackage({
    manifestPath,
    expectedRevision: withArtifacts.revision,
    outputDirectory: packageDirectory,
    deliverables: [
      { role: "song", artifact_id: "delivery-final" },
      { role: "vsqx", artifact_id: "vsqx-final" },
    ],
  });
  assert.equal(published.completeness.coreReady, true);
  assert.match(await readFile(published.indexPath, "utf8"), /vocaloid-creative-record-package\/v1/u);

  await upsertSongManifestSection(
    manifestPath,
    manifestPath,
    withArtifacts.revision,
    {
      ...withArtifacts.sections[0]!,
      description: "A changed opening",
    },
    true,
  );
  const stale = await listCreativeDecisions({ manifestPath, currentness: "stale", limit: 20 });
  assert.equal(stale.total, 8);
  assert.ok(stale.items.every((item) => item.staleReasons.includes("COMPOSITION_HASH_CHANGED")));

  const lines = (await readFile(creativeJournalPath(manifestPath), "utf8")).trim().split("\n");
  const tampered = JSON.parse(lines[0]!) as Record<string, unknown>;
  tampered.title = "tampered";
  lines[0] = JSON.stringify(tampered);
  await writeFile(creativeJournalPath(manifestPath), `${lines.join("\n")}\n`);
  await assert.rejects(listCreativeDecisions({ manifestPath }), /entry hash mismatch/iu);
});
