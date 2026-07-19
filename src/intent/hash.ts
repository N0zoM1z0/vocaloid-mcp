import { createHash } from "node:crypto";
import { z } from "zod";

import { CompositionIntentSchema, type CompositionIntent } from "./types.js";


function canonicalizeIntent(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeIntent);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalizeIntent(entry)]),
    );
  }
  return value;
}

export function songIntentHash(
  intent: CompositionIntent | z.input<typeof CompositionIntentSchema>,
): string {
  const parsed = CompositionIntentSchema.parse(intent);
  return createHash("sha256")
    .update(JSON.stringify(canonicalizeIntent(parsed)))
    .digest("hex");
}

export function optionalSongIntentHash(intent: CompositionIntent | undefined): string | null {
  return intent ? songIntentHash(intent) : null;
}
