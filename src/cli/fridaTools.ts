import * as fs from "node:fs/promises";
import * as path from "node:path";
import { spawn } from "node:child_process";
import type { FridaContext } from "./context";
import { computeFileHash, updateBaselineFile, readBaseline, computeNormalizedHash } from "./cognitiveBaseline";

/** Default empty data-driven list for Cognitives upload contract (see sync_actions_to_cognitive.py). */
export const COGNITIVE_DEFAULT_DATADRIVE = "[]\n";

/** ASCII-only placeholder; replace in UI or edit with real Key: value lines when the process needs headers. */
export const COGNITIVE_DEFAULT_HEADERS =
  "## Placeholder (FRIDA RPA). Replace with Key: value header lines if your process uses headers.txt.\n";

export interface EnsureCognitiveSyncCompanionResult {
  /** Basenames of files that were created (not overwritten). */
  created: string[];
}

/**
 * Ensures datadrive.txt and headers.txt exist so sync_actions_to_cognitive.py can run.
 * Requires Actions.txt. Never overwrites existing companion files.
 */
export async function ensureCognitiveSyncCompanionFiles(processDir: string): Promise<EnsureCognitiveSyncCompanionResult> {
  const actionsPath = path.join(processDir, "Actions.txt");
  try {
    const st = await fs.stat(actionsPath);
    if (!st.isFile()) {
      throw new Error(`Cannot push: ${actionsPath} exists but is not a file.`);
    }
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e?.code === "ENOENT") {
      throw new Error(`Cannot push: Actions.txt is missing in ${processDir}.`);
    }
    throw err;
  }

  const created: string[] = [];
  const datadrivePath = path.join(processDir, "datadrive.txt");
  const headersPath = path.join(processDir, "headers.txt");

  try {
    await fs.access(datadrivePath);
  } catch {
    await fs.writeFile(datadrivePath, COGNITIVE_DEFAULT_DATADRIVE, "utf8");
    created.push("datadrive.txt");
  }
  try {
    await fs.access(headersPath);
  } catch {
    await fs.writeFile(headersPath, COGNITIVE_DEFAULT_HEADERS, "utf8");
    created.push("headers.txt");
  }

  for (const name of created) {
    process.stdout.write(`frida-rpa: created missing companion file: ${path.join(processDir, name)}\n`);
  }
  return { created };
}

interface ToolResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface BaseOpts {
  json?: boolean;
}

export interface FixOpts extends BaseOpts {
  /** Pass `--unsafe-fixes` to `frida_lint check --fix` (e.g. W004 comment-out). */
  unsafeFixes?: boolean;
}

export interface PushOpts extends FixOpts {
  dryRun?: boolean;
  /** If true, pass `--verbose` to sync; prints legacy Azure per-step output instead of a summary. */
  verbose?: boolean;
}

/** Parsed stdout from `sync_actions_to_cognitive.py --json` (Cognitive step sync). */
export type CognitiveSyncFileEntry = { name: string; byteSize: number };

export type CognitiveAppUsage = {
  status: string;
  reason?: string;
  httpStatus?: number;
  rawResponse?: string;
};

export type CognitiveSyncResult = {
  processId: number;
  step: number;
  pathPrefix: string;
  dryRun?: boolean;
  files: CognitiveSyncFileEntry[];
  listStatus?: number;
  remoteFiles?: Array<{
    name: string;
    kind: string;
    fileId: string;
    contentLength: unknown;
  }>;
  appUsage: CognitiveAppUsage;
  notes?: string[];
  listBodyPreview?: string;
};

