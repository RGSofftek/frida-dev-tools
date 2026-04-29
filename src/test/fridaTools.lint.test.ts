import { EventEmitter } from "node:events";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { formatRunLintUserSummary, runLint, type LintDiagnostic } from "../cli/fridaTools";
import type { FridaContext } from "../cli/context";
import * as path from "node:path";

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

const actions = path.join("C:", "FRIDA", "TuringExpo", "Local", "1444065", "0", "Actions.txt");

const w004s003: LintDiagnostic[] = [
  {
    file: actions,
    line: 4,
    col: 1,
    code: "W004",
    message: "systemnotify/SystemNotify used (avoid unless explicitly requested)",
    severity: "warning",
    fixable: true,
    fix_kind: "unsafe",
  },
  {
    file: actions,
    line: 4,
    col: 1,
    code: "S003",
    message: "Trailing whitespace",
    severity: "style",
    fixable: true,
    fix_kind: "safe",
  },
];

describe("formatRunLintUserSummary", () => {
  it("includes counts and per-issue fix hints for W004 and S003", () => {
    const s = formatRunLintUserSummary(w004s003);
    expect(s).toContain("frida-rpa: lint");
    expect(s).toContain("No errors were found, but 2 non-error lint issues remain");
    expect(s).toMatch(/1 warning/);
    expect(s).toMatch(/1 style issue/);
    expect(s).toContain("W004");
    expect(s).toContain("S003");
    expect(s).toContain("Fix: unsafe");
    expect(s).toContain("Fix: safe - run `frida-rpa fix`");
  });
});

describe("runLint (mocked python)", () => {
  beforeEach(() => {
    mockSpawn.mockReset();
  });

  it("plain lint prints human summary, not raw JSON", async () => {
    mockSpawn.mockImplementation(() => {
      const { child } = makeMockChild();
      emitProcessClose(child, { stdout: JSON.stringify(w004s003), stderr: "", exit: 1 });
      return child;
    });
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const code = await runLint(baseContext("C:/tmp/lint"), {});
      expect(code).toBe(1);
      const combined = writeSpy.mock.calls.map((c) => c[0] as string).join("");
      expect(combined).toContain("frida-rpa: lint");
      expect(combined).toContain("W004");
      expect(combined).not.toMatch(/^\s*\[/);
    } finally {
      writeSpy.mockRestore();
    }
  });

  it("lint --json passes through raw array", async () => {
    const json = JSON.stringify(w004s003);
    mockSpawn.mockImplementation(() => {
      const { child } = makeMockChild();
      emitProcessClose(child, { stdout: json, stderr: "", exit: 1 });
      return child;
    });
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const code = await runLint(baseContext("C:/tmp/lintj"), { json: true });
      expect(code).toBe(1);
      const combined = writeSpy.mock.calls.map((c) => c[0] as string).join("");
      expect(combined.trim().startsWith("[")).toBe(true);
      expect(combined).toContain("W004");
      expect(combined).not.toContain("frida-rpa: lint");
    } finally {
      writeSpy.mockRestore();
    }
  });
});
