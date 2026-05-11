from __future__ import annotations

import subprocess
from collections.abc import Sequence
from pathlib import Path

import pytest

from axe.context import load_context
from axe.errors import AxeError
from axe.validate import run_validate

STUB_BIN = Path(__file__).parent / "fixtures" / "steamcmd_stub.sh"


def _real_spawn(argv: Sequence[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(list(argv), capture_output=True, text=True, check=False)


def test_validate_runs_steamcmd_with_validate_flag(synthetic_install: Path) -> None:
    (synthetic_install / "axe.toml").write_text(
        f"""\
schema = 1
[server]
id = "conan"
root = "{synthetic_install}"
[steamcmd]
binary = "{STUB_BIN}"
"""
    )
    ctx = load_context(synthetic_install / "axe.toml")
    outcome = run_validate(ctx, spawn=_real_spawn)
    assert outcome.appid == 443030
    assert outcome.log_file is not None
    # The stub fixture creates this binary on +app_update; confirms steamcmd was invoked.
    binary = (
        synthetic_install
        / "ConanSandbox"
        / "Binaries"
        / "Linux"
        / "ConanSandboxServer-Linux-Shipping"
    )
    assert binary.exists()


def test_validate_no_steamcmd_anywhere_raises_config(
    synthetic_install: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    (synthetic_install / "axe.toml").write_text(
        f"""\
schema = 1
[server]
id = "conan"
root = "{synthetic_install}"
"""
    )
    ctx = load_context(synthetic_install / "axe.toml")
    monkeypatch.setattr("shutil.which", lambda _name: None)
    with pytest.raises(AxeError, match="steamcmd binary not found"):
        run_validate(ctx)
