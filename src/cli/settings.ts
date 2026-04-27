import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parse as parseJsonc } from "jsonc-parser";

export interface SettingsOptions {
  patterns?: string[];
  sourcePath?: string;
  mode?: "merge" | "replace";
  dryRun?: boolean;
}

export interface SettingsResult {
  settingsPath: string;
  sourcePath?: string;
  mode: "merge" | "replace";
  changed: boolean;
  beforePatterns: string[];
  afterPatterns: string[];
}

const DEFAULT_PATTERNS = ["**/Actions.txt"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizePatterns(patterns: string[]): string[] {
  const cleaned = patterns
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return [...new Set(cleaned)];
}

function deepEqualArray(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortObject(entry));
  }
  if (!isRecord(value)) {
    return value;
  }
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    result[key] = sortObject(value[key]);
  }
  return result;
}

function deepEqualObject(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return JSON.stringify(sortObject(a)) === JSON.stringify(sortObject(b));
}

async function readSettingsJson(filePath: string, contextLabel: string): Promise<Record<string, unknown>> {
  const rawText = await fs.readFile(filePath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      throw new Error(`Cannot find ${contextLabel}: ${filePath}`);
    }
    throw error;
  });
  let parsed: unknown;
  const parseErrors: { error: number; offset: number; length: number }[] = [];
  parsed = parseJsonc(rawText, parseErrors, { allowTrailingComma: true });
  if (parseErrors.length > 0) {
    throw new Error(`Cannot read ${contextLabel} because it contains invalid JSON: ${filePath}`);
  }
  if (!isRecord(parsed)) {
    throw new Error(`Expected ${contextLabel} root to be a JSON object: ${filePath}`);
  }
  return parsed;
}

function mergeSourceFridaSettings(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...target };
  const directKeys = ["frida.filePatterns", "frida.syntaxColorScheme"];
  for (const key of directKeys) {
    if (key in source) {
      merged[key] = source[key];
    }
  }
  if ("editor.tokenColorCustomizations" in source) {
    merged["editor.tokenColorCustomizations"] = source["editor.tokenColorCustomizations"];
  }
  return merged;
}

export function mergeFridaPatterns(existing: string[] | undefined, requested?: string[]): string[] {
  if (requested && requested.length > 0) {
    return normalizePatterns(requested);
  }
  if (existing && existing.length > 0) {
    return normalizePatterns(existing);
  }
  return [...DEFAULT_PATTERNS];
}

export async function ensureWorkspaceSettings(
  workspacePath: string,
  options: SettingsOptions = {},
): Promise<SettingsResult> {
  const vscodeDir = path.join(workspacePath, ".vscode");
  const settingsPath = path.join(vscodeDir, "settings.json");
  const mode = options.mode ?? "merge";

  let root: Record<string, unknown> = {};
  let beforePatterns: string[] = [];

  try {
    root = { ...(await readSettingsJson(settingsPath, "settings.json")) };
    const currentValue = root["frida.filePatterns"];
    if (Array.isArray(currentValue)) {
      beforePatterns = currentValue.filter((item): item is string => typeof item === "string");
    }
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT" || String(error).includes("Cannot find settings.json")) {
      root = {};
      beforePatterns = [];
    } else {
      if (String(error).includes("invalid JSON")) {
        throw new Error(
          `Cannot update ${settingsPath} because it contains invalid JSON. Fix the file and run again.`,
        );
      }
      throw error;
    }
  }

  const sourcePath = options.sourcePath ? path.resolve(options.sourcePath) : undefined;
  let nextRoot = { ...root };
  if (sourcePath) {
    const sourceRoot = await readSettingsJson(sourcePath, "source settings JSON");
    if (mode === "replace") {
      nextRoot = { ...sourceRoot };
    } else {
      nextRoot = mergeSourceFridaSettings(nextRoot, sourceRoot);
    }
  }

  const currentValue = nextRoot["frida.filePatterns"];
  const sourcePatterns = Array.isArray(currentValue)
    ? currentValue.filter((item): item is string => typeof item === "string")
    : [];
  const afterPatterns = mergeFridaPatterns(sourcePatterns, options.patterns);
  nextRoot["frida.filePatterns"] = afterPatterns;

  const changed = !deepEqualObject(root, nextRoot) || !deepEqualArray(beforePatterns, afterPatterns);
  if (!changed) {
    return { settingsPath, sourcePath, mode, changed: false, beforePatterns, afterPatterns };
  }
  if (options.dryRun) {
    return { settingsPath, sourcePath, mode, changed: true, beforePatterns, afterPatterns };
  }

  await fs.mkdir(vscodeDir, { recursive: true });
  const nextContent = `${JSON.stringify(nextRoot, null, 2)}\n`;
  const tempPath = `${settingsPath}.tmp`;
  await fs.writeFile(tempPath, nextContent, "utf8");
  await fs.rename(tempPath, settingsPath);

  return { settingsPath, sourcePath, mode, changed: true, beforePatterns, afterPatterns };
}
