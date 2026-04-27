import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { PassThrough, Writable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  buildContext,
  commandRequiresLogin,
  formatCliResult,
  parseArgs,
  processInteractiveLineWithRecovery,
  renderCommandHelp,
  renderGlobalHelp,
  resolveExtensionDevPath,
  shouldUseDevHost,
} from "../cli";
import { createMaskedPrompt, handleLoginFlow, handleLogoutFlow } from "../cli/auth";
import { renderStatusPanel } from "../cli/ui";
import { detectEditor } from "../cli/launch";
import { ensureWorkspaceSettings, mergeFridaPatterns } from "../cli/settings";

describe("parseArgs", () => {
  it("parses open command with workspace and flags", () => {
    const result = parseArgs([
      "open",
      "C:/tmp/workspace",
      "--editor",
      "cursor",
      "--patterns",
      "**/Actions.txt,**/*SAPStatus*.txt",
      "--dry-run",
      "--init",
    ]);

    expect(result.workspaceArg).toBe("C:/tmp/workspace");
    expect(result.command).toBe("open");
    expect(result.editor).toBe("cursor");
    expect(result.patterns).toEqual(["**/Actions.txt", "**/*SAPStatus*.txt"]);
    expect(result.settingsMode).toBe("merge");
    expect(result.dryRun).toBe(true);
    expect(result.noDevHost).toBe(false);
    expect(result.init).toBe(true);
  });

  it("parses settings source and mode", () => {
    const result = parseArgs([
      "open",
      "C:/tmp/workspace",
      "--settings-source",
      "C:/tmp/template/settings.json",
      "--settings-mode",
      "replace",
    ]);
    expect(result.settingsSource).toBe("C:/tmp/template/settings.json");
    expect(result.settingsMode).toBe("replace");
  });

  it("parses no-dev-host flag", () => {
    const result = parseArgs(["open", "C:/tmp/workspace", "--no-dev-host"]);
    expect(result.noDevHost).toBe(true);
  });

  it("supports open command without workspace path", () => {
    const result = parseArgs(["open"]);
    expect(result.command).toBe("open");
    expect(result.workspaceArg).toBeUndefined();
  });

  it("throws for unknown option", () => {
    expect(() => parseArgs(["--wat"])).toThrow("Unknown option");
  });

  it("parses short help flag", () => {
    const result = parseArgs(["-h"]);
    expect(result.help).toBe(true);
    expect(result.command).toBe("help");
  });

  it("parses command help flag as command-specific help", () => {
    const result = parseArgs(["login", "--help"]);
    expect(result.help).toBe(true);
    expect(result.command).toBe("help");
    expect(result.helpTopic).toBe("login");
  });

  it("defaults to interactive when no command is passed", () => {
    const result = parseArgs([]);
    expect(result.command).toBe("interactive");
  });

  it("treats unknown positional command as open path for compatibility", () => {
    const result = parseArgs(["C:/tmp/workspace"]);
    expect(result.command).toBe("open");
    expect(result.workspaceArg).toBe("C:/tmp/workspace");
  });

  it("parses help topic after help command", () => {
    const result = parseArgs(["help", "push"]);
    expect(result.command).toBe("help");
    expect(result.helpTopic).toBe("push");
  });

  it("parses logs list with explicit action", () => {
    const result = parseArgs(["logs", "list", "--process-id", "1555960", "--user-email", "user@example.com"]);
    expect(result.command).toBe("logs");
    expect(result.logsAction).toBe("list");
    expect(result.processId).toBe(1555960);
    expect(result.userEmail).toBe("user@example.com");
  });

  it("parses logs latest flags", () => {
    const result = parseArgs([
      "logs",
      "latest",
      "--process-id",
      "1555960",
      "--user-email",
      "user@example.com",
      "--out-dir",
      "logs",
      "--json",
    ]);
    expect(result.command).toBe("logs");
    expect(result.logsAction).toBe("latest");
    expect(result.processId).toBe(1555960);
    expect(result.userEmail).toBe("user@example.com");
    expect(result.outDir).toBe("logs");
    expect(result.json).toBe(true);
  });

  it("parses logs get with run/file", () => {
    const result = parseArgs([
      "logs",
      "get",
      "--run-id",
      "2026041622085624",
      "--file",
      "ERROR.txt",
      "--limit",
      "10",
    ]);
    expect(result.command).toBe("logs");
    expect(result.logsAction).toBe("get");
    expect(result.runId).toBe("2026041622085624");
    expect(result.fileName).toBe("ERROR.txt");
    expect(result.limit).toBe(10);
  });

  it("throws for unknown logs action", () => {
    expect(() => parseArgs(["logs", "wat"])).toThrow("Unknown logs action");
  });

  it("parses agents command", () => {
    const result = parseArgs(["agents"]);
    expect(result.command).toBe("agents");
  });

  it("parses agents with workspace path and flags", () => {
    const result = parseArgs(["agents", "C:/ws", "--dry-run", "--force", "--backup", "--json"]);
    expect(result.command).toBe("agents");
    expect(result.workspaceArg).toBe("C:/ws");
    expect(result.dryRun).toBe(true);
    expect(result.force).toBe(true);
    expect(result.backup).toBe(true);
    expect(result.json).toBe(true);
  });

  it("parses push with workspace path as sync target folder", () => {
    const result = parseArgs(["push", "C:/FRIDA/TuringExpo/Local/1444065/0"]);
    expect(result.command).toBe("push");
    expect(result.workspaceArg).toBe("C:/FRIDA/TuringExpo/Local/1444065/0");
  });

  it("parses --unsafe-fixes for fix and push", () => {
    const fixR = parseArgs(["fix", "--unsafe-fixes", "C:/tmp/p"]);
    expect(fixR.command).toBe("fix");
    expect(fixR.unsafeFixes).toBe(true);
    const pushR = parseArgs(["push", "C:/FRIDA/x", "--unsafe-fixes"]);
    expect(pushR.command).toBe("push");
    expect(pushR.unsafeFixes).toBe(true);
  });
});

