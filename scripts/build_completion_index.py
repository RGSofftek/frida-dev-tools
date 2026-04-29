#!/usr/bin/env python3
"""
Build FRIDA completion index from local docs, with optional readers.json enrichment.
"""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build FRIDA completion index.")
    parser.add_argument(
        "--docs", required=True, help="Path to the FRIDA reader markdown directory (e.g. resources/frida-docs)"
    )
    parser.add_argument("--out", required=True, help="Output JSON path")
    parser.add_argument(
        "--coverage",
        required=False,
        default=None,
        help="Optional path to write coverage-report.json",
    )
    parser.add_argument(
        "--readers",
        required=False,
        help="Optional path to readers.json for richer metadata",
    )
    return parser.parse_args()


def extract_keyword(content: str) -> str:
    m = re.search(r"\*\*Keyword:\*\*\s*`([^`]+)`", content)
    if not m:
        return ""
    return m.group(1).strip()


def extract_reader_name(content: str, fallback: str) -> str:
    m = re.search(r"^#\s+(.+?)\s*$", content, re.MULTILINE)
    if m:
        return m.group(1).strip()
    return fallback


def extract_quick_reference(content: str) -> dict[str, str]:
    ref: dict[str, str] = {}
    m = re.search(
        r"##\s+Quick Reference\s*\n(.*?)(?:\n##\s+|$)",
        content,
        re.DOTALL,
    )
    if not m:
        return ref
    block = m.group(1)
    for line in block.splitlines():
        row = line.strip()
        if not row.startswith("|"):
            continue
        cells = [c.strip() for c in row.strip("|").split("|")]
        if len(cells) < 2:
            continue
        fn_cell = cells[0]
        fn_link = re.search(r"\[([^\]]+)\]\([^)]+\)", fn_cell)
        fn = fn_link.group(1).strip() if fn_link else fn_cell.strip()
        if fn and fn.lower() != "function":
            ref[fn] = cells[1]
    return ref


@dataclass(frozen=True)
class SyntaxVariant:
    raw: str
    stripped: str
    syntaxSource: str


STRUCTURAL_STARTS = (
    "if ",
    "for ",
    "foreach ",
    "while ",
    "switch ",
    "try",
    "catch",
    "else",
)


def _extract_h2_sections(content: str) -> list[tuple[str, int, int]]:
    sections: list[tuple[str, int, int]] = []
    matches = list(re.finditer(r"^##\s+([^\n#]+)\s*$", content, re.MULTILINE))
    for i, match in enumerate(matches):
        name = match.group(1).strip()
        start = match.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(content)
        sections.append((name, start, end))
    return sections


def _get_functions_h2_range(content: str) -> tuple[int, int] | None:
    for name, start, end in _extract_h2_sections(content):
        if name.lower() == "functions":
            return start, end
    return None


def _split_function_sections(functions_block: str) -> list[tuple[str, str]]:
    sections: list[tuple[str, str]] = []
    matches = list(re.finditer(r"^###\s+([^\n#]+)\s*$", functions_block, re.MULTILINE))
    for i, match in enumerate(matches):
        fn_name = match.group(1).strip()
        start = match.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(functions_block)
        sections.append((fn_name, functions_block[start:end]))
    return sections


def _is_instruction_line(line: str) -> bool:
    lower = line.strip().lower()
    if not lower:
        return False
    if lower in {"}", "end"}:
        return False
    if lower.startswith(("##", "#", "//", "*")):
        return False
    return not lower.startswith(STRUCTURAL_STARTS)


def _looks_prose_only(line: str) -> bool:
    clean = line.strip()
    if not clean:
        return True
    if clean.startswith("|") or clean.startswith("#"):
        return True
    if clean.lower().startswith(("note:", "example:", "examples:")):
        return True
    return False


def _strip_reader_prefix(raw: str, keyword: str) -> str:
    if not keyword:
        return raw
    prefix = f"{keyword} "
    if raw.lower().startswith(prefix.lower()):
        return raw[len(prefix) :].lstrip()
    return raw


def _extract_first_instruction(lines: list[str]) -> str | None:
    for line in lines:
        if _is_instruction_line(line):
            return line.strip()
    return None


def _context_anchor_matches(
    first_instruction: str | None,
    function_name: str,
    keyword: str,
) -> bool:
    if not first_instruction:
        return False
    lower = first_instruction.lower()
    fn = function_name.lower()
    if lower.startswith(fn + " ") or lower == fn:
        return True
    if keyword:
        prefixed = f"{keyword.lower()} {fn}"
        return lower.startswith(prefixed + " ") or lower == prefixed
    return False


