#!/usr/bin/env node
import { existsSync, statSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { detectEditor, EditorName, openWorkspaceInEditor } from "./cli/launch";
import { ensureWorkspaceSettings, SettingsResult } from "./cli/settings";
import { detectFridaContext, formatContextSummary, FridaContext } from "./cli/context";
import { renderBanner, renderPrompt, renderStatusPanel } from "./cli/ui";
import { createMaskedPrompt, getStoredSession, handleLoginFlow, handleLogoutFlow, SessionStoreResult } from "./cli/auth";
import { runFix, runLint, runLintRulesInfo, runLogs, runPull, runPush } from "./cli/fridaTools";
import { formatAgentsResultMessage, runAgentsImport } from "./cli/agents";

export type CliCommand = "interactive" | "open" | "status" | "login" | "logout" | "lint" | "fix" | "push" | "sync" | "pull" | "logs" | "agents" | "help";
export type LogsAction = "list" | "latest" | "get";

export interface CliOptions {
  command: CliCommand;
  logsAction?: LogsAction;
  workspaceArg?: string;
  editor?: EditorName;
  patterns?: string[];
  settingsSource?: string;
  settingsMode: "merge" | "replace";
  dryRun: boolean;
  noDevHost: boolean;
  help: boolean;
  init: boolean;
  json: boolean;
  processId?: number;
  step?: number;
  userEmail?: string;
  runId?: string;
  fileName?: string;
  outDir?: string;
  limit?: number;
  backup: boolean;
  force: boolean;
  /** When true, `fix` and `push` run `frida_lint check --fix --unsafe-fixes` (behavior-changing auto-fixes). */
  unsafeFixes: boolean;
  helpTopic?: string;
  /** `lint info` / `lint rules` — print documented frida_lint rule catalog (no process folder required). */
  lintAction?: "check" | "info";
}

export interface CliRunResult {
  workspacePath: string;
  settings: SettingsResult;
  editorName: EditorName;
  dryRun: boolean;
  devHostEnabled: boolean;
  extensionDevPath?: string;
  initRequested: boolean;
}

type CommandDoc = {
  purpose: string;
  flags: Array<{ name: string; description: string }>;
  notes?: string[];
  examples: string[];
};

type PromptQuestion = (prompt: string) => Promise<string>;
type InteractiveDisposition = "continue" | "exit";
type RunCommandHooks = {
  question?: PromptQuestion;
  maskedQuestion?: PromptQuestion;
};

const HELP_ORDER: CliCommand[] = ["open", "status", "login", "logout", "lint", "fix", "push", "sync", "pull", "logs", "agents", "help"];
const COMMAND_HELP: Record<CliCommand, CommandDoc> = {
  interactive: {
    purpose: "Start interactive shell (default when no command is passed).",
    flags: [],
    examples: ["frida-rpa"],
  },
  open: {
    purpose: "Prepare FRIDA workspace settings and open folder in editor.",
    flags: [
      { name: "--editor <code|cursor>", description: "Choose editor command." },
      { name: "--patterns <csv>", description: "Set frida.filePatterns values." },
      { name: "--settings-source <path>", description: "Use template settings JSON." },
      { name: "--settings-mode <merge|replace>", description: "Merge into or replace workspace settings." },
      { name: "--dry-run", description: "Preview actions without writing/opening." },
      { name: "--no-dev-host", description: "Skip extension development host mode." },
      { name: "--init", description: "Reserved for future behavior." },
    ],
    examples: ["frida-rpa open", "frida-rpa open .", "frida-rpa open C:/FRIDA/Local/1555960/0 --editor cursor"],
  },
  status: {
    purpose: "Show detected folder context, files, and auth state.",
    flags: [
      { name: "--process-id <n>", description: "Override inferred process id." },
      { name: "--step <n>", description: "Override inferred step index." },
      { name: "--json", description: "Emit machine-readable JSON." },
      { name: "[path]", description: "FRIDA process folder; default is current directory." },
    ],
    examples: ["frida-rpa status", "frida-rpa status C:/FRIDA/TuringExpo/Local/1444065/0", "frida-rpa status --json"],
  },
  login: {
    purpose: "Verify Cognitive credentials and store a local session for later commands.",
    flags: [],
    notes: [
      "The password is sent to Cognitive/Firebase for verification.",
      "On success, non-secret metadata is stored at ~/.frida-rpa/session.json and the password is stored in the OS secure credential store.",
      "Credentials remain available until you run logout.",
    ],
    examples: ["frida-rpa login"],
  },
  logout: {
    purpose: "Clear locally stored session credentials.",
    flags: [],
    examples: ["frida-rpa logout"],
  },
  lint: {
    purpose: "Run lint on Actions.txt and RunScript targets, or show documented lint rule list (lint info).",
    flags: [
      { name: "info|rules", description: "Print all frida_lint rule codes and help (no workspace required)." },
      { name: "--process-id <n>", description: "Override inferred process id." },
      { name: "--step <n>", description: "Override inferred step index." },
      { name: "--json", description: "For check: diagnostics JSON. For info: rule catalog JSON." },
      { name: "[path]", description: "FRIDA process folder for `lint` check; default is current directory." },
    ],
    notes: [
      "Does not modify files.",
      "`frida-rpa lint info` and `frida-rpa lint rules` are aliases; they run `frida_lint.py rules` from the extension install.",
    ],
    examples: [
      "frida-rpa lint",
      "frida-rpa lint C:/FRIDA/TuringExpo/Local/1444065/0",
      "frida-rpa lint --json",
      "frida-rpa lint info",
      "frida-rpa lint info --json",
    ],
  },
  fix: {
    purpose: "Run format + safe fixes + final lint verification.",
    flags: [
      { name: "--json", description: "Emit machine-readable verification output." },
      { name: "--unsafe-fixes", description: "Also apply behavior-changing (unsafe) linter auto-fixes." },
      { name: "--process-id <n>", description: "Override inferred process id." },
      { name: "--step <n>", description: "Override inferred step index." },
      { name: "[path]", description: "FRIDA process folder; default is current directory." },
    ],
    notes: [
      "Applies safe fixes by default. Unsafe fixes (e.g. W004) require --unsafe-fixes or manual edit / ## noqa.",
    ],
    examples: [
      "frida-rpa fix",
      "frida-rpa fix C:/FRIDA/TuringExpo/Local/1444065/0",
      "frida-rpa fix --unsafe-fixes",
    ],
  },
  push: {
    purpose: "Run lint-safe pipeline and sync to Cognitive when clean.",
    flags: [
      { name: "--dry-run", description: "Run checks and print sync payloads without upload." },
      { name: "--json", description: "Emit machine-readable command output where supported." },
      { name: "--unsafe-fixes", description: "Run check --fix with unsafe auto-fixes before the final check." },
      { name: "--process-id <n>", description: "Override inferred process id." },
      { name: "--step <n>", description: "Override inferred step index." },
      { name: "[path]", description: "Folder with Actions.txt (TuringExpo/Local/<id>/<step>); default is current directory." },
    ],
    notes: [
      "Pipeline: format -> check --fix -> format -> check --json -> upload.",
      "Upload is blocked when the final check reports at least one error-severity issue (warnings do not block).",
      "Sync uploads from the given folder (or cwd); use the path if you are not already cd'd into the process folder.",
    ],
    examples: [
      "frida-rpa push",
      "frida-rpa push C:/FRIDA/TuringExpo/Local/1444065/0",
      "frida-rpa push --dry-run",
    ],
  },
  sync: {
    purpose: "Alias for push.",
    flags: [{ name: "(same as push)", description: "Supports the same flags and behavior." }],
    examples: ["frida-rpa sync"],
  },
  pull: {
    purpose: "Fetch remote Actions.txt for inferred process/step.",
    flags: [
      { name: "--backup", description: "Create Actions.txt.bak before overwrite." },
      { name: "--force", description: "Allow non-interactive overwrite mode." },
      { name: "--dry-run", description: "Preview pull action only." },
      { name: "--process-id <n>", description: "Override inferred process id." },
      { name: "--step <n>", description: "Override inferred step index." },
      { name: "--json", description: "Emit machine-readable output where supported." },
      { name: "[path]", description: "Local folder to write Actions.txt; default is current directory." },
    ],
    examples: [
      "frida-rpa pull --backup",
      "frida-rpa pull C:/FRIDA/TuringExpo/Local/1444065/0 --backup",
      "frida-rpa pull --process-id 1555960 --step 0",
    ],
  },
  agents: {
    purpose: "Import AGENTS.md and agent-docs/ FRIDA context into the current workspace.",
    flags: [
      { name: "--dry-run", description: "List planned file actions without writing." },
      { name: "--force", description: "Overwrite existing AGENTS.md and bundled agent-doc files." },
      { name: "--backup", description: "Before overwrite, copy existing files to .bak-<timestamp> next to the target." },
      { name: "--json", description: "Emit machine-readable import result." },
    ],
    notes: [
      "By default, existing AGENTS.md and existing files under agent-docs/ are not overwritten; use --force to replace them.",
    ],
    examples: [
      "frida-rpa agents",
      "frida-rpa agents C:/path/to/workspace",
      "frida-rpa agents --dry-run",
      "frida-rpa agents --force --backup",
    ],
  },
  logs: {
    purpose: "List and download Cognitive run logs via network requests.",
    flags: [
      { name: "list|latest|get", description: "Logs action (default: list)." },
      { name: "--process-id <n>", description: "Override inferred process id." },
      { name: "--user-email <email>", description: "Cognitive user email folder (defaults to session email)." },
      { name: "--run-id <id|latest>", description: "Run folder id for get/list details." },
      { name: "--file <name>", description: "Specific file in Result folder (default: newest log-*.txt)." },
      { name: "--out-dir <path>", description: "Download root directory (default: logs)." },
      { name: "--limit <n>", description: "Max runs returned by list (default: 20)." },
      { name: "--json", description: "Emit machine-readable output." },
    ],
    notes: [
      "Downloads are saved under <out-dir>/<processId>/<runId>/<fileName>.",
      "Uses captured Cloud Function endpoints; does not require Microsoft login flow.",
    ],
    examples: [
      "frida-rpa logs list",
      "frida-rpa logs latest --process-id 1555960",
      "frida-rpa logs get --run-id 2026041622085624 --file ERROR.txt",
    ],
  },
  help: {
    purpose: "Show global help or command-specific help.",
    flags: [],
    examples: ["frida-rpa --help", "frida-rpa help push", "help pull (inside interactive shell)"],
  },
};

export function renderGlobalHelp(): string {
  const lines: string[] = [
    "frida-rpa [command] [options]",
    "",
    "Daily workflow: status -> lint -> fix -> push/pull",
    "",
    "Commands:",
  ];
  for (const command of HELP_ORDER) {
    lines.push(`  ${command.padEnd(8)} ${COMMAND_HELP[command].purpose}`);
  }
  lines.push(
    "",
    "Flag groups:",
    "  Editor/workspace: --editor --patterns --settings-source --settings-mode --no-dev-host --init",
    "  Runtime/safety:   --process-id --step --json --unsafe-fixes --dry-run --backup --force",
    "",
    "Examples:",
    "  frida-rpa open .",
    "  frida-rpa status",
    "  frida-rpa help push",
    "",
    "Interactive shell:",
    "  Type exit or quit to close frida-rpa >",
  );
  return lines.join("\n");
}

function normalizeHelpTopic(topic?: string): CliCommand | null {
  if (!topic) return null;
  const normalized = topic.toLowerCase();
  if (HELP_ORDER.includes(normalized as CliCommand)) return normalized as CliCommand;
  return null;
}

export function renderCommandHelp(command: CliCommand): string {
  const doc = COMMAND_HELP[command];
  const lines = [
    `${command}`,
    "",
    `Purpose: ${doc.purpose}`,
  ];
  if (doc.flags.length > 0) {
    lines.push("", "Flags:");
    for (const flag of doc.flags) {
      lines.push(`  ${flag.name.padEnd(24)} ${flag.description}`);
    }
  }
  if (doc.notes && doc.notes.length > 0) {
    lines.push("", "Notes:");
    for (const note of doc.notes) {
      lines.push(`  - ${note}`);
    }
  }
  lines.push("", "Examples:");
  for (const example of doc.examples) {
    lines.push(`  ${example}`);
  }
  return lines.join("\n");
}

export function formatCliError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `frida-rpa error: ${message}`;
}