export function parseCognitiveSyncJson(
  stdout: string,
):
  | { ok: true; value: CognitiveSyncResult }
  | { ok: false; error: string } {
  const t = stdout.trim();
  if (!t) {
    return { ok: false, error: "empty output" };
  }
  try {
    const v = JSON.parse(t) as unknown;
    if (!v || typeof v !== "object") {
      return { ok: false, error: "not a JSON object" };
    }
    const o = v as Record<string, unknown>;
    if (typeof o.processId !== "number" || typeof o.step !== "number" || !Array.isArray(o.files) || o.appUsage === null || o.appUsage === undefined) {
      return { ok: false, error: "invalid Cognitive sync result shape" };
    }
    return { ok: true, value: o as CognitiveSyncResult };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

interface PullOpts extends BaseOpts {
  backup?: boolean;
  force?: boolean;
  dryRun?: boolean;
}

interface LogsOpts extends BaseOpts {
  action: "list" | "latest" | "get";
  processId: number;
  userEmail: string;
  runId?: string;
  fileName?: string;
  outDir?: string;
  limit?: number;
}

async function resolveToolRoot(): Promise<string> {
  // Compiled cli.js lives in out/, so repo root is one level up from that.
  return path.resolve(__dirname, "..", "..");
}

function inferRequiredContext(context: FridaContext): { processId: number; step: number } {
  if (context.processId === undefined || context.step === undefined) {
    throw new Error("Could not infer process and step from folder. Use --process-id and --step.");
  }
  return { processId: context.processId, step: context.step };
}

function runPython(cwd: string, args: string[]): Promise<ToolResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("python", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}

function printResult(label: string, result: ToolResult): void {
  if (result.stdout.trim()) {
    process.stdout.write(result.stdout);
    if (!result.stdout.endsWith("\n")) {
      process.stdout.write("\n");
    }
  }
  if (result.stderr.trim()) {
    process.stderr.write(result.stderr);
    if (!result.stderr.endsWith("\n")) {
      process.stderr.write("\n");
    }
  }
  if (result.exitCode !== 0) {
    throw new Error(`${label} failed with exit code ${result.exitCode}`);
  }
}

/** Print stdout/stderr from a tool run without throwing (used when exit 1 can mean warning-only). */
function writeToolOutput(result: ToolResult): void {
  if (result.stdout) {
    process.stdout.write(result.stdout);
    if (!result.stdout.endsWith("\n")) {
      process.stdout.write("\n");
    }
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
    if (!result.stderr.endsWith("\n")) {
      process.stderr.write("\n");
    }
  }
}

export type LintDiagnostic = {
  file: string;
  line: number;
  col: number;
  code: string;
  message: string;
  severity: string;
  fixable?: boolean;
  fix_kind?: string | null;
};

/**
 * User-facing `frida-rpa push` success summary after lint passes and sync JSON is parsed.
 */
export function formatPushUserSummary(
  diagnostics: LintDiagnostic[],
  processId: number,
  sync: CognitiveSyncResult,
): string {
  const lines: string[] = ["frida-rpa: push", ""];
  if (diagnostics.length === 0) {
    lines.push("Lint: clean");
  } else {
    lines.push(
      `Lint: ${diagnostics.length} non-error issue(s) (push not blocked). Use \`frida-rpa lint\` for details.`,
    );
  }
  if (sync.dryRun) {
    lines.push("Upload: dry run (no remote changes)");
  } else {
    lines.push("Upload: successful");
  }
  lines.push(`Destination: Cognitive process ${processId}`);
  lines.push("");

  const fileLabel = sync.dryRun ? "Files (local, dry run):" : "Files uploaded:";
  lines.push(fileLabel);
  if (sync.files.length === 0) {
    lines.push("  (none)");
  } else {
    const maxName = Math.max(10, ...sync.files.map((f) => f.name.length));
    for (const f of sync.files) {
      lines.push(`  ${f.name.padEnd(maxName, " ")}  ${f.byteSize} B`);
    }
  }
  lines.push("");

  if (sync.dryRun) {
    lines.push("Remote verification: (skipped in dry run)");
  } else {
    const sc = sync.listStatus ?? 0;
    lines.push(sc === 200 ? "Remote verification: OK" : `Remote verification: HTTP ${sc}`);
  }
  if (sync.listBodyPreview) {
    lines.push(
      "Note: list response was not valid JSON; use `frida-rpa push --json` to inspect `listBodyPreview`.",
    );
  }

  const au = sync.appUsage;
  if (au.status === "skipped" && au.reason === "missing_optional_credentials") {
    lines.push("AppUsage analytics: skipped - optional credentials are not configured");
  } else if (au.status === "ok") {
    lines.push(`AppUsage analytics: sent (HTTP ${au.httpStatus ?? "?"})`);
  } else if (au.status === "queued" && sync.dryRun) {
    lines.push("AppUsage analytics: (would be sent in a real run)");
  } else if (au.status === "skipped") {
    lines.push("AppUsage analytics: skipped");
  } else {
    lines.push(`AppUsage analytics: ${au.status}`);
  }

  if (sync.notes && sync.notes.length > 0) {
    lines.push("");
    for (const n of sync.notes) {
      lines.push(n);
    }
  }
  lines.push("");
  return lines.join("\n");
}

export function parseLintCheckJson(stdout: string): { diagnostics: LintDiagnostic[]; parseError?: string } {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return { diagnostics: [] };
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) {
      return { diagnostics: [], parseError: "expected JSON array" };
    }
    return { diagnostics: parsed as LintDiagnostic[] };
  } catch (e) {
    return { diagnostics: [], parseError: e instanceof Error ? e.message : String(e) };
  }
}