def _extract_params(section: str) -> list[str]:
    params: list[str] = []
    m = re.search(r"\*\*Parameters:\*\*(.*?)(?:\n\*\*|\n---|\Z)", section, re.DOTALL)
    if not m:
        return params
    block = m.group(1)
    for line in block.splitlines():
        row = line.strip()
        if not row.startswith("-"):
            continue
        name_match = re.search(r"`([^`]+)`", row)
        if name_match:
            params.append(name_match.group(1).strip())
    return params


def _extract_short_description(section: str) -> str:
    for line in section.splitlines():
        s = line.strip()
        if not s:
            continue
        if s.startswith(("###", "**", "|", "```", "---", "*Added:")):
            continue
        if s.startswith(">"):
            return s[1:].strip()
        return s
    return ""


def _extract_syntax_variants(section: str, function_name: str, keyword: str) -> list[SyntaxVariant]:
    variants: list[SyntaxVariant] = []
    context = ""
    in_fence = False
    fence_lines: list[str] = []
    seen_raw: set[str] = set()
    section_unambiguous = True

    def flush_fence() -> None:
        nonlocal fence_lines, context
        if context.lower() not in {"syntax"}:
            fence_lines = []
            return
        raw_lines = [ln.strip() for ln in fence_lines if ln.strip() and not _looks_prose_only(ln)]
        if not raw_lines:
            fence_lines = []
            return
        first_instruction = _extract_first_instruction(raw_lines)
        if not _context_anchor_matches(first_instruction, function_name, keyword) and not section_unambiguous:
            fence_lines = []
            return
        for raw_line in raw_lines:
            normalized = raw_line.strip()
            if normalized in seen_raw:
                continue
            seen_raw.add(normalized)
            variants.append(
                SyntaxVariant(
                    raw=normalized,
                    stripped=_strip_reader_prefix(normalized, keyword),
                    syntaxSource="docs",
                )
            )
        fence_lines = []

    for line in section.splitlines():
        stripped = line.strip()
        if stripped.startswith("```"):
            if in_fence:
                in_fence = False
                flush_fence()
            else:
                in_fence = True
                fence_lines = []
            continue
        if in_fence:
            fence_lines.append(line)
            continue
        m = re.match(r"^\*\*([\w][\w\s/]*):\*\*$", stripped)
        if m:
            context = m.group(1).strip()

    return variants


def _variant_dicts(variants: list[SyntaxVariant]) -> list[dict[str, str]]:
    return [
        {"raw": v.raw, "stripped": v.stripped, "syntaxSource": v.syntaxSource}
        for v in variants
    ]


def extract_function_sections(content: str, keyword: str) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    fn_range = _get_functions_h2_range(content)
    if not fn_range:
        return out
    start, end = fn_range
    functions_block = content[start:end]
    for fn_name, section in _split_function_sections(functions_block):
        short = _extract_short_description(section)
        params = _extract_params(section)
        syntax = _variant_dicts(_extract_syntax_variants(section, fn_name, keyword))
        out[fn_name] = {
            "name": fn_name,
            "shortDescription": short,
            "description": short,
            "syntax": syntax,
            "params": params,
            "examples": [],
        }
    return out


def parse_reader_doc(path: Path) -> dict[str, Any]:
    content = path.read_text(encoding="utf-8")
    reader_name = extract_reader_name(content, path.stem)
    keyword = extract_keyword(content)
    quick_ref = extract_quick_reference(content)
    sections = extract_function_sections(content, keyword if keyword != "-" else "")

    functions: list[dict[str, Any]] = []
    seen: set[str] = set()

    for fn_name, short in quick_ref.items():
        if fn_name in sections:
            item = sections[fn_name]
            if short:
                item["shortDescription"] = short
                if not item["description"]:
                    item["description"] = short
        else:
            item = {
                "name": fn_name,
                "shortDescription": short,
                "description": short,
                "syntax": [],
                "params": [],
                "examples": [],
            }
        functions.append(item)
        seen.add(fn_name.lower())

    for fn_name, section_item in sections.items():
        if fn_name.lower() in seen:
            continue
        functions.append(section_item)

    return {
        "keyword": keyword if keyword != "-" else "",
        "name": reader_name,
        "functions": sorted(functions, key=lambda x: x["name"].lower()),
    }