export function commandRequiresLogin(command: CliCommand): boolean {
  const loginRequiredCommands = new Set<CliCommand>([]);
  return loginRequiredCommands.has(command);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function resolveExtensionDevPath(): Promise<string> {
  const candidateRoots = [path.resolve(__dirname, ".."), process.cwd()];
  for (const root of candidateRoots) {
    const packagePath = path.join(root, "package.json");
    if (!(await pathExists(packagePath))) continue;
    const packageRaw = await fs.readFile(packagePath, "utf8");
    const packageJson = JSON.parse(packageRaw) as { name?: string };
    if (packageJson.name === "frida-editor-tools") return root;
  }
  throw new Error("Could not determine extension path.");
}

export async function resolveWorkspacePath(inputPath?: string): Promise<string> {
  const resolved = path.resolve(inputPath ?? process.cwd());
  const stat = await fs.stat(resolved).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") throw new Error(`Workspace path does not exist: ${resolved}`);
    throw error;
  });
  if (!stat.isDirectory()) throw new Error(`Workspace path is not a directory: ${resolved}`);
  return resolved;
}

function parseIntFlag(name: string, value: string | undefined): number {
  if (!value || !/^\d+$/.test(value)) throw new Error(`${name} requires a numeric value`);
  return Number(value);
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    command: "interactive",
    settingsMode: "merge",
    dryRun: false,
    noDevHost: false,
    help: false,
    init: false,
    json: false,
    backup: false,
    force: false,
    unsafeFixes: false,
  };

  let index = 0;
  let explicitCommand: CliCommand | undefined;
  const maybeCommand = argv[0];
    if (maybeCommand && !maybeCommand.startsWith("-")) {
    const normalized = maybeCommand.toLowerCase();
    if (["open", "status", "login", "logout", "lint", "fix", "push", "sync", "pull", "logs", "agents", "help"].includes(normalized)) {
      options.command = normalized as CliCommand;
      explicitCommand = options.command;
      index = 1;
    } else {
      options.command = "open";
      options.workspaceArg = maybeCommand;
      index = 1;
    }
  }

  for (; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("-")) {
      if (options.command === "help" && !options.helpTopic) {
        options.helpTopic = token;
        continue;
      }
      if (options.command === "logs" && !options.logsAction) {
        if (!["list", "latest", "get"].includes(token.toLowerCase())) {
          throw new Error(`Unknown logs action: ${token}. Use list, latest, or get.`);
        }
        options.logsAction = token.toLowerCase() as LogsAction;
        continue;
      }
      if (options.command === "lint" && !options.lintAction) {
        const sub = token.toLowerCase();
        if (sub === "info" || sub === "rules") {
          options.lintAction = "info";
          continue;
        }
      }
      if (!options.workspaceArg) {
        options.workspaceArg = token;
        continue;
      }
      throw new Error(`Unexpected argument: ${token}`);
    }
    if (token === "--help" || token === "-h") {
      options.help = true;
      if (explicitCommand && explicitCommand !== "help") options.helpTopic = explicitCommand;
      options.command = "help";
      continue;
    }
    if (token === "--dry-run") { options.dryRun = true; continue; }
    if (token === "--no-dev-host") { options.noDevHost = true; continue; }
    if (token === "--init") { options.init = true; continue; }
    if (token === "--json") { options.json = true; continue; }
    if (token === "--unsafe-fixes") { options.unsafeFixes = true; continue; }
    if (token === "--backup") { options.backup = true; continue; }
    if (token === "--force") { options.force = true; continue; }
    if (token === "--editor") { const n = argv[index + 1]; if (n !== "cursor" && n !== "code") throw new Error("--editor requires one value: code or cursor"); options.editor = n; index += 1; continue; }
    if (token === "--patterns") { const n = argv[index + 1]; if (!n) throw new Error("--patterns requires a comma-separated list"); options.patterns = n.split(",").map((e) => e.trim()).filter((e) => e); index += 1; continue; }
    if (token === "--settings-source") { const n = argv[index + 1]; if (!n) throw new Error("--settings-source requires a file path"); options.settingsSource = n; index += 1; continue; }
    if (token === "--settings-mode") { const n = argv[index + 1]; if (n !== "merge" && n !== "replace") throw new Error("--settings-mode requires one value: merge or replace"); options.settingsMode = n; index += 1; continue; }
    if (token === "--process-id") { options.processId = parseIntFlag("--process-id", argv[index + 1]); index += 1; continue; }
    if (token === "--step") { options.step = parseIntFlag("--step", argv[index + 1]); index += 1; continue; }
    if (token === "--limit") { options.limit = parseIntFlag("--limit", argv[index + 1]); index += 1; continue; }
    if (token === "--user-email") { const n = argv[index + 1]; if (!n) throw new Error("--user-email requires a value"); options.userEmail = n; index += 1; continue; }
    if (token === "--run-id") { const n = argv[index + 1]; if (!n) throw new Error("--run-id requires a value"); options.runId = n; index += 1; continue; }
    if (token === "--file") { const n = argv[index + 1]; if (!n) throw new Error("--file requires a value"); options.fileName = n; index += 1; continue; }
    if (token === "--out-dir") { const n = argv[index + 1]; if (!n) throw new Error("--out-dir requires a value"); options.outDir = n; index += 1; continue; }
    throw new Error(`Unknown option: ${token}`);
  }

  return options;
}

