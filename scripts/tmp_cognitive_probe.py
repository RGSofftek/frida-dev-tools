#!/usr/bin/env python3
"""Temporary probe for Cognitive endpoints with auth bootstrap."""

from __future__ import annotations

import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Dict, Tuple


CREATE_URL = "https://us-central1-cognitive-testing.cloudfunctions.net/apps-createApp"
LIST_URL = "https://us-central1-cognitive-testing.cloudfunctions.net/apps-getAdminAppsAndSuites"
MY_PROCESSES_URL = "https://us-central1-cognitive-testing.cloudfunctions.net/tests-getMyProcesses"
AZURE_CREATE_DIRECTORY_URL = "https://us-central1-cognitive-testing.cloudfunctions.net/azure-createDirectory"
AZURE_CREATE_TXT_URL = "https://us-central1-cognitive-testing.cloudfunctions.net/azure-createTxtFile"
VERIFY_PASSWORD_URL = "https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyPassword"
AUTH_GENERATE_TOKEN_URL = "https://us-central1-cognitive-testing.cloudfunctions.net/auth-generateToken"
VERIFY_CUSTOM_TOKEN_URL = "https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyCustomToken"

AUTOMATION_API_KEY = "AIzaSyAAA1Ov40AMxbl5waVkjVw0X7AMbxW1-YY"
COGNITIVE_API_KEY = "AIzaSyBhs_Z3-wh659Z39_OfKrTjglZaoAZQ4fE"


def load_env_file(repo_root: Path) -> Dict[str, str]:
    env_map: Dict[str, str] = {}
    env_path = repo_root / ".env"
    if not env_path.exists():
        return env_map
    for line in env_path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        env_map[key.strip()] = value.strip()
    return env_map


def pick_first_non_empty(keys: list[str], env_map: Dict[str, str]) -> str:
    for key in keys:
        value = os.environ.get(key) or env_map.get(key)
        if value:
            return value
    return ""


def truncate_token_like_strings(text: str, max_len: int = 36) -> str:
    pattern = re.compile(r"(?<![A-Za-z0-9_-])([A-Za-z0-9_-]{40,})(?![A-Za-z0-9_-])")

    def repl(match: re.Match[str]) -> str:
        token = match.group(1)
        if len(token) <= max_len:
            return token
        return f"{token[:12]}...<{len(token)} chars>...{token[-8:]}"

    return pattern.sub(repl, text)


def request_json(url: str, method: str, headers: Dict[str, str], payload: Dict[str, object] | None) -> Tuple[int, str]:
    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url=url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            status = response.getcode()
            body = response.read().decode("utf-8", errors="replace")
            return status, body
    except urllib.error.HTTPError as err:
        body = err.read().decode("utf-8", errors="replace")
        return err.code, body
    except Exception as err:  # pylint: disable=broad-except
        return -1, f"{type(err).__name__}: {err}"


def parse_json_object(text: str) -> Dict[str, object]:
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return {}
    if isinstance(parsed, dict):
        return parsed
    return {}


def processes_for_suite(my_processes_payload: Dict[str, object], suite_id: str) -> Dict[str, Dict[str, object]]:
    target_prefix = f"{suite_id} - "
    matches: Dict[str, Dict[str, object]] = {}
    for process_id, item in my_processes_payload.items():
        if not isinstance(item, dict):
            continue
        suites = item.get("Suites")
        if not isinstance(suites, list):
            continue
        if any(isinstance(s, str) and s.startswith(target_prefix) for s in suites):
            matches[str(process_id)] = item
    return matches


