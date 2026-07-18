import assert from "node:assert/strict";
import test from "node:test";

import { expandTempoCurve } from "../src/tempo.js";


test("tempo curve expands accelerando with strict ordered musical positions", () => {
  const result = expandTempoCurve({
    timeSignatures: [{ measure: 0, numerator: 4, denominator: 4 }],
    start: { measure: 8, beat: 0 },
    end: { measure: 12, beat: 0 },
    startBpm: 120,
    endBpm: 168,
    steps: 9,
    curve: "ease_in_out",
  });
  assert.equal(result.events[0]?.bpm, 120);
  assert.equal(result.events.at(-1)?.bpm, 168);
  assert.deepEqual(result.events[0]?.position, { measure: 8, beat: 0, tick: 0 });
  assert.deepEqual(result.events.at(-1)?.position, { measure: 12, beat: 0, tick: 0 });
  assert.ok(result.events.every((event, index) => index === 0 || event.tick > result.events[index - 1]!.tick));
  assert.ok((result.events[1]?.bpm ?? 999) < 126);
});
