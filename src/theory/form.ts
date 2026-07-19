import type { SongManifest } from "../song-manifest.js";
import type { DomainAnalysis, SymbolicIndex } from "./events.js";


interface SectionDensity {
  section: SongManifest["sections"][number];
  startTick: number;
  endTick: number;
  vocalOnsets: number;
  arrangementOnsets: number;
  drumOnsets: number;
  onsetsPerQuarter: number;
}

function sectionDensities(index: SymbolicIndex): SectionDensity[] {
  const vocalCounts = new Map<string, number>();
  const arrangementCounts = new Map<string, number>();
  const drumCounts = new Map<string, number>();
  const increment = (counts: Map<string, number>, sectionId: string | undefined): void => {
    if (sectionId) counts.set(sectionId, (counts.get(sectionId) ?? 0) + 1);
  };
  for (const event of index.vocalEvents) increment(vocalCounts, event.sectionId);
  for (const event of index.arrangementEvents) increment(arrangementCounts, event.sectionId);
  for (const event of index.drumEvents) increment(drumCounts, event.sectionId);
  return index.timeline.sections.map((entry) => {
    const durationQuarters = Math.max(1, (entry.endTick - entry.startTick) / 480);
    const vocalOnsets = vocalCounts.get(entry.id) ?? 0;
    const arrangementOnsets = arrangementCounts.get(entry.id) ?? 0;
    const drumOnsets = drumCounts.get(entry.id) ?? 0;
    return {
      section: entry.value,
      startTick: entry.startTick,
      endTick: entry.endTick,
      vocalOnsets,
      arrangementOnsets,
      drumOnsets,
      onsetsPerQuarter: (vocalOnsets + arrangementOnsets + drumOnsets) / durationQuarters,
    };
  });
}

export function analyzeForm(manifest: SongManifest, index: SymbolicIndex): DomainAnalysis {
  const findings: DomainAnalysis["findings"] = [];
  const metrics: DomainAnalysis["metrics"] = [];
  const densities = sectionDensities(index);
  const energyValues = manifest.sections.map((section) => section.energy);
  const coveredTicks = index.timeline.sections.reduce(
    (sum, section) => sum + Math.max(0, section.endTick - section.startTick),
    0,
  );
  metrics.push(
    {
      id: "form.section_count",
      domain: "form",
      value: manifest.sections.length,
      unit: "sections",
      objectIds: manifest.sections.map((section) => section.id),
    },
    {
      id: "form.section_coverage",
      domain: "form",
      value: index.timeline.songEndTick > 0
        ? Number(Math.min(1, coveredTicks / index.timeline.songEndTick).toFixed(6))
        : 1,
      unit: "ratio",
      objectIds: manifest.sections.map((section) => section.id),
    },
    {
      id: "form.energy_range",
      domain: "form",
      value: energyValues.length > 0 ? Math.max(...energyValues) - Math.min(...energyValues) : 0,
      unit: "normalized",
      objectIds: manifest.sections.map((section) => section.id),
    },
  );
  for (const density of densities) {
    const durationTicks = density.endTick - density.startTick;
    metrics.push(
      {
        id: `form.section_duration.${density.section.id}`,
        domain: "form",
        value: durationTicks,
        unit: "ticks",
        objectIds: [density.section.id],
      },
      {
        id: `form.section_energy.${density.section.id}`,
        domain: "form",
        value: density.section.energy,
        unit: "normalized",
        objectIds: [density.section.id],
      },
      {
        id: `form.section_onset_density.${density.section.id}`,
        domain: "form",
        value: Number(density.onsetsPerQuarter.toFixed(6)),
        unit: "onsets_per_quarter",
        objectIds: [density.section.id],
      },
    );
  }

  for (const [sectionIndex, chorus] of densities.entries()) {
    if (chorus.section.kind !== "chorus") continue;
    const comparison = densities.slice(0, sectionIndex).reverse().find(
      (candidate) => candidate.section.kind === "verse" || candidate.section.kind === "pre_chorus",
    );
    if (!comparison) continue;
    const energyDelta = chorus.section.energy - comparison.section.energy;
    const densityScale = Math.max(1, chorus.onsetsPerQuarter, comparison.onsetsPerQuarter);
    const densityDelta = (chorus.onsetsPerQuarter - comparison.onsetsPerQuarter) / densityScale;
    if (Math.abs(energyDelta) < 0.12 && Math.abs(densityDelta) < 0.18) {
      findings.push({
        code: "CHORUS_CONTRAST_LOW",
        ruleVersion: "1.0.0",
        severity: "info",
        domain: "form",
        confidence: 0.85,
        message: `${chorus.section.id} has nearly the same declared energy and symbolic onset density as ${comparison.section.id}.`,
        objectIds: [comparison.section.id, chorus.section.id],
        startTick: chorus.startTick,
        endTick: chorus.endTick,
        source: "section energy and symbolic onset density",
        details: {
          energy_delta: Number(energyDelta.toFixed(6)),
          density_delta: Number(densityDelta.toFixed(6)),
        },
        suggestion: "Clarify the chorus function through motif, register, harmonic tension, rhythmic space, or arrangement—not necessarily more layers.",
        repairKind: "arrangement",
      });
    }
  }
  return { findings, metrics };
}