def bootstrap_token(email: str, password: str) -> Tuple[str, Dict[str, object]]:
    diagnostics: Dict[str, object] = {}
    if not email or not password:
        diagnostics["bootstrap_error"] = "missing email or password"
        return "", diagnostics

    step1_status, step1_body = request_json(
        f"{VERIFY_PASSWORD_URL}?key={AUTOMATION_API_KEY}",
        "POST",
        {
            "Content-Type": "application/json",
            "Origin": "https://cognitivetesting.online",
        },
        {
            "email": email,
            "password": password,
            "returnSecureToken": True,
        },
    )
    diagnostics["verifyPassword_status"] = step1_status
    if step1_status != 200:
        diagnostics["verifyPassword_body"] = truncate_token_like_strings(step1_body)
        return "", diagnostics

    step2_status, custom_jwt = request_json(
        AUTH_GENERATE_TOKEN_URL,
        "POST",
        {
            "Content-Type": "text/plain",
            "Origin": "https://cognitivetesting.online",
            "Authorization": AUTOMATION_API_KEY,
        },
        {"uid": email},
    )
    diagnostics["authGenerateToken_status"] = step2_status
    if step2_status != 200:
        diagnostics["authGenerateToken_body"] = truncate_token_like_strings(custom_jwt)
        return "", diagnostics

    custom_jwt = custom_jwt.strip()
    step3_status, step3_body = request_json(
        f"{VERIFY_CUSTOM_TOKEN_URL}?key={COGNITIVE_API_KEY}",
        "POST",
        {
            "Content-Type": "application/json",
            "Origin": "https://cognitivetesting.online",
        },
        {
            "token": custom_jwt,
            "returnSecureToken": True,
        },
    )
    diagnostics["verifyCustomToken_status"] = step3_status
    if step3_status != 200:
        diagnostics["verifyCustomToken_body"] = truncate_token_like_strings(step3_body)
        return "", diagnostics

    parsed = parse_json_object(step3_body)
    if not parsed:
        diagnostics["verifyCustomToken_body"] = truncate_token_like_strings(step3_body)
        diagnostics["bootstrap_error"] = "invalid json response from verifyCustomToken"
        return "", diagnostics

    token = str(parsed.get("idToken", "")).strip()
    diagnostics["token_obtained"] = bool(token)
    return token, diagnostics


