import assert from "node:assert/strict";
import test from "node:test";

import { normalizeEditExchange } from "./production-mcp.mjs";


const before = { revision: 7 };
const preview = {
  kind: "mutation_preview",
  action: "upsert_section",
  preview: {
    source: { revision: 7 },
    predicted: { revision: 8 },
    totalChanges: 1,
  },
};
const applied = {
  kind: "mutation_applied",
  action: "upsert_section",
  write: {
    revision: 8,
    compositionHash: "a".repeat(64),
    mixHash: "b".repeat(64),
    contentHash: "c".repeat(64),
  },
  totalChanges: 1,
  evidence: { changedCount: 1, objectIds: ["verse"] },
};

test("production MCP edit exchange exposes stable normalized fields", () => {
  const result = normalizeEditExchange("upsert_section", before, preview, applied);
  assert.equal(result.preview.predicted.revision, 8);
  assert.equal(result.applied.revision, 8);
  assert.deepEqual(result.summary, {
    sourceRevision: 7,
    predictedRevision: 8,
    appliedRevision: 8,
    totalChanges: 1,
    compositionHash: "a".repeat(64),
    mixHash: "b".repeat(64),
    contentHash: "c".repeat(64),
  });
  assert.equal(result.raw.preview, preview);
  assert.equal(result.raw.applied, applied);
});

test("production MCP edit exchange rejects preview/apply drift", () => {
  assert.throws(
    () => normalizeEditExchange(
      "upsert_section",
      before,
      preview,
      { ...applied, write: { ...applied.write, revision: 9 } },
    ),
    /predicted revision 8 but apply wrote 9/u,
  );
  assert.throws(
    () => normalizeEditExchange(
      "upsert_section",
      before,
      preview,
      { ...applied, totalChanges: 2 },
    ),
    /predicted 1 change\(s\) but apply reported 2/u,
  );
});

test("production MCP edit exchange rejects incomplete raw envelopes", () => {
  assert.throws(
    () => normalizeEditExchange(
      "upsert_section",
      before,
      { ...preview, preview: { ...preview.preview, predicted: {} } },
      applied,
    ),
    /missing integer revision\/change fields/u,
  );
  assert.throws(
    () => normalizeEditExchange(
      "upsert_section",
      before,
      preview,
      { ...applied, totalChanges: undefined },
    ),
    /missing integer revision\/change fields/u,
  );
});
