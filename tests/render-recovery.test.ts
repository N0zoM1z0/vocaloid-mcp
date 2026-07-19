import assert from "node:assert/strict";
import test from "node:test";

import { parseNativeExportFailure } from "../src/render.js";


test("native export failure parsing finds the final structured helper diagnostic", () => {
  const result = parseNativeExportFailure([
    "helper diagnostic",
    JSON.stringify({
      ok: false,
      stage: "set_save_filename",
      win32_error: 13,
      forced_termination: false,
    }),
  ].join("\n"));
  assert.equal(result?.stage, "set_save_filename");
  assert.equal(result?.win32_error, 13);
  assert.equal(parseNativeExportFailure("plain stderr only"), null);
});
