#!/usr/bin/env python3
"""
Tool: cognitive_download_log (cognitive_download_log.py)

Downloads the latest or selected log text file for a Cognitive process/user path.
"""

from __future__ import annotations

import argparse
import json
import urllib.error
import urllib.request
from pathlib import Path

AZURE_BASE = "https://us-central1-cognitive-testing.cloudfunctions.net"
ORIGIN = "https://cognitivetesting.online"


def _post_json(url: str, payload: object, *, timeout: float = 60.0) -> tuple[int, str]:
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
            body = resp.read().decode("utf-8", errors="replace")
            return resp.getcode(), body
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        raise SystemExit(f"HTTP {e.code} for {url}\n{err_body}") from e


def _list_dir(path: str) -> list[dict]:
    url = f"{AZURE_BASE}/azure-listFilesAndDirectories"
    code, body = _post_json(url, {"path": path})
    if code != 200:
        raise SystemExit(f"Unexpected HTTP {code} from azure-listFilesAndDirectories")
    try:
        parsed = json.loads(body)
    except json.JSONDecodeError as e:
        raise SystemExit(f"Could not parse directory listing JSON for path {path}: {e}") from e
    if not isinstance(parsed, list):
        raise SystemExit(f"Unexpected listing body for path {path}: {body[:500]}")
    return parsed


def _get_txt(path: str, file_name: str) -> str:
    url = f"{AZURE_BASE}/azure-getTxtFile"
    code, body = _post_json(url, {"path": path, "fileName": file_name})
    if code != 200:
        raise SystemExit(f"Unexpected HTTP {code} from azure-getTxtFile")
    return body


def run(
    *,
    process_id: int,
    user_email: str,
    run_id: str,
    file_name: str | None,
    out_dir: Path,
) -> dict:
    process_user_path = f"Processes/{process_id}/{user_email}"

    selected_run = run_id
    if selected_run == "latest":
        runs = sorted(
            [
                item.get("name", "")
                for item in _list_dir(process_user_path)
                if item.get("kind") == "directory" and isinstance(item.get("name"), str)
            ],
            reverse=True,
        )
        if not runs:
            raise SystemExit(f"No runs found for path {process_user_path}")
        selected_run = runs[0]

    result_path = f"{process_user_path}/{selected_run}/Result"
    files = [
        item.get("name", "")
        for item in _list_dir(result_path)
        if item.get("kind") == "file" and isinstance(item.get("name"), str)
    ]
    files.sort()

    chosen_file = file_name
    if not chosen_file:
        log_candidates = sorted([name for name in files if name.lower().startswith("log-") and name.lower().endswith(".txt")], reverse=True)
        if not log_candidates:
            raise SystemExit(f"No log-*.txt files found in {result_path}")
        chosen_file = log_candidates[0]

    if chosen_file not in files:
        raise SystemExit(f"File {chosen_file!r} not found in {result_path}")

    text = _get_txt(result_path, chosen_file)
    output_path = out_dir / str(process_id) / selected_run / chosen_file
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(text, encoding="utf-8", newline="\n")

    return {
        "processId": process_id,
        "userEmail": user_email,
        "runId": selected_run,
        "resultPath": result_path,
        "fileName": chosen_file,
        "path": str(output_path),
        "sizeChars": len(text),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--process-id", type=int, required=True, help="Cognitive process id")
    parser.add_argument("--user-email", required=True, help="Cognitive user email folder name")
    parser.add_argument("--run-id", default="latest", help="Run id or latest")
    parser.add_argument("--file", help="Specific file to download from Result folder")
    parser.add_argument("--out-dir", default="logs", help="Output directory root (default: logs)")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    data = run(
        process_id=args.process_id,
        user_email=args.user_email,
        run_id=args.run_id,
        file_name=args.file,
        out_dir=Path(args.out_dir),
    )

    if args.json:
        print(json.dumps(data, indent=2))
        return

    print(f"Downloaded: {data['path']}")
    print(f"Run: {data['runId']}")
    print(f"File: {data['fileName']}")
    print(f"Size (chars): {data['sizeChars']}")


if __name__ == "__main__":
    main()
