"""Streaming spawn: subprocess output is written to stderr AND captured."""

from __future__ import annotations

import sys

import pytest

from axe.errors import AxeError
from axe.steamcmd import (
    AppInfoPrint,
    SteamcmdRequest,
    _streaming_spawn,
    resolve_steamcmd,
    run_steamcmd,
)


def test_streaming_spawn_tees_to_stderr_and_captures(capfd: pytest.CaptureFixture[str]) -> None:
    result = _streaming_spawn([sys.executable, "-c", "print('streamed line')"])
    assert result.returncode == 0
    assert "streamed line" in result.stdout
    captured = capfd.readouterr()
    assert "streamed line" in captured.err


def test_resolve_steamcmd_uses_config_binary_first() -> None:
    assert resolve_steamcmd("/explicit/path/steamcmd") == "/explicit/path/steamcmd"


def test_resolve_steamcmd_falls_back_to_path(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "shutil.which",
        lambda name: "/usr/bin/steamcmd" if name == "steamcmd" else None,
    )
    assert resolve_steamcmd(None) == "/usr/bin/steamcmd"


def test_resolve_steamcmd_raises_with_install_hint(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("shutil.which", lambda _name: None)
    with pytest.raises(AxeError) as excinfo:
        resolve_steamcmd(None)
    assert "steamcmd not found in PATH" in excinfo.value.message
    assert "paru -S steamcmd" in excinfo.value.message
    assert "apt install steamcmd" in excinfo.value.message


def test_run_steamcmd_timeout_raises_lifecycle(monkeypatch: pytest.MonkeyPatch) -> None:
    """Short timeout against slow subprocess surfaces lifecycle error."""
    import subprocess

    def slow(*_a, **_kw) -> subprocess.CompletedProcess[str]:
        raise subprocess.TimeoutExpired(cmd="steamcmd", timeout=0.1)

    monkeypatch.setattr(subprocess, "run", slow)
    req = SteamcmdRequest(
        binary="/usr/bin/steamcmd",
        force_install_dir="/tmp/whatever",
        actions=[AppInfoPrint(appid=443030)],
    )
    with pytest.raises(AxeError, match="steamcmd timed out"):
        run_steamcmd(req, timeout=0.1)
