import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";

import { resolveReadableDirectory } from "./paths.js";
import type { VoiceInfo } from "./types.js";


const DEFAULT_VOICE_DIR = "/mnt/d/Vocaloid/VoiceDB";

function decodeVvd(data: Buffer): string {
  const decoded = Buffer.from(
    data.map((byte) => (byte === 0x0a || byte === 0x0d ? byte : byte ^ 0x1a)),
  );
  return decoded.toString("utf8");
}

function parseVvd(data: Buffer, path: string): VoiceInfo {
  const text = decodeVvd(data);
  const fields = new Map<string, string>();
  for (const match of text.matchAll(/"([^"]+)":=:"([^"]*)"/g)) {
    const key = match[1];
    const value = match[2];
    if (key !== undefined && value !== undefined) fields.set(key, value);
  }

  const name = fields.get("VOICENAME");
  const componentId = fields.get("VOICEIDSTR");
  if (!name || !componentId || componentId.length !== 16) {
    throw new Error(`Unrecognized VOCALOID VVD metadata: ${path}`);
  }

  const parameterNames = [
    "Breathiness",
    "Brightness",
    "Clearness",
    "Opening",
    "Gender Factor",
  ];
  const parameters: Record<string, number> = {};
  for (const parameter of parameterNames) {
    const raw = fields.get(parameter);
    if (raw !== undefined && Number.isFinite(Number(raw))) {
      parameters[parameter] = Number(raw);
    }
  }

  const formatVersion = fields.get("FORMAT");
  return {
    name,
    componentId,
    ...(formatVersion ? { formatVersion } : {}),
    path,
    parameters,
  };
}

async function findVvdFiles(root: string, maxDepth = 5): Promise<string[]> {
  const output: string[] = [];

  async function walk(directory: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(path, depth + 1);
      } else if (entry.isFile() && extname(entry.name).toLowerCase() === ".vvd") {
        output.push(path);
      }
    }
  }

  await walk(root, 0);
  return output.sort((left, right) => left.localeCompare(right));
}

export async function discoverVoices(inputDirectories?: string[]): Promise<VoiceInfo[]> {
  const requested =
    inputDirectories && inputDirectories.length > 0
      ? inputDirectories
      : [process.env.VOCALOID_VOICE_DIR ?? DEFAULT_VOICE_DIR];
  const voices: VoiceInfo[] = [];
  const seen = new Set<string>();

  for (const directory of requested) {
    const root = await resolveReadableDirectory(directory);
    for (const path of await findVvdFiles(root)) {
      const voice = parseVvd(await readFile(path), path);
      if (!seen.has(voice.componentId)) {
        voices.push(voice);
        seen.add(voice.componentId);
      }
    }
  }

  return voices.sort((left, right) => left.name.localeCompare(right.name));
}
