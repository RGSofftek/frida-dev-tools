/** Matches `editor.tokenColorCustomizations` textMateRules entries for `[frida]`. */
export type FridaTextMateRule = {
  scope?: string | string[];
  settings: { foreground?: string; background?: string; fontStyle?: string };
};

export type FridaSyntaxPaletteName = "dark" | "light" | "highContrast";

/**
 * Bundled TextMate rules for `editor.tokenColorCustomizations["[frida]"]`.
 * Single source of truth; extension applies these at runtime to user settings.
 */
export function getFridaTextMateRules(palette: FridaSyntaxPaletteName): FridaTextMateRule[] {
  switch (palette) {
    case "light":
      return lightRules;
    case "highContrast":
      return highContrastRules;
    case "dark":
    default:
      return darkRules;
  }
}

const darkRules: FridaTextMateRule[] = [
  { scope: "variable.parameter.placeholder.frida", settings: { foreground: "#E07A5F" } },
  { scope: "variable.other.global.frida", settings: { foreground: "#6B9FD9" } },
  { scope: "variable.other.runtime.frida", settings: { foreground: "#4EC9B0" } },
  { scope: "variable.other.braced.frida", settings: { foreground: "#DCDC9F" } },
  { scope: "entity.name.namespace.frida", settings: { foreground: "#9CDCFE" } },
  { scope: "entity.name.function.frida", settings: { foreground: "#EFB080" } },
  { scope: "keyword.control.frida", settings: { foreground: "#C586C0" } },
  { scope: "keyword.operator.frida", settings: { foreground: "#D4D4D4" } },
  { scope: "keyword.operator.increment.frida", settings: { foreground: "#D4D4D4" } },
  { scope: "string.quoted.double.frida", settings: { foreground: "#CE9178" } },
  { scope: "constant.character.escape.frida", settings: { foreground: "#D7BA7D" } },
  { scope: "constant.numeric.frida", settings: { foreground: "#B5CEA8" } },
  { scope: "comment.line.suppression.frida", settings: { foreground: "#6A9955" } },
  { scope: "comment.line.important.frida", settings: { foreground: "#6A9955" } },
  { scope: "comment.line.warning.frida", settings: { foreground: "#D7BA7D" } },
  { scope: "comment.line.error.frida", settings: { foreground: "#F44747" } },
  { scope: "comment.line.number-sign.frida", settings: { foreground: "#6A9955" } },
  { scope: "meta.region.begin.frida", settings: { foreground: "#569CD6", fontStyle: "italic" } },
  { scope: "meta.region.end.frida", settings: { foreground: "#569CD6", fontStyle: "italic" } },
];

const lightRules: FridaTextMateRule[] = [
  { scope: "variable.parameter.placeholder.frida", settings: { foreground: "#A33A2A" } },
  { scope: "variable.other.global.frida", settings: { foreground: "#0050B3" } },
  { scope: "variable.other.runtime.frida", settings: { foreground: "#00786C" } },
  { scope: "variable.other.braced.frida", settings: { foreground: "#5C4E00" } },
  { scope: "entity.name.namespace.frida", settings: { foreground: "#0451A5" } },
  { scope: "entity.name.function.frida", settings: { foreground: "#795E26" } },
  { scope: "keyword.control.frida", settings: { foreground: "#AF00DB" } },
  { scope: "keyword.operator.frida", settings: { foreground: "#000000" } },
  { scope: "keyword.operator.increment.frida", settings: { foreground: "#000000" } },
  { scope: "string.quoted.double.frida", settings: { foreground: "#A31515" } },
  { scope: "constant.character.escape.frida", settings: { foreground: "#811F3F" } },
  { scope: "constant.numeric.frida", settings: { foreground: "#098658" } },
  { scope: "comment.line.suppression.frida", settings: { foreground: "#008000" } },
  { scope: "comment.line.important.frida", settings: { foreground: "#008000" } },
  { scope: "comment.line.warning.frida", settings: { foreground: "#795E26" } },
  { scope: "comment.line.error.frida", settings: { foreground: "#E51400" } },
  { scope: "comment.line.number-sign.frida", settings: { foreground: "#008000" } },
  { scope: "meta.region.begin.frida", settings: { foreground: "#0451A5", fontStyle: "italic" } },
  { scope: "meta.region.end.frida", settings: { foreground: "#0451A5", fontStyle: "italic" } },
];

const highContrastRules: FridaTextMateRule[] = [
  { scope: "variable.parameter.placeholder.frida", settings: { foreground: "#FF6633" } },
  { scope: "variable.other.global.frida", settings: { foreground: "#649CFF" } },
  { scope: "variable.other.runtime.frida", settings: { foreground: "#3FFFD4" } },
  { scope: "variable.other.braced.frida", settings: { foreground: "#FFFF00" } },
  { scope: "entity.name.namespace.frida", settings: { foreground: "#00FFFF" } },
  { scope: "entity.name.function.frida", settings: { foreground: "#FFFF00" } },
  { scope: "keyword.control.frida", settings: { foreground: "#FF00FF" } },
  { scope: "keyword.operator.frida", settings: { foreground: "#FFFFFF" } },
  { scope: "keyword.operator.increment.frida", settings: { foreground: "#FFFFFF" } },
  { scope: "string.quoted.double.frida", settings: { foreground: "#00FF88" } },
  { scope: "constant.character.escape.frida", settings: { foreground: "#FFFF00" } },
  { scope: "constant.numeric.frida", settings: { foreground: "#00FF00" } },
  { scope: "comment.line.suppression.frida", settings: { foreground: "#00FF00" } },
  { scope: "comment.line.important.frida", settings: { foreground: "#00FF00" } },
  { scope: "comment.line.warning.frida", settings: { foreground: "#FFFF00" } },
  { scope: "comment.line.error.frida", settings: { foreground: "#FF0000" } },
  { scope: "comment.line.number-sign.frida", settings: { foreground: "#00FF00" } },
  { scope: "meta.region.begin.frida", settings: { foreground: "#00FFFF", fontStyle: "italic" } },
  { scope: "meta.region.end.frida", settings: { foreground: "#00FFFF", fontStyle: "italic" } },
];