export function hasLintErrorSeverity(diagnostics: LintDiagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === "error");
}

/**
 * User-facing `file:line` for linters; uses basename so long process paths stay readable.
 */
export function formatDiagnosticLocation(d: LintDiagnostic): string {
  return `${path.basename(d.file)}:${d.line}`;
}

function countBySeverity(
  diagnostics: LintDiagnostic[],
  severity: string,
): number {
  return diagnostics.filter((d) => d.severity === severity).length;
}

/**
 * One-line description of what non-error issues remain, for the "Status" block.
 */
export function formatNonErrorCountsLine(diagnostics: LintDiagnostic[]): string {
  if (diagnostics.length === 0) return "No non-error issues remain.";
  if (diagnostics.length === 1) {
    const s = diagnostics[0].severity;
    if (s === "warning") return "No errors were found, but 1 warning still needs your decision.";
    if (s === "convention")
      return "No errors were found, but 1 convention still needs your attention.";
    if (s === "style")
      return "No errors were found, but 1 style issue still needs your attention.";
    return "No errors were found, but 1 non-error lint issue still needs your attention.";
  }
  const w = countBySeverity(diagnostics, "warning");
  const c = countBySeverity(diagnostics, "convention");
  const st = countBySeverity(diagnostics, "style");
  const parts: string[] = [];
  if (w) parts.push(`${w} warning(s)`);
  if (c) parts.push(`${c} convention(s)`);
  if (st) parts.push(`${st} style issue(s)`);
  const detail = parts.length > 0 ? ` (${parts.join(", ")})` : "";
  return `No errors were found, but ${diagnostics.length} non-error lint issues remain${detail}. Review the list below.`;
}

/**
 * Lists each diagnostic with code, location, severity, and message (2 lines per issue).
 * Used for `frida-rpa fix` remaining issues. See `formatIssueWithLintHint` for lint.
 */
export function formatRemainingDiagnosticsSummary(diagnostics: LintDiagnostic[]): string {
  return diagnostics
    .map((d) => `  ${d.code}  ${formatDiagnosticLocation(d)}  ${d.severity}\n  ${d.message}`)
    .join("\n\n");
}

/**
 * `Fix: ...` line for plain `frida-rpa lint` output.
 */
function formatFixHintForLint(d: LintDiagnostic): string {
  if (d.severity === "error") {
    return "Fix: correct the error in the script, then re-run `frida-rpa lint`.";
  }
  if (d.fixable) {
    if (d.fix_kind === "unsafe") {
      return `Fix: unsafe - run \`frida-rpa fix --unsafe-fixes\`, add \`## noqa: ${d.code}\` on the line, or edit manually.`;
    }
    return "Fix: safe - run `frida-rpa fix`.";
  }
  return `Fix: edit the script, or add \`## noqa: ${d.code}\` on the line.`;
}

function formatIssueWithLintHint(d: LintDiagnostic): string {
  return `  ${d.code}  ${formatDiagnosticLocation(d)}  ${d.severity}\n  ${d.message}\n  ${formatFixHintForLint(d)}`;
}

/**
 * Second line of the `frida-rpa fix` block after the status: explains counts after a fix pass.
 */
