#!/usr/bin/env python3
"""
Tool: cognitive_list_logs (cognitive_list_logs.py)

Lists available execution runs and, optionally, downloadable files in a run Result folder
for a Cognitive process/user path.
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


def run(*, process_id: int, user_email: str, run_id: str | None, limit: int) -> dict:
    process_user_path = f"Processes/{process_id}/{user_email}"
    entries = _list_dir(process_user_path)
    runs = sorted(
        [
            {
                "runId": item.get("name", ""),
                "fileId": item.get("fileId"),
            }
            for item in entries
            if item.get("kind") == "directory" and isinstance(item.get("name"), str)
        ],
        key=lambda x: x["runId"],
        reverse=True,
    )
    if limit > 0:
        runs = runs[:limit]

    selected_run = run_id
    if selected_run == "latest":
        selected_run = runs[0]["runId"] if runs else None

    files: list[dict] = []
    result_path: str | None = None
    if selected_run:
        result_path = f"{process_user_path}/{selected_run}/Result"
        result_entries = _list_dir(result_path)
        files = [
            {
                "name": item.get("name", ""),
                "kind": item.get("kind"),
                "contentLength": ((item.get("properties") or {}).get("contentLength")),
                "fileId": item.get("fileId"),
            }
            for item in result_entries
            if item.get("kind") == "file" and isinstance(item.get("name"), str)
        ]
        files.sort(key=lambda x: x["name"])

    return {
        "processId": process_id,
        "userEmail": user_email,
        "path": process_user_path,
        "runCount": len(runs),
        "runs": runs,
        "selectedRunId": selected_run,
        "resultPath": result_path,
        "files": files,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--process-id", type=int, required=True, help="Cognitive process id")
    parser.add_argument("--user-email", required=True, help="Cognitive user email folder name")
    parser.add_argument("--run-id", help="Specific run id to inspect; use 'latest' for newest run")
    parser.add_argument("--limit", type=int, default=20, help="Maximum run ids to return (0=all)")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    data = run(
        process_id=args.process_id,
        user_email=args.user_email,
        run_id=args.run_id,
        limit=max(0, args.limit),
    )

    if args.json:
        print(json.dumps(data, indent=2))
        return

    print(f"Process: {data['processId']}")
    print(f"User: {data['userEmail']}")
    print(f"Runs: {data['runCount']}")
    for run_item in data["runs"]:
        print(f"- {run_item['runId']}")
    if data["selectedRunId"]:
        print(f"Selected run: {data['selectedRunId']}")
        print(f"Result path: {data['resultPath']}")
        for file in data["files"]:
            print(f"  * {file['name']} ({file['contentLength']})")


if __name__ == "__main__":
    main()
