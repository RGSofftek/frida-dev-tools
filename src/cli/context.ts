import * as fs from "node:fs";
import * as path from "node:path";
import type { SessionStoreResult } from "./auth";

export interface FridaContext {
  cwd: string;
  processId?: number;
  step?: number;
  isFridaProcessFolder: boolean;
  files: {
    actions: boolean;
    datadrive: boolean;
    headers: boolean;
  };
  runScriptTargets: string[];
}

export interface ContextSummary {
  cwd: string;
  processId?: number;
  step?: number;
  isFridaProcessFolder: boolean;
  files: FridaContext["files"];
  runScriptTargets: string[];
  auth: "signed_in" | "signed_out";
  userEmail?: string;
}

const runScriptRegex = /^\s*RunScript\s+(\S+)/i;

function parsePathForProcess(cwd: string): { processId?: number; step?: number; isMatch: boolean } {
  const parts = cwd.split(path.sep).filter(Boolean);
  if (parts.length < 3) {
    return { isMatch: false };
  }
  const stepToken = parts[parts.length - 1];
  const processToken = parts[parts.length - 2];
  const localToken = parts[parts.length - 3];
  if (localToken.toLowerCase() !== "local") {
    return { isMatch: false };
  }
  if (!/^\d+$/.test(processToken) || !/^\d+$/.test(stepToken)) {
    return { isMatch: false };
  }
  return {
    processId: Number(processToken),
    step: Number(stepToken),
    isMatch: true,
  };
}

function parseRunScripts(actionsPath: string): string[] {
  if (!fs.existsSync(actionsPath)) {
    return [];
  }
  const lines = fs.readFileSync(actionsPath, "utf8").split(/\r?\n/);
  const targets: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const match = runScriptRegex.exec(line);
    if (!match) {
      continue;
    }
    const raw = match[1].trim();
    const normalized = raw.toLowerCase().endsWith(".txt") ? raw : `${raw}.txt`;
    if (normalized.toLowerCase() === "actions.txt") {
      continue;
    }
    if (!seen.has(normalized)) {
      seen.add(normalized);
      targets.push(normalized);
    }
  }
  return targets;
}

export function detectFridaContext(cwd: string): FridaContext {
  const parsed = parsePathForProcess(cwd);
  const actionsPath = path.join(cwd, "Actions.txt");
  return {
    cwd,
    processId: parsed.processId,
    step: parsed.step,
    isFridaProcessFolder: parsed.isMatch,
    files: {
      actions: fs.existsSync(actionsPath),
      datadrive: fs.existsSync(path.join(cwd, "datadrive.txt")),
      headers: fs.existsSync(path.join(cwd, "headers.txt")),
    },
    runScriptTargets: parseRunScripts(actionsPath),
  };
}

export function formatContextSummary(context: FridaContext, session: SessionStoreResult | null): ContextSummary {
  return {
    cwd: context.cwd,
    processId: context.processId,
    step: context.step,
    isFridaProcessFolder: context.isFridaProcessFolder,
    files: context.files,
    runScriptTargets: context.runScriptTargets,
    auth: session ? "signed_in" : "signed_out",
    userEmail: session?.email,
  };
}
