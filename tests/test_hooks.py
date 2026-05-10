from __future__ import annotations

import subprocess
from collections.abc import Mapping, Sequence

from axe.hooks import run_hook


def _ok_runner(
    _argv: Sequence[str], _env: Mapping[str, str]
) -> subprocess.CompletedProcess[bytes]:
    return subprocess.CompletedProcess(args=[], returncode=0, stdout=b"", stderr=b"")


def _fail_runner(
    _argv: Sequence[str], _env: Mapping[str, str]
) -> subprocess.CompletedProcess[bytes]:
    return subprocess.CompletedProcess(args=[], returncode=2, stdout=b"", stderr=b"")


def test_empty_command_no_op() -> None:
    assert run_hook("", {}, runner=_ok_runner) is None


def test_success_returns_none() -> None:
    assert run_hook("echo hi", {"AXE_EVENT": "drift"}, runner=_ok_runner) is None


def test_failure_returns_warning() -> None:
    warn = run_hook("echo hi", {}, runner=_fail_runner)
    assert warn is not None
    assert "exited 2" in warn


def test_command_not_found() -> None:
    def fnf(_argv: Sequence[str], _env: Mapping[str, str]) -> subprocess.CompletedProcess[bytes]:
        raise FileNotFoundError("no such file")

    warn = run_hook("nope.sh", {}, runner=fnf)
    assert warn is not None
    assert "not found" in warn


def test_env_var_passed_to_runner() -> None:
    seen: dict[str, str] = {}

    def capture(
        _argv: Sequence[str], env: Mapping[str, str]
    ) -> subprocess.CompletedProcess[bytes]:
        seen.update(env)
        return subprocess.CompletedProcess(args=[], returncode=0, stdout=b"", stderr=b"")

    run_hook("any-cmd", {"AXE_EVENT": "drift", "AXE_ROOT": "/x"}, runner=capture)
    assert seen["AXE_EVENT"] == "drift"
    assert seen["AXE_ROOT"] == "/x"
