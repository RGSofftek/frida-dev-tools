# FRIDA lint, auto-fix, and sync to Cognitive

Run the FRIDA formatter, apply **safe** linter fixes automatically, confirm the tree is clean, then push `Actions.txt`, `datadrive.txt`, and `headers.txt` to Cognitive Testing.

This command **does not** wait for per-diagnostic approval (unlike `/frida-lint-fix`). It applies only what `check --fix` can fix safely. If anything remains, **do not run sync**; report diagnostics and point the user to `/frida-lint-fix` for iterative review.

## Working directory

Run every Python command from the **project root** (the folder that contains `Actions.txt` and `.cursor/tools/`).

## Target files (`<target>`)

- If the user passed a path or glob after the command, use that as `<target>` (one or more tokens; pass them through to `frida_lint.py`).
- Otherwise: prefer `Actions.txt` in the project root if it exists; else the focused `.txt` file; else `*.txt` in the project root.
- If the main script uses `RunScript` and you are linting that main file (e.g. `Actions.txt`), add **`--follow-scripts`** so sub-scripts stay consistent (same idea as the frida-dev rule for lint targets).

## Step 1 – Format

```bash
python .cursor/tools/frida_lint.py format [--follow-scripts] <target>
```

## Step 2 – Apply safe fixes

```bash
python .cursor/tools/frida_lint.py check --fix [--follow-scripts] <target>
```

Use **`--unsafe-fixes`** only if the user explicitly asks for unsafe fixes in the same invocation.

## Step 3 – Format again

Safe fixes can leave lines that the formatter normalizes:

```bash
python .cursor/tools/frida_lint.py format [--follow-scripts] <target>
```

## Step 4 – Verify before upload

```bash
python .cursor/tools/frida_lint.py check --json [--follow-scripts] <target>
```

- **Exit code 0**: proceed to sync.
- **Exit code 1**: print a concise summary from the JSON (file, line, code, message). **Stop. Do not run `sync_actions_to_cognitive.py`.** Tell the user to fix manually or run `/frida-lint-fix`.

Optional second pass (only if you still see only fixable noise after step 2): repeat Step 2–4 once; do not loop more than **twice** total without user direction.

## Step 5 – Sync to Cognitive

Only after Step 4 succeeds:

```bash
python .cursor/tools/sync_actions_to_cognitive.py
```

Respect the user if they ask for **`--dry-run`** (print payloads only) or pass through other flags documented in `sync_actions_to_cognitive.py` (`--dir`, `--process-id`, `--step`, `--user-uuid`, `--app-usage-auth`, `--platform`, `--version`, `--no-sanitize`).

**Environment variables** (when not overridden by flags): `COGNITIVE_USER_UUID`, `COGNITIVE_APP_USAGE_AUTH`, `COGNITIVE_PROCESS_ID`, `COGNITIVE_STEP_INDEX`, `COGNITIVE_PLATFORM`, `COGNITIVE_CLIENT_VERSION`. If sync fails for auth or missing files, report the error output clearly.

To **pull** remote `Actions.txt` down after editing on Cognitive (opposite direction), use `python .cursor/tools/fetch_actions_from_cognitive.py` (see that script for `--dry-run` and `--backup`).

## Summary

1. `format` → `check --fix` → `format` → `check --json` (all with the same `<target>` and optional `--follow-scripts`).
2. Sync only on clean lint.
3. No sync on failure; hand off to `/frida-lint-fix` when human judgment is needed.
