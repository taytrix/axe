from __future__ import annotations

import json
import subprocess

import httpx
import pytest

from axe import __version__
from axe.errors import AxeError
from axe.update import RELEASES_LATEST_URL, latest_release_tag, run_update


def _response(tag: str) -> httpx.Response:
    return httpx.Response(
        200,
        content=json.dumps({"tag_name": tag}).encode(),
        request=httpx.Request("GET", RELEASES_LATEST_URL),
    )


def test_latest_release_tag_parses_response() -> None:
    def fetch(_url: str) -> httpx.Response:
        return _response("python-v0.9.99")

    assert latest_release_tag(fetch=fetch) == "python-v0.9.99"


def test_latest_release_tag_http_error_raises() -> None:
    def fetch(_url: str) -> httpx.Response:
        return httpx.Response(
            404,
            request=httpx.Request("GET", RELEASES_LATEST_URL),
        )

    with pytest.raises(AxeError, match="HTTP 404"):
        latest_release_tag(fetch=fetch)


def test_run_update_noop_when_already_at_target(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("shutil.which", lambda name: "/usr/bin/uv" if name == "uv" else None)

    def fetch(_url: str) -> httpx.Response:
        return _response(f"python-v{__version__}")

    outcome = run_update(fetch=fetch)
    assert outcome.upgraded is False
    assert outcome.target == f"python-v{__version__}"


def test_run_update_spawns_uv_tool_install(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("shutil.which", lambda name: "/usr/bin/uv" if name == "uv" else None)

    def fetch(_url: str) -> httpx.Response:
        return _response("python-v9.9.9")

    captured: dict[str, list[str]] = {}

    def fake_spawn(cmd: list[str]) -> subprocess.CompletedProcess[str]:
        captured["cmd"] = cmd
        return subprocess.CompletedProcess(args=cmd, returncode=0, stdout="", stderr="")

    outcome = run_update(fetch=fetch, spawn=fake_spawn)
    assert outcome.upgraded is True
    assert outcome.target == "python-v9.9.9"
    assert "uv" in captured["cmd"]
    assert "tool" in captured["cmd"]
    assert "install" in captured["cmd"]
    assert "--from" in captured["cmd"]
    assert any("@python-v9.9.9" in arg for arg in captured["cmd"])
    assert "--force" in captured["cmd"]


def test_run_update_no_uv_raises_config_error(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("shutil.which", lambda _name: None)
    with pytest.raises(AxeError, match="uv not found"):
        run_update(target_tag="python-v9.9.9")


def test_run_update_uv_nonzero_exit_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("shutil.which", lambda name: "/usr/bin/uv" if name == "uv" else None)

    def fake_spawn(cmd: list[str]) -> subprocess.CompletedProcess[str]:
        return subprocess.CompletedProcess(args=cmd, returncode=1, stdout="", stderr="error")

    with pytest.raises(AxeError, match="uv tool install failed"):
        run_update(target_tag="python-v9.9.9", spawn=fake_spawn)
