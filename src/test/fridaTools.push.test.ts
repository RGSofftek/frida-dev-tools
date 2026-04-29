import { EventEmitter } from "node:events";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  runPush,
  parseLintCheckJson,
  hasLintErrorSeverity,
  parseCognitiveSyncJson,
  formatPushUserSummary,
} from "../cli/fridaTools";
import type { FridaContext } from "../cli/context";
import { updateBaselineFile } from "../cli/cognitiveBaseline";

const { mockSpawn } = vi.hoisted(() => {
  return { mockSpawn: vi.fn() as ReturnType<typeof vi.fn> };
});

vi.mock("node:child_process", () => ({
  spawn: mockSpawn,
}));

function emitProcessClose(
  child: { emit: (ev: string, ...a: unknown[]) => void; stdout: EventEmitter; stderr: EventEmitter },
  out: { stdout: string; stderr: string; exit: number },
): void {
  process.nextTick(() => {
    if (out.stdout) child.stdout.emit("data", Buffer.from(out.stdout));
    if (out.stderr) child.stderr.emit("data", Buffer.from(out.stderr));
    child.emit("close", out.exit);
  });
}

function makeMockChild(): { child: { emit: (ev: string, ...a: unknown[]) => void; stdout: EventEmitter; stderr: EventEmitter } } {
  const child = new EventEmitter() as unknown as { emit: (ev: string, ...a: unknown[]) => void; stdout: EventEmitter; stderr: EventEmitter };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return { child };
}

const baseContext = (fridaCwd: string): FridaContext => ({
  cwd: fridaCwd,
  processId: 1444065,
  step: 0,
  isFridaProcessFolder: true,
  files: { actions: true, datadrive: true, headers: true },
  runScriptTargets: [],
});

describe("parseLintCheckJson / hasLintErrorSeverity", () => {
  it("parses array and detects errors", () => {
    const { diagnostics } = parseLintCheckJson(
      JSON.stringify([
        { file: "a", line: 1, col: 1, code: "E001", message: "e", severity: "error" },
        { file: "b", line: 2, col: 1, code: "W004", message: "w", severity: "warning" },
      ]),
    );
    expect(diagnostics).toHaveLength(2);
    expect(hasLintErrorSeverity(diagnostics)).toBe(true);
  });

  it("returns no errors for warning-only", () => {
    const { diagnostics, parseError } = parseLintCheckJson(
      JSON.stringify([{ file: "a", line: 1, col: 1, code: "W004", message: "w", severity: "warning" }]),
    );
    expect(parseError).toBeUndefined();
    expect(hasLintErrorSeverity(diagnostics)).toBe(false);
  });

  it("reports parse error for invalid json", () => {
    const { parseError, diagnostics } = parseLintCheckJson("not json");
    expect(diagnostics).toEqual([]);
    expect(parseError).toBeDefined();
  });
});

