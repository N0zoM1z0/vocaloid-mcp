import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
  acquireEditorLease,
  EditorBusyError,
  inspectEditorLease,
} from "../src/editor-lease.js";


test("Editor lease is host-wide, diagnostic, and safely releasable", async (context) => {
  const temporary = await mkdtemp(join(process.cwd(), ".test-editor-lease-"));
  const previous = process.env.VOCALOID_EDITOR_LOCK_PATH;
  process.env.VOCALOID_EDITOR_LOCK_PATH = join(temporary, "editor.lock");
  context.after(async () => {
    if (previous === undefined) delete process.env.VOCALOID_EDITOR_LOCK_PATH;
    else process.env.VOCALOID_EDITOR_LOCK_PATH = previous;
    await rm(temporary, { recursive: true, force: true });
  });

  const first = await acquireEditorLease("first-render");
  const snapshot = await inspectEditorLease();
  assert.equal(snapshot?.requestId, "first-render");
  assert.equal(snapshot?.ownerPid, process.pid);
  assert.equal(snapshot?.ownerAlive, true);

  await assert.rejects(
    acquireEditorLease("second-render"),
    (error: unknown) => {
      assert.ok(error instanceof EditorBusyError);
      assert.equal(error.code, "EDITOR_BUSY");
      assert.equal(error.owner.requestId, "first-render");
      return true;
    },
  );

  await first.release();
  await first.release();
  assert.equal(await inspectEditorLease(), null);
  const second = await acquireEditorLease("second-render");
  await second.release();
});

test("Editor lease immediately reclaims a valid lock whose owner PID is dead", async (context) => {
  const temporary = await mkdtemp(join(process.cwd(), ".test-editor-dead-lease-"));
  const previous = process.env.VOCALOID_EDITOR_LOCK_PATH;
  const path = join(temporary, "editor.lock");
  process.env.VOCALOID_EDITOR_LOCK_PATH = path;
  context.after(async () => {
    if (previous === undefined) delete process.env.VOCALOID_EDITOR_LOCK_PATH;
    else process.env.VOCALOID_EDITOR_LOCK_PATH = previous;
    await rm(temporary, { recursive: true, force: true });
  });

  await writeFile(path, `${JSON.stringify({
    leaseId: "dead-owner-lease",
    ownerPid: 2_147_483_647,
    requestId: "interrupted-render",
    acquiredAt: new Date().toISOString(),
  })}\n`);
  const before = await inspectEditorLease();
  assert.equal(before?.ownerAlive, false);
  assert.ok((before?.ageMilliseconds ?? 10_000) < 60_000);

  const recovered = await acquireEditorLease("recovery-render");
  assert.equal(recovered.requestId, "recovery-render");
  await recovered.release();
  assert.equal(await inspectEditorLease(), null);
});