describe("buildContext", () => {
  it("uses workspace path to resolve process id and step under .../Local/<id>/<step>", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "frida-ctx-"));
    const frida = path.join(root, "TuringExpo", "Local", "1444065", "0");
    await fs.mkdir(frida, { recursive: true });
    const options = parseArgs(["status", frida]);
    const ctx = buildContext(options);
    expect(ctx.cwd).toBe(path.resolve(frida));
    expect(ctx.processId).toBe(1444065);
    expect(ctx.step).toBe(0);
    expect(ctx.isFridaProcessFolder).toBe(true);
  });

  it("throws when workspace path for push does not exist", () => {
    const options = parseArgs(["push", path.join(os.tmpdir(), "missing-frida-999")]);
    expect(() => buildContext(options)).toThrow("does not exist");
  });
});

describe("help rendering", () => {
  it("global help includes command descriptions and flag groups", () => {
    const output = renderGlobalHelp();
    expect(output).toContain("Daily workflow");
    expect(output).toContain("status -> lint -> fix -> push/pull");
    expect(output).toContain("open");
    expect(output).toMatch(/\bagents\s+/);
    expect(output).toContain("Flag groups:");
    expect(output).toContain("--process-id");
    expect(output).toContain("Type exit or quit to close frida-rpa >");
  });

  it("command help for push includes pipeline notes and examples", () => {
    const output = renderCommandHelp("push");
    expect(output).toContain("Purpose:");
    expect(output).toContain("Pipeline: format");
    expect(output).toContain("frida-rpa push");
    expect(output).toContain("warnings do not block");
  });

  it("command help for fix mentions --unsafe-fixes", () => {
    const output = renderCommandHelp("fix");
    expect(output).toContain("--unsafe-fixes");
  });

  it("command help for open includes no-arg current folder usage", () => {
    const output = renderCommandHelp("open");
    expect(output).toContain("frida-rpa open");
  });

  it("command help for sync states alias behavior", () => {
    const output = renderCommandHelp("sync");
    expect(output).toContain("Alias for push");
  });

  it("command help for logs includes actions and output folder", () => {
    const output = renderCommandHelp("logs");
    expect(output).toContain("List and download Cognitive run logs");
    expect(output).toContain("list|latest|get");
    expect(output).toContain("out-dir");
    expect(output).toContain("<out-dir>/<processId>/<runId>/<fileName>");
  });

  it("command help for login describes credential and session storage", () => {
    const output = renderCommandHelp("login");
    expect(output).toContain("Verify Cognitive credentials");
    expect(output).toContain("password is sent to Cognitive/Firebase for verification");
    expect(output).toContain("~/.frida-rpa/session.json");
    expect(output).toContain("OS secure credential store");
  });

  it("command help for agents describes import and overwrite policy", () => {
    const output = renderCommandHelp("agents");
    expect(output).toContain("AGENTS.md");
    expect(output).toContain("agent-docs");
    expect(output).toContain("frida-rpa agents");
  });
});