export function shouldUseDevHost(_workspacePath: string, options: CliOptions, extensionRepoPath?: string): boolean {
  return !options.noDevHost && !!extensionRepoPath;
}

export function formatCliResult(result: CliRunResult): string {
  const lines = [
    `Workspace: ${result.workspacePath}`,
    `Editor: ${result.editorName}`,
    `Launch mode: ${result.devHostEnabled ? "extension-development-host" : "normal-window"}`,
    `Settings mode: ${result.settings.mode}`,
    result.settings.sourcePath ? `Settings source: ${result.settings.sourcePath}` : "Settings source: none",
    result.settings.changed ? `Updated: ${result.settings.settingsPath}` : `No settings changes needed: ${result.settings.settingsPath}`,
    `frida.filePatterns: [${result.settings.afterPatterns.join(", ")}]`,
  ];
  if (result.devHostEnabled && result.extensionDevPath) lines.push(`Extension development path: ${result.extensionDevPath}`);
  if (result.dryRun) lines.push("Dry run only: no files were modified and editor was not opened.");
  if (result.initRequested) lines.push("--init is reserved for future scaffolding and currently does nothing.");
  return lines.join("\n");
}

async function runOpen(options: CliOptions): Promise<number> {
  const workspacePath = await resolveWorkspacePath(options.workspaceArg ?? ".");
  let extensionRepoPath: string | undefined;
  try { extensionRepoPath = await resolveExtensionDevPath(); } catch { extensionRepoPath = undefined; }

  let defaultSettingsSource: string | undefined;
  if (extensionRepoPath) {
    const candidate = path.join(extensionRepoPath, ".vscode", "settings.json");
    if (await pathExists(candidate)) defaultSettingsSource = candidate;
  }
  const settings = await ensureWorkspaceSettings(workspacePath, {
    patterns: options.patterns, sourcePath: options.settingsSource ?? defaultSettingsSource, mode: options.settingsMode, dryRun: options.dryRun,
  });
  const devHostEnabled = shouldUseDevHost(workspacePath, options, extensionRepoPath);
  const editor = await detectEditor(options.editor, undefined, { defaultEditor: "code", strictDefault: true });
  if (!options.dryRun) await openWorkspaceInEditor(editor, workspacePath, { extensionDevelopmentPath: devHostEnabled ? extensionRepoPath : undefined });
  process.stdout.write(`${formatCliResult({ workspacePath, settings, editorName: editor.name, dryRun: options.dryRun, devHostEnabled, extensionDevPath: devHostEnabled ? extensionRepoPath : undefined, initRequested: options.init })}\n`);
  return 0;
}

