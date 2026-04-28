"""
Static documentation for frida_lint rules.

Keep RULES in sync with run_lint() rule_list in frida_lint.py (codes and primary messages).
Longer descriptions are for human/cli output only.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class RuleInfo:
    code: str
    severity: str  # error | warning | convention | style
    message: str
    description: str
    fixable: bool
    fix_kind: str | None  # "safe" | "unsafe" | None
    noqa: bool  # whether ## noqa: <CODE> on the line can suppress the diagnostic

    def to_json_dict(self) -> dict:
        d = asdict(self)
        return d


# Order matches frida_lint.run_lint rule_list (C001 is separate in implementation but listed first for docs).
RULES: list[RuleInfo] = [
    RuleInfo(
        "C001",
        "convention",
        "Missing global variables documentation block at script top",
        "Suggests inserting a GLOBAL VARIABLES comment block at the top when <<globals>> are used. "
        "Fixable: safe insert. When C001 applies, W003 is not reported for the same run.",
        True,
        "safe",
        True,
    ),
    RuleInfo(
        "E001",
        "error",
        "'continue' does not exist in FRIDA; use flag variable + conditional instead",
        "FRIDA has no continue; use a boolean flag and wrap the rest of the loop body in if.",
        False,
        None,
        True,
    ),
    RuleInfo(
        "E002",
        "error",
        'Bare boolean in if(); use string comparison e.g. -eq "true"',
        "if (<<<x>>>) is invalid; compare to string true/false. Auto-fix: safe (rewrites to -eq).",
        True,
        "safe",
        True,
    ),
    RuleInfo(
        "E003",
        "error",
        "Compound operators (-AND/-OR/-NOT/-XOR) not allowed in while; use if+break inside loop",
        "while() must use a single simple condition; use nested if and break for compound logic.",
        False,
        None,
        True,
    ),
    RuleInfo(
        "E004",
        "error",
        "Block mismatch (end vs } or wrong closer)",
        "Control-flow closers must match: if/try/catch use end; for/while/switch use }.",
        False,
        None,
        False,
    ),
    RuleInfo(
        "E005",
        "error",
        "Unbalanced block (extra closer or unclosed block)",
        "Stack of block open/close is inconsistent; fix structure.",
        False,
        None,
        False,
    ),
    RuleInfo(
        "E006",
        "error",
        "Throw does not exist in FRIDA",
        "Remove or replace Throw with supported error handling.",
        False,
        None,
        True,
    ),
    RuleInfo(
        "E007",
        "error",
        "Instruction may be split across lines (FRIDA requires single-line instructions)",
        "Heuristic: previous reader line looks incomplete. Keep each instruction on one line.",
        False,
        None,
        True,
    ),
    RuleInfo(
        "E008",
        "error",
        "RunScript references missing file",
        "The .txt file for RunScript was not found next to the script (path shown in full message).",
        False,
        None,
        True,
    ),
    RuleInfo(
        "W001",
        "warning",
        "Variable used but never declared (see message for name)",
        "A <<<name>>> reference has no matching DefineVariable (or other declaration) in scope.",
        False,
        None,
        False,
    ),
    RuleInfo(
        "W002",
        "warning",
        "Variable declared but never used (see message for name)",
        "A declared local is never read; may be dead code or a typo.",
        False,
        None,
        False,
    ),
    RuleInfo(
        "W003",
        "warning",
        "Global used but not documented in header block (see message)",
        "Add <<Name>> to the GLOBAL VARIABLES section (suppressed if C001 already added a block this run).",
        False,
        None,
        True,
    ),
    RuleInfo(
        "W004",
        "warning",
        "systemnotify/SystemNotify used (avoid unless explicitly requested)",
        "Policy: prefer logging/mail over OS notifications. Unsafe auto-fix may comment out the line; "
        "or add ## noqa: W004 on the instruction line to keep it and acknowledge intent.",
        True,
        "unsafe",
        True,
    ),
    RuleInfo(
        "W005",
        "warning",
        "Finish inside loop; consider log-and-continue for row-level errors",
        "Finish aborts the whole run; inside a loop you may want to record the row and continue instead.",
        False,
        None,
        True,
    ),
    RuleInfo(
        "W006",
        "warning",
        "SAP instruction inside loop but outside try/catch block",
        "Transactional work in loops is usually wrapped in try/catch for per-iteration errors.",
        False,
        None,
        True,
    ),
    RuleInfo(
        "W007",
        "warning",
        "Excel workbook opened but never closed (use Excel Save WB and close or Excel Close WB)",
        "A workbook was opened; ensure a close/save path on all exits.",
        False,
        None,
        True,
    ),
    RuleInfo(
        "W009",
        "warning",
        "Catch inside loop without SAP CloseTrans (transaction recovery)",
        "When the catch is in a loop and contains SAP calls, include CloseTrans for clean recovery.",
        False,
        None,
        True,
    ),
    RuleInfo(
        "W010",
        "warning",
        "Unmatched #%region / #%endregion",
        "Region open/close markers are unpaired; fix markers or order.",
        False,
        None,
        True,
    ),
    RuleInfo(
        "W011",
        "warning",
        "Excel ReadCell result used in SAP without prior empty-check",
        "Heuristic: value flows to SAP without an if guard; validate empty/NA as needed.",
        False,
        None,
        True,
    ),
    RuleInfo(
        "W012",
        "warning",
        "SAP SendKey 0 without subsequent GetStatusInfo or RunScript CheckSAPStatus",
        "After Enter, read status or run a status script within a few lines.",
        False,
        None,
        True,
    ),
    RuleInfo(
        "W013",
        "warning",
        "try block with empty catch (silently swallowing errors)",
        "Empty catch hides failures. Exception: catch after SAP CloseTrans alone may be allowed.",
        False,
        None,
        True,
    ),
    RuleInfo(
        "W018",
        "warning",
        "for 0 times - dead code, loop body never executes",
        "The loop count is zero; the body will not run.",
        False,
        None,
        True,
    ),
    RuleInfo(
        "W019",
        "warning",
        "Non-ASCII or Cognitive-unsafe characters (prefer ASCII; run format or check --fix)",
        "Cognitive upload rejects non-ASCII; format/check --fix normalizes. Use ## noqa: W019 to keep a line as-is.",
        True,
        "safe",
        True,
    ),
    RuleInfo(
        "S001",
        "style",
        "Expected indent does not match block depth",
        "Indentation should follow control-flow nesting (tabs or spaces per config). Auto-fix: safe.",
        True,
        "safe",
        True,
    ),
    RuleInfo(
        "S002",
        "style",
        "Comment missing space after ##",
        "Use ## with a space before prose. Auto-fix: safe.",
        True,
        "safe",
        True,
    ),
    RuleInfo(
        "S003",
        "style",
        "Trailing whitespace",
        "Auto-fix: safe (strip end of line).",
        True,
        "safe",
        True,
    ),
    RuleInfo(
        "C002",
        "convention",
        "#%region without descriptive name",
        "Give each region a short label for logs and navigation.",
        False,
        None,
        True,
    ),
    RuleInfo(
        "C004",
        "convention",
        "No checkpoint comment before SAP StartTransaction",
        "Add a ## line describing the step before StartTransaction. Auto-fix: safe insert of a stub line.",
        True,
        "safe",
        True,
    ),
]

RESERVED_CODES_NOTE = (
    "Reserved / not implemented in current frida_lint: C003 (large block without region) returns no "
    "diagnostics; C005-C008 are not wired. W008, W014-W017 are not used in the active rule set."
)


def emit_rules_text() -> str:
    order = ("error", "warning", "convention", "style")
    by_sev: dict[str, list[RuleInfo]] = {s: [] for s in order}
    for r in RULES:
        by_sev.setdefault(r.severity, []).append(r)
    lines: list[str] = [
        "FRIDA lint rules (frida_lint.py)",
        "-------------------------------",
        "",
    ]
    for sev in order:
        items = by_sev.get(sev, [])
        if not items:
            continue
        lines.append(f"{sev.upper()}")
        lines.append("")
        for rule in sorted(items, key=lambda x: x.code):
            fx = ""
            if rule.fixable and rule.fix_kind:
                fx = f" [fix: {rule.fix_kind}]"
            nq = "yes" if rule.noqa else "no"
            lines.append(f"  {rule.code}  {rule.message}{fx}")
            lines.append(f"      {rule.description}")
            lines.append(f"      noqa: {nq}")
            lines.append("")
    lines.append("Note")
    lines.append(f"  {RESERVED_CODES_NOTE}")
    lines.append("")
    return "\n".join(lines)


def emit_rules_json() -> str:
    return json.dumps([r.to_json_dict() for r in RULES], indent=2) + "\n"
