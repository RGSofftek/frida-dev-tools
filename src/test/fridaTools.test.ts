import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  COGNITIVE_DEFAULT_DATADRIVE,
  COGNITIVE_DEFAULT_HEADERS,
  ensureCognitiveSyncCompanionFiles,
} from "../cli/fridaTools";

describe("ensureCognitiveSyncCompanionFiles", () => {
  it("creates datadrive.txt and headers.txt when only Actions.txt exists", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "frida-companion-"));
    const processDir = path.join(root, "TuringExpo", "Local", "999", "0");
    await fs.mkdir(processDir, { recursive: true });
    await fs.writeFile(path.join(processDir, "Actions.txt"), "DefineVariable as x with the value 1\n", "utf8");

    const out = await ensureCognitiveSyncCompanionFiles(processDir);
    expect(out.created.sort()).toEqual(["datadrive.txt", "headers.txt"].sort());

    const datadrive = await fs.readFile(path.join(processDir, "datadrive.txt"), "utf8");
    const headers = await fs.readFile(path.join(processDir, "headers.txt"), "utf8");
    expect(datadrive).toBe(COGNITIVE_DEFAULT_DATADRIVE);
    expect(headers).toBe(COGNITIVE_DEFAULT_HEADERS);
  });

  it("does not overwrite existing datadrive.txt or headers.txt", async () => {
    const processDir = await fs.mkdtemp(path.join(os.tmpdir(), "frida-companion-"));
    await fs.writeFile(path.join(processDir, "Actions.txt"), "x\n", "utf8");
    const customData = "[]\n# custom\n";
    const customHeaders = "## my headers\nKey: value\n";
    await fs.writeFile(path.join(processDir, "datadrive.txt"), customData, "utf8");
    await fs.writeFile(path.join(processDir, "headers.txt"), customHeaders, "utf8");

    const out = await ensureCognitiveSyncCompanionFiles(processDir);
    expect(out.created).toEqual([]);

    expect(await fs.readFile(path.join(processDir, "datadrive.txt"), "utf8")).toBe(customData);
    expect(await fs.readFile(path.join(processDir, "headers.txt"), "utf8")).toBe(customHeaders);
  });

  it("throws a clear error when Actions.txt is missing", async () => {
    const processDir = await fs.mkdtemp(path.join(os.tmpdir(), "frida-companion-"));
    await expect(ensureCognitiveSyncCompanionFiles(processDir)).rejects.toThrow(/Actions\.txt is missing/);
  });

  it("writes companions next to Actions.txt in a nested Local process path", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "frida-companion-"));
    const processDir = path.join(root, "FRIDA", "TuringExpo", "Local", "8029289", "0");
    await fs.mkdir(processDir, { recursive: true });
    await fs.writeFile(path.join(processDir, "Actions.txt"), "Line\n", "utf8");
    await ensureCognitiveSyncCompanionFiles(processDir);
    const datadrivePath = path.join(processDir, "datadrive.txt");
    const headersPath = path.join(processDir, "headers.txt");
    expect(await fs.access(datadrivePath).then(() => true)).toBe(true);
    expect(await fs.access(headersPath).then(() => true)).toBe(true);
  });
});

describe("ensureCognitiveSyncCompanionFiles (stdout)", () => {
  it("prints a line for each file created", async () => {
    const processDir = await fs.mkdtemp(path.join(os.tmpdir(), "frida-companion-"));
    await fs.writeFile(path.join(processDir, "Actions.txt"), "x\n", "utf8");

    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const out = await ensureCognitiveSyncCompanionFiles(processDir);
      expect(out.created.length).toBe(2);
      const calls = writeSpy.mock.calls.map((c) => c[0] as string);
      const combined = calls.join("");
      expect(combined).toContain("frida-rpa: created missing companion file:");
      expect(combined).toContain("datadrive.txt");
      expect(combined).toContain("headers.txt");
    } finally {
      writeSpy.mockRestore();
    }
  });
});
