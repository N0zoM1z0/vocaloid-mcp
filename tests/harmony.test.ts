import assert from "node:assert/strict";
import test from "node:test";

import { isChordTone, parseChordSymbol } from "../src/harmony.js";


test("parses common chord symbols into deterministic pitch-class guardrails", () => {
  const major = parseChordSymbol("Cmaj7");
  assert.ok(major);
  assert.deepEqual(major.pitchClasses, [0, 4, 7, 11]);
  assert.equal(isChordTone(71, major), true);
  assert.equal(isChordTone(70, major), false);

  const minor = parseChordSymbol("F#m7/C#");
  assert.ok(minor);
  assert.deepEqual(minor.pitchClasses, [1, 4, 6, 9]);
  assert.equal(minor.bass, "C#");

  const suspended = parseChordSymbol("Bbsus4");
  assert.ok(suspended);
  assert.deepEqual(suspended.pitchClasses, [3, 5, 10]);
  assert.equal(parseChordSymbol("not-a-chord"), null);
});