export function formatPostFixCountsLine(diagnostics: LintDiagnostic[]): string {
  if (diagnostics.length === 0) {
    return "Safe fixes were applied. No issues remain.";
  }
  if (diagnostics.length === 1) {
    const s = diagnostics[0].severity;
    if (s === "warning")
      return "Safe fixes were applied where possible. 1 warning still needs your decision.";
    if (s === "convention")
      return "Safe fixes were applied where possible. 1 convention still needs your attention.";
    if (s === "style")
      return "Safe fixes were applied where possible. 1 style issue still needs your attention.";
    return "Safe fixes were applied where possible. 1 issue still needs your attention.";
  }
  const w = countBySeverity(diagnostics, "warning");
  const c = countBySeverity(diagnostics, "convention");
  const st = countBySeverity(diagnostics, "style");
  const parts: string[] = [];
  if (w) parts.push(`${w} warning(s)`);
  if (c) parts.push(`${c} convention(s)`);
  if (st) parts.push(`${st} style issue(s)`);
  const detail = parts.length > 0 ? ` (${parts.join(", ")})` : "";
  return `Safe fixes were applied where possible. ${diagnostics.length} non-error lint issues remain${detail}. Review the list below.`;
}

/**
 * Full human output for `frida-rpa lint` when the wrapper has parsed the JSON check output.
 */
export function formatRunLintUserSummary(diagnostics: LintDiagnostic[]): string {
  if (diagnostics.length === 0) {
    return ["frida-rpa: lint", "", "Status: clean", "No issues found.", ""].join("\n");
  }
  const hasErrors = hasLintErrorSeverity(diagnostics);
  const out: string[] = ["frida-rpa: lint", "", "Status: issues found"];
  if (hasErrors) {
    const nErr = diagnostics.filter((d) => d.severity === "error").length;
    if (nErr === 1) {
      out.push("1 error was reported. Fix it before running automation in production.");
    } else {
      out.push(`${nErr} errors were reported. Fix them before running automation in production.`);
    }
  } else if (diagnostics.length === 1) {
    out.push(formatNonErrorCountsLine(diagnostics));
  } else {
    const w = countBySeverity(diagnostics, "warning");
    const c = countBySeverity(diagnostics, "convention");
    const st = countBySeverity(diagnostics, "style");
    out.push(`No errors were found, but ${diagnostics.length} non-error lint issues remain:`);
    if (w) out.push(`  ${w} warning(s)`);
    if (c) out.push(`  ${c} convention(s)`);
    if (st) out.push(`  ${st} style issue(s)`);
  }
  out.push("");
  out.push("Issues:");
  out.push("");
  const sorted = [...diagnostics].sort((a, b) => {
    if (a.severity === "error" && b.severity !== "error") return -1;
    if (a.severity !== "error" && b.severity === "error") return 1;
    return 0;
  });
  out.push(sorted.map((d) => formatIssueWithLintHint(d)).join("\n\n"));
  out.push("");
  out.push("Next steps:");
  out.push("  frida-rpa fix          Apply safe fixes (add `--unsafe-fixes` to include unsafe auto-fixes)");
  out.push("  frida-rpa lint --json  Machine-readable diagnostics");
  out.push("");
  return out.join("\n");
}

/**
 * When unsafe auto-fixes were not run, explains why and what the user can do next.
 */
export function formatUnsafeFixGuidance(diagnostics: LintDiagnostic[], unsafeFixesEnabled: boolean): string {
  if (unsafeFixesEnabled) {
    return "";
  }
  const unsafe = diagnostics.filter(
    (d) => d.fixable && d.fix_kind === "unsafe" && d.severity !== "error",
  );
  if (unsafe.length === 0) {
    return "";
  }
  const allUnsafeAreW004 = unsafe.length > 0 && unsafe.every((d) => d.code === "W004");
  const lines: string[] = [
    "Why it was not changed automatically:",
  ];
  if (allUnsafeAreW004) {
    lines.push(
      "  W004 is unsafe because changing systemnotify can alter whether an OS confirmation window",
      "  appears, or your intentional confirmation flow.",
    );
  } else {
    lines.push(
      "  These auto-fixes are marked unsafe because they may change script meaning or what the end user sees.",
    );
  }
  const noqaLine = allUnsafeAreW004
    ? "  Add ## noqa: W004 on the line  Keep the line intentionally; suppress the rule for that line"
    : "  Add ## noqa: <CODE> on the line  Keep the line intentionally; suppress the rule for that line";
  lines.push(
    "",
    "Choose one:",
    "  frida-rpa fix --unsafe-fixes         Apply those unsafe auto-fixes (then review the diff in git)",
    noqaLine,
    "  Edit the script manually              Fix or replace the line yourself",
    "",
    "Review full output:",
    "  frida-rpa lint",
    "  frida-rpa lint --json",
  );
  return lines.join("\n");
}

