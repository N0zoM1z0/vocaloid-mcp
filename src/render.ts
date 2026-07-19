import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  access,
  copyFile,
  mkdir,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { promisify } from "node:util";

import { acquireEditorLease, type EditorLease } from "./editor-lease.js";
import { PROJECT_ROOT, resolveReadablePath, resolveWritablePath } from "./paths.js";
import { validateProject } from "./vsqx.js";
import { analyzeWav, type WavAnalysis } from "./wav.js";


const execFileAsync = promisify(execFile);
const DEFAULT_EDITOR = "/mnt/d/Vocaloid/Vocaloid3FE/VOCALOID3.exe";
const DEFAULT_POWERSHELL =
  "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe";
const KNOWN_EDITOR_FINGERPRINTS: Readonly<Record<string, string>> = {
  da625070e93b069ba0d991db22810287114aad8d736ed1d69e7740fb7bc3067b: "3.2.1.1",
};

interface NativeExportResult {
  ok: boolean;
  process_id: number;
  bytes: number;
  elapsed_ms: number;
  forced_termination: boolean;
  event_verification_seen: boolean;
  pre_send_adjusted: boolean;
}

export type RenderProgressStage =
  | "validating"
  | "waiting_for_editor"
  | "fingerprinting_editor"
  | "launching_editor"
  | "synthesizing"
  | "verifying_audio"
  | "committing_output"
  | "cleanup";

export interface RenderProgress {
  stage: RenderProgressStage;
  progress: number;
  total: number;
  message: string;
}

export interface RenderRuntimeOptions {
  requestId?: string;
  signal?: AbortSignal;
  progress?: (update: RenderProgress) => void | Promise<void>;
  lease?: EditorLease;
  allowUnknownEditor?: boolean;
}

export interface RenderHostFingerprint {
  editorPath: string;
  editorSha256: string;
  editorBytes: number;
  editorVersion: string;
  knownEditorFingerprint: boolean;
  helperPath: string;
  helperSha256: string;
  helperBytes: number;
  powershellPath: string;
  cacheKey: string;
}

