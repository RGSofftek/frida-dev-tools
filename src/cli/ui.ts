import type { ContextSummary } from "./context";

const color = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  pink: "\x1b[95m",
  white: "\x1b[97m",
  gray: "\x1b[90m",
  blue: "\x1b[94m",
};

function applyColor(text: string, token: string): string {
  if (process.env.NO_COLOR) {
    return text;
  }
  return `${token}${text}${color.reset}`;
}

export function renderBanner(): string {
  const bannerRows = [
    "███████╗██████╗ ██╗██████╗  █████╗     ██████╗ ██████╗  █████╗",
    "██╔════╝██╔══██╗██║██╔══██╗██╔══██╗    ██╔══██╗██╔══██╗██╔══██╗",
    "█████╗  ██████╔╝██║██║  ██║███████║    ██████╔╝██████╔╝███████║",
    "██╔══╝  ██╔══██╗██║██║  ██║██╔══██║    ██╔══██╗██╔═══╝ ██╔══██║",
    "██║     ██║  ██║██║██████╔╝██║  ██║    ██║  ██║██║     ██║  ██║",
    "╚═╝     ╚═╝  ╚═╝╚═╝╚═════╝ ╚═╝  ╚═╝    ╚═╝  ╚═╝╚═╝     ╚═╝  ╚═╝",
  ];
  const coloredRows = bannerRows.map((row, rowIndex) => {
    const lead = rowIndex < bannerRows.length - 1 ? ">" : " ";
    if (process.env.NO_COLOR) {
      return `${lead}  ${row}`;
    }
    const chars = row.split("");
    const out = chars
      .map((char, idx) => {
        const ratio = chars.length <= 1 ? 0 : idx / (chars.length - 1);
        const tone = ratio < 0.68 ? color.pink : ratio < 0.88 ? color.white : color.gray;
        return `${tone}${char}${color.reset}`;
      })
      .join("");
    return `${color.pink}${lead}${color.reset}  ${out}`;
  });
  return [
    ...coloredRows,
    applyColor("DEVELOPMENT CLI", `${color.bright}${color.white}`),
    applyColor("────────────────────────────────────────────────────────", color.pink),
    "",
    applyColor("Tips for getting started:", color.dim),
    `1. ${applyColor("login", color.pink)}  Sign in to Cognitive`,
    `2. ${applyColor("status", color.pink)} Show detected process folder context`,
    `3. ${applyColor("lint", color.pink)}   Check local FRIDA scripts`,
    `4. ${applyColor("help", color.pink)}   Show all commands`,
    "",
  ].join("\n");
}

export function renderPrompt(): string {
  return `${applyColor("frida-rpa", `${color.bright}${color.pink}`)} ${applyColor(">", color.blue)} `;
}

function cognitiveStatus(summary: ContextSummary): string {
  return `Cognitive    ${summary.auth === "signed_in" ? `signed in${summary.userEmail ? ` as ${summary.userEmail}` : ""}` : "not signed in"}`;
}

export function renderStatusPanel(summary: ContextSummary, opts?: { compact?: boolean }): string {
  if (opts?.compact) {
    return cognitiveStatus(summary);
  }
  const lines = [
    "Current FRIDA context",
    `Folder       ${summary.cwd}`,
    `Process      ${summary.processId ?? "not detected"}`,
    `Step         ${summary.step ?? "not detected"}`,
    `Actions.txt  ${summary.files.actions ? "found" : "missing"}`,
    `datadrive.txt ${summary.files.datadrive ? "found" : "missing"}`,
    `headers.txt  ${summary.files.headers ? "found" : "missing"}`,
    cognitiveStatus(summary),
    `RunScript    ${summary.runScriptTargets.length > 0 ? summary.runScriptTargets.join(", ") : "none detected"}`,
  ];
  if (!summary.isFridaProcessFolder) {
    lines.push("Note         Folder does not match .../Local/<process>/<step> shape.");
  }
  return lines.join("\n");
}