describe("runPush (mocked python)", () => {
  beforeEach(() => {
    mockSpawn.mockReset();
  });

  it("does not throw when final check has warnings only, then runs sync", async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "frida-push-"));
    const fridaCwd = path.join(base, "TuringExpo", "Local", "test123", "0");
    await fs.mkdir(fridaCwd, { recursive: true });
    
    const remoteContent = "Line\n";
    const localContent = "Line\nEdited\n";
    await fs.writeFile(path.join(fridaCwd, "Actions.txt"), localContent, "utf8");
    await updateBaselineFile(fridaCwd, 1444065, 0, "Actions.txt", { content: remoteContent }, "pull");

    const warnJson = [
      { file: path.join(fridaCwd, "Actions.txt"), line: 4, col: 1, code: "W004", message: "notify", severity: "warning" },
    ];
    let n = 0;
    mockSpawn.mockImplementation((cmd: string, args: string[]) => {
      expect(cmd).toBe("python");
      n += 1;
      const { child } = makeMockChild();
      
      // Handle fetch_actions_from_cognitive.py (preflight, lease, post-push)
      if (String(args[0]).includes("fetch_actions_from_cognitive")) {
        const outFileIdx = args.indexOf("--out-file");
        if (outFileIdx >= 0) {
          const outFile = args[outFileIdx + 1];
          fs.mkdir(path.dirname(outFile), { recursive: true }).then(() => {
            // Post-push fetch will return localContent because sync pushed it
            // Pre-push fetch returns remoteContent
            const outContent = n > 7 ? localContent : remoteContent;
            return fs.writeFile(outFile, outContent, "utf8");
          }).then(() => {
            emitProcessClose(child, { stdout: "fetched\n", stderr: "", exit: 0 });
          });
          return child;
        }
      }

      if (String(args[0]).includes("frida_lint")) {
        const isFormat = args.includes("format");
        const isCheck = args.includes("check");
        if (isFormat) {
          emitProcessClose(child, { stdout: "", stderr: "", exit: 0 });
          return child;
        }
        if (isCheck && args.includes("--fix")) {
          emitProcessClose(child, { stdout: "out\n", stderr: "", exit: 1 });
          return child;
        }
        if (isCheck && args.includes("--json")) {
          emitProcessClose(child, { stdout: JSON.stringify(warnJson), stderr: "", exit: 1 });
          return child;
        }
      }

      if (String(args[0]).includes("sync_actions_to_cognitive")) {
        expect(args).toContain("--dry-run");
        expect(args).toContain("--json");
        expect(args).not.toContain("--verbose");
        const drySync = {
          processId: 1444065,
          step: 0,
          pathPrefix: "Processes/1444065/Steps/0",
          dryRun: true,
          files: [
            { name: "Actions.txt", byteSize: 5 },
            { name: "datadrive.txt", byteSize: 2 },
            { name: "headers.txt", byteSize: 1 },
          ],
          appUsage: { status: "skipped" as const, reason: "missing_optional_credentials" },
        };
        emitProcessClose(child, { stdout: `${JSON.stringify(drySync)}\n`, stderr: "", exit: 0 });
        return child;
      }
      
      emitProcessClose(child, { stdout: "", stderr: "", exit: 0 });
      return child;
    });
    const code = await runPush(baseContext(fridaCwd), { dryRun: true });
    expect(code).toBe(0);
  });

  it("throws when final check has an error diagnostic", async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "frida-push-err-"));
    const fridaCwd = path.join(base, "TuringExpo", "Local", "err", "0");
    await fs.mkdir(fridaCwd, { recursive: true });
    
    const remoteContent = "Line\n";
    const localContent = "bad\n";
    await fs.writeFile(path.join(fridaCwd, "Actions.txt"), localContent, "utf8");
    await updateBaselineFile(fridaCwd, 1444065, 0, "Actions.txt", { content: remoteContent }, "pull");

    const errJson = [
      { file: path.join(fridaCwd, "Actions.txt"), line: 1, col: 1, code: "E001", message: "bad", severity: "error" },
    ];
    let n = 0;
    mockSpawn.mockImplementation((cmd: string, args: string[]) => {
      n += 1;
      const { child } = makeMockChild();
      
      if (String(args[0]).includes("fetch_actions_from_cognitive")) {
        const outFileIdx = args.indexOf("--out-file");
        if (outFileIdx >= 0) {
          const outFile = args[outFileIdx + 1];
          fs.mkdir(path.dirname(outFile), { recursive: true }).then(() => {
            return fs.writeFile(outFile, remoteContent, "utf8");
          }).then(() => {
            emitProcessClose(child, { stdout: "fetched\n", stderr: "", exit: 0 });
          });
          return child;
        }
      }

      if (String(args[0]).includes("frida_lint")) {
        const isFormat = args.includes("format");
        const isCheck = args.includes("check");
        if (isFormat) {
          emitProcessClose(child, { stdout: "", stderr: "", exit: 0 });
          return child;
        }
        if (isCheck && args.includes("--fix")) {
          emitProcessClose(child, { stdout: "", stderr: "", exit: 0 });
          return child;
        }
        if (isCheck && args.includes("--json")) {
          emitProcessClose(child, { stdout: JSON.stringify(errJson), stderr: "", exit: 1 });
          return child;
        }
      }

      emitProcessClose(child, { stdout: "", stderr: "", exit: 0 });
      return child;
    });
    await expect(runPush(baseContext(fridaCwd), { dryRun: true })).rejects.toThrow(/one or more errors/);
  });

  it("passes --unsafe-fixes to check --fix when set", async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "frida-push-"));
    const fridaCwd = path.join(base, "TuringExpo", "Local", "test456", "0");
    await fs.mkdir(fridaCwd, { recursive: true });
    
    const remoteContent = "x\n";
    const localContent = "x\ny\n";
    await fs.writeFile(path.join(fridaCwd, "Actions.txt"), localContent, "utf8");
    await updateBaselineFile(fridaCwd, 1444065, 0, "Actions.txt", { content: remoteContent }, "pull");

    let n = 0;
    mockSpawn.mockImplementation((cmd: string, args: string[]) => {
      n += 1;
      const { child } = makeMockChild();

      if (String(args[0]).includes("fetch_actions_from_cognitive")) {
        const outFileIdx = args.indexOf("--out-file");
        if (outFileIdx >= 0) {
          const outFile = args[outFileIdx + 1];
          fs.mkdir(path.dirname(outFile), { recursive: true }).then(() => {
            const outContent = n > 7 ? localContent : remoteContent;
            return fs.writeFile(outFile, outContent, "utf8");
          }).then(() => {
            emitProcessClose(child, { stdout: "fetched\n", stderr: "", exit: 0 });
          });
          return child;
        }
      }

      if (String(args[0]).includes("frida_lint")) {
        const isFormat = args.includes("format");
        const isCheck = args.includes("check");
        if (isFormat) {
          emitProcessClose(child, { stdout: "", stderr: "", exit: 0 });
          return child;
        }
        if (isCheck && args.includes("--fix")) {
          expect(args).toContain("--unsafe-fixes");
          emitProcessClose(child, { stdout: "", stderr: "", exit: 0 });
          return child;
        }
        if (isCheck && args.includes("--json")) {
          emitProcessClose(child, { stdout: "[]", stderr: "", exit: 0 });
          return child;
        }
      }

      if (String(args[0]).includes("sync_actions_to_cognitive")) {
        expect(args).toContain("--json");
        const drySync = {
          processId: 1444065,
          step: 0,
          pathPrefix: "Processes/1444065/Steps/0",
          dryRun: true,
          files: [
            { name: "Actions.txt", byteSize: 2 },
            { name: "datadrive.txt", byteSize: 2 },
            { name: "headers.txt", byteSize: 2 },
          ],
          appUsage: { status: "skipped" as const, reason: "missing_optional_credentials" },
        };
        emitProcessClose(child, { stdout: `${JSON.stringify(drySync)}\n`, stderr: "", exit: 0 });
        return child;
      }

      emitProcessClose(child, { stdout: "", stderr: "", exit: 0 });
      return child;
    });
    const code = await runPush(baseContext(fridaCwd), { dryRun: true, unsafeFixes: true });
    expect(code).toBe(0);
  });

  it("uses --verbose and not --json when sync verbose is requested", async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "frida-push-"));
    const fridaCwd = path.join(base, "TuringExpo", "Local", "v1", "0");
    await fs.mkdir(fridaCwd, { recursive: true });
    
    const remoteContent = "a\n";
    const localContent = "a\nb\n";
    await fs.writeFile(path.join(fridaCwd, "Actions.txt"), localContent, "utf8");
    await updateBaselineFile(fridaCwd, 1444065, 0, "Actions.txt", { content: remoteContent }, "pull");

    let n = 0;
    mockSpawn.mockImplementation((cmd: string, args: string[]) => {
      n += 1;
      const { child } = makeMockChild();

      if (String(args[0]).includes("fetch_actions_from_cognitive")) {
        const outFileIdx = args.indexOf("--out-file");
        if (outFileIdx >= 0) {
          const outFile = args[outFileIdx + 1];
          fs.mkdir(path.dirname(outFile), { recursive: true }).then(() => {
            const outContent = n > 7 ? localContent : remoteContent;
            return fs.writeFile(outFile, outContent, "utf8");
          }).then(() => {
            emitProcessClose(child, { stdout: "fetched\n", stderr: "", exit: 0 });
          });
          return child;
        }
      }

      if (String(args[0]).includes("frida_lint")) {
        emitProcessClose(child, { stdout: "[]", stderr: "", exit: 0 });
        return child;
      }

      if (String(args[0]).includes("sync_actions_to_cognitive")) {
        expect(args).toContain("--verbose");
        expect(args).not.toContain("--json");
        emitProcessClose(child, { stdout: "azure-listFilesAndDirectories: 200\n[]\n", stderr: "", exit: 0 });
        return child;
      }

      emitProcessClose(child, { stdout: "", stderr: "", exit: 0 });
      return child;
    });
    const code = await runPush(baseContext(fridaCwd), { dryRun: true, verbose: true });
    expect(code).toBe(0);
  });

  it("rejects json and verbose together", async () => {
    const fridaCwd = path.join("C:", "x", "0", "0");
    await expect(runPush(baseContext(fridaCwd), { json: true, verbose: true, dryRun: true })).rejects.toThrow(
      /--json and --verbose/,
    );
  });
});

describe("Cognitive push formatting helpers", () => {
  it("parseCognitiveSyncJson reads valid result", () => {
    const raw = JSON.stringify({
      processId: 1,
      step: 0,
      pathPrefix: "Processes/1/Steps/0",
      files: [],
      appUsage: { status: "skipped", reason: "missing_optional_credentials" },
    });
    const r = parseCognitiveSyncJson(raw);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.processId).toBe(1);
  });

  it("formatPushUserSummary matches key lines", () => {
    const text = formatPushUserSummary(
      [],
      123,
      {
        processId: 123,
        step: 0,
        pathPrefix: "x",
        dryRun: true,
        files: [{ name: "Actions.txt", byteSize: 3 }],
        appUsage: { status: "skipped", reason: "missing_optional_credentials" },
      },
    );
    expect(text).toContain("Lint: clean");
    expect(text).toContain("Destination: Cognitive process 123");
    expect(text).toContain("AppUsage analytics: skipped - optional credentials are not configured");
  });
});
