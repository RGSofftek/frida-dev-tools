import * as fs from "node:fs/promises";
import * as path from "node:path";

/** Options: resolve `workspacePath` in the caller (e.g. with `resolveWorkspacePath`). */
export interface RunAgentsOptions {
  workspacePath: string;
  dryRun: boolean;
  force: boolean;
  backup: boolean;
  json: boolean;
}

export type AgentFileAction = "created" | "skipped" | "overwritten" | "would_create" | "would_skip" | "would_overwrite";
export type AgentsFileOp = { relativePath: string; action: AgentFileAction; backupPath?: string };

export interface RunAgentsResult {
  workspacePath: string;
  bundleRoot: string;
  agentsMd: { action: "created" | "skipped" | "overwritten" | "would_create" | "would_skip" | "would_overwrite"; message?: string; backupPath?: string };
  files: AgentsFileOp[];
  preservedAgentsMessage?: string;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * `out/cli/agents.js` -> `out/cli/`; two levels up is the `frida-editor-tools` root (see `out/cli.js` vs `out/cli/agents.js`).
 */
export async function resolveFridaEditorToolsRoot(): Promise<string> {
  const candidateRoots = [path.resolve(__dirname, "..", ".."), path.resolve(__dirname, ".."), process.cwd()];
  for (const root of candidateRoots) {
    const packagePath = path.join(root, "package.json");
    if (!(await pathExists(packagePath))) continue;
    const packageRaw = await fs.readFile(packagePath, "utf8");
    const packageJson = JSON.parse(packageRaw) as { name?: string };
    if (packageJson.name === "frida-editor-tools") return path.resolve(root);
  }
  throw new Error("Could not locate frida-editor-tools (missing package.json with name frida-editor-tools).");
}

async function listFilesRecursive(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await listFilesRecursive(full)));
    } else if (e.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function backupName(destPath: string, stamp: string): string {
  return `${destPath}.bak-${stamp}`;
}

export async function runAgentsImportWithPaths(
  options: { dryRun: boolean; force: boolean; backup: boolean; workspacePath: string },
  bundleRoot: string,
): Promise<RunAgentsResult> {
  const workspacePath = path.resolve(options.workspacePath);
  const srcAgents = path.join(bundleRoot, "AGENTS.md");
  const srcAgentDocs = path.join(bundleRoot, "agent-docs");

  if (!(await pathExists(srcAgents)) || !(await pathExists(srcAgentDocs))) {
    throw new Error(`Agent bundle is incomplete under ${bundleRoot} (expected AGENTS.md and agent-docs/).`);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const destAgents = path.join(workspacePath, "AGENTS.md");
  const destAgentDocsRoot = path.join(workspacePath, "agent-docs");

  const files: AgentsFileOp[] = [];
  let agentsMd: RunAgentsResult["agentsMd"];
  let preservedMessage: string | undefined;

  const srcDocFiles = await listFilesRecursive(srcAgentDocs);
  for (const srcFile of srcDocFiles) {
    const rel = path.relative(srcAgentDocs, srcFile);
    const dest = path.join(destAgentDocsRoot, rel);
    const relDisplay = `agent-docs/${rel.split(path.sep).join("/")}`;

    if (options.dryRun) {
      if (await pathExists(dest)) {
        files.push({ relativePath: relDisplay, action: options.force ? "would_overwrite" : "would_skip" });
      } else {
        files.push({ relativePath: relDisplay, action: "would_create" });
      }
      continue;
    }

    if (await pathExists(dest)) {
      if (!options.force) {
        files.push({ relativePath: relDisplay, action: "skipped" });
        continue;
      }
      let backupPath: string | undefined;
      if (options.backup) {
        backupPath = backupName(dest, stamp);
        await fs.copyFile(dest, backupPath);
      }
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.copyFile(srcFile, dest);
      files.push({ relativePath: relDisplay, action: "overwritten", backupPath });
    } else {
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.copyFile(srcFile, dest);
      files.push({ relativePath: relDisplay, action: "created" });
    }
  }

  if (options.dryRun) {
    if (await pathExists(destAgents)) {
      if (!options.force) {
        agentsMd = { action: "would_skip", message: "Existing AGENTS.md would be preserved (use --force to replace)." };
      } else {
        agentsMd = { action: "would_overwrite" };
      }
    } else {
      agentsMd = { action: "would_create" };
    }
  } else {
    if (await pathExists(destAgents)) {
      if (!options.force) {
        agentsMd = { action: "skipped" };
        preservedMessage = "Existing AGENTS.md was not modified. Copied/updated files under agent-docs/ only. Use --force to replace AGENTS.md.";
      } else {
        let agentsBackup: string | undefined;
        if (options.backup) {
          agentsBackup = backupName(destAgents, stamp);
          await fs.copyFile(destAgents, agentsBackup);
        }
        await fs.copyFile(srcAgents, destAgents);
        agentsMd = { action: "overwritten", backupPath: agentsBackup };
      }
    } else {
      await fs.copyFile(srcAgents, destAgents);
      agentsMd = { action: "created" };
    }
  }

  return {
    workspacePath,
    bundleRoot: path.resolve(bundleRoot),
    agentsMd: agentsMd!,
    files,
    preservedAgentsMessage: preservedMessage,
  };
}

export async function runAgentsImport(options: RunAgentsOptions): Promise<RunAgentsResult> {
  const root = await resolveFridaEditorToolsRoot();
  const bundleRoot = path.join(root, "resources", "agent-context");
  return runAgentsImportWithPaths(
    {
      dryRun: options.dryRun,
      force: options.force,
      backup: options.backup,
      workspacePath: path.resolve(options.workspacePath),
    },
    bundleRoot,
  );
}

export function formatAgentsResultMessage(result: RunAgentsResult, json: boolean): string {
  if (json) {
    return `${JSON.stringify(result, null, 2)}\n`;
  }
  const lines: string[] = [
    `Workspace: ${result.workspacePath}`,
    `Bundle: ${result.bundleRoot}`,
    "",
    "AGENTS.md:",
    `  ${result.agentsMd.action}` + (result.agentsMd.backupPath ? ` (backup: ${result.agentsMd.backupPath})` : ""),
  ];
  if (result.agentsMd.message) lines.push(`  ${result.agentsMd.message}`);
  if (result.preservedAgentsMessage) lines.push(`  Note: ${result.preservedAgentsMessage}`);
  lines.push("", "agent-docs/:");
  const byAction: Record<string, string[]> = {};
  for (const f of result.files) {
    if (!byAction[f.action]) byAction[f.action] = [];
    byAction[f.action]!.push(f.backupPath ? `${f.relativePath} <- ${f.backupPath}` : f.relativePath);
  }
  for (const action of Object.keys(byAction).sort()) {
    lines.push(`  ${action}:`);
    for (const p of byAction[action]!.sort()) {
      lines.push(`    - ${p}`);
    }
  }
  return lines.join("\n");
}

export interface RunAgentsImportTestOptions {
  dryRun: boolean;
  force: boolean;
  backup: boolean;
  workspacePath: string;
  bundleRoot: string;
}

export async function runAgentsImportWithBundle(options: RunAgentsImportTestOptions): Promise<RunAgentsResult> {
  return runAgentsImportWithPaths(
    {
      dryRun: options.dryRun,
      force: options.force,
      backup: options.backup,
      workspacePath: options.workspacePath,
    },
    options.bundleRoot,
  );
}
