#!/usr/bin/env python3
"""
Tool: sync_actions_to_cognitive (sync_actions_to_cognitive.py)

Problem:
  Keeps local FRIDA process files in sync with Cognitive Testing (same upload sequence as the UI:
  createTxtFile for each file, list directory, optional AppUsage-ScriptChange). Also uploads
  local RunScript targets referenced from Actions.txt when the matching .txt exists next to it.
  Azure rejects
  non-ASCII file content unless normalized; by default this script sanitizes like frida_lint W019.

Usage (run from project root; paths default to the repo root next to .cursor/):
  python .cursor/tools/sync_actions_to_cognitive.py

Arguments:
  --dir PATH              Folder containing Actions.txt, datadrive.txt, headers.txt (default: project root)
  --process-id N          Cognitive process id (default: env COGNITIVE_PROCESS_ID or workspace default)
  --step N                Step index under the process (default: env COGNITIVE_STEP_INDEX or 0)
  --user-uuid UUID        User id for AppUsage body (default: env COGNITIVE_USER_UUID)
  --app-usage-auth KEY    auth query param for AppUsage (default: env COGNITIVE_APP_USAGE_AUTH); if
                          missing with user UUID, upload still runs but analytics POST is skipped
  --platform NAME         Analytics platform string (default: env COGNITIVE_PLATFORM or CognitiveTesting)
  --version NAME          Client version string (default: env COGNITIVE_CLIENT_VERSION or local-sync)
  --dry-run               Print JSON payloads only; no HTTP requests
  --no-sanitize           Send file bytes as-is; fails if Azure rejects non-ASCII content

Environment variables mirror the defaults above where noted. Copy UUID and auth from browser
Network tab (cognitivetesting.online) if your workspace defaults are wrong.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

from frida_cognitive_ascii import sanitize_for_azure_upload

# Project root (parent of .cursor/) when this file lives in .cursor/tools/.
_PROJECT_ROOT = Path(__file__).resolve().parents[2]

AZURE_BASE = "https://us-central1-cognitive-testing.cloudfunctions.net"
APP_USAGE_BASE = "https://us-central1-automation-1713b.cloudfunctions.net"
ORIGIN = "https://cognitivetesting.online"

DEFAULT_PROCESS_ID = 1555960
DEFAULT_STEP = 0

_RE_RUNSCRIPT = re.compile(r"^\s*RunScript\s+(\S+)", re.IGNORECASE)


def _runscript_txt_names(actions_text: str) -> list[str]:
    """Local .txt targets of RunScript in Actions.txt (excluding Actions itself), first-seen order."""
    seen: set[str] = set()
    out: list[str] = []
    for line in actions_text.splitlines():
        m = _RE_RUNSCRIPT.match(line.strip())
        if not m:
            continue
        name = m.group(1).strip()
        base = name if name.lower().endswith(".txt") else f"{name}.txt"
        if base.lower() == "actions.txt":
            continue
        if base not in seen:
            seen.add(base)
            out.append(base)
    return out


def _crlf(text: str) -> str:
    """Match browser JSON payloads (Windows-style newlines in file content)."""
    return text.replace("\r\n", "\n").replace("\n", "\r\n")


def _post_json(url: str, payload: object, *, timeout: float = 120.0) -> tuple[int, str]:
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


def _azure_create_txt_file(path_prefix: str, file_name: str, content: str) -> None:
    url = f"{AZURE_BASE}/azure-createTxtFile"
    payload = {"path": path_prefix, "file": {"name": file_name, "content": content}}
    code, body = _post_json(url, payload)
    if body.strip().lower() == "true":
        return
    raise SystemExit(
        f"azure-createTxtFile rejected {file_name!r} (HTTP {code}, body={body!r}). "
        "Try running without --no-sanitize if the file contains non-ASCII characters."
    )


def sync(
    *,
    base_dir: Path,
    process_id: int,
    step: int,
    user_uuid: str | None,
    app_usage_auth: str | None,
    platform: str,
    version: str,
    dry_run: bool,
    sanitize: bool,
) -> None:
    path_prefix = f"Processes/{process_id}/Steps/{step}"

    actions_path = base_dir / "Actions.txt"
    datadrive_path = base_dir / "datadrive.txt"
    headers_path = base_dir / "headers.txt"

    core_files: list[tuple[str, Path]] = [
        ("Actions.txt", actions_path),
        ("datadrive.txt", datadrive_path),
        ("headers.txt", headers_path),
    ]

    contents: dict[str, str] = {}
    for name, p in core_files:
        if not p.is_file():
            raise SystemExit(f"Missing required file: {p}")
        contents[name] = p.read_text(encoding="utf-8", errors="strict")

    for sub_name in _runscript_txt_names(contents["Actions.txt"]):
        if sub_name in contents:
            continue
        sub_path = base_dir / sub_name
        if sub_path.is_file():
            contents[sub_name] = sub_path.read_text(encoding="utf-8", errors="strict")
        else:
            print(
                f"Warning: RunScript references {sub_name} but file is missing locally; not uploaded.",
                file=sys.stderr,
            )

    upload_text: dict[str, str] = {}
    for name, text in contents.items():
        if sanitize and any(ord(c) > 127 for c in text):
            upload_text[name] = sanitize_for_azure_upload(text)
            if name == "Actions.txt":
                print(
                    "Note: Sanitized non-ASCII characters in Actions.txt for Azure upload "
                    "(API only accepts ASCII file content)."
                )
        else:
            upload_text[name] = text

    create_payloads = [
        {"path": path_prefix, "file": {"name": name, "content": _crlf(upload_text[name])}}
        for name in contents
    ]

    if dry_run:
        print(json.dumps({"step": "azure-createTxtFile", "payloads": create_payloads}, indent=2))
        print(json.dumps({"step": "azure-listFilesAndDirectories", "path": path_prefix}, indent=2))
        if user_uuid and app_usage_auth:
            analytics = {
                "pid": process_id,
                "user": user_uuid,
                "files": [
                    {
                        "fileName": n,
                        "byteSize": len(_crlf(upload_text[n]).encode("utf-8")),
                    }
                    for n in contents
                ],
                "platform": platform,
                "version": version,
            }
            print(json.dumps({"step": "AppUsage-ScriptChange", "body": analytics}, indent=2))
        return

    for payload in create_payloads:
        name = payload["file"]["name"]
        _azure_create_txt_file(path_prefix, name, payload["file"]["content"])

    list_url = f"{AZURE_BASE}/azure-listFilesAndDirectories"
    code, body = _post_json(list_url, {"path": path_prefix})
    print(f"azure-listFilesAndDirectories: {code}")
    try:
        listing = json.loads(body)
        print(json.dumps(listing, indent=2))
    except json.JSONDecodeError:
        print(body[:2000])

    if not app_usage_auth or not user_uuid:
        print(
            "Skipping AppUsage-ScriptChange (set COGNITIVE_APP_USAGE_AUTH and COGNITIVE_USER_UUID).",
            file=sys.stderr,
        )
        return

    analytics_url = f"{APP_USAGE_BASE}/AppUsage-ScriptChange?auth={app_usage_auth}"
    analytics_body = {
        "pid": process_id,
        "user": user_uuid,
        "files": [
            {"fileName": n, "byteSize": len(_crlf(upload_text[n]).encode("utf-8"))}
            for n in contents
        ],
        "platform": platform,
        "version": version,
    }
    code, resp = _post_json(analytics_url, analytics_body)
    print(f"AppUsage-ScriptChange: {code} {resp}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "--dir",
        type=Path,
        default=_PROJECT_ROOT,
        help="Folder containing Actions.txt, datadrive.txt, headers.txt (default: project root)",
    )
    parser.add_argument("--process-id", type=int, default=int(os.environ.get("COGNITIVE_PROCESS_ID", DEFAULT_PROCESS_ID)))
    parser.add_argument("--step", type=int, default=int(os.environ.get("COGNITIVE_STEP_INDEX", DEFAULT_STEP)))
    parser.add_argument(
        "--user-uuid",
        default=os.environ.get("COGNITIVE_USER_UUID"),
        help="UUID from AppUsage-ScriptChange JSON body (env: COGNITIVE_USER_UUID)",
    )
    parser.add_argument(
        "--app-usage-auth",
        default=os.environ.get("COGNITIVE_APP_USAGE_AUTH"),
        help="auth query value for AppUsage (env: COGNITIVE_APP_USAGE_AUTH)",
    )
    parser.add_argument("--platform", default=os.environ.get("COGNITIVE_PLATFORM", "CognitiveTesting"))
    parser.add_argument("--version", default=os.environ.get("COGNITIVE_CLIENT_VERSION", "local-sync"))
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--no-sanitize",
        action="store_true",
        help="Send file text as-is (will fail on non-ASCII for Actions.txt with decorative Unicode).",
    )
    args = parser.parse_args()

    sync(
        base_dir=args.dir.resolve(),
        process_id=args.process_id,
        step=args.step,
        user_uuid=args.user_uuid,
        app_usage_auth=args.app_usage_auth,
        platform=args.platform,
        version=args.version,
        dry_run=args.dry_run,
        sanitize=not args.no_sanitize,
    )


if __name__ == "__main__":
    main()