/**
 * FRIDA process folder: cwd, or an explicit path when provided (e.g. `frida-rpa push C:\FRIDA\...\0`).
 * Overrides must still point at an existing directory so sync/lint use the right files.
 */
function resolveContextCwd(options: CliOptions): string {
  const base = options.workspaceArg ? path.resolve(options.workspaceArg) : process.cwd();
  if (options.workspaceArg) {
    if (!existsSync(base)) {
      throw new Error(`Workspace path does not exist: ${base}`);
    }
    if (!statSync(base).isDirectory()) {
      throw new Error(`Workspace path is not a directory: ${base}`);
    }
  }
  return base;
}

export function buildContext(options: CliOptions): FridaContext {
  const cwd = resolveContextCwd(options);
  const detected = detectFridaContext(cwd);
  return { ...detected, processId: options.processId ?? detected.processId, step: options.step ?? detected.step };
}

async function runStatus(options: CliOptions): Promise<number> {
  const summary = formatContextSummary(buildContext(options), await getStoredSession());
  if (options.json) process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  else process.stdout.write(`${renderStatusPanel(summary)}\n`);
  return 0;
}

async function runAgentsCommand(options: CliOptions): Promise<number> {
  const workspacePath = await resolveWorkspacePath(options.workspaceArg ?? ".");
  const result = await runAgentsImport({
    workspacePath,
    dryRun: options.dryRun,
    force: options.force,
    backup: options.backup,
    json: options.json,
  });
  process.stdout.write(formatAgentsResultMessage(result, options.json));
  return 0;
}

