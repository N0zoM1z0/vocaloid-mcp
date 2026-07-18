import type { RawTheoryFinding } from "./events.js";
import type { TheoryDomain, TheorySeverity } from "./types.js";


export type TheoryBlockingStage = "score" | "build";

export interface TheoryRuleDefinition {
  code: string;
  version: string;
  domain: TheoryDomain;
  allowedSeverities: readonly TheorySeverity[];
  structural: boolean;
  blockingStages: readonly TheoryBlockingStage[];
}

function rule(
  code: string,
  domain: TheoryDomain,
  severity: TheorySeverity | readonly TheorySeverity[],
  structural = false,
): TheoryRuleDefinition {
  const allowedSeverities: TheorySeverity[] = typeof severity === "string" ? [severity] : [...severity];
  const blockingStages: TheoryBlockingStage[] = structural ? ["score", "build"] : [];
  return Object.freeze({
    code,
    version: "1.0.0",
    domain,
    allowedSeverities: Object.freeze(allowedSeverities),
    structural,
    blockingStages: Object.freeze(blockingStages),
  });
}

// This is the single policy registry for symbolic theory findings. Domain analyzers
// still locate evidence; they cannot silently invent a new code, version, domain,
// severity class, or build-blocking policy.
export const THEORY_RULE_REGISTRY = Object.freeze([
  rule("CHORUS_CONTRAST_LOW", "form", "info"),

  rule("KEY_INVALID", "key", "error", true),
  rule("KEY_COVERAGE_GAP", "key", "warning"),
  rule("CHORD_SYMBOL_UNPARSED_STRICT", "harmony", ["error", "warning"], true),
  rule("CHORD_OUTSIDE_SONG", "harmony", "error", true),
  rule("CHORD_TIMELINE_OVERLAP", "harmony", "error", true),
  rule("CHORD_COVERAGE_GAP", "harmony", "warning"),
  rule("SUSTAINED_NON_CHORD_TONE_UNRESOLVED", "harmony", "warning"),
  rule("LEADING_TONE_UNRESOLVED", "harmony", "warning"),

  rule("MOTIF_REPETITION_HIGH", "melody", "info"),
  rule("CLIMAX_PLACEMENT_UNUSUAL", "melody", "info"),
  rule("VOCAL_TESSITURA_STRAIN", "melody", "warning"),
  rule("LARGE_LEAP_UNBALANCED", "melody", "warning"),
  rule("PHRASE_WITHOUT_BREATH", "vocal", "warning"),
  rule("STRONG_BEAT_OUT_OF_SCALE", "melody", "warning"),

  rule("PATTERN_METER_MISMATCH", "rhythm", "warning"),

  rule("VOCAL_ONSET_DENSITY_RISK", "note_allocation", "warning"),
  rule("MORA_DURATION_UNSINGABLE", "note_allocation", "warning"),
  rule("CONSONANT_LEAD_TIME_INSUFFICIENT", "note_allocation", "warning"),
  rule("MELISMA_PHONEME_UNSUITABLE", "note_allocation", "warning"),
  rule("VIBRATO_NOTE_TOO_SHORT", "performance", "warning"),
  rule("SCOOP_DEPTH_CONTEXT_RISK", "performance", "warning"),

  rule("VOCAL_HARMONY_MINOR_SECOND", "voice_leading", "warning"),
  rule("VOICE_CROSSING", "voice_leading", "warning"),
  rule("VOICE_SPACING_EXTREME", "voice_leading", "warning"),
  rule("PARALLEL_PERFECT_INTERVAL", "voice_leading", "warning"),

  rule("VOICING_NOTE_OUTSIDE_MIDI", "arrangement", "error", true),
  rule("ARRANGEMENT_RANGE_RISK", "arrangement", "warning"),
  rule("BASS_CONFLICTS_WITH_SLASH_CHORD", "arrangement", "warning"),
  rule("REGISTER_DENSITY_COLLISION", "arrangement", "warning"),
  rule("RHYTHMIC_LAYER_COLLISION", "arrangement", "warning"),
  rule("ACCOMPANIMENT_ROLE_REDUNDANCY", "arrangement", "warning"),
  rule("SECTION_DENSITY_ENERGY_MISMATCH", "arrangement", "warning"),
] satisfies readonly TheoryRuleDefinition[]);

const RULE_BY_CODE = new Map(THEORY_RULE_REGISTRY.map((entry) => [entry.code, entry]));

if (RULE_BY_CODE.size !== THEORY_RULE_REGISTRY.length) {
  throw new Error("Theory rule registry contains a duplicate issue code");
}

export function theoryRuleDefinition(code: string): TheoryRuleDefinition {
  const definition = RULE_BY_CODE.get(code);
  if (!definition) throw new Error(`Unregistered theory issue code ${code}`);
  return definition;
}

export function assertRegisteredTheoryFinding(finding: RawTheoryFinding): TheoryRuleDefinition {
  const definition = theoryRuleDefinition(finding.code);
  if (finding.ruleVersion !== definition.version) {
    throw new Error(
      `Theory finding ${finding.code} declares version ${finding.ruleVersion}; registry requires ${definition.version}`,
    );
  }
  if (finding.domain !== definition.domain) {
    throw new Error(
      `Theory finding ${finding.code} declares domain ${finding.domain}; registry requires ${definition.domain}`,
    );
  }
  if (!definition.allowedSeverities.includes(finding.severity)) {
    throw new Error(
      `Theory finding ${finding.code} declares severity ${finding.severity}; registry permits `
      + definition.allowedSeverities.join("/"),
    );
  }
  return definition;
}

export function theoryFindingBlocks(
  finding: Pick<RawTheoryFinding, "code" | "severity">,
  stage: TheoryBlockingStage,
): boolean {
  const definition = theoryRuleDefinition(finding.code);
  return definition.blockingStages.includes(stage) && finding.severity === "error";
}

export function theoryRuleRegistryDescriptor(): readonly object[] {
  return THEORY_RULE_REGISTRY.map((entry) => ({
    code: entry.code,
    version: entry.version,
    domain: entry.domain,
    allowedSeverities: entry.allowedSeverities,
    structural: entry.structural,
    blockingStages: entry.blockingStages,
  }));
}