describe("command auth policy", () => {
  it("does not require login for pull/push/sync", () => {
    expect(commandRequiresLogin("pull")).toBe(false);
    expect(commandRequiresLogin("push")).toBe(false);
    expect(commandRequiresLogin("sync")).toBe(false);
  });
});

describe("interactive recovery", () => {
  it("recovers from command errors and keeps interactive loop alive", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const result = await processInteractiveLineWithRecovery("push", async () => {
      throw new Error("forced failure");
    });
    expect(result).toBe("continue");
    expect(stderrSpy).toHaveBeenCalledWith("frida-rpa error: forced failure\n");
    stderrSpy.mockRestore();
  });
});

describe("handleLoginFlow", () => {
  it("supports injected question function (interactive shell reuse)", async () => {
    const prompts: string[] = [];
    const answers = ["", "top-secret"];
    const question = vi.fn(async (prompt: string) => {
      prompts.push(prompt);
      return answers.shift() ?? "";
    });

    await expect(handleLoginFlow(question)).rejects.toThrow("Email is required.");
    expect(question).toHaveBeenCalledTimes(2);
    expect(prompts).toEqual(["Cognitive email: ", "Cognitive password: "]);
  });

  it("uses masked question callback when provided", async () => {
    const question = vi.fn(async () => "");
    const maskedQuestion = vi.fn(async () => "secret-password");

    await expect(handleLoginFlow(question, maskedQuestion)).rejects.toThrow("Email is required.");
    expect(question).toHaveBeenCalledTimes(1);
    expect(maskedQuestion).toHaveBeenCalledTimes(1);
  });

  it("verifies credentials before reporting a saved session", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const question = vi.fn(async () => "user@example.com");
    const maskedQuestion = vi.fn(async () => "bad-password");
    const verifier = vi.fn(async () => {
      throw new Error("Cognitive login failed: invalid email or password.");
    });
    const savePassword = vi.fn(async () => {});

    await expect(handleLoginFlow(question, maskedQuestion, verifier, savePassword)).rejects.toThrow(
      "Cognitive login failed: invalid email or password.",
    );
    expect(verifier).toHaveBeenCalledWith("user@example.com", "bad-password");
    expect(savePassword).not.toHaveBeenCalled();
    expect(stdoutSpy).not.toHaveBeenCalledWith(expect.stringContaining("Saved local credentials"));
    stdoutSpy.mockRestore();
  });

  it("stores password after verification succeeds", async () => {
    const question = vi.fn(async () => "user@example.com");
    const maskedQuestion = vi.fn(async () => "top-secret");
    const verifier = vi.fn(async () => {});
    const savePassword = vi.fn(async () => {});

    await expect(handleLoginFlow(question, maskedQuestion, verifier, savePassword)).resolves.toBe(0);
    expect(verifier).toHaveBeenCalledWith("user@example.com", "top-secret");
    expect(savePassword).toHaveBeenCalledWith("user@example.com", "top-secret");
  });

  it("masks TTY password input", async () => {
    const chunks: string[] = [];
    const promptInput = new PassThrough() as PassThrough & {
      isRaw: boolean;
      isTTY: boolean;
      setRawMode: (mode: boolean) => typeof promptInput;
    };
    const promptOutput = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
    }) as NodeJS.WriteStream;
    const setRawMode = vi.fn((mode: boolean) => {
      promptInput.isRaw = mode;
      return promptInput;
    });

    promptInput.isRaw = false;
    promptInput.isTTY = true;
    promptInput.setRawMode = setRawMode;

    const answerPromise = createMaskedPrompt(undefined, promptInput, promptOutput)("Cognitive password: ");
    promptInput.write("secret\r");

    await expect(answerPromise).resolves.toBe("secret");
    expect(chunks.join("")).toBe("Cognitive password: ******\n");
    expect(setRawMode).toHaveBeenNthCalledWith(1, true);
    expect(setRawMode).toHaveBeenLastCalledWith(false);
  });
});

