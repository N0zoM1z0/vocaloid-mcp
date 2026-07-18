import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";


const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SOURCE_ROOT = join(ROOT, "src");

async function typescriptFiles(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return typescriptFiles(path);
      return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
    }));
    return nested.flat().sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

test("intent authoring remains independent from corpus and style evidence", async () => {
  const files = await typescriptFiles(join(SOURCE_ROOT, "intent"));
  assert.ok(files.length >= 4);
  for (const path of files) {
    const source = await readFile(path, "utf8");
    assert.doesNotMatch(
      source,
      /(?:from|import\s*\()["'][^"']*(?:corpus|style-profile|style-palettes)[^"']*["']/u,
      `${path} must not depend on corpus or style evidence`,
    );
  }
});

test("restricted corpus and style modules cannot import intent mutation capabilities", async () => {
  const files = [
    ...(await typescriptFiles(join(SOURCE_ROOT, "corpus"))),
    ...(await typescriptFiles(join(SOURCE_ROOT, "style-profile"))),
    join(SOURCE_ROOT, "style-palettes.ts"),
  ];
  const mutationNames = [
    "setSongManifestCompositionIntent",
    "upsertSongManifestSectionIntent",
    "upsertSongManifestPhraseDirection",
    "bindSongManifestPhraseRealization",
  ];
  for (const path of files) {
    const source = await readFile(path, "utf8");
    for (const name of mutationNames) {
      assert.doesNotMatch(source, new RegExp(`\\b${name}\\b`, "u"), `${path} imports ${name}`);
    }
    assert.doesNotMatch(
      source,
      /import\s+\*\s+as\s+\w+\s+from\s+["'][^"']*song-manifest\.js["']/u,
      `${path} must not namespace-import the mutable song-manifest API`,
    );
  }
});