def main() -> int:
    repo_root = Path(__file__).resolve().parents[1]
    env_map = load_env_file(repo_root)

    email = pick_first_non_empty(
        ["COGNITIVE_EMAIL", "COGNITIVE_USER", "COGNITIVE_ADMIN_EMAIL", "EMAIL"],
        env_map,
    )
    password = pick_first_non_empty(
        ["COGNITIVE_PASS", "COGNITIVE_PASSWORD", "PASSWORD"],
        env_map,
    )

    ts = int(time.time())
    app_name = f"Tmp-Probe-{ts}"
    app_id = int(str(ts)[-7:])

    token, auth_diag = bootstrap_token(email, password)

    base_headers = {
        "Content-Type": "text/plain;charset=UTF-8",
        "Origin": "https://cognitivetesting.online",
    }
    if token:
        base_headers["Authorization"] = token

    create_payload = {"appId": app_id, "nombre": app_name, "mail": email}
    create_status, create_body = request_json(
        CREATE_URL,
        "POST",
        base_headers,
        create_payload,
    )

    encoded_email = urllib.parse.quote(email, safe="")
    list_endpoint = f"{LIST_URL}?email={encoded_email}"
    list_headers = {"Content-Type": "text/plain", "Origin": "https://cognitivetesting.online"}
    if token:
        list_headers["Authorization"] = token

    list_status, list_body = request_json(
        list_endpoint,
        "GET",
        list_headers,
        None,
    )

    suites_from_app: Dict[str, str] = {}
    parsed_apps = parse_json_object(list_body)
    app_entry = parsed_apps.get(str(app_id))
    if isinstance(app_entry, dict):
        suites_obj = app_entry.get("suites")
        if isinstance(suites_obj, dict):
            suites_from_app = {str(k): str(v) for k, v in suites_obj.items()}

    my_processes_endpoint = f"{MY_PROCESSES_URL}?mail={encoded_email}"
    my_processes_status, my_processes_body = request_json(
        my_processes_endpoint,
        "GET",
        list_headers,
        None,
    )
    suite_id_for_listing = pick_first_non_empty(["COGNITIVE_SUITE_ID", "TARGET_SUITE_ID"], env_map) or "5640573"
    my_processes_parsed = parse_json_object(my_processes_body)
    suite_process_matches = (
        processes_for_suite(my_processes_parsed, suite_id_for_listing)
        if my_processes_status == 200 and my_processes_parsed
        else {}
    )

    suite_ts = int(time.time())
    suite_process_id = int(str(suite_ts)[-7:])
    suite_name = f"Tmp-Suite-Probe-{suite_ts}"
    suite_path_base = f"Processes/{suite_process_id}"
    suite_steps_path = f"{suite_path_base}/Steps"
    suite_step0_path = f"{suite_steps_path}/0"

    azure_headers = {"Content-Type": "application/json", "Origin": "https://cognitivetesting.online"}
    az1_status, az1_body = request_json(AZURE_CREATE_DIRECTORY_URL, "POST", azure_headers, {"path": suite_path_base})
    az2_status, az2_body = request_json(AZURE_CREATE_DIRECTORY_URL, "POST", azure_headers, {"path": suite_steps_path})
    az3_status, az3_body = request_json(AZURE_CREATE_DIRECTORY_URL, "POST", azure_headers, {"path": suite_step0_path})
    az4_status, az4_body = request_json(
        AZURE_CREATE_TXT_URL,
        "POST",
        azure_headers,
        {"path": suite_step0_path, "file": {"name": "Actions.txt", "content": "Hello World"}},
    )

    process_ts = int(time.time())
    process_id = int(str(process_ts)[-7:])
    process_name = f"Tmp-Process-Probe-{process_ts}"
    process_path_base = f"Processes/{process_id}"
    process_steps_path = f"{process_path_base}/Steps"
    process_step0_path = f"{process_steps_path}/0"

    p1_status, p1_body = request_json(
        AZURE_CREATE_DIRECTORY_URL,
        "POST",
        azure_headers,
        {"path": process_path_base},
    )
    p2_status, p2_body = request_json(
        AZURE_CREATE_DIRECTORY_URL,
        "POST",
        azure_headers,
        {"path": process_steps_path},
    )
    p3_status, p3_body = request_json(
        AZURE_CREATE_DIRECTORY_URL,
        "POST",
        azure_headers,
        {"path": process_step0_path},
    )
    p4_status, p4_body = request_json(
        AZURE_CREATE_TXT_URL,
        "POST",
        azure_headers,
        {"path": process_step0_path, "file": {"name": "Actions.txt", "content": "Hello world"}},
    )

    print("=== Probe Inputs ===")
    print(f"email_source={'present' if email else 'missing'}")
    print(f"password_source={'present' if password else 'missing'}")
    print(f"token_bootstrapped={'yes' if token else 'no'}")
    print(f"auth_diag={json.dumps(auth_diag)}")
    print(f"tmp_app_name={app_name}")
    print(f"tmp_app_id={app_id}")
    print("")

    print("=== Endpoint 1: POST apps-createApp ===")
    print(f"url={CREATE_URL}")
    print(f"status={create_status}")
    print("body=")
    print(truncate_token_like_strings(create_body))
    print("")

    print("=== Endpoint 2: GET apps-getAdminAppsAndSuites ===")
    print(f"url={list_endpoint}")
    print(f"status={list_status}")
    print("body=")
    print(truncate_token_like_strings(list_body))
    print("")

    print("=== Endpoint 3: GET suites under created app ===")
    print(f"app_id={app_id}")
    print(f"suites_count={len(suites_from_app)}")
    print(f"suites={json.dumps(suites_from_app, ensure_ascii=True)}")
    print("")

    print("=== Endpoint 4: GET tests-getMyProcesses ===")
    print(f"url={my_processes_endpoint}")
    print(f"status={my_processes_status}")
    print("body=")
    print(truncate_token_like_strings(my_processes_body))
    print("")

    print("=== Endpoint 4b: Processes within suite (derived from tests-getMyProcesses) ===")
    print(f"suite_id={suite_id_for_listing}")
    print(f"matched_processes_count={len(suite_process_matches)}")
    sample_keys = list(suite_process_matches.keys())[:10]
    print(f"matched_process_ids_sample={json.dumps(sample_keys)}")
    print("")

    print("=== Endpoint 5-8: Suite scaffold (tested Azure sequence) ===")
    print(f"suite_name={suite_name}")
    print(f"suite_process_id={suite_process_id}")
    print(f"POST {AZURE_CREATE_DIRECTORY_URL} path={suite_path_base} status={az1_status} body={truncate_token_like_strings(az1_body)}")
    print(f"POST {AZURE_CREATE_DIRECTORY_URL} path={suite_steps_path} status={az2_status} body={truncate_token_like_strings(az2_body)}")
    print(f"POST {AZURE_CREATE_DIRECTORY_URL} path={suite_step0_path} status={az3_status} body={truncate_token_like_strings(az3_body)}")
    print(f"POST {AZURE_CREATE_TXT_URL} path={suite_step0_path}/Actions.txt status={az4_status} body={truncate_token_like_strings(az4_body)}")
    print("")

    print("=== Endpoint 9-12: Process scaffold (tested Azure sequence) ===")
    print(f"process_name={process_name}")
    print(f"process_id={process_id}")
    print(f"POST {AZURE_CREATE_DIRECTORY_URL} path={process_path_base} status={p1_status} body={truncate_token_like_strings(p1_body)}")
    print(f"POST {AZURE_CREATE_DIRECTORY_URL} path={process_steps_path} status={p2_status} body={truncate_token_like_strings(p2_body)}")
    print(f"POST {AZURE_CREATE_DIRECTORY_URL} path={process_step0_path} status={p3_status} body={truncate_token_like_strings(p3_body)}")
    print(f"POST {AZURE_CREATE_TXT_URL} path={process_step0_path}/Actions.txt status={p4_status} body={truncate_token_like_strings(p4_body)}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
