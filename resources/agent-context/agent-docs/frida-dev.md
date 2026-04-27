# FRIDA development workflow (any agent or IDE)

## Lint after script edits

After you change one or more FRIDA scripts (`.txt` files):

- Run **`frida-rpa lint`** from the **project root** of the FRIDA workspace (or pass explicit targets if your setup supports that).
- Run **`frida-rpa fix`** when you want format plus safe automated fixes, then re-run lint until clean.

If the repository vendors Python lint instead, run that tooling from the project root per the repo (for example `python frida_lint.py` when present). Paths and config (e.g. `.fridalintrc`) should resolve from the current working directory.

## RunScript and lint scope

When a script contains `RunScript <Name>`, include **`<Name>.txt`** in the same lint or fix run as the main script so the call graph stays consistent (main file clean, sub-script broken is a common miss).

## Resolve syntax from docs

When adding or changing FRIDA instructions, get names and parameters from `readers-index.md` and the relevant `*-reader.md` in this folder, plus `frida-core.md` for structure. Do not guess.

## Sub-scripts and shared variables

When a change affects variables or control flow that a `RunScript` sub-script relies on, update the sub-script in the same task, then run lint on **all** modified `.txt` files.
