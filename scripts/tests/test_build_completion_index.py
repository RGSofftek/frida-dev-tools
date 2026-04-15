from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.append(str(SCRIPTS))

import build_completion_index as bci  # noqa: E402


def fixture_text() -> str:
    fixture = ROOT / "test-fixtures" / "docs" / "test-reader.md"
    return fixture.read_text(encoding="utf-8")


def test_function_names_extracted() -> None:
    sections = bci.extract_function_sections(fixture_text(), "Test")
    assert set(sections.keys()) == {"SimpleFunc", "MultiFunc", "NoSyntaxFunc"}
    assert "Functions" not in sections


def test_syntax_accepted_from_syntax_heading() -> None:
    sections = bci.extract_function_sections(fixture_text(), "Test")
    syntax = sections["SimpleFunc"]["syntax"]
    assert len(syntax) == 1
    assert syntax[0]["raw"] == "Test SimpleFunc Param1 <val>"
    assert syntax[0]["stripped"] == "SimpleFunc Param1 <val>"
    assert syntax[0]["syntaxSource"] == "docs"


def test_multiple_variants_preserved() -> None:
    sections = bci.extract_function_sections(fixture_text(), "Test")
    assert len(sections["MultiFunc"]["syntax"]) == 2


def test_examples_rejected() -> None:
    sections = bci.extract_function_sections(fixture_text(), "Test")
    all_raw = [item["raw"] for item in sections["SimpleFunc"]["syntax"]]
    assert not any("hello" in raw for raw in all_raw)


def test_no_syntax_yields_empty_list() -> None:
    sections = bci.extract_function_sections(fixture_text(), "Test")
    assert sections["NoSyntaxFunc"]["syntax"] == []


def test_prefix_stripping() -> None:
    sections = bci.extract_function_sections(fixture_text(), "Test")
    assert not sections["SimpleFunc"]["syntax"][0]["stripped"].startswith("Test ")


def test_duplicate_dedup() -> None:
    text = fixture_text().replace(
        'Test MultiFunc ByName "<name>"',
        'Test MultiFunc ByName "<name>"\nTest MultiFunc ByName "<name>"',
    )
    sections = bci.extract_function_sections(text, "Test")
    raw_lines = [item["raw"] for item in sections["MultiFunc"]["syntax"]]
    assert raw_lines.count('Test MultiFunc ByName "<name>"') == 1
