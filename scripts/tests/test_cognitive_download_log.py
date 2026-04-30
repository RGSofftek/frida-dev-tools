from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = REPO_ROOT / "resources" / "cli-tools" / "cognitive_download_log.py"
_SPEC = importlib.util.spec_from_file_location("cognitive_download_log", MODULE_PATH)
assert _SPEC and _SPEC.loader
cognitive_download_log = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(cognitive_download_log)


def test_large_log_500_shows_size_aware_message(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    large_size = 51_473_009
    process_id = 1555960
    user_email = "rodrigo.gracia@softtek.com"
    run_id = "latest"
    selected_run = "2026043007410564"
    result_path = f"Processes/{process_id}/{user_email}/{selected_run}/Result"

    def fake_list_dir(path: str) -> list[dict]:
        if path == f"Processes/{process_id}/{user_email}":
            return [{"kind": "directory", "name": selected_run}]
        if path == result_path:
            return [
                {
                    "kind": "file",
                    "name": f"log-{selected_run}.txt",
                    "properties": {"contentLength": large_size},
                }
            ]
        raise AssertionError(f"unexpected path {path}")

    def fake_get_txt(path: str, file_name: str) -> str:
        raise SystemExit(
            f"HTTP 500 for {cognitive_download_log.AZURE_BASE}/azure-getTxtFile\nbackend failed"
        )

    monkeypatch.setattr(cognitive_download_log, "_list_dir", fake_list_dir)
    monkeypatch.setattr(cognitive_download_log, "_get_txt", fake_get_txt)

    with pytest.raises(SystemExit) as exc_info:
        cognitive_download_log.run(
            process_id=process_id,
            user_email=user_email,
            run_id=run_id,
            file_name=None,
            out_dir=tmp_path,
        )

    message = str(exc_info.value)
    assert "HTTP 500" in message
    assert "likely failed server-side due to large text payload size or timeout" in message
    assert f"Run: {selected_run}" in message
    assert f"File size: {large_size} bytes" in message
    assert "frida-rpa logs get --process-id 1555960 --run-id <older-run-id>" in message


def test_small_log_500_keeps_original_error(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    process_id = 1555960
    user_email = "rodrigo.gracia@softtek.com"
    selected_run = "2026043007355334"
    file_name = f"log-{selected_run}.txt"
    result_path = f"Processes/{process_id}/{user_email}/{selected_run}/Result"

    def fake_list_dir(path: str) -> list[dict]:
        if path == result_path:
            return [{"kind": "file", "name": file_name, "properties": {"contentLength": 1024}}]
        raise AssertionError(f"unexpected path {path}")

    def fake_get_txt(path: str, chosen_file: str) -> str:
        raise SystemExit(
            f"HTTP 500 for {cognitive_download_log.AZURE_BASE}/azure-getTxtFile\nbackend failed"
        )

    monkeypatch.setattr(cognitive_download_log, "_list_dir", fake_list_dir)
    monkeypatch.setattr(cognitive_download_log, "_get_txt", fake_get_txt)

    with pytest.raises(SystemExit) as exc_info:
        cognitive_download_log.run(
            process_id=process_id,
            user_email=user_email,
            run_id=selected_run,
            file_name=file_name,
            out_dir=tmp_path,
        )

    assert str(exc_info.value).startswith(
        f"HTTP 500 for {cognitive_download_log.AZURE_BASE}/azure-getTxtFile"
    )
