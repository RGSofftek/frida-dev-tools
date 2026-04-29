#!/usr/bin/env python3
"""
Tool: fetch_actions_from_cognitive (fetch_actions_from_cognitive.py)

Downloads Actions.txt from Cognitive Testing Azure storage using the same API as the web UI
(POST azure-getTxtFile with path + fileName). Overwrites local Actions.txt when not in dry-run.

Usage (from project root):
  python resources/cli-tools/fetch_actions_from_cognitive.py
  python resources/cli-tools/fetch_actions_from_cognitive.py --dry-run
  python resources/cli-tools/fetch_actions_from_cognitive.py --backup

Arguments:
  --dir PATH          Folder to write Actions.txt into (default: project root)
  --process-id N      Cognitive process id (default: env COGNITIVE_PROCESS_ID or 1555960)
  --step N            Step index (default: env COGNITIVE_STEP_INDEX or 0)
  --dry-run           Fetch and print summary; do not write a file
  --preserve-crlf     Keep Windows line endings from remote; default normalizes to LF
  --backup            Copy existing Actions.txt to Actions.txt.bak before overwrite
  --preview-chars N   Max characters to print in dry-run preview (default: 500)

Environment: COGNITIVE_PROCESS_ID, COGNITIVE_STEP_INDEX (same as sync_actions_to_cognitive.py).

API note: azure-getTxtFile expects JSON {"path": "Processes/{pid}/Steps/{step}", "fileName": "Actions.txt"}
and returns the raw file body (not JSON), per live endpoint behavior.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import urllib.error
import urllib.request
from pathlib import Path

# Project root (parent of resources/) when this file lives in resources/cli-tools/.
_PROJECT_ROOT = Path(__file__).resolve().parents[2]

AZURE_BASE = "https://us-central1-cognitive-testing.cloudfunctions.net"
ORIGIN = "https://cognitivetesting.online"

DEFAULT_PROCESS_ID = 1555960
DEFAULT_STEP = 0

REMOTE_FILE_NAME = "Actions.txt"


def _post_get_txt_file(path_prefix: str, file_name: str, *, timeout: float = 120.0) -> tuple[int, str]:
    """POST azure-getTxtFile; response body is raw file text."""
    url = f"{AZURE_BASE}/azure-getTxtFile"
    payload = {"path": path_prefix, "fileName": file_name}
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/json; charset=utf-8",
            "Origin": ORIGIN,
            "Accept": "*/*",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8", errors="strict")
            return resp.getcode(), body
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        raise SystemExit(f"HTTP {e.code} for {url}\n{err_body}") from e


def _normalize_newlines(text: str, preserve_crlf: bool) -> str:
    if preserve_crlf:
        return text
    return text.replace("\r\n", "\n").replace("\r", "\n")


def fetch_actions_text(
    *,
    process_id: int,
    step: int,
    preserve_crlf: bool,
) -> str:
    path_prefix = f"Processes/{process_id}/Steps/{step}"
    code, raw = _post_get_txt_file(path_prefix, REMOTE_FILE_NAME)
    if code != 200:
        raise SystemExit(f"Unexpected HTTP {code} from azure-getTxtFile")
    return _normalize_newlines(raw, preserve_crlf)


def run(
    *,
    base_dir: Path,
    process_id: int,
    step: int,
    dry_run: bool,
    preserve_crlf: bool,
    backup: bool,
    preview_chars: int,
    out_file: Path | None = None,
) -> None:
    text = fetch_actions_text(process_id=process_id, step=step, preserve_crlf=preserve_crlf)
    if out_file:
        out_path = out_file
    else:
        out_path = base_dir / REMOTE_FILE_NAME

    if dry_run:
        n = len(text)
        le = "remote CRLF/LF preserved" if preserve_crlf else "normalized to LF"
        print(f"azure-getTxtFile: OK, {n} characters ({le})")
        head = text[:preview_chars]
        print("--- preview (start) ---")
        print(head)
        if n > preview_chars:
            print(f"... ({n - preview_chars} more characters)")
        print("--- end preview ---")
        return

    if backup and out_path.is_file():
        bak = out_path.with_suffix(out_path.suffix + ".bak")
        shutil.copy2(out_path, bak)
        print(f"Backed up to {bak}")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(text, encoding="utf-8", newline="\n")
    print(f"Wrote {out_path} ({len(text)} characters)")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "--dir",
        type=Path,
        default=_PROJECT_ROOT,
        help="Folder to write Actions.txt (default: project root)",
    )
    parser.add_argument(
        "--process-id",
        type=int,
        default=int(os.environ.get("COGNITIVE_PROCESS_ID", DEFAULT_PROCESS_ID)),
    )
    parser.add_argument("--step", type=int, default=int(os.environ.get("COGNITIVE_STEP_INDEX", DEFAULT_STEP)))
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--preserve-crlf", action="store_true")
    parser.add_argument("--backup", action="store_true", help="Save Actions.txt.bak before overwrite")
    parser.add_argument("--preview-chars", type=int, default=500, help="Dry-run preview length")
    parser.add_argument("--out-file", type=Path, help="Write to this exact file instead of <dir>/Actions.txt")
    args = parser.parse_args()

    try:
        run(
            base_dir=args.dir.resolve(),
            process_id=args.process_id,
            step=args.step,
            dry_run=args.dry_run,
            preserve_crlf=args.preserve_crlf,
            backup=args.backup,
            preview_chars=max(0, args.preview_chars),
            out_file=args.out_file.resolve() if args.out_file else None,
        )
    except UnicodeDecodeError as e:
        raise SystemExit(f"Remote body is not valid UTF-8: {e}") from e


if __name__ == "__main__":
    main()