export async function processInteractiveLine(
  line: string,
  runParsedCommand: (options: CliOptions, hooks?: RunCommandHooks) => Promise<number>,
  hooks?: RunCommandHooks,
): Promise<InteractiveDisposition> {
  const next = line.trim();
  if (!next) return "continue";
  if (next === "exit" || next === "quit") return "exit";

  const child = parseArgs(next.split(/\s+/));
  if (child.command === "help") {
    const topic = normalizeHelpTopic(child.helpTopic);
    if (child.helpTopic && !topic) {
      process.stdout.write(`Unknown help topic: ${child.helpTopic}\nSupported: ${HELP_ORDER.join(", ")}\n`);
    } else {
      process.stdout.write(`${topic ? renderCommandHelp(topic) : renderGlobalHelp()}\n`);
    }
    return "continue";
  }
  if (child.command === "interactive") {
    process.stdout.write("Type 'help' to list available commands.\n");
    return "continue";
  }
  await runParsedCommand(child, hooks);
  return "continue";
}

export async function processInteractiveLineWithRecovery(
  line: string,
  runParsedCommand: (options: CliOptions, hooks?: RunCommandHooks) => Promise<number>,
  hooks?: RunCommandHooks,
): Promise<InteractiveDisposition> {
  try {
    return await processInteractiveLine(line, runParsedCommand, hooks);
  } catch (error: unknown) {
    process.stderr.write(`${formatCliError(error)}\n`);
    return "continue";
  }
}

