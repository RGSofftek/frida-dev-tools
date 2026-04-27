import * as vscode from "vscode";
import { getFridaTextMateRules, type FridaSyntaxPaletteName } from "./fridaTokenColors";

export type FridaSyntaxColorScheme = "auto" | "dark" | "light" | "highContrast";

export function resolveFridaPalette(
  scheme: FridaSyntaxColorScheme,
  themeKind: vscode.ColorThemeKind,
): FridaSyntaxPaletteName {
  if (scheme === "dark") {
    return "dark";
  }
  if (scheme === "light") {
    return "light";
  }
  if (scheme === "highContrast") {
    return "highContrast";
  }
  switch (themeKind) {
    case vscode.ColorThemeKind.Dark:
      return "dark";
    case vscode.ColorThemeKind.Light:
      return "light";
    case vscode.ColorThemeKind.HighContrast:
    case vscode.ColorThemeKind.HighContrastLight:
      return "highContrast";
    default:
      return "dark";
  }
}

/**
 * Writes bundled FRIDA `textMateRules` into **user** settings under the **language** block
 * `"[frida]": { "editor.tokenColorCustomizations": { "textMateRules": [...] } }`.
 *
 * Note: `editor.tokenColorCustomizations["[frida]"]` (nested under `editor`) means a **color theme**
 * named `frida`, not the language id. Language-specific colors must use the top-level `[frida]` section.
 */
export async function applyBundledFridaTokenColorsToUserSettings(): Promise<void> {
  const ws = vscode.workspace.getConfiguration();
  const scheme = ws.get<FridaSyntaxColorScheme>("frida.syntaxColorScheme", "auto");
  const themeKind = vscode.window.activeColorTheme.kind;
  const palette = resolveFridaPalette(scheme, themeKind);
  const rules = getFridaTextMateRules(palette);

  const fridaLang = vscode.workspace.getConfiguration("[frida]");
  const inspect = fridaLang.inspect<Record<string, unknown>>("editor.tokenColorCustomizations");
  const globalValue = inspect?.globalValue;
  const base =
    typeof globalValue === "object" && globalValue !== null && !Array.isArray(globalValue)
      ? { ...(globalValue as Record<string, unknown>) }
      : {};

  const prevRules = base.textMateRules;
  if (prevRules !== undefined && JSON.stringify(prevRules) === JSON.stringify(rules)) {
    return;
  }

  base.textMateRules = rules;

  await fridaLang.update("editor.tokenColorCustomizations", base, vscode.ConfigurationTarget.Global);
}

export function registerFridaTokenColorApplication(context: vscode.ExtensionContext): void {
  const run = (): void => {
    void applyBundledFridaTokenColorsToUserSettings();
  };

  run();

  context.subscriptions.push(
    vscode.window.onDidChangeActiveColorTheme(() => {
      const scheme = vscode.workspace.getConfiguration().get<FridaSyntaxColorScheme>("frida.syntaxColorScheme", "auto");
      if (scheme === "auto") {
        run();
      }
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("frida.syntaxColorScheme")) {
        run();
      }
    }),
  );
}