export interface RenderResult extends WavAnalysis {
  inputPath: string;
  outputPath: string;
  backupPath?: string;
  editorProcessId: number;
  editorElapsedMilliseconds: number;
  forcedTermination: boolean;
  editorPath: string;
  editorSha256: string;
  editorBytes: number;
  editorVersion: string;
  knownEditorFingerprint: boolean;
  leaseRequestId: string;
  preSendAdjustmentAllowed: boolean;
  eventVerificationSeen: boolean;
  preSendAdjusted: boolean;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function windowsPath(path: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("wslpath", ["-w", path], {
      timeout: 10_000,
      maxBuffer: 64 * 1024,
    });
    const converted = stdout.trim();
    if (!converted) throw new Error("wslpath returned an empty path");
    return converted;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not convert path for Windows: ${path}. ${detail}`);
  }
}

function parseNativeResult(stdout: string): NativeExportResult {
  const lines = stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index--) {
    try {
      const value: unknown = JSON.parse(lines[index] ?? "");
      if (
        typeof value === "object" &&
        value !== null &&
        "ok" in value &&
        value.ok === true &&
        "process_id" in value &&
        typeof value.process_id === "number" &&
        "bytes" in value &&
        typeof value.bytes === "number" &&
        "elapsed_ms" in value &&
        typeof value.elapsed_ms === "number" &&
        "forced_termination" in value &&
        typeof value.forced_termination === "boolean" &&
        "event_verification_seen" in value &&
        typeof value.event_verification_seen === "boolean" &&
        "pre_send_adjusted" in value &&
        typeof value.pre_send_adjusted === "boolean"
      ) {
        return value as NativeExportResult;
      }
    } catch {
      // Search earlier lines for the helper's final structured result.
    }
  }
  throw new Error(`Native exporter did not return a success result: ${stdout.trim()}`);
}

async function sha256(path: string): Promise<{ sha256: string; bytes: number }> {
  const hash = createHash("sha256");
  let bytes = 0;
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => {
      bytes += chunk.length;
      hash.update(chunk);
    });
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return { sha256: hash.digest("hex"), bytes };
}

async function editorFileVersion(powershell: string, windowsEditor: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      powershell,
      [
        "-NoProfile",
        "-Command",
        "(Get-Item -LiteralPath $env:VOCALOID_FINGERPRINT_PATH).VersionInfo.FileVersion",
      ],
      {
        timeout: 15_000,
        maxBuffer: 64 * 1024,
        windowsHide: true,
        env: { ...process.env, VOCALOID_FINGERPRINT_PATH: windowsEditor },
      },
    );
    const raw = stdout.trim();
    return raw.replace(/\s*,\s*/gu, ".") || "unknown";
  } catch {
    return "unknown";
  }
}

export async function inspectRenderHost(allowUnknownEditor = false): Promise<RenderHostFingerprint> {
  const editor = await resolveReadablePath(process.env.VOCALOID_EDITOR_PATH ?? DEFAULT_EDITOR);
  const helper = await resolveReadablePath(
    process.env.VOCALOID_EXPORT_HELPER ?? join(PROJECT_ROOT, "build/native/vocaloid_export.exe"),
  ).catch(() => {
    throw new Error("Native export helper is unavailable. Run scripts/build-native.sh before rendering.");
  });
  const powershell = process.env.VOCALOID_POWERSHELL_PATH ?? DEFAULT_POWERSHELL;
  if (!(await exists(powershell))) throw new Error(`Windows PowerShell is unavailable: ${powershell}`);
  const [editorDigest, helperDigest, windowsEditor] = await Promise.all([
    sha256(editor),
    sha256(helper),
    windowsPath(editor),
  ]);
  const expectedVersion = KNOWN_EDITOR_FINGERPRINTS[editorDigest.sha256];
  if (!expectedVersion && !allowUnknownEditor) {
    throw new Error(
      `Unknown VOCALOID3 Editor fingerprint ${editorDigest.sha256} (${editorDigest.bytes} bytes). `
      + "Refusing UI automation because dialog/command IDs are version-specific; set allow_unknown_editor=true only after a bounded manual verification.",
    );
  }
  const observedVersion = await editorFileVersion(powershell, windowsEditor);
  if (expectedVersion && observedVersion !== "unknown" && observedVersion !== expectedVersion) {
    throw new Error(
      `VOCALOID3 Editor version/hash mismatch: hash profile expects ${expectedVersion}, file metadata reports ${observedVersion}`,
    );
  }
  const editorVersion = observedVersion === "unknown" ? (expectedVersion ?? "unknown") : observedVersion;
  return {
    editorPath: editor,
    editorSha256: editorDigest.sha256,
    editorBytes: editorDigest.bytes,
    editorVersion,
    knownEditorFingerprint: expectedVersion !== undefined,
    helperPath: helper,
    helperSha256: helperDigest.sha256,
    helperBytes: helperDigest.bytes,
    powershellPath: powershell,
    cacheKey: `${editorDigest.sha256}:${helperDigest.sha256}:${editorVersion}`,
  };
}

function abortError(): Error {
  const error = new Error("VOCALOID render cancelled by the MCP client");
  error.name = "AbortError";
  return error;
}

function processFailure(error: unknown): Error {
  if (typeof error === "object" && error !== null) {
    const stdout = "stdout" in error && typeof error.stdout === "string" ? error.stdout.trim() : "";
    const stderr = "stderr" in error && typeof error.stderr === "string" ? error.stderr.trim() : "";
    const detail = [stderr, stdout].filter(Boolean).join("; ");
    if (detail) return new Error(`VOCALOID export helper failed: ${detail}`);
  }
  return error instanceof Error ? error : new Error(String(error));
}

export async function renderProjectToWav(
  inputPath: string,
  requestedOutputPath: string,
  timeoutSeconds: number,
  overwrite: boolean,
  allowPreSendAdjustment = false,
  runtime: RenderRuntimeOptions = {},
): Promise<RenderResult> {
  const report = async (
    stage: RenderProgressStage,
    progress: number,
    message: string,
  ): Promise<void> => {
    await runtime.progress?.({ stage, progress, total: 8, message });
  };
  if (runtime.signal?.aborted) throw abortError();
  await report("validating", 1, "Validating VSQX and immutable output path");
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 10 || timeoutSeconds > 600) {
    throw new Error(`timeoutSeconds must be an integer in 10..600, got ${timeoutSeconds}`);
  }
  const source = await resolveReadablePath(inputPath);
  if (extname(source).toLowerCase() !== ".vsqx") throw new Error(`Expected a .vsqx input: ${source}`);
  const validation = await validateProject(source);
  if (!validation.valid) {
    throw new Error(`Refusing to render an invalid VSQX: ${validation.diagnostics.join("; ")}`);
  }
  const outputPath = await resolveWritablePath(requestedOutputPath);
  if (extname(outputPath).toLowerCase() !== ".wav") {
    throw new Error(`Output path must end in .wav: ${outputPath}`);
  }
  const outputExists = await exists(outputPath);
  if (outputExists && !overwrite) {
    throw new Error(`Output already exists: ${outputPath}. Set overwrite=true to replace it.`);
  }

  const runner = await resolveReadablePath(join(PROJECT_ROOT, "scripts/run-vocaloid-export.ps1"));

  await report("fingerprinting_editor", 2, "Fingerprinting the installed VOCALOID3 Editor");
  const host = await inspectRenderHost(runtime.allowUnknownEditor);
  const windowsEditor = await windowsPath(host.editorPath);

  const renderToken = `${process.pid}-${randomUUID()}`;
  const temporary = join(dirname(outputPath), `.vocaloid-render-${renderToken}.wav`);
  const stagedSource = join(dirname(outputPath), `.vocaloid-render-${renderToken}.vsqx`);
  /* Keep helper coordination paths independent of the requested output name.
     VOCALOID3 uses legacy Win32 common dialogs, and their sidecar files can
     otherwise exceed MAX_PATH when a descriptive stem basename is appended
     to an already-deep output directory. */
  const runtimeDirectory = join(PROJECT_ROOT, "build", "runtime");
  await mkdir(runtimeDirectory, { recursive: true });
  const cancelPath = join(
    runtimeDirectory,
    `.vocaloid-export-${process.pid}-${randomUUID()}.cancel`,
  );
  const requestId = runtime.requestId ?? `render-${process.pid}-${randomUUID()}`;
  await report("waiting_for_editor", 3, "Acquiring the host-wide VOCALOID Editor render lease");
  const ownedLease = runtime.lease ? null : await acquireEditorLease(requestId);
  const lease = runtime.lease ?? ownedLease!;
  let cancelled = false;
  const requestCancel = (): void => {
    cancelled = true;
    void writeFile(cancelPath, "cancel\n", { encoding: "utf8", flag: "wx" }).catch(() => undefined);
  };
  runtime.signal?.addEventListener("abort", requestCancel, { once: true });
  if (runtime.signal?.aborted) requestCancel();
  let nativeResult: NativeExportResult;
  try {
    if (cancelled) throw abortError();
    /* VOCALOID3's legacy Save dialog opens in the loaded VSQX directory.  A
       disposable adjacent project lets the helper type only a short basename
       instead of asking the dialog to interpret a \\wsl UNC output path. */
    await copyFile(source, stagedSource);
    const [windowsHelper, windowsSource, windowsTemporary, windowsRunner, windowsCancel] =
      await Promise.all([
        windowsPath(host.helperPath),
        windowsPath(stagedSource),
        windowsPath(temporary),
        windowsPath(runner),
        windowsPath(cancelPath),
      ]);
    let stdout: string;
    try {
      await report("launching_editor", 4, "Launching the helper-owned minimized VOCALOID3 Editor");
      await report("synthesizing", 5, "Waiting for original-Editor synthesis and WAV export");
      const result = await execFileAsync(
        host.powershellPath,
        [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          windowsRunner,
          "-HelperPath",
          windowsHelper,
          "-EditorPath",
          windowsEditor,
          "-ProjectPath",
          windowsSource,
          "-OutputPath",
          windowsTemporary,
          "-TimeoutMilliseconds",
          String(timeoutSeconds * 1000),
          "-AllowPreSendAdjustment",
          allowPreSendAdjustment ? "1" : "0",
          "-CancelPath",
          windowsCancel,
        ],
        {
          timeout: timeoutSeconds * 1000 + 30_000,
          maxBuffer: 1024 * 1024,
          windowsHide: true,
        },
      );
      stdout = result.stdout;
    } catch (error) {
      if (cancelled || runtime.signal?.aborted) throw abortError();
      throw processFailure(error);
    }
    nativeResult = parseNativeResult(stdout);
    if (cancelled || runtime.signal?.aborted) throw abortError();
    await report("verifying_audio", 6, "Verifying RIFF structure, channel layout, level, and non-silence");
    const analysis = await analyzeWav(temporary);
    if (analysis.silent) {
      throw new Error(
        `Rendered WAV is effectively silent (peak=${analysis.peak}, rms=${analysis.rms})`,
      );
    }

    let backupPath: string | undefined;
    if (outputExists) {
      backupPath = `${outputPath}.bak-${new Date().toISOString().replaceAll(":", "-")}`;
      await copyFile(outputPath, backupPath);
    }
    await report("committing_output", 7, "Atomically committing the verified WAV");
    await rename(temporary, outputPath);
    return {
      ...analysis,
      path: outputPath,
      inputPath: source,
      outputPath,
      ...(backupPath ? { backupPath } : {}),
      editorProcessId: nativeResult.process_id,
      editorElapsedMilliseconds: nativeResult.elapsed_ms,
      forcedTermination: nativeResult.forced_termination,
      editorPath: host.editorPath,
      editorSha256: host.editorSha256,
      editorBytes: host.editorBytes,
      editorVersion: host.editorVersion,
      knownEditorFingerprint: host.knownEditorFingerprint,
      leaseRequestId: lease.requestId,
      preSendAdjustmentAllowed: allowPreSendAdjustment,
      eventVerificationSeen: nativeResult.event_verification_seen,
      preSendAdjusted: nativeResult.pre_send_adjusted,
    };
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  } finally {
    runtime.signal?.removeEventListener("abort", requestCancel);
    await unlink(stagedSource).catch(() => undefined);
    await unlink(cancelPath).catch(() => undefined);
    await ownedLease?.release();
    try {
      await report("cleanup", 8, "Released render lease and removed helper temporary state");
    } catch {
      // Progress transport failure must never strand the host-wide Editor lease.
    }
  }
}
