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
  renderCognitiveShellHelp,
  renderCommandHelp,
  renderGlobalHelp,
  resolveExtensionDevPath,
  shouldUseDevHost,
} from "../cli";
import { createMaskedPrompt, getStoredSession, handleLoginFlow, handleLogoutFlow } from "../cli/auth";
import { renderCognitiveContextLine, renderCognitivePrompt, renderStatusPanel } from "../cli/ui";
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

  it("parses cognitive namespace commands", () => {
    const list = parseArgs(["cognitive", "apps", "list", "--json"]);
    expect(list.command).toBe("cognitive");
    expect(list.cognitiveResource).toBe("apps");
    expect(list.cognitiveAction).toBe("list");
    expect(list.json).toBe(true);

    const create = parseArgs(["cognitive", "suites", "create", "--app", "3320302", "--name", "Suite A"]);
    expect(create.cognitiveResource).toBe("suites");
    expect(create.cognitiveAction).toBe("create");
    expect(create.appId).toBe("3320302");
    expect(create.createName).toBe("Suite A");

    const processCreate = parseArgs(["cognitive", "processes", "create", "--suite", "5640573", "--name", "Process A"]);
    expect(processCreate.cognitiveResource).toBe("processes");
    expect(processCreate.cognitiveAction).toBe("create");
    expect(processCreate.suiteId).toBe("5640573");
    expect(processCreate.createName).toBe("Process A");
  });

  it("parses cognitive nav/push/pull entry points", () => {
    const nav = parseArgs(["cognitive", "nav"]);
    expect(nav.command).toBe("cognitive");
    expect(nav.cognitiveResource).toBe("nav");

    const push = parseArgs(["cognitive", "push", "--dry-run"]);
    expect(push.command).toBe("cognitive");
    expect(push.cognitiveResource).toBe("push");
    expect(push.dryRun).toBe(true);

    const pull = parseArgs(["cognitive", "pull", "--backup"]);
    expect(pull.command).toBe("cognitive");
    expect(pull.cognitiveResource).toBe("pull");
    expect(pull.backup).toBe(true);

    const login = parseArgs(["cognitive", "login"]);
    expect(login.command).toBe("cognitive");
    expect(login.cognitiveResource).toBe("login");

    const logout = parseArgs(["cognitive", "logout"]);
    expect(logout.command).toBe("cognitive");
    expect(logout.cognitiveResource).toBe("logout");
  });

  it("parses lint info and lint rules as documented rule catalog", () => {
    const info = parseArgs(["lint", "info"]);
    expect(info.command).toBe("lint");
    expect(info.lintAction).toBe("info");
    expect(info.workspaceArg).toBeUndefined();

    const rules = parseArgs(["lint", "rules"]);
    expect(rules.command).toBe("lint");
    expect(rules.lintAction).toBe("info");
  });

  it("parses lint info --json", () => {
    const result = parseArgs(["lint", "info", "--json"]);
    expect(result.command).toBe("lint");
    expect(result.lintAction).toBe("info");
    expect(result.json).toBe(true);
  });

  it("parses lint with workspace path when not using info subcommand", () => {
    const result = parseArgs(["lint", "C:/FRIDA/Local/0/0"]);
    expect(result.command).toBe("lint");
    expect(result.lintAction).toBeUndefined();
    expect(result.workspaceArg).toBe("C:/FRIDA/Local/0/0");
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

  it("parses estimate subcommands and flags", () => {
    const init = parseArgs(["estimate", "init", "--out", "./estimation_mock.json", "--force"]);
    expect(init.command).toBe("estimate");
    expect(init.estimateAction).toBe("init");
    expect(init.estimateOut).toBe("./estimation_mock.json");
    expect(init.force).toBe(true);

    const example = parseArgs(["estimate", "example", "--json"]);
    expect(example.command).toBe("estimate");
    expect(example.estimateAction).toBe("example");
    expect(example.json).toBe(true);

    const generate = parseArgs(["estimate", "generate", "--config", "./cfg.json", "--out", "./out.pptx"]);
    expect(generate.command).toBe("estimate");
    expect(generate.estimateAction).toBe("generate");
    expect(generate.estimateConfig).toBe("./cfg.json");
    expect(generate.estimateOut).toBe("./out.pptx");
  });

  it("parses push with workspace path as sync target folder", () => {
    const result = parseArgs(["push", "C:/FRIDA/TuringExpo/Local/1444065/0"]);
    expect(result.command).toBe("push");
    expect(result.workspaceArg).toBe("C:/FRIDA/TuringExpo/Local/1444065/0");
  });

  it("parses --verbose for push", () => {
    const v = parseArgs(["push", "--verbose", "C:/tmp/f"]);
    expect(v.command).toBe("push");
    expect(v.verbose).toBe(true);
  });

  it("parses --unsafe-fixes for fix and push", () => {
    const fixR = parseArgs(["fix", "--unsafe-fixes", "C:/tmp/p"]);
    expect(fixR.command).toBe("fix");
    expect(fixR.unsafeFixes).toBe(true);
    const pushR = parseArgs(["push", "C:/FRIDA/x", "--unsafe-fixes"]);
    expect(pushR.command).toBe("push");
    expect(pushR.unsafeFixes).toBe(true);
  });

  it("parses --force for push", () => {
    const result = parseArgs(["push", "C:/FRIDA/TuringExpo/Local/1444065/0", "--force"]);
    expect(result.command).toBe("push");
    expect(result.force).toBe(true);
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
    expect(output).toContain("Quick start:");
    expect(output).toContain("One-time setup:");
    expect(output).toContain("Day-to-day:");
    expect(output).toContain("status -> lint -> fix -> cognitive push/pull");
    expect(output).toContain("open");
    expect(output).toContain("Command groups:");
    expect(output).toContain("Workspace setup");
    expect(output).toContain("Script quality");
    expect(output).toContain("Cognitive cloud");
    expect(output).not.toMatch(/\n\s+push\s+/);
    expect(output).not.toMatch(/\n\s+pull\s+/);
    expect(output).toContain("Flag groups:");
    expect(output).toContain("Common recipes:");
    expect(output).toContain("Context + flags:");
    expect(output).toContain("Discover more:");
    expect(output).toContain("--process-id");
    expect(output).toContain("Top-level shell:");
    expect(output).toContain("Cognitive shell:");
  });

  it("command help for push includes pipeline notes and examples", () => {
    const output = renderCommandHelp("push");
    expect(output).toContain("Purpose:");
    expect(output).toContain("DEPRECATED alias");
    expect(output).toContain("frida-rpa cognitive push");
    expect(output).toContain("Pipeline: remote preflight -> format");
    expect(output).toContain("frida-rpa push");
    expect(output).toContain("frida-rpa push --force");
    expect(output).toContain("allow local Actions.txt to overwrite Cognitive");
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

  it("command help for logs points to cognitive logs", () => {
    const output = renderCommandHelp("logs");
    expect(output).toContain("Legacy logs command removed");
    expect(output).toContain("frida-rpa cognitive logs");
  });

  it("command help for cognitive describes domain commands", () => {
    const output = renderCommandHelp("cognitive");
    expect(output).toContain("apps|suites|processes|logs|push|pull|nav|login|logout");
    expect(output).toContain("frida-rpa cognitive");
    expect(output).toContain("canonical surface");
    expect(output).toContain("frida-rpa cognitive nav");
    expect(output).toContain("frida-rpa cognitive login");
    expect(output).toContain("frida-rpa cognitive processes create --suite 5640573 --name \"My Process\"");
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

  it("command help for estimate includes cwd defaults and examples", () => {
    const output = renderCommandHelp("estimate");
    expect(output).toContain("Generate estimation PPTX files");
    expect(output).toContain("generate|init|example");
    expect(output).toContain("./estimation_mock.json");
    expect(output).toContain("./estimation_mock.pptx");
    expect(output).toContain("estimation/example_config.json");
    expect(output).toContain("frida-rpa estimate example");
    expect(output).toContain("frida-rpa estimate generate --config ./estimation_mock.json");
  });
});

describe("cognitive shell help", () => {
  it("renders grouped help with create command status", () => {
    const output = renderCognitiveShellHelp({ appId: "10", suiteId: "20", processId: "30" });
    expect(output).toContain("Cognitive shell help");
    expect(output).toContain("Context: app=10  suite=20  process=30");
    expect(output).toContain("\nExplore\n");
    expect(output).toContain("\nSync\n");
    expect(output).toContain("\nNavigation\n");
    expect(output).toContain("\nSession\n");
    expect(output).toContain("\nContext\n");
    expect(output).toContain("\nShell\n");
    expect(output).toContain("\nStatus\n");
    expect(output).toContain("logs list|latest|get");
    expect(output).toContain("nav");
    expect(output).toContain("Create a suite scaffold in Cognitive");
    expect(output).toContain("Create a process scaffold in Cognitive");
    expect(output).toContain("clear");
  });
});

describe("command auth policy", () => {
  it("requires login for cognitive, pull, push, and sync", () => {
    expect(commandRequiresLogin("pull")).toBe(true);
    expect(commandRequiresLogin("push")).toBe(true);
    expect(commandRequiresLogin("sync")).toBe(true);
    expect(commandRequiresLogin("cognitive")).toBe(true);
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
    const question = vi.fn(async () => "User@Example.com");
    const maskedQuestion = vi.fn(async () => "top-secret");
    const verifier = vi.fn(async () => {});
    const savePassword = vi.fn(async () => {});
    const saveSession = vi.fn(async () => {});
    const loadPrevSession = vi.fn(async () => null);
    const deletePreviousCredential = vi.fn(async () => {});

    await expect(
      handleLoginFlow(
        question,
        maskedQuestion,
        verifier,
        savePassword,
        saveSession,
        loadPrevSession,
        deletePreviousCredential,
      ),
    ).resolves.toBe(0);
    expect(verifier).toHaveBeenCalledWith("user@example.com", "top-secret");
    expect(deletePreviousCredential).not.toHaveBeenCalled();
    expect(savePassword).toHaveBeenCalledWith("user@example.com", "top-secret");
    expect(saveSession).toHaveBeenCalledWith("user@example.com");
  });

  it("deletes prior account credential before saving when switching email", async () => {
    const order: string[] = [];
    const question = vi.fn(async () => "new@example.com");
    const maskedQuestion = vi.fn(async () => "pw");
    const verifier = vi.fn(async () => {});
    const savePassword = vi.fn(async () => {
      order.push("savePassword");
    });
    const saveSession = vi.fn(async () => {});
    const loadPrevSession = vi.fn(async () => ({
      email: "old@example.com",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastVerifiedAt: "2026-01-01T00:00:00.000Z",
    }));
    const deletePreviousCredential = vi.fn(async () => {
      order.push("deletePrevious");
    });

    await handleLoginFlow(question, maskedQuestion, verifier, savePassword, saveSession, loadPrevSession, deletePreviousCredential);

    expect(deletePreviousCredential).toHaveBeenCalledWith("old@example.com");
    expect(order).toEqual(["deletePrevious", "savePassword"]);
    expect(savePassword).toHaveBeenCalledWith("new@example.com", "pw");
  });

  it("does not delete prior credential when email is unchanged after normalization", async () => {
    const question = vi.fn(async () => "USER@example.com");
    const maskedQuestion = vi.fn(async () => "pw");
    const verifier = vi.fn(async () => {});
    const savePassword = vi.fn(async () => {});
    const saveSession = vi.fn(async () => {});
    const loadPrevSession = vi.fn(async () => ({
      email: "user@example.com",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastVerifiedAt: "2026-01-01T00:00:00.000Z",
    }));
    const deletePreviousCredential = vi.fn(async () => {});

    await handleLoginFlow(question, maskedQuestion, verifier, savePassword, saveSession, loadPrevSession, deletePreviousCredential);

    expect(deletePreviousCredential).not.toHaveBeenCalled();
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

describe("getStoredSession", () => {
  it("does not report signed in when secure credential is missing", async () => {
    await expect(getStoredSession(async () => false, async () => ({
      email: "user@example.com",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastVerifiedAt: "2026-01-01T00:00:00.000Z",
      credentialStore: "windows-dpapi",
    }))).resolves.toBeNull();
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

  it("still clears session when credential deletion fails", async () => {
    const deletePassword = vi.fn(async () => {
      throw new Error("delete failed");
    });
    const loadSession = vi.fn(async () => ({
      email: "user@example.com",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastVerifiedAt: "2026-01-01T00:00:00.000Z",
    }));
    const clearSession = vi.fn(async () => {});
    await expect(handleLogoutFlow(deletePassword, loadSession, clearSession)).resolves.toBe(0);
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

describe("cognitive UI", () => {
  it("renders cognitive prompt and context line", () => {
    expect(renderCognitivePrompt()).toContain("frida-rpa:cognitive");
    const line = renderCognitiveContextLine({ appId: "1", suiteId: "2", processId: "3" });
    expect(line).toContain("app=1");
    expect(line).toContain("suite=2");
    expect(line).toContain("process=3");
  });
});
