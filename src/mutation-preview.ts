import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";

import { diffManifestSnapshots } from "./manifest-history.js";
import { PROJECT_ROOT } from "./paths.js";
import { loadSongManifest } from "./song-manifest.js";
import { preflightSongManifest } from "./song-preflight.js";


export interface MutationPreviewResult {
  dryRun: true;
  source: {
    path: string;
    revision: number;
    contentHash: string;
    compositionHash: string;
    mixHash: string;
  };
  predicted: {
    revision: number;
    contentHash: string;
    compositionHash: string;
    mixHash: string;
  };
  changes: Awaited<ReturnType<typeof diffManifestSnapshots>>["domains"];
  totalChanges: number;
  readiness: Awaited<ReturnType<typeof preflightSongManifest>>["readiness"];
  issues: Awaited<ReturnType<typeof preflightSongManifest>>["issues"];
}

export async function previewSongManifestMutation(
  manifestPath: string,
  expectedRevision: number,
  mutateTemporary: (temporaryManifestPath: string) => Promise<unknown>,
): Promise<MutationPreviewResult> {
  const source = await loadSongManifest(manifestPath);
  if (source.manifest.revision !== expectedRevision) {
    throw new Error(
      `Stale manifest revision ${expectedRevision}; current revision is ${source.manifest.revision} `
      + `(${source.manifest.content_hash}). Inspect again before previewing a mutation.`,
    );
  }
  const runtime = join(PROJECT_ROOT, "build/runtime");
  await mkdir(runtime, { recursive: true });
  const temporary = await mkdtemp(join(runtime, ".manifest-dry-run-"));
  const temporaryManifest = join(temporary, "preview.song.json");
  try {
    await copyFile(source.path, temporaryManifest);
    await mutateTemporary(temporaryManifest);
    const [predicted, diff, preflight] = await Promise.all([
      loadSongManifest(temporaryManifest),
      diffManifestSnapshots(source.path, temporaryManifest),
      preflightSongManifest(temporaryManifest, {
        artifactCheck: "none",
        includePerformanceWarnings: true,
      }),
    ]);
    return {
      dryRun: true,
      source: {
        path: source.path,
        revision: source.manifest.revision,
        contentHash: source.manifest.content_hash,
        compositionHash: source.manifest.composition_hash,
        mixHash: source.manifest.mix_hash,
      },
      predicted: {
        revision: predicted.manifest.revision,
        contentHash: predicted.manifest.content_hash,
        compositionHash: predicted.manifest.composition_hash,
        mixHash: predicted.manifest.mix_hash,
      },
      changes: diff.domains,
      totalChanges: diff.totalChanges,
      readiness: preflight.readiness,
      issues: preflight.issues,
    };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
