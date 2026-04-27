import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { formatAgentsResultMessage, runAgentsImportWithPaths } from "../cli/agents";

async function createTempDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "frida-agents-test-"));
}

async function writeBundle(root: string, files: Record<string, string>): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, "utf8");
  }
}

describe("runAgentsImportWithPaths", () => {
  it("dry run reports actions and does not write files", async () => {
    const workspace = await createTempDir();
    const bundle = await createTempDir();
    try {
      await writeBundle(bundle, {
        "AGENTS.md": "# Root instructions",
        "agent-docs/one.md": "doc1",
      });

      const result = await runAgentsImportWithPaths(
        { dryRun: true, force: false, backup: false, workspacePath: workspace },
        bundle,
      );

      expect(result.agentsMd.action).toBe("would_create");
      expect(result.files.some((f) => f.action === "would_create" && f.relativePath === "agent-docs/one.md")).toBe(true);
      expect(await fs.access(path.join(workspace, "AGENTS.md")).then(
        () => true,
        () => false,
      )).toBe(false);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
      await fs.rm(bundle, { recursive: true, force: true });
    }
  });

  it("creates AGENTS.md and agent-docs files", async () => {
    const workspace = await createTempDir();
    const bundle = await createTempDir();
    try {
      await writeBundle(bundle, {
        "AGENTS.md": "# Bundle root",
        "agent-docs/one.md": "content one",
      });

      const result = await runAgentsImportWithPaths(
        { dryRun: false, force: false, backup: false, workspacePath: workspace },
        bundle,
      );

      expect(result.agentsMd.action).toBe("created");
      expect((await fs.readFile(path.join(workspace, "AGENTS.md"), "utf8")).trim()).toBe("# Bundle root");
      expect((await fs.readFile(path.join(workspace, "agent-docs", "one.md"), "utf8")).trim()).toBe("content one");
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
      await fs.rm(bundle, { recursive: true, force: true });
    }
  });

  it("skips existing AGENTS.md by default but still imports missing agent-docs", async () => {
    const workspace = await createTempDir();
    const bundle = await createTempDir();
    try {
      await writeBundle(bundle, {
        "AGENTS.md": "# From bundle",
        "agent-docs/new.md": "new doc",
      });
      await fs.writeFile(path.join(workspace, "AGENTS.md"), "# User kept", "utf8");

      const result = await runAgentsImportWithPaths(
        { dryRun: false, force: false, backup: false, workspacePath: workspace },
        bundle,
      );

      expect(result.agentsMd.action).toBe("skipped");
      expect(result.preservedAgentsMessage).toBeDefined();
      expect((await fs.readFile(path.join(workspace, "AGENTS.md"), "utf8")).trim()).toBe("# User kept");
      expect((await fs.readFile(path.join(workspace, "agent-docs", "new.md"), "utf8")).trim()).toBe("new doc");
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
      await fs.rm(bundle, { recursive: true, force: true });
    }
  });

  it("overwrites with --force and backs up with --backup", async () => {
    const workspace = await createTempDir();
    const bundle = await createTempDir();
    try {
      await writeBundle(bundle, {
        "AGENTS.md": "# New",
        "agent-docs/x.md": "v2",
      });
      await fs.writeFile(path.join(workspace, "AGENTS.md"), "# Old", "utf8");
      await fs.mkdir(path.join(workspace, "agent-docs"), { recursive: true });
      await fs.writeFile(path.join(workspace, "agent-docs", "x.md"), "v1", "utf8");

      const result = await runAgentsImportWithPaths(
        { dryRun: false, force: true, backup: true, workspacePath: workspace },
        bundle,
      );

      expect(result.agentsMd.action).toBe("overwritten");
      expect(result.agentsMd.backupPath).toBeDefined();
      expect((await fs.readFile(path.join(workspace, "AGENTS.md"), "utf8")).trim()).toBe("# New");
      const over = result.files.find((f) => f.relativePath === "agent-docs/x.md" && f.action === "overwritten");
      expect(over?.backupPath).toBeDefined();
      expect((await fs.readFile(path.join(workspace, "agent-docs", "x.md"), "utf8")).trim()).toBe("v2");
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
      await fs.rm(bundle, { recursive: true, force: true });
    }
  });

  it("formatAgentsResultMessage emits JSON when json is true", async () => {
    const workspace = await createTempDir();
    const bundle = await createTempDir();
    try {
      await writeBundle(bundle, {
        "AGENTS.md": "# X",
        "agent-docs/a.md": "a",
      });
      const result = await runAgentsImportWithPaths(
        { dryRun: true, force: false, backup: false, workspacePath: workspace },
        bundle,
      );
      const out = formatAgentsResultMessage(result, true);
      const parsed = JSON.parse(out) as { agentsMd: { action: string } };
      expect(parsed.agentsMd.action).toBe("would_create");
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
      await fs.rm(bundle, { recursive: true, force: true });
    }
  });
});
