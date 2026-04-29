# FRIDA Editor Extension

VS Code/Cursor extension that adds language tooling for FRIDA automation scripts.

## Features

- FRIDA language registration (`frida`)
- TextMate syntax highlighting for:
  - comments and region markers
  - variable interpolation (`<<<>>>`, `<<>>`, `<>` doc-style placeholders, `{}`)
  - reader prefixes (SAP, Excel, File, etc.)
  - common Mix instructions
- Bundled **syntax colors** for FRIDA (bracket tiers, reader/mix verbs, control words, operators, strings, comments, regions): the extension writes **`[frida].editor.tokenColorCustomizations.textMateRules`** in your **user** settings while it is enabled (language-specific block, not `editor.tokenColorCustomizations["[frida]"]`, which targets a **theme** named `frida`). Palettes are defined in `src/fridaTokenColors.ts` (single source of truth).
- **`frida.syntaxColorScheme`**: `auto` (follows active color theme: dark / light / high contrast), or force `dark`, `light`, or `highContrast`. Unknown future theme kinds fall back to the **dark** palette when using `auto`.
- **Workspace vs user**: the extension updates the **user (global)** `"[frida]"` language section, merging `editor.tokenColorCustomizations` and replacing **`textMateRules`**. If you set **`[frida].editor.tokenColorCustomizations`** in **workspace** settings, VS Code’s normal precedence applies; check **Settings (JSON)** if colors look wrong.
- **Manual edits**: customizing **`[frida].editor.tokenColorCustomizations`** in user settings may be overwritten when the extension reapplies **`textMateRules`**. Remove a mistaken legacy key **`editor.tokenColorCustomizations["[frida]"]`** (theme override) if present; it does not color FRIDA files. To opt out of bundled colors, adjust rules after disabling the extension or edit **`textMateRules`** knowing they may be replaced on reload.
- **Sync / policy**: user-level settings may sync across machines; ensure that is acceptable in your environment.
- Language config:
  - `##` line comments
  - region folding with `#%region` / `#%endregion`
  - bracket and quote pairing
- Snippets for common blocks and instructions
- LSP completion + hover backed by `resources/frida.completion.json`

## Completion Index Schema

The generated completion index currently uses `schemaVersion: 2`.

- Each function can expose multiple syntax variants.
- `syntax` entries are objects with:
  - `raw`: full documented syntax line
  - `stripped`: reader-prefix stripped form for reader-context insertion
  - `syntaxSource`: `docs` or `readers`

## File Association

This extension does not claim all `.txt` files.

In the repository where you run FRIDA scripts, create or update `.vscode/settings.json` and configure `frida.filePatterns` to auto-assign language mode:

```json
{
  "frida.filePatterns": [
    "**/Actions.txt",
    "**/*SAPStatus*.txt"
  ]
}
```

Add more FRIDA script names by adding additional globs to `frida.filePatterns`. For example:

```json
{
  "frida.filePatterns": [
    "**/Actions.txt",
    "**/headers.txt",
    "**/datadrive.txt",
    "**/*SAPStatus*.txt",
    "**/*MyCustomFridaScript*.txt"
  ]
}
```

You can also define explicit language associations in your workspace:

```json
{
  "files.associations": {
    "**/Actions.txt": "frida"
  }
}
```

## Build Completion Index

The completion index is generated from docs in this repo:

```bash
python ./scripts/build_completion_index.py --docs ./resources/frida-docs --out ./resources/frida.completion.json --coverage ./resources/coverage-report.json
```

Optional enrichment with an external `readers.json`:

```bash
python ./scripts/build_completion_index.py --docs ./resources/frida-docs --out ./resources/frida.completion.json --coverage ./resources/coverage-report.json --readers C:/path/to/readers.json
```

## Tests

The extension uses:

- `vitest` for TypeScript completion/LSP helper tests
- `pytest` for Python completion-index parser tests

Run all tests:

```bash
npm test
```

Run one suite:

```bash
npm run test:ts
npm run test:py
```

## Build and Package

```bash
npm install
npm run vscode:prepublish
npx @vscode/vsce package
```

Install the generated `.vsix` from Cursor/VS Code command palette:

- `Extensions: Install from VSIX...`

## Local CLI (`frida-rpa`)

This repo provides a local CLI for FRIDA workspace setup and day-to-day terminal workflows.
The command is `frida-rpa`; `frida-work` is kept as a compatibility alias during migration.

Important naming note:
- npm package name: `frida-editor-tools`
- installed command names: `frida-rpa` (primary), `frida-work` (temporary alias)

Build first so the binary exists in `out/`:

```bash
npm run compile
```

Install the local command globally for your machine:

```bash
npm link
```

Usage:

```bash
frida-rpa open
frida-rpa open <path>
frida-rpa open <path> --editor cursor
frida-rpa open <path> --patterns "**/Actions.txt,**/*SAPStatus*.txt"
frida-rpa open <path> --settings-source "C:/templates/.vscode/settings.json"
frida-rpa open <path> --settings-source "C:/templates/.vscode/settings.json" --settings-mode replace
frida-rpa open <path> --dry-run
frida-rpa open <path> --no-dev-host
frida-rpa status
frida-rpa login
frida-rpa lint
frida-rpa fix
frida-rpa push
frida-rpa pull --backup
frida-rpa
```

Help usage:

```bash
frida-rpa --help
frida-rpa help push
```

Behavior:
- Defaults `frida.filePatterns` to `["**/Actions.txt"]` when none exist.
- `--patterns` replaces `frida.filePatterns` with the provided comma-separated list.
- `--settings-source` loads a source `settings.json` and applies FRIDA/editor color config into the workspace settings.
- `--settings-mode merge` (default) overlays source FRIDA-related keys while preserving unrelated workspace settings.
- `--settings-mode replace` replaces workspace `.vscode/settings.json` with source content before applying explicit CLI overrides.
- Precedence order is: existing workspace settings -> source settings per `--settings-mode` -> CLI overrides (currently `--patterns`).
- `--dry-run` reports intended actions without writing files or opening an editor.
- `open` with no path uses the current working directory (same as `frida-rpa open .`).
- Default editor for `open` is VS Code (`code`). Use `--editor cursor` to opt in to Cursor.
- When `open` can resolve the local extension repo path, it launches in extension development host mode even if the target FRIDA workspace is outside this repo.
- `--no-dev-host` is the explicit escape hatch for a plain editor window.
- `--init` is reserved for a future release and currently has no behavior.
- Running `frida-rpa` with no command starts an interactive shell (`frida-rpa >`).
- In the interactive shell, use `exit` or `quit` to return to your terminal.
- `login` stores a local CLI session marker, but current `pull`, `push`, and `sync` commands run through `resources/cli-tools` (invoked from the `frida-rpa` binary) and do not require that local login session.
- `push` includes a freshness guard: it verifies the remote file has not changed since the last `pull` or `push` before uploading, preventing accidental overwrites. If the remote has changed, it blocks and suggests manual review.

Run focused TypeScript tests (including CLI tests):

```bash
npm run test:ts
```
