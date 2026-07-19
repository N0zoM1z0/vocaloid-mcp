import { execFile } from "node:child_process";
import { promisify } from "node:util";


const execFileAsync = promisify(execFile);
const COMPONENT_ID = /^[A-Z0-9]{16}$/u;
const REGISTRY_ROOT = "HKLM\\SOFTWARE\\WOW6432Node\\VCLDASGN3\\DATABASE\\VOICE3";

export type VoiceRegistrationStatus =
  | "active"
  | "activation_incomplete"
  | "not_registered"
  | "indeterminate";

export interface VoiceRegistrationInspection {
  componentId: string;
  status: VoiceRegistrationStatus;
  installed: boolean;
  databasePathPresent: boolean;
  activationMarkerPresent: boolean;
  keyMarkerPresent: boolean;
  reason: string;
}

export function parseVoiceRegistrationQuery(
  componentId: string,
  output: string,
): VoiceRegistrationInspection {
  if (!COMPONENT_ID.test(componentId)) throw new Error("componentId must contain 16 uppercase letters/digits");
  const values = new Map<string, string>();
  for (const match of output.matchAll(/^\s*([^\r\n]+?)\s+REG_(?:SZ|DWORD)\s+([^\r\n]*)$/gmu)) {
    const name = match[1]?.trim().toUpperCase();
    const value = match[2]?.trim();
    if (name && value !== undefined) values.set(name, value);
  }
  const installed = /^(?:0x)?1$/iu.test(values.get("INSTALLED") ?? "");
  const databasePathPresent = (values.get("PATH")?.length ?? 0) > 0;
  const time = values.get("TIME") ?? "";
  const activationMarkerPresent = time.length > 0 && !/^0+$/u.test(time);
  const keyMarkerPresent = (values.get("DEFAULT")?.length ?? 0) > 0;
  const active = installed && databasePathPresent && activationMarkerPresent && keyMarkerPresent;
  return {
    componentId,
    status: active ? "active" : "activation_incomplete",
    installed,
    databasePathPresent,
    activationMarkerPresent,
    keyMarkerPresent,
    reason: active
      ? "32-bit VOCALOID3 registry entry has installed, database-path, activation-time, and key markers."
      : "32-bit VOCALOID3 registry entry is incomplete; use the legitimate voicebank installer/license workflow before rendering.",
  };
}

export async function inspectVoiceRegistration(
  componentId: string,
): Promise<VoiceRegistrationInspection> {
  if (!COMPONENT_ID.test(componentId)) throw new Error("componentId must contain 16 uppercase letters/digits");
  const registryExecutable = process.env.VOCALOID_REG_EXE ?? "/mnt/c/Windows/System32/reg.exe";
  const registryKey = `${REGISTRY_ROOT}\\${componentId}`;
  try {
    const result = await execFileAsync(registryExecutable, ["query", registryKey, "/s"], {
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 256 * 1024,
    });
    return parseVoiceRegistrationQuery(componentId, result.stdout);
  } catch (error) {
    const candidate = error as { code?: string | number; message?: string };
    if (candidate.code === 1 || candidate.code === "1") {
      return {
        componentId,
        status: "not_registered",
        installed: false,
        databasePathPresent: false,
        activationMarkerPresent: false,
        keyMarkerPresent: false,
        reason: "No 32-bit VOCALOID3 VOICE3 registry entry exists for this component.",
      };
    }
    return {
      componentId,
      status: "indeterminate",
      installed: false,
      databasePathPresent: false,
      activationMarkerPresent: false,
      keyMarkerPresent: false,
      reason: `Registration inspection unavailable: ${candidate.message ?? String(error)}`,
    };
  }
}
