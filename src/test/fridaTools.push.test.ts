import { EventEmitter } from "node:events";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { runPush, parseLintCheckJson, hasLintErrorSeverity } from "../cli/fridaTools";
import type { FridaContext } from "../cli/context";

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
    await fs.writeFile(path.join(fridaCwd, "Actions.txt"), "Line\n", "utf8");
    const warnJson = [
      { file: path.join(fridaCwd, "Actions.txt"), line: 4, col: 1, code: "W004", message: "notify", severity: "warning" },
    ];
    let n = 0;
    mockSpawn.mockImplementation((cmd: string, args: string[]) => {
      expect(cmd).toBe("python");
      n += 1;
      const { child } = makeMockChild();
      if (n === 1 || n === 3) {
        emitProcessClose(child, { stdout: "", stderr: "", exit: 0 });
        return child;
      }
      if (n === 2) {
        expect(args[2]).toBe("check");
        expect(args).toContain("--fix");
        expect(args).not.toContain("--json");
        expect(args).not.toContain("--unsafe-fixes");
        emitProcessClose(child, { stdout: "out\n", stderr: "", exit: 1 });
        return child;
      }
      if (n === 4) {
        expect(args[2]).toBe("check");
        expect(args).toContain("--json");
        emitProcessClose(child, { stdout: JSON.stringify(warnJson), stderr: "", exit: 1 });
        return child;
      }
      if (n === 5) {
        expect(String(args[0])).toContain("sync_actions_to_cognitive");
        expect(args).toContain("--dry-run");
        emitProcessClose(child, { stdout: "dry run ok\n", stderr: "", exit: 0 });
        return child;
      }
      throw new Error(`unexpected spawn call n=${n} ${args.join(" ")}`);
    });
    const code = await runPush(baseContext(fridaCwd), { dryRun: true });
    expect(code).toBe(0);
    expect(n).toBe(5);
  });

  it("throws when final check has an error diagnostic", async () => {
    const fridaCwd = path.join("C:", "tmp", "f");
    const errJson = [
      { file: path.join(fridaCwd, "Actions.txt"), line: 1, col: 1, code: "E001", message: "bad", severity: "error" },
    ];
    let n = 0;
    mockSpawn.mockImplementation((cmd: string, args: string[]) => {
      n += 1;
      const { child } = makeMockChild();
      if (n === 1 || n === 3) {
        emitProcessClose(child, { stdout: "", stderr: "", exit: 0 });
        return child;
      }
      if (n === 2) {
        emitProcessClose(child, { stdout: "", stderr: "", exit: 0 });
        return child;
      }
      if (n === 4) {
        expect(args[2]).toBe("check");
        expect(args).toContain("--json");
        emitProcessClose(child, { stdout: JSON.stringify(errJson), stderr: "", exit: 1 });
        return child;
      }
      throw new Error("unexpected");
    });
    await expect(runPush(baseContext(fridaCwd), { dryRun: true })).rejects.toThrow(/one or more errors/);
    expect(n).toBe(4);
  });

  it("passes --unsafe-fixes to check --fix when set", async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "frida-push-"));
    const fridaCwd = path.join(base, "TuringExpo", "Local", "test456", "0");
    await fs.mkdir(fridaCwd, { recursive: true });
    await fs.writeFile(path.join(fridaCwd, "Actions.txt"), "x\n", "utf8");
    let n = 0;
    mockSpawn.mockImplementation((cmd: string, args: string[]) => {
      n += 1;
      const { child } = makeMockChild();
      if (n === 1 || n === 3) {
        emitProcessClose(child, { stdout: "", stderr: "", exit: 0 });
        return child;
      }
      if (n === 2) {
        expect(args).toContain("--unsafe-fixes");
        expect(args).toContain("--fix");
        emitProcessClose(child, { stdout: "", stderr: "", exit: 0 });
        return child;
      }
      if (n === 4) {
        emitProcessClose(child, { stdout: "[]", stderr: "", exit: 0 });
        return child;
      }
      if (n === 5) {
        expect(String(args[0])).toContain("sync_actions_to_cognitive");
        emitProcessClose(child, { stdout: "y\n", stderr: "", exit: 0 });
        return child;
      }
      throw new Error(`unexpected n=${n}`);
    });
    const code = await runPush(baseContext(fridaCwd), { dryRun: true, unsafeFixes: true });
    expect(code).toBe(0);
    expect(n).toBe(5);
  });
});
