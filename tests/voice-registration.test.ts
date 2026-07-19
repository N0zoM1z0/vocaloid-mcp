import assert from "node:assert/strict";
import test from "node:test";

import {
  findVoiceIdentityCollision,
  type VoiceProbeRecord,
} from "../src/voice-readiness.js";
import { parseVoiceRegistrationQuery } from "../src/voice-registration.js";


const IA = "BLRGDDR4M3WM2LC6";

test("voice registration parser rejects an all-zero activation marker", () => {
  const result = parseVoiceRegistrationQuery(IA, `
HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\VCLDASGN3\\DATABASE\\VOICE3\\${IA}
    PATH    REG_SZ    D:\\Vocaloid\\VoiceDB\\IA
    INSTALLED    REG_DWORD    0x1
    TIME    REG_SZ    0000000000000000
HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\VCLDASGN3\\DATABASE\\VOICE3\\${IA}\\KEYS
    default    REG_SZ    redacted
`);
  assert.equal(result.status, "activation_incomplete");
  assert.equal(result.installed, true);
  assert.equal(result.activationMarkerPresent, false);
  assert.equal(result.keyMarkerPresent, true);
});

test("voice registration parser accepts complete markers without exposing their values", () => {
  const result = parseVoiceRegistrationQuery(IA, `
HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\VCLDASGN3\\DATABASE\\VOICE3\\${IA}
    PATH    REG_SZ    D:\\Vocaloid\\VoiceDB\\IA
    INSTALLED    REG_DWORD    0x1
    TIME    REG_SZ    BHMN74F9ED86FKAB
HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\VCLDASGN3\\DATABASE\\VOICE3\\${IA}\\KEYS
    default    REG_SZ    redacted
`);
  assert.equal(result.status, "active");
  assert.equal(result.databasePathPresent, true);
  assert.equal(result.activationMarkerPresent, true);
  assert.equal(result.keyMarkerPresent, true);
  assert.doesNotMatch(JSON.stringify(result), /BHMN74F9ED86FKAB|redacted/u);
});

test("voice probe identity guard catches exact cross-component render collisions only on one host", () => {
  const record: VoiceProbeRecord = {
    componentId: "BDREB7P2KTWKYDC5",
    voiceName: "IA_ROCKS",
    status: "verified",
    checkedAt: "2026-07-19T00:00:00.000Z",
    expiresAt: "2026-07-26T00:00:00.000Z",
    hostCacheKey: "host-a",
    editorSha256: "editor",
    editorVersion: "3.2.1.1",
    helperSha256: "helper",
    reason: "fixture",
    renderSha256: "same-render",
  };
  assert.equal(
    findVoiceIdentityCollision([record], IA, "host-a", "same-render")?.componentId,
    record.componentId,
  );
  assert.equal(findVoiceIdentityCollision([record], IA, "host-b", "same-render"), undefined);
  assert.equal(findVoiceIdentityCollision([record], IA, "host-a", "different-render"), undefined);
});
