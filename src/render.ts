import { execFile } from "node:child_process";
import {
  access,
  copyFile,
  rename,
  unlink,
} from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { promisify } from "node:util";

import { PROJECT_ROOT, resolveReadablePath, resolveWritablePath } from "./paths.js";
import { validateProject } from "./vsqx.js";
import { analyzeWav, type WavAnalysis } from "./wav.js";


const execFileAsync = promisify(execFile);
const DEFAULT_EDITOR = "/mnt/d/Vocaloid/Vocaloid3FE/VOCALOID3.exe";
const DEFAULT_POWERSHELL =
  "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe";

interface NativeExportResult {
  ok: boolean;
  process_id: number;
  bytes: number;
  elapsed_ms: number;
  forced_termination: boolean;
}

export interface RenderResult extends WavAnalysis {
  inputPath: string;
  outputPath: string;
  backupPath?: string;
  editorProcessId: number;
  editorElapsedMilliseconds: number;
  forcedTermination: boolean;
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
        typeof value.forced_termination === "boolean"
      ) {
        return value as NativeExportResult;
      }
    } catch {
      // Search earlier lines for the helper's final structured result.
    }
  }
  throw new Error(`Native exporter did not return a success result: ${stdout.trim()}`);
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
): Promise<RenderResult> {
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

  const editor = await resolveReadablePath(process.env.VOCALOID_EDITOR_PATH ?? DEFAULT_EDITOR);
  const helper = await resolveReadablePath(
    process.env.VOCALOID_EXPORT_HELPER ?? join(PROJECT_ROOT, "build/native/vocaloid_export.exe"),
  ).catch(() => {
    throw new Error(
      "Native export helper is unavailable. Run scripts/build-native.sh before rendering.",
    );
  });
  const runner = await resolveReadablePath(join(PROJECT_ROOT, "scripts/run-vocaloid-export.ps1"));
  const powershell = process.env.VOCALOID_POWERSHELL_PATH ?? DEFAULT_POWERSHELL;
  if (!(await exists(powershell))) throw new Error(`Windows PowerShell is unavailable: ${powershell}`);

  const temporary = join(
    dirname(outputPath),
    `.${basename(outputPath)}.render-${process.pid}-${Date.now()}.wav`,
  );
  let nativeResult: NativeExportResult;
  try {
    const [windowsHelper, windowsEditor, windowsSource, windowsTemporary, windowsRunner] =
      await Promise.all([
        windowsPath(helper),
        windowsPath(editor),
        windowsPath(source),
        windowsPath(temporary),
        windowsPath(runner),
      ]);
    let stdout: string;
    try {
      const result = await execFileAsync(
        powershell,
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
        ],
        {
          timeout: timeoutSeconds * 1000 + 30_000,
          maxBuffer: 1024 * 1024,
          windowsHide: true,
        },
      );
      stdout = result.stdout;
    } catch (error) {
      throw processFailure(error);
    }
    nativeResult = parseNativeResult(stdout);
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
    };
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}