/**
 * Full human-readable footer for `frida-rpa fix` when the final check still has non-error issues.
 * Empty string when there is nothing to report.
 */
export function formatRunFixUserSummary(
  diagnostics: LintDiagnostic[],
  options: { unsafeFixes: boolean },
): string {
  if (diagnostics.length === 0) {
    return "";
  }
  const title = diagnostics.length === 1 ? "Remaining issue:" : "Remaining issues:";
  const unsafeBlock = formatUnsafeFixGuidance(diagnostics, options.unsafeFixes);
  const out = [
    "frida-rpa: fix",
    "",
    "Status: completed with warnings",
    formatPostFixCountsLine(diagnostics),
    "",
    title,
    formatRemainingDiagnosticsSummary(diagnostics),
  ];
  if (unsafeBlock) {
    out.push("", unsafeBlock);
  } else {
    out.push(
      "",
      "Next step:",
      "  frida-rpa lint    Human-readable list",
      "  frida-rpa lint --json  Machine-readable diagnostics (same JSON as the final `check --json` step)",
    );
  }
  return out.join("\n") + "\n";
}

/**
 * Print documented `frida_lint` rule catalog (from `frida_lint.py rules`). No FRIDA process folder required.
 */
export async function runLintRulesInfo(opts: BaseOpts = {}): Promise<number> {
  const root = await resolveToolRoot();
  const args = [path.join(root, "resources", "cli-tools", "frida_lint.py"), "rules"];
  if (opts.json) {
    args.push("--json");
  }
  const result = await runPython(process.cwd(), args);
  if (opts.json) {
    process.stdout.write(result.stdout);
  } else {
    printResult("lint rules", result);
  }
  return result.exitCode === 0 ? 0 : 1;
}

export async function runLint(context: FridaContext, opts: BaseOpts = {}): Promise<number> {
  const root = await resolveToolRoot();
  const target = context.files.actions ? "Actions.txt" : "*.txt";
  const args = [
    path.join(root, "resources", "cli-tools", "frida_lint.py"),
    "--follow-scripts",
    "check",
    target,
    "--json",
  ];
  const result = await runPython(context.cwd, args);
  if (opts.json) {
    process.stdout.write(result.stdout);
    if (result.stdout.trim() && !result.stdout.endsWith("\n")) {
      process.stdout.write("\n");
    }
    return result.exitCode === 0 ? 0 : 1;
  }
  const { diagnostics, parseError } = parseLintCheckJson(result.stdout);
  if (result.stderr.trim()) {
    process.stderr.write(result.stderr);
    if (!result.stderr.endsWith("\n")) {
      process.stderr.write("\n");
    }
  }
  if (parseError) {
    process.stderr.write(`frida-rpa: lint: could not parse check output: ${parseError}\n`);
    writeToolOutput(result);
    return 1;
  }
  if (result.exitCode !== 0 && diagnostics.length === 0) {
    writeToolOutput(result);
    return 1;
  }
  process.stdout.write(formatRunLintUserSummary(diagnostics));
  return diagnostics.length > 0 ? 1 : 0;
}