async function runInteractive(options: CliOptions): Promise<number> {
  const context = buildContext(options);
  let rl = createInterface({ input, output });
  try {
    process.stdout.write(`${renderBanner()}\n`);
    process.stdout.write(`${renderStatusPanel(formatContextSummary(context, await getStoredSession()), { compact: true })}\n`);
    while (true) {
      const next = await rl.question(renderPrompt());
      const commandName = next.trim().split(/\s+/)[0]?.toLowerCase();
      let action: InteractiveDisposition;

      if (commandName === "login") {
        rl.close();
        action = await processInteractiveLineWithRecovery(next, runCommand);
        rl = createInterface({ input, output });
      } else {
        action = await processInteractiveLineWithRecovery(next, runCommand, {
          question: rl.question.bind(rl),
          maskedQuestion: createMaskedPrompt(rl),
        });
      }

      if (action === "exit") break;
    }
  } finally {
    rl.close();
  }
  return 0;
}

async function runCommand(options: CliOptions, hooks?: RunCommandHooks): Promise<number> {
  if (commandRequiresLogin(options.command)) {
    throw new Error("Not logged in. Run 'frida-rpa login' first.");
  }
  switch (options.command) {
    case "help": {
      const topic = normalizeHelpTopic(options.helpTopic);
      if (options.helpTopic && !topic) {
        throw new Error(`Unknown help topic: ${options.helpTopic}. Supported: ${HELP_ORDER.join(", ")}`);
      }
      process.stdout.write(`${topic ? renderCommandHelp(topic) : renderGlobalHelp()}\n`);
      return 0;
    }
    case "open": return runOpen(options);
    case "status": return runStatus(options);
    case "login": return handleLoginFlow(hooks?.question, hooks?.maskedQuestion);
    case "logout": return handleLogoutFlow();
    case "lint": {
      if (options.lintAction === "info") {
        return runLintRulesInfo({ json: options.json });
      }
      return runLint(buildContext(options), { json: options.json });
    }
    case "fix": return runFix(buildContext(options), { json: options.json, unsafeFixes: options.unsafeFixes });
    case "push":
    case "sync": return runPush(buildContext(options), { json: options.json, dryRun: options.dryRun, unsafeFixes: options.unsafeFixes });
    case "pull": return runPull(buildContext(options), { json: options.json, backup: options.backup, force: options.force, dryRun: options.dryRun });
    case "agents": return runAgentsCommand(options);
    case "logs": {
      const context = buildContext(options);
      if (context.processId === undefined) {
        throw new Error("Could not infer process id from folder. Use --process-id.");
      }
      const session = await getStoredSession();
      const userEmail = options.userEmail ?? session?.email ?? process.env.COGNITIVE_USER_EMAIL;
      if (!userEmail) {
        throw new Error("Could not determine Cognitive user email. Use --user-email or run login first.");
      }
      return runLogs(context, {
        action: options.logsAction ?? "list",
        processId: context.processId,
        userEmail,
        runId: options.runId,
        fileName: options.fileName,
        outDir: options.outDir,
        limit: options.limit,
        json: options.json,
      });
    }
    case "interactive": return runInteractive(options);
    default: return 1;
  }
}

function isLegacyFridaWorkInvocation(): boolean {
  return path.basename(process.argv[1] ?? "").toLowerCase().startsWith("frida-work");
}

export async function runCli(argv: string[]): Promise<number> {
  let options = parseArgs(argv);
  if (isLegacyFridaWorkInvocation()) {
    process.stderr.write("frida-work is deprecated. Use 'frida-rpa open <path>' or 'frida-rpa'.\n");
    if (argv.length === 0) options = { ...options, command: "open", workspaceArg: process.cwd() };
  }
  return runCommand(options);
}

export function getSessionFilePath(): string {
  return path.join(os.homedir(), ".frida-rpa", "session.json");
}

export type { SessionStoreResult };

if (require.main === module) {
  runCli(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${formatCliError(error)}\n`);
    process.exitCode = 1;
  });
}