def merge_readers_json(target: dict[str, Any], readers_path: Path) -> None:
    data = json.loads(readers_path.read_text(encoding="utf-8"))
    readers = [v for k, v in data.items() if k.isdigit() and isinstance(v, dict)]
    by_key = {r["keyword"].lower(): r for r in target["readers"]}

    for reader in readers:
        keyword = str(reader.get("Keyword", "")).strip()
        name = str(reader.get("Name", "")).strip() or keyword
        fr = by_key.get(keyword.lower())
        if fr is None:
            fr = {"keyword": keyword, "name": name, "functions": []}
            target["readers"].append(fr)
            by_key[keyword.lower()] = fr

        by_fn = {f["name"].lower(): f for f in fr["functions"]}
        for fn in reader.get("Function", []):
            fn_name = str(fn.get("Name", "")).strip()
            if not fn_name:
                continue
            item = by_fn.get(fn_name.lower())
            if item is None:
                item = {
                    "name": fn_name,
                    "shortDescription": "",
                    "description": "",
                    "syntax": [],
                    "params": [],
                    "examples": [],
                }
                fr["functions"].append(item)
                by_fn[fn_name.lower()] = item
            if not item.get("syntax"):
                item["syntax"] = [
                    {
                        "raw": str(s).strip(),
                        "stripped": _strip_reader_prefix(str(s).strip(), fr["keyword"]),
                        "syntaxSource": "readers",
                    }
                    for s in fn.get("Syntax", [])
                    if str(s).strip()
                ]

            if not item.get("shortDescription"):
                item["shortDescription"] = str(fn.get("ShortDescription", "")).strip()

            if not item.get("description"):
                item["description"] = str(fn.get("Description", "")).strip()

            existing_params = set(item.get("params", []))
            for p in fn.get("Params", []):
                param = str(p).strip()
                if param and param not in existing_params:
                    item.setdefault("params", []).append(param)
                    existing_params.add(param)

            examples = [str(ex).strip() for ex in fn.get("Example", []) if str(ex).strip()]
            item.setdefault("examples", []).extend(examples)

        fr["functions"] = sorted(fr["functions"], key=lambda x: x["name"].lower())

    target["readers"] = sorted(
        target["readers"], key=lambda x: (x["keyword"] == "", x["keyword"].lower())
    )


def main() -> int:
    args = parse_args()
    docs_path = Path(args.docs).resolve()
    out_path = Path(args.out).resolve()
    readers_path = Path(args.readers).resolve() if args.readers else None

    if not docs_path.exists():
        raise FileNotFoundError(f"Docs path not found: {docs_path}")

    reader_docs = sorted(docs_path.glob("*-reader.md"))
    readers: list[dict[str, Any]] = [parse_reader_doc(p) for p in reader_docs]

    for reader in readers:
        for fn in reader["functions"]:
            assert fn["name"] != "Functions", (
                f"Bogus aggregate entry 'Functions' found in reader '{reader['name']}'. "
                "This indicates extract_function_sections is still splitting on ## instead of ###."
            )

    index = {"schemaVersion": 2, "readers": readers}

    if readers_path is not None:
        if not readers_path.exists():
            raise FileNotFoundError(f"readers.json not found: {readers_path}")
        merge_readers_json(index, readers_path)

    totals = {
        "total_functions": 0,
        "total_syntax_variants": 0,
        "functions_with_syntax": 0,
        "functions_missing_syntax": 0,
        "per_reader": [],
        "top_missing": [],
    }
    top_missing: list[str] = []
    for reader in index["readers"]:
        reader_total = len(reader["functions"])
        with_syntax = 0
        variants = 0
        for fn in reader["functions"]:
            syntax_variants = fn.get("syntax", [])
            vcount = len(syntax_variants)
            variants += vcount
            if vcount > 0:
                with_syntax += 1
            else:
                top_missing.append(f"{reader['keyword'] or 'Mix'}/{fn['name']}")
        missing = reader_total - with_syntax
        totals["total_functions"] += reader_total
        totals["total_syntax_variants"] += variants
        totals["functions_with_syntax"] += with_syntax
        totals["functions_missing_syntax"] += missing
        totals["per_reader"].append(
            {
                "reader": reader["keyword"] or "Mix",
                "functions": reader_total,
                "with_syntax": with_syntax,
                "missing_syntax": missing,
                "variants": variants,
            }
        )
    totals["top_missing"] = top_missing[:20]

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(index, indent=2), encoding="utf-8")
    if args.coverage:
        coverage_path = Path(args.coverage).resolve()
        coverage_path.parent.mkdir(parents=True, exist_ok=True)
        coverage_path.write_text(json.dumps(totals, indent=2), encoding="utf-8")
        print(f"Wrote coverage report: {coverage_path}")

    fn_total = totals["total_functions"] or 1
    pct = (totals["functions_with_syntax"] / fn_total) * 100.0
    print(
        f"Coverage: {totals['functions_with_syntax']}/{totals['total_functions']} "
        f"functions ({pct:.1f}%), {totals['total_syntax_variants']} variants"
    )
    for item in totals["per_reader"]:
        r_total = item["functions"] or 1
        r_pct = (item["with_syntax"] / r_total) * 100.0
        print(
            f"  {item['reader']}: {item['with_syntax']}/{item['functions']} "
            f"({r_pct:.1f}%) - {item['variants']} variants"
        )

    # TODO: After manual review, commit baseline to test-fixtures/baseline-coverage.json
    # and add --baseline flag to compare against it for regression detection.
    print(f"Wrote completion index: {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
