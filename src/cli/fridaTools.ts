import * as fs from "node:fs/promises";
import * as path from "node:path";
import { spawn } from "node:child_process";
import type { FridaContext } from "./context";

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

interface PushOpts extends FixOpts {
  dryRun?: boolean;
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
 * Lists each non-error diagnostic with code, location, and message (2 lines per issue).
 */
export function formatRemainingDiagnosticsSummary(diagnostics: LintDiagnostic[]): string {
  return diagnostics
    .map((d) => `  ${d.code}  ${formatDiagnosticLocation(d)}\n  ${d.message}`)
    .join("\n\n");
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
  const hasW004 = unsafe.some((d) => d.code === "W004");
  const lines: string[] = [
    "Why it was not changed automatically:",
  ];
  if (hasW004) {
    lines.push(
      "  For W004, the unsafe fix comments out or removes systemnotify, which can change whether an",
      "  OS confirmation window appears, so the linter will not do that unless you run with",
      "  --unsafe-fixes and review the result.",
    );
  } else {
    lines.push(
      "  These auto-fixes are marked unsafe because they may change script meaning or what the end user sees.",
    );
  }
  lines.push(
    "",
    "Choose one:",
    "  frida-rpa fix --unsafe-fixes         Apply those unsafe auto-fixes (then review the diff in git)",
    "  Add ## noqa: <CODE> on the line  Keep the line intentionally; suppress the rule for that line",
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
    formatNonErrorCountsLine(diagnostics),
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
  const args = [path.join(root, ".cursor", "tools", "frida_lint.py"), "rules"];
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
    path.join(root, ".cursor", "tools", "frida_lint.py"),
    "--follow-scripts",
    "check",
    target,
    "--json",
  ];
  const result = await runPython(context.cwd, args);
  if (opts.json) {
    process.stdout.write(result.stdout);
  } else {
    printResult("lint", result);
  }
  return result.exitCode === 0 ? 0 : 1;
}

export async function runFix(context: FridaContext, opts: FixOpts = {}): Promise<number> {
  const root = await resolveToolRoot();
  const target = context.files.actions ? "Actions.txt" : "*.txt";
  const script = path.join(root, ".cursor", "tools", "frida_lint.py");

  printResult("format", await runPython(context.cwd, [script, "--follow-scripts", "format", target]));
  const checkFixArgs = [script, "--follow-scripts", "check", target, "--fix"];
  if (opts.unsafeFixes) checkFixArgs.push("--unsafe-fixes");
  const checkFix = await runPython(context.cwd, checkFixArgs);
  writeToolOutput(checkFix);
  printResult("format", await runPython(context.cwd, [script, "--follow-scripts", "format", target]));
  const verify = await runPython(context.cwd, [script, "--follow-scripts", "check", target, "--json"]);
  const { diagnostics, parseError } = parseLintCheckJson(verify.stdout);
  if (verify.exitCode !== 0 && !verify.stdout.trim()) {
    writeToolOutput(verify);
    return 1;
  }
  if (parseError) {
    process.stderr.write(`frida-rpa error: could not parse lint JSON: ${parseError}\n`);
    writeToolOutput(verify);
    return 1;
  }
  if (hasLintErrorSeverity(diagnostics)) {
    if (opts.json && verify.stdout.trim()) {
      process.stdout.write(verify.stdout);
      if (!verify.stdout.endsWith("\n")) process.stdout.write("\n");
    } else {
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
  }
  return 0;
}

export async function runPush(context: FridaContext, opts: PushOpts = {}): Promise<number> {
  const root = await resolveToolRoot();
  const target = context.files.actions ? "Actions.txt" : "*.txt";
  const lintScript = path.join(root, ".cursor", "tools", "frida_lint.py");

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
  if (opts.json) {
    if (verify.stdout.trim()) {
      process.stdout.write(verify.stdout);
      if (!verify.stdout.endsWith("\n")) process.stdout.write("\n");
    }
  } else if (diagnostics.length > 0) {
    process.stdout.write(
      `frida-rpa: final check has ${diagnostics.length} non-error lint issue(s) (e.g. warnings). Push is not blocked. Use \`frida-rpa lint --json\` for details.\n`,
    );
  }

  await ensureCognitiveSyncCompanionFiles(context.cwd);

  const identifiers = inferRequiredContext(context);
  const syncArgs = [
    path.join(root, ".cursor", "tools", "sync_actions_to_cognitive.py"),
    "--dir",
    context.cwd,
    "--process-id",
    `${identifiers.processId}`,
    "--step",
    `${identifiers.step}`,
  ];
  if (opts.dryRun) {
    syncArgs.push("--dry-run");
  }
  printResult("sync", await runPython(context.cwd, syncArgs));
  return 0;
}

export async function runPull(context: FridaContext, opts: PullOpts = {}): Promise<number> {
  const root = await resolveToolRoot();
  const identifiers = inferRequiredContext(context);
  const args = [
    path.join(root, ".cursor", "tools", "fetch_actions_from_cognitive.py"),
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
  return 0;
}

export async function runLogs(context: FridaContext, opts: LogsOpts): Promise<number> {
  const root = await resolveToolRoot();
  const listScript = path.join(root, ".cursor", "tools", "cognitive_list_logs.py");
  const downloadScript = path.join(root, ".cursor", "tools", "cognitive_download_log.py");
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
