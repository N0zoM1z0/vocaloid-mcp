#!/usr/bin/env node

import { renderCompositionAgentPrompt } from "../dist/src/composition-brief.js";


const arguments_ = process.argv.slice(2);
const intentArgument = arguments_.find((value) => value.startsWith("--intent="));
if (!intentArgument || arguments_.length !== 1) {
  throw new Error("Usage: npm run --silent compose:prompt -- --intent=intents/<name>.intent.json");
}
const intentFile = intentArgument.slice("--intent=".length);
const rendered = await renderCompositionAgentPrompt(intentFile);
process.stdout.write(rendered.prompt);
