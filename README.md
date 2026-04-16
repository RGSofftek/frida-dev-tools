# FRIDA Editor Extension

VS Code/Cursor extension that adds language tooling for FRIDA automation scripts.

## Features

- FRIDA language registration (`frida`)
- TextMate syntax highlighting for:
  - comments and region markers
  - variable interpolation (`<<<>>>`, `<<>>`, `{}`)
  - reader prefixes (SAP, Excel, File, etc.)
  - common Mix instructions
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
python ./scripts/build_completion_index.py --docs ./.cursor/docs --out ./resources/frida.completion.json --coverage ./resources/coverage-report.json
```

Optional enrichment with an external `readers.json`:

```bash
python ./scripts/build_completion_index.py --docs ./.cursor/docs --out ./resources/frida.completion.json --coverage ./resources/coverage-report.json --readers C:/path/to/readers.json
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
