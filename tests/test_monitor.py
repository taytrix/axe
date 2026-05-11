from __future__ import annotations

import subprocess
from collections.abc import Mapping, Sequence
from pathlib import Path

import pytest

from axe.context import load_context
from axe.monitor import run_monitor_tick
from axe.state import load_state


@pytest.fixture
def install_with_declared(synthetic_install: Path) -> Path:
    """Synthetic install with one declared mod id and no ACF (forces missing_local drift)."""
    toml = f"""\
schema = 1

[server]
id = "conan"
root = "{synthetic_install}"

[mods]
ids = [880454836]

[hooks]
on_drift = "echo drift"
"""
    (synthetic_install / "axe.toml").write_text(toml)
    return synthetic_install


def _no_op_runner(
    _argv: Sequence[str], _env: Mapping[str, str]
) -> subprocess.CompletedProcess[bytes]:
    return subprocess.CompletedProcess(args=[], returncode=0, stdout=b"", stderr=b"")


def _block_workshop_api(monkeypatch: pytest.MonkeyPatch) -> None:
    """Force workshop API to fail so freshness uses ACF only."""
    from axe import mods, workshop
    from axe.errors import AxeError

    def fail(_ids, fetch=None):  # noqa: ANN001 — signature mirror
        raise AxeError("workshop_api", "test: API blocked")

    monkeypatch.setattr(workshop, "get_published_file_details", fail)
    monkeypatch.setattr(mods, "get_published_file_details", fail)


def _stub_build_status(monkeypatch: pytest.MonkeyPatch, *, drifted: bool = False) -> None:
    """Replace read_build_status everywhere with a deterministic stub."""
    from axe import build, status
    from axe.build import BuildStatus

    def fake(_ctx, *, spawn=None):  # noqa: ANN001 — signature mirror
        return BuildStatus(
            installed_buildid="100" if drifted else "200",
            latest_buildid="200",
            binary_present=True,
            drifted=drifted,
            warnings=[],
        )

    monkeypatch.setattr(build, "read_build_status", fake)
    monkeypatch.setattr(status, "read_build_status", fake)


def test_first_tick_with_drift_writes_state_and_fires_hook(
    install_with_declared: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _block_workshop_api(monkeypatch)
    _stub_build_status(monkeypatch, drifted=False)
    ctx = load_context(install_with_declared / "axe.toml")
    seen: dict[str, str] = {}

    def capture(
        _argv: Sequence[str], env: Mapping[str, str]
    ) -> subprocess.CompletedProcess[bytes]:
        for k, v in env.items():
            if k.startswith("AXE_"):
                seen[k] = v
        return subprocess.CompletedProcess(args=[], returncode=0, stdout=b"", stderr=b"")

    outcome = run_monitor_tick(ctx, hook_runner=capture)
    assert outcome.state.drift is True
    assert outcome.hook_fired is True
    assert seen["AXE_EVENT"] == "drift"
    assert seen["AXE_ROOT"] == str(install_with_declared)
    assert (install_with_declared / ".axe" / "state.json").exists()


def test_second_tick_with_persistent_drift_does_not_fire_hook(
    install_with_declared: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _block_workshop_api(monkeypatch)
    _stub_build_status(monkeypatch, drifted=False)
    ctx = load_context(install_with_declared / "axe.toml")

    first = run_monitor_tick(ctx, hook_runner=_no_op_runner)
    assert first.hook_fired is True

    second = run_monitor_tick(ctx, hook_runner=_no_op_runner)
    assert second.state.drift is True
    assert second.hook_fired is False


def test_drift_to_clean_to_drift_fires_hook_twice(
    synthetic_install: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _block_workshop_api(monkeypatch)
    _stub_build_status(monkeypatch, drifted=False)
    # Start with one declared id and no ACF -> drift
    (synthetic_install / "axe.toml").write_text(
        f"""\
schema = 1
[server]
id = "conan"
root = "{synthetic_install}"
[mods]
ids = [1]
[hooks]
on_drift = "echo"
"""
    )
    ctx = load_context(synthetic_install / "axe.toml")
    first = run_monitor_tick(ctx, hook_runner=_no_op_runner)
    assert first.hook_fired is True

    # Drop declared mod -> clean
    (synthetic_install / "axe.toml").write_text(
        f"""\
schema = 1
[server]
id = "conan"
root = "{synthetic_install}"
[mods]
ids = []
[hooks]
on_drift = "echo"
"""
    )
    ctx2 = load_context(synthetic_install / "axe.toml")
    clean = run_monitor_tick(ctx2, hook_runner=_no_op_runner)
    assert clean.state.drift is False
    assert clean.hook_fired is False

    # Re-add declared mod -> drift again
    (synthetic_install / "axe.toml").write_text(
        f"""\
schema = 1
[server]
id = "conan"
root = "{synthetic_install}"
[mods]
ids = [1]
[hooks]
on_drift = "echo"
"""
    )
    ctx3 = load_context(synthetic_install / "axe.toml")
    third = run_monitor_tick(ctx3, hook_runner=_no_op_runner)
    assert third.state.drift is True
    assert third.hook_fired is True


def test_empty_hook_command_does_not_fire(
    synthetic_install: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _block_workshop_api(monkeypatch)
    _stub_build_status(monkeypatch, drifted=False)
    (synthetic_install / "axe.toml").write_text(
        f"""\
schema = 1
[server]
id = "conan"
root = "{synthetic_install}"
[mods]
ids = [1]
"""
    )
    ctx = load_context(synthetic_install / "axe.toml")
    outcome = run_monitor_tick(ctx, hook_runner=_no_op_runner)
    assert outcome.state.drift is True
    assert outcome.hook_fired is False


def test_state_persists(install_with_declared: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _block_workshop_api(monkeypatch)
    _stub_build_status(monkeypatch, drifted=False)
    ctx = load_context(install_with_declared / "axe.toml")
    run_monitor_tick(ctx, hook_runner=_no_op_runner)
    loaded = load_state(install_with_declared / ".axe" / "state.json")
    assert loaded is not None
    assert loaded.drift is True
    assert loaded.mods.missing_local == 1
    # state.build is always present in 0.2 (even if installed/latest unknown)
    assert loaded.build.installed_buildid in (None, "200")
    assert loaded.build.drifted is False


def test_build_drift_triggers_on_drift(
    synthetic_install: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """No mods declared, but base build drifted -> on_drift fires."""
    _block_workshop_api(monkeypatch)
    _stub_build_status(monkeypatch, drifted=True)
    (synthetic_install / "axe.toml").write_text(
        f"""\
schema = 1
[server]
id = "conan"
root = "{synthetic_install}"
[mods]
ids = []
[hooks]
on_drift = "echo"
"""
    )
    ctx = load_context(synthetic_install / "axe.toml")
    outcome = run_monitor_tick(ctx, hook_runner=_no_op_runner)
    assert outcome.state.drift is True
    assert outcome.state.build.drifted is True
    assert outcome.hook_fired is True
