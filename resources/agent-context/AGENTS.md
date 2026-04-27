# FRIDA workspace (agent instructions)

This folder contains FRIDA (Fast Robotic Intelligent Digital Assistant) automation scripts and related assets. FRIDA uses reader-specific instructions (SAP, Excel, Web, Mix, etc.). **Do not guess instruction names or parameters.**

## Where to read first

1. Open `agent-docs/readers-index.md` and identify which reader applies to the task.
2. Read `agent-docs/frida-core.md` for language-wide rules (syntax, variables, comparisons, RunScript, antipatterns).
3. Load **only** the reader doc(s) you need, for example `agent-docs/sap-reader.md`, `agent-docs/excel-reader.md`, or `agent-docs/browpet-reader.md`.
4. Use `agent-docs/syntax-cheatsheet.md` for shared syntax (variables, control flow, operators) when unsure.

Optional topic guides in the same folder:

- `agent-docs/frida-sap.md` — SAP batch patterns, status bar, recovery
- `agent-docs/frida-excel.md` — workbook lifecycle, checkpoints, resume
- `agent-docs/frida-web.md` — Browpet/Web conventions and waiting
- `agent-docs/frida-dev.md` — lint, RunScript call graph, tooling from repo root

## Hard rules (short list)

- **Single-line instructions** — no reader instruction may span multiple lines. Only control-flow blocks may use multiple lines.
- **Docs before coding** — resolve every instruction from `agent-docs/*-reader.md`, not from memory.
- **Booleans are strings** — compare to `"true"` / `"false"`, not raw boolean `if (<<<x>>>)`.
- **`while` conditions stay simple** — no `-AND` / `-OR` in `while`; use `if` + `break` inside the loop.
- **No `continue`** — FRIDA does not support `continue`; use a flag and wrap the loop body.
- **`RunScript`** — shared variables with sub-scripts; when you change a script that calls `RunScript Name`, include `Name.txt` in lint/fix scope when you run checks.

## Validate changes

After editing `.txt` FRIDA scripts:

- Prefer **`frida-rpa lint`** then **`frida-rpa fix`** from the **project root** when the FRIDA RPA CLI is installed.
- If the repo vendors Python lint tooling instead, run it from the project root per that repo’s documentation.

## Cognitive / ASCII

If scripts sync to Cognitive Testing, keep payloads ASCII-safe where required; see `agent-docs/frida-core.md` (Cognitive / ASCII-safe text).