export async function runFix(context: FridaContext, opts: FixOpts = {}): Promise<number> {
  const root = await resolveToolRoot();
  const target = context.files.actions ? "Actions.txt" : "*.txt";
  const script = path.join(root, "resources", "cli-tools", "frida_lint.py");

  printResult("format", await runPython(context.cwd, [script, "--follow-scripts", "format", target]));
  const checkFixArgs = [script, "--follow-scripts", "check", target, "--fix"];
  if (opts.unsafeFixes) checkFixArgs.push("--unsafe-fixes");
  const checkFix = await runPython(context.cwd, checkFixArgs);
  const printCheckFixRaw = (): void => {
    if (checkFix.stdout || checkFix.stderr) {
      writeToolOutput(checkFix);
    }
  };
  printResult("format", await runPython(context.cwd, [script, "--follow-scripts", "format", target]));
  const verify = await runPython(context.cwd, [script, "--follow-scripts", "check", target, "--json"]);
  const { diagnostics, parseError } = parseLintCheckJson(verify.stdout);
  if (verify.exitCode !== 0 && !verify.stdout.trim()) {
    printCheckFixRaw();
    writeToolOutput(verify);
    return 1;
  }
  if (parseError) {
    process.stderr.write(`frida-rpa error: could not parse lint JSON: ${parseError}\n`);
    printCheckFixRaw();
    writeToolOutput(verify);
    return 1;
  }
  if (hasLintErrorSeverity(diagnostics)) {
    if (opts.json && verify.stdout.trim()) {
      process.stdout.write(verify.stdout);
      if (!verify.stdout.endsWith("\n")) process.stdout.write("\n");
    } else {
      printCheckFixRaw();
      writeToolOutput(verify);
    }
    return 1;
  }
  if (opts.json && verify.stdout.trim()) {
    process.stdout.write(verify.stdout);
    if (!verify.stdout.endsWith("\n")) process.stdout.write("\n");
  } else if (diagnostics.length > 0) {
    process.stdout.write(
      formatRunFixUserSummary(diagnostics, { unsafeFixes: opts.unsafeFixes === true }),
    );
  } else {
    process.stdout.write("frida-rpa: fix\n\nStatus: clean\nAll checks passed after format and fix.\n");
  }
  return 0;
}

