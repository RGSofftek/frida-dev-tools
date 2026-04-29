import { EventEmitter } from "node:events";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  formatDiagnosticLocation,
  formatNonErrorCountsLine,
  formatRemainingDiagnosticsSummary,
  formatPostFixCountsLine,
  formatRunFixUserSummary,
  formatUnsafeFixGuidance,
  runFix,
  type LintDiagnostic,
} from "../cli/fridaTools";
import type { FridaContext } from "../cli/context";

const w004Unsafe: LintDiagnostic = {
  file: path.join("C:", "FRIDA", "TuringExpo", "Local", "8125706", "0", "Actions.txt"),
  line: 6,
  col: 1,
  code: "W004",
  message: "systemnotify/SystemNotify used (avoid unless explicitly requested) [unsafe fix]",
  severity: "warning",
  fixable: true,
  fix_kind: "unsafe",
};

describe("formatRunFix user-facing helpers", () => {
  it("formatDiagnosticLocation uses basename:line", () => {
    expect(formatDiagnosticLocation(w004Unsafe)).toBe("Actions.txt:6");
  });

  it("formatNonErrorCountsLine describes a single warning", () => {
    expect(
      formatNonErrorCountsLine([{ ...w004Unsafe, severity: "warning" }]),
    ).toContain("1 warning");
  });

  it("formatNonErrorCountsLine describes multiple severities with counts", () => {
    const a: LintDiagnostic = { ...w004Unsafe, line: 1, code: "W001", message: "m" };
    const b: LintDiagnostic = { ...w004Unsafe, line: 2, code: "C001", message: "m2", severity: "convention" };
    const line = formatNonErrorCountsLine([a, b]);
    expect(line).toMatch(/2 non-error lint issues remain/);
    expect(line).toMatch(/1 warning/);
    expect(line).toMatch(/1 convention/);
  });

  it("formatRemainingDiagnosticsSummary lists each issue on two lines with severity", () => {
    const out = formatRemainingDiagnosticsSummary([w004Unsafe]);
    expect(out).toContain("W004  Actions.txt:6  warning");
    expect(out).toContain("systemnotify");
  });

  it("formatUnsafeFixGuidance returns W004 copy when unsafe fixes were skipped and W004 is present", () => {
    const g = formatUnsafeFixGuidance([w004Unsafe], false);
    expect(g).toContain("W004 is unsafe");
    expect(g).toContain("frida-rpa fix --unsafe-fixes");
    expect(g).toContain("## noqa: W004");
  });

  it("formatUnsafeFixGuidance is empty when --unsafe-fixes was used", () => {
    expect(formatUnsafeFixGuidance([w004Unsafe], true)).toBe("");
  });

  it("formatRunFixUserSummary includes status and W004 why-block for unsafe W004", () => {
    const s = formatRunFixUserSummary([w004Unsafe], { unsafeFixes: false });
    expect(s).toMatch(/frida-rpa: fix/);
    expect(s).toMatch(/Status: completed with warnings/);
    expect(s).toMatch(/W004/);
    expect(s).toMatch(/Why it was not changed automatically/);
    expect(s).toContain("## noqa: W004");
    expect(s).not.toMatch(/Next step:/);
  });

  it("formatRunFixUserSummary uses Next step when there is no unsafe auto-fix to explain", () => {
    const d: LintDiagnostic = {
      ...w004Unsafe,
      fixable: false,
      fix_kind: null,
    };
    const s = formatRunFixUserSummary([d], { unsafeFixes: false });
    expect(s).toMatch(/Next step/);
    expect(s).toMatch(/frida-rpa lint/);
  });

  it("formatRunFixUserSummary uses plural Remaining issues for multiple diagnostics", () => {
    const a: LintDiagnostic = { ...w004Unsafe, line: 1, code: "W001", message: "a" };
    const b: LintDiagnostic = { ...w004Unsafe, line: 2, code: "W002", message: "b" };
    const s = formatRunFixUserSummary([a, b], { unsafeFixes: false });
    expect(s).toContain("Remaining issues:");
    expect(s).toContain("W001");
    expect(s).toContain("W002");
    expect(s).toContain("## noqa: <CODE>");
  });

  it("formatPostFixCountsLine includes safe-fixes prefix", () => {
    expect(formatPostFixCountsLine([w004Unsafe])).toMatch(/Safe fixes were applied where possible/);
  });
});

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
  processId: 8125706,
  step: 0,
  isFridaProcessFolder: true,
  files: { actions: true, datadrive: true, headers: true },
  runScriptTargets: [],
});