describe("handleLogoutFlow", () => {
  it("succeeds when no session exists", async () => {
    const deletePassword = vi.fn(async () => {});
    const loadSession = vi.fn(async () => null);
    const clearSession = vi.fn(async () => {});
    await expect(handleLogoutFlow(deletePassword, loadSession, clearSession)).resolves.toBe(0);
    expect(loadSession).toHaveBeenCalledTimes(1);
    expect(deletePassword).not.toHaveBeenCalled();
    expect(clearSession).toHaveBeenCalledTimes(1);
  });

  it("deletes stored password for current session email", async () => {
    const deletePassword = vi.fn(async () => {});
    const loadSession = vi.fn(async () => ({
      email: "user@example.com",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastVerifiedAt: "2026-01-01T00:00:00.000Z",
    }));
    const clearSession = vi.fn(async () => {});
    await expect(handleLogoutFlow(deletePassword, loadSession, clearSession)).resolves.toBe(0);
    expect(deletePassword).toHaveBeenCalledWith("user@example.com");
    expect(clearSession).toHaveBeenCalledTimes(1);
  });
});

describe("mergeFridaPatterns", () => {
  it("returns default when existing is empty and none requested", () => {
    expect(mergeFridaPatterns([], undefined)).toEqual(["**/Actions.txt"]);
  });

  it("returns requested patterns when provided", () => {
    expect(mergeFridaPatterns(["**/Old.txt"], ["**/Actions.txt"])).toEqual(["**/Actions.txt"]);
  });
});

