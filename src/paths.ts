import { realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function splitRoots(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(":")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => resolve(item));
}

function isInside(path: string, root: string): boolean {
  const delta = relative(root, path);
  return delta === "" || (!delta.startsWith(`..${sep}`) && delta !== "..");
}

async function existingRoots(candidates: string[]): Promise<string[]> {
  const roots: string[] = [];
  for (const candidate of candidates) {
    try {
      roots.push(await realpath(candidate));
    } catch {
      // Optional roots such as /mnt/d/Vocaloid are absent on other hosts.
    }
  }
  return roots;
}

export async function resolveReadablePath(input: string): Promise<string> {
  const requested = isAbsolute(input) ? resolve(input) : resolve(PROJECT_ROOT, input);
  const actual = await realpath(requested);
  const roots = await existingRoots([
    PROJECT_ROOT,
    "/mnt/d/Vocaloid",
    ...splitRoots(process.env.VOCALOID_READ_ROOTS),
  ]);
  if (!roots.some((root) => isInside(actual, root))) {
    throw new Error(
      `Read path is outside allowed roots: ${actual}. ` +
        "Add its parent to VOCALOID_READ_ROOTS if this is intentional.",
    );
  }
  const info = await stat(actual);
  if (!info.isFile()) throw new Error(`Expected a file: ${actual}`);
  return actual;
}

export async function resolveReadableDirectory(input: string): Promise<string> {
  const requested = isAbsolute(input) ? resolve(input) : resolve(PROJECT_ROOT, input);
  const actual = await realpath(requested);
  const roots = await existingRoots([
    PROJECT_ROOT,
    "/mnt/d/Vocaloid",
    ...splitRoots(process.env.VOCALOID_READ_ROOTS),
  ]);
  if (!roots.some((root) => isInside(actual, root))) {
    throw new Error(
      `Read directory is outside allowed roots: ${actual}. ` +
        "Add its parent to VOCALOID_READ_ROOTS if this is intentional.",
    );
  }
  const info = await stat(actual);
  if (!info.isDirectory()) throw new Error(`Expected a directory: ${actual}`);
  return actual;
}

export async function resolveWritablePath(input: string): Promise<string> {
  const requested = isAbsolute(input) ? resolve(input) : resolve(PROJECT_ROOT, input);
  const parent = await realpath(dirname(requested));
  const roots = await existingRoots([
    PROJECT_ROOT,
    ...splitRoots(process.env.VOCALOID_WRITE_ROOTS),
  ]);
  if (!roots.some((root) => isInside(requested, root) && isInside(parent, root))) {
    throw new Error(
      `Write path is outside allowed roots: ${requested}. ` +
        "Add its parent to VOCALOID_WRITE_ROOTS if this is intentional.",
    );
  }
  return requested;
}

export async function resolveWritableDirectory(input: string): Promise<string> {
  const requested = isAbsolute(input) ? resolve(input) : resolve(PROJECT_ROOT, input);
  const actual = await realpath(requested);
  const roots = await existingRoots([
    PROJECT_ROOT,
    ...splitRoots(process.env.VOCALOID_WRITE_ROOTS),
  ]);
  if (!roots.some((root) => isInside(actual, root))) {
    throw new Error(
      `Write directory is outside allowed roots: ${actual}. `
        + "Add it to VOCALOID_WRITE_ROOTS if this is intentional.",
    );
  }
  const info = await stat(actual);
  if (!info.isDirectory()) throw new Error(`Expected a directory: ${actual}`);
  return actual;
}
