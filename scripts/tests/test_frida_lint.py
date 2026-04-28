"""
Regression tests for .cursor/tools/frida_lint.py (invoked via subprocess from repo root).
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
FRIDA_LINT = REPO_ROOT / ".cursor" / "tools" / "frida_lint.py"


def _run_lint(argv: list[str], cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(FRIDA_LINT), *argv],
        cwd=cwd,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )


@pytest.fixture()
def isolated_dir(tmp_path: Path) -> Path:
    d = tmp_path / "frida-process"
    d.mkdir(parents=True, exist_ok=True)
    return d


def test_s003_safe_fix_removes_trailing_whitespace(isolated_dir: Path) -> None:
    actions = isolated_dir / "Actions.txt"
    actions.write_text('DefineVariable as "x" with the value "1"\nhaving space   \n', encoding="utf-8")
    fix = _run_lint(["check", "Actions.txt", "--fix"], isolated_dir)
    assert fix.returncode == 1
    text = actions.read_text(encoding="utf-8")
    for line in text.splitlines():
        assert line == line.rstrip()
    verify = _run_lint(["check", "Actions.txt", "--json"], isolated_dir)
    diags = json.loads(verify.stdout)
    assert not any(d.get("code") == "S003" for d in diags)


def test_w004_unsafe_fix_no_longer_reports(isolated_dir: Path) -> None:
    actions = isolated_dir / "Actions.txt"
    actions.write_text('SystemNotify Type "Notification" with message "hi"\n', encoding="utf-8")
    fix = _run_lint(["check", "Actions.txt", "--fix", "--unsafe-fixes"], isolated_dir)
    assert fix.returncode == 1
    out = actions.read_text(encoding="utf-8")
    assert "noqa: w004" in out.lower()
    verify = _run_lint(["check", "Actions.txt", "--json"], isolated_dir)
    diags = json.loads(verify.stdout)
    assert not any(d.get("code") == "W004" for d in diags)


def test_no_op_rules_not_reported_as_fixable(isolated_dir: Path) -> None:
    actions = isolated_dir / "Actions.txt"
    actions.write_text(
        "while (<<<a>>> -AND <<<b>>>) {\n}\n"
        "for 0 times {\n}\n"
        "Throw \"x\"\n",
        encoding="utf-8",
    )
    r = _run_lint(["check", "Actions.txt", "--json"], isolated_dir)
    assert r.returncode == 1
    diags = json.loads(r.stdout)
    for code in ("E003", "W018", "E006"):
        found = [d for d in diags if d.get("code") == code]
        assert found, f"missing {code}"
        assert found[0].get("fixable") is False


def test_s002_preserves_indent(isolated_dir: Path) -> None:
    actions = isolated_dir / "Actions.txt"
    actions.write_text("\t##Comment without space after hashes\n", encoding="utf-8")
    _run_lint(["check", "Actions.txt", "--fix"], isolated_dir)
    text = actions.read_text(encoding="utf-8")
    assert text.startswith("\t## Comment")


def test_c004_checkpoint_indented(isolated_dir: Path) -> None:
    actions = isolated_dir / "Actions.txt"
    actions.write_text("\tSAP StartTransaction VA01\n", encoding="utf-8")
    _run_lint(["check", "Actions.txt", "--fix"], isolated_dir)
    lines = actions.read_text(encoding="utf-8").splitlines()
    assert any("## Start transaction VA01" in ln for ln in lines)
    assert any(ln.startswith("\t## Start transaction") for ln in lines)


def test_c001_separator_lines_ascii_in_rule_block() -> None:
    """C001 block strings must stay ASCII-safe (Cognitive upload policy). Source-level check avoids FRIDA-global edge cases."""
    raw = FRIDA_LINT.read_text(encoding="utf-8")
    assert '"## --------------------------------------------------------------------"' in raw
    assert "GLOBAL VARIABLES" in raw