describe("ensureWorkspaceSettings", () => {
  it("writes default frida.filePatterns", async () => {
    const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "frida-cli-test-"));
    const result = await ensureWorkspaceSettings(workspacePath);
    const settingsPath = path.join(workspacePath, ".vscode", "settings.json");
    const content = JSON.parse(await fs.readFile(settingsPath, "utf8")) as Record<string, unknown>;

    expect(result.changed).toBe(true);
    expect(content["frida.filePatterns"]).toEqual(["**/Actions.txt"]);
  });

  it("replaces patterns when requested", async () => {
    const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "frida-cli-test-"));
    await fs.mkdir(path.join(workspacePath, ".vscode"), { recursive: true });
    await fs.writeFile(
      path.join(workspacePath, ".vscode", "settings.json"),
      `${JSON.stringify({ "frida.filePatterns": ["**/Old.txt"], other: true }, null, 2)}\n`,
      "utf8",
    );

    const result = await ensureWorkspaceSettings(workspacePath, {
      patterns: ["**/Actions.txt", "**/*SAPStatus*.txt"],
    });
    const content = JSON.parse(
      await fs.readFile(path.join(workspacePath, ".vscode", "settings.json"), "utf8"),
    ) as Record<string, unknown>;

    expect(result.changed).toBe(true);
    expect(content.other).toBe(true);
    expect(content["frida.filePatterns"]).toEqual(["**/Actions.txt", "**/*SAPStatus*.txt"]);
  });

  it("merge mode applies source FRIDA and token color settings while keeping unrelated destination keys", async () => {
    const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "frida-cli-test-"));
    await fs.mkdir(path.join(workspacePath, ".vscode"), { recursive: true });
    await fs.writeFile(
      path.join(workspacePath, ".vscode", "settings.json"),
      `${JSON.stringify(
        {
          unrelated: true,
          "frida.filePatterns": ["**/Old.txt"],
          "editor.wordWrap": "on",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    const sourcePath = path.join(workspacePath, "source-settings.json");
    await fs.writeFile(
      sourcePath,
      `${JSON.stringify(
        {
          "frida.filePatterns": ["**/Actions.txt", "**/*SAPStatus*.txt"],
          "frida.syntaxColorScheme": "dark",
          "editor.tokenColorCustomizations": {
            textMateRules: [{ scope: "variable.other.runtime.frida", settings: { foreground: "#4EC9B0" } }],
          },
          "files.autoSave": "afterDelay",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const result = await ensureWorkspaceSettings(workspacePath, {
      sourcePath,
      mode: "merge",
    });
    const content = JSON.parse(
      await fs.readFile(path.join(workspacePath, ".vscode", "settings.json"), "utf8"),
    ) as Record<string, unknown>;

    expect(result.changed).toBe(true);
    expect(result.mode).toBe("merge");
    expect(result.sourcePath).toBe(path.resolve(sourcePath));
    expect(content.unrelated).toBe(true);
    expect(content["editor.wordWrap"]).toBe("on");
    expect(content["files.autoSave"]).toBeUndefined();
    expect(content["frida.syntaxColorScheme"]).toBe("dark");
    expect(content["editor.tokenColorCustomizations"]).toEqual({
      textMateRules: [{ scope: "variable.other.runtime.frida", settings: { foreground: "#4EC9B0" } }],
    });
    expect(content["frida.filePatterns"]).toEqual(["**/Actions.txt", "**/*SAPStatus*.txt"]);
  });

  it("replace mode mirrors source settings and still applies explicit patterns override", async () => {
    const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "frida-cli-test-"));
    await fs.mkdir(path.join(workspacePath, ".vscode"), { recursive: true });
    await fs.writeFile(
      path.join(workspacePath, ".vscode", "settings.json"),
      `${JSON.stringify({ unrelated: true, "frida.filePatterns": ["**/Old.txt"] }, null, 2)}\n`,
      "utf8",
    );
    const sourcePath = path.join(workspacePath, "source-settings.json");
    await fs.writeFile(
      sourcePath,
      `${JSON.stringify(
        {
          "frida.filePatterns": ["**/SourceDefault.txt"],
          "frida.syntaxColorScheme": "light",
          "editor.tokenColorCustomizations": { textMateRules: [{ scope: "source.frida", settings: { foreground: "#fff" } }] },
          "files.autoSave": "afterDelay",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const result = await ensureWorkspaceSettings(workspacePath, {
      sourcePath,
      mode: "replace",
      patterns: ["**/Actions.txt"],
    });
    const content = JSON.parse(
      await fs.readFile(path.join(workspacePath, ".vscode", "settings.json"), "utf8"),
    ) as Record<string, unknown>;

    expect(result.changed).toBe(true);
    expect(result.mode).toBe("replace");
    expect(content.unrelated).toBeUndefined();
    expect(content["files.autoSave"]).toBe("afterDelay");
    expect(content["frida.syntaxColorScheme"]).toBe("light");
    expect(content["frida.filePatterns"]).toEqual(["**/Actions.txt"]);
  });

  it("fails on malformed settings JSON", async () => {
    const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "frida-cli-test-"));
    await fs.mkdir(path.join(workspacePath, ".vscode"), { recursive: true });
    await fs.writeFile(path.join(workspacePath, ".vscode", "settings.json"), "{invalid", "utf8");

    await expect(ensureWorkspaceSettings(workspacePath)).rejects.toThrow("invalid JSON");
  });

  it("fails on malformed source settings JSON", async () => {
    const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "frida-cli-test-"));
    const sourcePath = path.join(workspacePath, "source-settings.json");
    await fs.writeFile(sourcePath, "{invalid", "utf8");
    await expect(ensureWorkspaceSettings(workspacePath, { sourcePath })).rejects.toThrow(
      "source settings JSON",
    );
  });

  it("dry run reports changes without writing source merge output", async () => {
    const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "frida-cli-test-"));
    const sourcePath = path.join(workspacePath, "source-settings.json");
    await fs.writeFile(
      sourcePath,
      `${JSON.stringify(
        {
          "frida.filePatterns": ["**/Actions.txt", "**/*SAPStatus*.txt"],
          "frida.syntaxColorScheme": "dark",
          "editor.tokenColorCustomizations": { textMateRules: [{ scope: "source.frida", settings: { foreground: "#fff" } }] },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const result = await ensureWorkspaceSettings(workspacePath, {
      sourcePath,
      mode: "merge",
      dryRun: true,
    });
    await expect(fs.access(path.join(workspacePath, ".vscode", "settings.json"))).rejects.toBeTruthy();
    expect(result.changed).toBe(true);
  });

  it("accepts JSONC source settings with comments", async () => {
    const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "frida-cli-test-"));
    const sourcePath = path.join(workspacePath, "source-settings.json");
    await fs.writeFile(
      sourcePath,
      `{
  // FRIDA defaults
  "frida.filePatterns": ["**/Actions.txt"],
  "frida.syntaxColorScheme": "dark",
}`,
      "utf8",
    );

    const result = await ensureWorkspaceSettings(workspacePath, { sourcePath, mode: "merge" });
    expect(result.changed).toBe(true);
    const content = JSON.parse(
      await fs.readFile(path.join(workspacePath, ".vscode", "settings.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(content["frida.syntaxColorScheme"]).toBe("dark");
  });
});

describe("detectEditor", () => {
  it("uses preferred editor when available", async () => {
    const result = await detectEditor("cursor", (command) => command === "cursor");
    expect(result).toEqual({ name: "cursor", command: "cursor" });
  });

  it("defaults to VS Code when no preference is provided", async () => {
    const result = await detectEditor(undefined, (command) => command === "code");
    expect(result).toEqual({ name: "code", command: "code" });
  });

  it("strict default errors when VS Code missing", async () => {
    await expect(
      detectEditor(undefined, (command) => command === "cursor", { defaultEditor: "code", strictDefault: true }),
    ).rejects.toThrow("Default editor");
  });
});

describe("resolveExtensionDevPath", () => {
  it("resolves repo root for frida-editor-tools", async () => {
    const resolved = await resolveExtensionDevPath();
    const packageRaw = await fs.readFile(path.join(resolved, "package.json"), "utf8");
    const pkg = JSON.parse(packageRaw) as { name?: string };
    expect(pkg.name).toBe("frida-editor-tools");
  });
});

describe("shouldUseDevHost", () => {
  it("enables dev host for external FRIDA workspaces when extension path exists", () => {
    const result = shouldUseDevHost(
      "C:/FRIDA/TuringExpo/Local/1555960/0",
      parseArgs(["open", "C:/FRIDA/TuringExpo/Local/1555960/0"]),
      "C:/Users/rodrigo.gracia/Documents/Projects/vscode-frida-extension",
    );
    expect(result).toBe(true);
  });

  it("disables dev host when no-dev-host flag is set", () => {
    const result = shouldUseDevHost(
      "C:/FRIDA/TuringExpo/Local/1555960/0",
      parseArgs(["open", "C:/FRIDA/TuringExpo/Local/1555960/0", "--no-dev-host"]),
      "C:/Users/rodrigo.gracia/Documents/Projects/vscode-frida-extension",
    );
    expect(result).toBe(false);
  });
});

describe("formatCliResult", () => {
  it("prints extension-development-host mode details", () => {
    const output = formatCliResult({
      workspacePath: "C:/tmp/workspace",
      editorName: "code",
      dryRun: true,
      devHostEnabled: true,
      extensionDevPath: "C:/repo",
      initRequested: true,
      settings: {
        settingsPath: "C:/tmp/workspace/.vscode/settings.json",
        mode: "merge",
        changed: false,
        beforePatterns: ["**/Actions.txt"],
        afterPatterns: ["**/Actions.txt"],
      },
    });

    expect(output).toContain("Launch mode: extension-development-host");
    expect(output).toContain("Extension development path: C:/repo");
  });
});

describe("renderStatusPanel", () => {
  it("supports compact startup view with only cognitive status", () => {
    const output = renderStatusPanel(
      {
        cwd: "C:/FRIDA/TuringExpo/Local/1555960/0",
        processId: 1555960,
        step: 0,
        isFridaProcessFolder: true,
        files: { actions: true, datadrive: true, headers: true },
        runScriptTargets: [],
        auth: "signed_out",
      },
      { compact: true },
    );
    expect(output).toBe("Cognitive    not signed in");
  });
});