describe("runFix (mocked python)", () => {
  beforeEach(() => {
    mockSpawn.mockReset();
  });

  it("returns 0 and prints structured summary for remaining unsafe W004", async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "frida-fix-"));
    const fridaCwd = path.join(base, "TuringExpo", "Local", "p", "0");
    await fs.mkdir(fridaCwd, { recursive: true });
    await fs.writeFile(path.join(fridaCwd, "Actions.txt"), "x\n", "utf8");
    const actionsPath = path.join(fridaCwd, "Actions.txt");
    const warnJson = [JSON.parse(JSON.stringify(w004Unsafe))] as LintDiagnostic[];
    warnJson[0].file = actionsPath;
    let n = 0;
    mockSpawn.mockImplementation((_cmd: string, _args: string[]) => {
      n += 1;
      const { child } = makeMockChild();
      if (n === 1 || n === 3) {
        emitProcessClose(child, { stdout: "", stderr: "", exit: 0 });
        return child;
      }
      if (n === 2) {
        emitProcessClose(child, { stdout: "linter out\n", stderr: "", exit: 1 });
        return child;
      }
      if (n === 4) {
        emitProcessClose(child, { stdout: JSON.stringify(warnJson), stderr: "", exit: 1 });
        return child;
      }
      throw new Error(`unexpected spawn n=${n}`);
    });
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const code = await runFix(baseContext(fridaCwd), {});
      expect(code).toBe(0);
      const combined = writeSpy.mock.calls.map((c) => c[0] as string).join("");
      expect(combined).toContain("frida-rpa: fix");
      expect(combined).toContain("Status: completed with warnings");
      expect((combined.match(/Status: completed with warnings/g) || []).length).toBe(1);
      expect(combined).toContain("Safe fixes were applied where possible");
      expect(combined).toContain("W004");
      expect(combined).toContain("Why it was not changed automatically");
      expect(combined).not.toContain("linter out");
    } finally {
      writeSpy.mockRestore();
    }
  });

  it("json mode does not print the human-friendly fix summary (only raw JSON body)", async () => {
    const fridaCwd = path.join(os.tmpdir(), "frida-fix-json");
    const warnJson: LintDiagnostic[] = [JSON.parse(JSON.stringify(w004Unsafe))];
    warnJson[0].file = path.join(fridaCwd, "Actions.txt");
    let n = 0;
    mockSpawn.mockImplementation(() => {
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
        emitProcessClose(child, { stdout: JSON.stringify(warnJson), stderr: "", exit: 1 });
        return child;
      }
      throw new Error(`unexpected n=${n}`);
    });
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const code = await runFix(baseContext(fridaCwd), { json: true });
      expect(code).toBe(0);
      const combined = writeSpy.mock.calls.map((c) => c[0] as string).join("");
      expect(combined).toContain("W004");
      expect(combined).not.toContain("frida-rpa: fix");
      expect(combined).not.toContain("Status: completed with warnings");
    } finally {
      writeSpy.mockRestore();
    }
  });

  it("returns 0 and prints clean when verify JSON has no diagnostics", async () => {
    const fridaCwd = path.join(os.tmpdir(), "frida-clean");
    let n = 0;
    mockSpawn.mockImplementation(() => {
      n += 1;
      const { child } = makeMockChild();
      if (n === 1 || n === 3) {
        emitProcessClose(child, { stdout: "", stderr: "", exit: 0 });
        return child;
      }
      if (n === 2) {
        emitProcessClose(child, { stdout: "should not be shown\n", stderr: "", exit: 0 });
        return child;
      }
      if (n === 4) {
        emitProcessClose(child, { stdout: "[]", stderr: "", exit: 0 });
        return child;
      }
      throw new Error(`unexpected n=${n}`);
    });
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const code = await runFix(baseContext(fridaCwd), {});
      expect(code).toBe(0);
      const combined = writeSpy.mock.calls.map((c) => c[0] as string).join("");
      expect(combined).toContain("Status: clean");
      expect(combined).not.toContain("should not be shown");
    } finally {
      writeSpy.mockRestore();
    }
  });

  it("returns 1 and writes verify output on error severities (no human summary)", async () => {
    const fridaCwd = "C:/tmp/f";
    const errJson: LintDiagnostic[] = [
      {
        file: path.join(fridaCwd, "Actions.txt"),
        line: 1,
        col: 1,
        code: "E001",
        message: "bad",
        severity: "error",
      },
    ];
    let n = 0;
    mockSpawn.mockImplementation(() => {
      n += 1;
      const { child } = makeMockChild();
      if (n === 1 || n === 3) {
        emitProcessClose(child, { stdout: "", stderr: "", exit: 0 });
        return child;
      }
      if (n === 2) {
        emitProcessClose(child, { stdout: "err step\n", stderr: "", exit: 1 });
        return child;
      }
      if (n === 4) {
        emitProcessClose(child, { stdout: JSON.stringify(errJson), stderr: "", exit: 1 });
        return child;
      }
      throw new Error(`unexpected n=${n}`);
    });
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const code = await runFix(baseContext(fridaCwd), {});
      expect(code).toBe(1);
      const combined = writeSpy.mock.calls.map((c) => c[0] as string).join("");
      expect(combined).toContain("E001");
      expect(combined).toContain("err step");
      expect(combined).not.toContain("Status: completed with warnings");
    } finally {
      writeSpy.mockRestore();
    }
  });
});
