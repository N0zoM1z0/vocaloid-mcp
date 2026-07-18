import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";


const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const THEORY_ROOT = join(ROOT, "src", "theory");

async function theoryFiles(): Promise<string[]> {
  const entries = await readdir(THEORY_ROOT, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => join(THEORY_ROOT, entry.name))
    .sort();
}

test("symbolic theory analysis cannot depend on corpus or style evidence", async () => {
  const files = await theoryFiles();
  assert.ok(files.some((path) => path.endsWith("analyze.ts")));
  for (const path of files) {
    const source = await readFile(path, "utf8");
    assert.doesNotMatch(
      source,
      /(?:from|import\s*\()["'][^"']*(?:corpus|style-profile|style-palettes)[^"']*["']/u,
      `${path} must remain corpus/style independent`,
    );
  }
});

test("theory proposal code cannot invoke manifest mutation or dry-run implementations", async () => {
  const path = join(THEORY_ROOT, "proposals.ts");
  const source = await readFile(path, "utf8");
  for (const mutationCapability of [
    "mutateManifest",
    "previewSongManifestMutation",
    "transformSongManifestEvents",
    "upsertSongManifestVocalPart",
    "upsertSongManifestVocalPhrase",
    "upsertSongManifestArrangementTrack",
    "updateSongManifestTimeline",
  ]) {
    assert.doesNotMatch(
      source,
      new RegExp(`\\b${mutationCapability}\\b`, "u"),
      `proposal layer must describe ${mutationCapability} only through a read-only action patch`,
    );
  }
});