export async function runPush(context: FridaContext, opts: PushOpts = {}): Promise<number> {
  if (opts.json && opts.verbose) {
    throw new Error("Use only one of --json and --verbose.");
  }

  const root = await resolveToolRoot();
  const target = context.files.actions ? "Actions.txt" : "*.txt";
  const identifiers = inferRequiredContext(context);

  // 1. Preflight remote fetch and baseline guard
  const fetchScript = path.join(root, "resources", "cli-tools", "fetch_actions_from_cognitive.py");
  const remoteSidecarPath = path.join(context.cwd, ".frida-rpa", "remote", "Actions.remote.txt");
  const fetchArgs = [
    fetchScript,
    "--dir", context.cwd,
    "--process-id", `${identifiers.processId}`,
    "--step", `${identifiers.step}`,
    "--out-file", remoteSidecarPath,
  ];

  const fetchRes = await runPython(context.cwd, fetchArgs);
  if (fetchRes.exitCode !== 0) {
    writeToolOutput(fetchRes);
    throw new Error(`Cognitive push preflight failed: could not fetch remote Actions.txt (exit code ${fetchRes.exitCode}).`);
  }

  let remoteHash: string;
  let localHash: string;
  try {
    remoteHash = await computeFileHash(remoteSidecarPath);
  } catch (err: unknown) {
    throw new Error(`Cognitive push preflight failed: could not hash fetched remote file: ${String(err)}`);
  }
  try {
    localHash = await computeFileHash(path.join(context.cwd, "Actions.txt"));
  } catch (err: unknown) {
    // If local Actions.txt is missing, inferRequiredContext usually wouldn't have succeeded if we require it, 
    // but fridaTools relies on target existing.
    localHash = "";
  }

  const baseline = await readBaseline(context.cwd);
  const baselineHash = baseline?.processId === identifiers.processId && baseline?.step === identifiers.step
    ? baseline.files["Actions.txt"]?.sha256
    : undefined;

  if (remoteHash === baselineHash) {
    if (localHash === remoteHash) {
      if (opts.json) {
        process.stdout.write(JSON.stringify({ ok: true, status: "noop", message: "No changes to upload" }, null, 2) + "\n");
        return 0;
      }
      process.stdout.write("frida-rpa: push\n\nNo changes to upload. Local Actions.txt matches remote.\n");
      return 0;
    }
  } else if (localHash === remoteHash) {
    if (opts.json) {
      process.stdout.write(JSON.stringify({ ok: true, status: "noop", message: "No changes to upload" }, null, 2) + "\n");
      return 0;
    }
    process.stdout.write("frida-rpa: push\n\nNo changes to upload. Local Actions.txt matches remote.\n");
    await updateBaselineFile(context.cwd, identifiers.processId, identifiers.step, "Actions.txt", { hash: remoteHash }, "pull");
    return 0;
  } else {
    const blockMessage = !baselineHash
      ? "No local baseline exists and remote differs from local. Please run `frida-rpa pull --backup` or review the changes manually before pushing."
      : "Cognitive Actions.txt changed since the last local pull/push.";
    
    if (opts.json) {
      process.stdout.write(JSON.stringify({
        ok: false,
        error: "Push blocked due to remote drift.",
        blockReason: blockMessage,
        localFile: path.join(context.cwd, "Actions.txt"),
        remoteFile: remoteSidecarPath
      }, null, 2) + "\n");
      return 1; // Error exit code since json error is emitted
    }
    
    process.stderr.write(
      `frida-rpa: push blocked\nReason: ${blockMessage}\n\n` +
      `Local file:  ${path.join(context.cwd, "Actions.txt")}\n` +
      `Remote copy: ${remoteSidecarPath}\n\n` +
      `Review the diff, resolve Actions.txt manually, then run frida-rpa push again.\n`
    );
    throw new Error("Push blocked due to remote drift.");
  }

  // 2. Format / check / fix (Linting pipeline)
  const lintScript = path.join(root, "resources", "cli-tools", "frida_lint.py");

  printResult("format", await runPython(context.cwd, [lintScript, "--follow-scripts", "format", target]));
  const checkFixArgs = [lintScript, "--follow-scripts", "check", target, "--fix"];
  if (opts.unsafeFixes) checkFixArgs.push("--unsafe-fixes");
  const checkFix = await runPython(context.cwd, checkFixArgs);
  writeToolOutput(checkFix);
  printResult("format", await runPython(context.cwd, [lintScript, "--follow-scripts", "format", target]));
  const verify = await runPython(context.cwd, [lintScript, "--follow-scripts", "check", target, "--json"]);
  const { diagnostics, parseError } = parseLintCheckJson(verify.stdout);
  if (verify.exitCode !== 0 && !verify.stdout.trim()) {
    process.stdout.write(verify.stdout);
    process.stderr.write(verify.stderr);
    throw new Error("Push blocked: lint check failed (no JSON output from frida_lint).");
  }
  if (parseError) {
    process.stdout.write(verify.stdout);
    process.stderr.write(verify.stderr);
    throw new Error(`Push blocked: could not parse lint output (${parseError})`);
  }
  if (hasLintErrorSeverity(diagnostics)) {
    process.stdout.write(verify.stdout);
    if (!verify.stdout.endsWith("\n")) process.stdout.write("\n");
    process.stderr.write(verify.stderr);
    throw new Error("Push blocked because lint reports one or more errors.");
  }
  if (opts.verbose) {
    if (opts.json && verify.stdout.trim()) {
      process.stdout.write(verify.stdout);
      if (!verify.stdout.endsWith("\n")) process.stdout.write("\n");
    } else if (!opts.json && diagnostics.length > 0) {
      process.stdout.write(
        `frida-rpa: final check has ${diagnostics.length} non-error lint issue(s) (e.g. warnings). Push is not blocked. Use \`frida-rpa lint --json\` for details.\n`,
      );
    }
  }

  // 3. Lease verification right before upload
  const leaseRes = await runPython(context.cwd, fetchArgs);
  if (leaseRes.exitCode !== 0) {
    throw new Error("Push blocked: lease check failed (could not re-fetch remote Actions.txt).");
  }
  const leaseHash = await computeFileHash(remoteSidecarPath);
  if (leaseHash !== remoteHash) {
    throw new Error("Push blocked: Cognitive Actions.txt was modified by another user during the push process.");
  }

  await ensureCognitiveSyncCompanionFiles(context.cwd);

  const syncScript = path.join(root, "resources", "cli-tools", "sync_actions_to_cognitive.py");
  const syncArgs = [syncScript, "--dir", context.cwd, "--process-id", `${identifiers.processId}`, "--step", `${identifiers.step}`];
  if (opts.dryRun) {
    syncArgs.push("--dry-run");
  }
  if (opts.verbose) {
    syncArgs.push("--verbose");
  } else {
    syncArgs.push("--json");
  }

  const syncRes = await runPython(context.cwd, syncArgs);
  if (syncRes.exitCode !== 0) {
    writeToolOutput(syncRes);
    throw new Error(`Cognitive sync failed with exit code ${syncRes.exitCode}.`);
  }
  if (syncRes.stderr.trim()) {
    process.stderr.write(syncRes.stderr);
    if (!syncRes.stderr.endsWith("\n")) {
      process.stderr.write("\n");
    }
  }

  if (opts.verbose) {
    if (syncRes.stdout.trim()) {
      process.stdout.write(syncRes.stdout);
      if (!syncRes.stdout.endsWith("\n")) process.stdout.write("\n");
    }
    return 0;
  }

  const syncParsed = parseCognitiveSyncJson(syncRes.stdout);
  if (!syncParsed.ok) {
    writeToolOutput(syncRes);
    throw new Error(`Cognitive sync returned unparseable JSON: ${syncParsed.error}`);
  }

  // 4. Update baseline to the actual uploaded text
  if (!opts.dryRun) {
    try {
      const postSyncFetch = await runPython(context.cwd, fetchArgs);
      if (postSyncFetch.exitCode === 0) {
        const postPushHash = await computeFileHash(remoteSidecarPath);
        await updateBaselineFile(context.cwd, identifiers.processId, identifiers.step, "Actions.txt", { hash: postPushHash }, "push");
      }
    } catch (err: unknown) {
      process.stderr.write(`frida-rpa: warning: could not save post-push baseline: ${String(err)}\n`);
    }
  }

  if (opts.json) {
    let lintData: unknown;
    try {
      lintData = JSON.parse(verify.stdout.trim() || "[]");
    } catch {
      lintData = [];
    }
    process.stdout.write(
      JSON.stringify(
        { lint: lintData, sync: syncParsed.value },
        null,
        2,
      ) + "\n",
    );
    return 0;
  }

  process.stdout.write(
    formatPushUserSummary(
      diagnostics,
      identifiers.processId,
      syncParsed.value,
    ),
  );
  return 0;
}

