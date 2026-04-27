import { spawn } from "node:child_process";
import { spawnSync } from "node:child_process";

export type EditorName = "cursor" | "code";

export interface EditorBinary {
  name: EditorName;
  command: string;
}

export interface OpenWorkspaceOptions {
  extensionDevelopmentPath?: string;
}

export type CommandExists = (command: string) => boolean;
export interface DetectEditorOptions {
  defaultEditor?: EditorName;
  strictDefault?: boolean;
}

function commandExists(command: string): boolean {
  const lookup = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(lookup, [command], { stdio: "ignore" });
  return result.status === 0;
}

export async function detectEditor(
  preferred?: EditorName,
  exists: CommandExists = commandExists,
  options: DetectEditorOptions = {},
): Promise<EditorBinary> {
  const defaultEditor = options.defaultEditor ?? "code";
  if (preferred) {
    if (exists(preferred)) {
      return { name: preferred, command: preferred };
    }
    throw new Error(
      `Preferred editor "${preferred}" is not available on PATH. Install it or use --editor with an available option.`,
    );
  }

  if (exists(defaultEditor)) {
    return { name: defaultEditor, command: defaultEditor };
  }
  const alternate = defaultEditor === "code" ? "cursor" : "code";
  if (!options.strictDefault && exists(alternate)) {
    return { name: alternate, command: alternate };
  }

  if (options.strictDefault) {
    throw new Error(
      `Default editor "${defaultEditor}" is not available on PATH. Use --editor cursor if Cursor is installed.`,
    );
  }
  throw new Error(
    "No supported editor binary found on PATH. Install Cursor or VS Code, or run with --editor cursor|code.",
  );
}

export async function openWorkspaceInEditor(
  editor: EditorBinary,
  workspacePath: string,
  options: OpenWorkspaceOptions = {},
): Promise<void> {
  const args = options.extensionDevelopmentPath
    ? [`--extensionDevelopmentPath=${options.extensionDevelopmentPath}`, workspacePath]
    : [workspacePath];

  await new Promise<void>((resolve, reject) => {
    const child = spawn(editor.command, args, {
      stdio: "ignore",
      detached: true,
      // On Windows, editor CLIs are commonly .cmd shims that require shell resolution.
      shell: process.platform === "win32",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}
