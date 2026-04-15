# Extension repo initialization

This file contains all the steps to set up this directory as a standalone extension repo. Run an agent here after opening this directory as a fresh workspace.

Assumptions:
- You just moved the contents of `vscode-frida-extension/` into a new empty directory.
- No `git init` has been run yet.
- No `npm install` has been run yet.
- No `.cursor` subtree is present yet.
- All internal paths still reference the old layout (`../.cursor/docs`).

## Steps (execute in order)

### 1. Initialize git repo

```bash
git init
git add -A
git commit -m "Initial import of FRIDA extension from parent repo"
```

### 2. Import .cursor subtree

```bash
git remote add frida-tooling https://github.com/RGSofftek/frida-dev-tools.git
git fetch frida-tooling
git subtree add --prefix=.cursor frida-tooling/main --squash
```

This creates `.cursor/` with `docs/`, `rules/`, `tools/`, etc.

### 3. Update docs path references

Three files reference `../.cursor/docs` (the old parent-relative path). Replace all occurrences with `./.cursor/docs`:

**`package.json`** line with `build:index` script:
- old: `--docs ../.cursor/docs`
- new: `--docs ./.cursor/docs`

**`README.md`** two bash command blocks under "Build Completion Index":
- old: `--docs ../.cursor/docs` (appears twice)
- new: `--docs ./.cursor/docs`

No other files need path updates.

### 4. Create `.vscode/launch.json`

Create `.vscode/launch.json` with this content (extension root is now the repo root, no subfolder):

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Run FRIDA Extension",
      "type": "extensionHost",
      "request": "launch",
      "runtimeExecutable": "${execPath}",
      "args": [
        "--extensionDevelopmentPath=${workspaceFolder}"
      ]
    }
  ]
}
```

### 5. Install dependencies

```bash
npm install
```

### 6. Build and verify

```bash
npm run build:index
npm run compile
npm test
```

All must succeed:
- `build:index` prints coverage summary and writes `resources/frida.completion.json` + `resources/coverage-report.json`
- `compile` produces `out/` with no errors
- `test` runs vitest (7 tests) + pytest (7 tests), all passing

### 7. Commit everything

```bash
git add -A
git commit -m "Complete standalone repo setup: subtree, path updates, build verified"
```

### 8. Clean up

Delete this `init.md` file:

```bash
rm init.md
git add -A
git commit -m "Remove initialization instructions"
```

## Quick reference after setup

| Task | Command |
|------|---------|
| Rebuild completion index | `npm run build:index` |
| Compile TypeScript | `npm run compile` |
| Full prepublish (index + compile) | `npm run vscode:prepublish` |
| Run all tests | `npm test` |
| Package VSIX | `npm run package` |
| Pull latest .cursor subtree updates | `git subtree pull --prefix=.cursor frida-tooling/main --squash` |
| Push .cursor changes back upstream | `git subtree push --prefix=.cursor frida-tooling/main` |
