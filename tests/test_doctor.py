from __future__ import annotations

from pathlib import Path

import pytest

from axe.context import load_context
from axe.doctor import run_doctor


def _check(report, name: str):  # noqa: ANN001
    for c in report.checks:
        if c.name == name:
            return c
    raise AssertionError(f"check {name!r} missing from doctor report")


def test_doctor_server_binary_present(synthetic_install_with_toml: Path) -> None:
    """The synthetic fixture creates the server binary stub → ✓."""
    ctx = load_context(synthetic_install_with_toml / "axe.toml")
    report = run_doctor(ctx)
    assert _check(report, "server binary").ok is True


def test_doctor_server_binary_missing_when_absent(
    synthetic_install_with_toml: Path,
) -> None:
    """Remove the binary stub → ✗ with a recovery hint."""
    layout_bin = (
        synthetic_install_with_toml
        / "ConanSandbox"
        / "Binaries"
        / "Linux"
        / "ConanSandboxServer-Linux-Shipping"
    )
    layout_bin.unlink()
    ctx = load_context(synthetic_install_with_toml / "axe.toml")
    report = run_doctor(ctx)
    c = _check(report, "server binary")
    assert c.ok is False
    assert "axe sync" in c.detail


def test_doctor_steamcmd_check_uses_shutil_which(
    monkeypatch: pytest.MonkeyPatch, synthetic_install_with_toml: Path
) -> None:
    monkeypatch.setattr("shutil.which", lambda name: None if name == "steamcmd" else "/x")
    ctx = load_context(synthetic_install_with_toml / "axe.toml")
    report = run_doctor(ctx)
    c = _check(report, "steamcmd")
    assert c.ok is False
    assert "paru" in c.detail or "apt" in c.detail


def test_doctor_state_json_missing_fails(synthetic_install_with_toml: Path) -> None:
    ctx = load_context(synthetic_install_with_toml / "axe.toml")
    report = run_doctor(ctx)
    c = _check(report, "state.json")
    assert c.ok is False
    assert "axe monitor" in c.detail


def test_doctor_report_all_ok_aggregates(synthetic_install_with_toml: Path) -> None:
    """all_ok is False when any check fails (default state for a fresh install)."""
    ctx = load_context(synthetic_install_with_toml / "axe.toml")
    report = run_doctor(ctx)
    assert report.all_ok is False
