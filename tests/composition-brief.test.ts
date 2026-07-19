import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import {
  CompositionBriefSchema,
  loadCompositionBrief,
  renderCompositionAgentPrompt,
} from "../src/composition-brief.js";


const INTENT = "intents/2026-07-19-summer-night-rain-cicadas-ia-rocks.intent.json";

test("composition intent files are strict, bounded, and independently renderable", async () => {
  const loaded = await loadCompositionBrief(INTENT);
  assert.equal(loaded.brief.run_id, "natsu-ame-semi-ia-rocks-20260719");
  assert.deepEqual(loaded.brief.musical_constraints.tempo_bpm, { min: 180, max: 200, preferred: 190 });
  assert.equal(loaded.brief.musical_constraints.voice.name, "IA_ROCKS");
  assert.equal(loaded.brief.source_boundaries.local_ia_corpus, "forbidden");

  const rendered = await renderCompositionAgentPrompt(INTENT);
  assert.match(rendered.prompt, /summer-night-rain-cicadas/u);
  assert.match(rendered.prompt, /BDREB7P2KTWKYDC5/u);
  assert.match(rendered.prompt, /180[\s\S]*200/u);
  assert.match(rendered.prompt, /record_if_absent/u);
  assert.match(rendered.prompt, /Never expand a DSL bundle into a template melody/u);
  assert.doesNotMatch(rendered.prompt, /\{\{(?:INTENT_FILE|COMPOSITION_BRIEF_JSON)\}\}/u);
});

test("composition intent path and BPM preference cannot escape their contracts", async () => {
  await assert.rejects(
    loadCompositionBrief(resolve("package.json")),
    /must be a \*\.intent\.json file inside/u,
  );
  const base = (await loadCompositionBrief("intents/template.intent.json")).brief;
  assert.throws(
    () => CompositionBriefSchema.parse({
      ...base,
      musical_constraints: {
        ...base.musical_constraints,
        tempo_bpm: { min: 180, max: 200, preferred: 210 },
      },
    }),
    /preferred BPM must be inside min\.\.max/u,
  );
});