export async function runPull(context: FridaContext, opts: PullOpts = {}): Promise<number> {
  const root = await resolveToolRoot();
  const identifiers = inferRequiredContext(context);
  const args = [
    path.join(root, "resources", "cli-tools", "fetch_actions_from_cognitive.py"),
    "--dir",
    context.cwd,
    "--process-id",
    `${identifiers.processId}`,
    "--step",
    `${identifiers.step}`,
  ];
  if (opts.backup) {
    args.push("--backup");
  }
  if (opts.dryRun) {
    args.push("--dry-run");
  }
  if (opts.force) {
    // reserved for future behavior; no script flag today.
  }
  printResult("pull", await runPython(context.cwd, args));

  if (!opts.dryRun) {
    try {
      const actionsPath = path.join(context.cwd, "Actions.txt");
      const hash = await computeFileHash(actionsPath);
      await updateBaselineFile(context.cwd, identifiers.processId, identifiers.step, "Actions.txt", { hash }, "pull");
    } catch (err: unknown) {
      process.stderr.write(`frida-rpa: warning: could not save pull baseline: ${String(err)}\n`);
    }
  }

  return 0;
}

export async function runLogs(context: FridaContext, opts: LogsOpts): Promise<number> {
  const root = await resolveToolRoot();
  const listScript = path.join(root, "resources", "cli-tools", "cognitive_list_logs.py");
  const downloadScript = path.join(root, "resources", "cli-tools", "cognitive_download_log.py");
  const commonArgs = ["--process-id", `${opts.processId}`, "--user-email", opts.userEmail];

  if (opts.action === "list") {
    const args = [listScript, ...commonArgs];
    if (opts.runId) args.push("--run-id", opts.runId);
    if (opts.limit !== undefined) args.push("--limit", `${opts.limit}`);
    if (opts.json) args.push("--json");
    const result = await runPython(context.cwd, args);
    if (opts.json) {
      process.stdout.write(result.stdout);
      return result.exitCode === 0 ? 0 : 1;
    }
    printResult("logs list", result);
    return 0;
  }

  const args = [downloadScript, ...commonArgs];
  if (opts.action === "get") {
    if (!opts.runId) {
      throw new Error("logs get requires --run-id");
    }
    args.push("--run-id", opts.runId);
  } else {
    args.push("--run-id", opts.runId ?? "latest");
  }
  if (opts.fileName) args.push("--file", opts.fileName);
  if (opts.outDir) args.push("--out-dir", opts.outDir);
  if (opts.json) args.push("--json");
  const result = await runPython(context.cwd, args);
  if (opts.json) {
    process.stdout.write(result.stdout);
    return result.exitCode === 0 ? 0 : 1;
  }
  printResult(`logs ${opts.action}`, result);
  return 0;
}
