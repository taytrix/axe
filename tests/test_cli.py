from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from typer.testing import CliRunner

from axe.cli import app
from axe.errors import ExitCode

runner = CliRunner()


def test_front_door_panel() -> None:
    result = runner.invoke(app, [])
    assert result.exit_code == 0
    assert "axe " in result.stdout
    assert "axe status" in result.stdout


def test_front_door_json_is_misuse() -> None:
    result = runner.invoke(app, ["--json"])
    assert result.exit_code == int(ExitCode.MISUSE)
    envelope = json.loads(result.stdout)
    assert envelope["ok"] is False
    assert envelope["command"] == "axe"


def test_init_writes_toml(synthetic_install: Path) -> None:
    result = runner.invoke(app, ["init", str(synthetic_install)])
    assert result.exit_code == 0
    assert (synthetic_install / "axe.toml").exists()


def test_init_json_envelope(synthetic_install: Path) -> None:
    result = runner.invoke(app, ["--json", "init", str(synthetic_install)])
    assert result.exit_code == 0
    envelope = json.loads(result.stdout)
    assert envelope["ok"] is True
    assert envelope["command"] == "init"
    assert envelope["data"]["root"] == str(synthetic_install)
    assert envelope["data"]["server_id"] == "conan"


def test_init_refuses_overwrite(synthetic_install_with_toml: Path) -> None:
    result = runner.invoke(app, ["init", str(synthetic_install_with_toml)])
    assert result.exit_code == int(ExitCode.FILESYSTEM)


def test_init_rejects_non_conan_install(tmp_path: Path) -> None:
    result = runner.invoke(app, ["init", str(tmp_path)])
    assert result.exit_code == int(ExitCode.DISCOVERY)


def _stub_systemctl(monkeypatch: pytest.MonkeyPatch, show: dict[str, str]) -> None:
    """Replace axe.systemd.systemctl_show with a stub returning `show`."""
    from axe import cli, status, systemd

    def fake(_unit: str) -> dict[str, str]:
        return show

    monkeypatch.setattr(systemd, "systemctl_show", fake)
    monkeypatch.setattr(status, "systemctl_show", fake)
    monkeypatch.setattr(cli, "systemctl_show", fake)


def test_status_envelope_shape(
    monkeypatch: pytest.MonkeyPatch,
    synthetic_install_with_toml: Path,
) -> None:
    _stub_systemctl(
        monkeypatch,
        {"ActiveState": "inactive", "SubState": "dead", "MainPID": "0"},
    )
    result = runner.invoke(
        app,
        ["--json", "--config", str(synthetic_install_with_toml / "axe.toml"), "status"],
    )
    assert result.exit_code == 0
    envelope: dict[str, Any] = json.loads(result.stdout)
    assert envelope["ok"] is True
    assert envelope["command"] == "status"
    data = envelope["data"]
    assert data["server"]["unit"] == "axe-conan.service"
    assert data["server"]["active_state"] == "inactive"
    assert data["server"]["main_pid"] is None
    assert data["mods"]["declared"] == 0


def test_status_missing_config(tmp_path: Path) -> None:
    missing = tmp_path / "absent.toml"
    result = runner.invoke(app, ["--config", str(missing), "status"])
    assert result.exit_code == int(ExitCode.CONFIG)


def test_server_status_envelope(
    monkeypatch: pytest.MonkeyPatch,
    synthetic_install_with_toml: Path,
) -> None:
    _stub_systemctl(
        monkeypatch,
        {"ActiveState": "active", "SubState": "running", "MainPID": "12345"},
    )
    result = runner.invoke(
        app,
        [
            "--json",
            "--config",
            str(synthetic_install_with_toml / "axe.toml"),
            "server",
            "status",
        ],
    )
    assert result.exit_code == 0
    envelope = json.loads(result.stdout)
    assert envelope["ok"] is True
    assert envelope["data"]["active_state"] == "active"
    assert envelope["data"]["main_pid"] == 12345


def test_unit_server_envelope(synthetic_install_with_toml: Path) -> None:
    result = runner.invoke(
        app,
        ["--json", "--config", str(synthetic_install_with_toml / "axe.toml"), "unit"],
    )
    assert result.exit_code == 0
    envelope = json.loads(result.stdout)
    assert envelope["data"]["target"] == "server"
    assert "ExecStart=" in envelope["data"]["text"]


def test_unit_monitor_envelope(synthetic_install_with_toml: Path) -> None:
    result = runner.invoke(
        app,
        [
            "--json",
            "--config",
            str(synthetic_install_with_toml / "axe.toml"),
            "unit",
            "monitor",
        ],
    )
    assert result.exit_code == 0
    envelope = json.loads(result.stdout)
    assert envelope["data"]["target"] == "monitor"
    assert "Type=oneshot" in envelope["data"]["service"]
    assert "WantedBy=timers.target" in envelope["data"]["timer"]


def test_unit_invalid_target(synthetic_install_with_toml: Path) -> None:
    result = runner.invoke(
        app,
        [
            "--config",
            str(synthetic_install_with_toml / "axe.toml"),
            "unit",
            "invalid",
        ],
    )
    assert result.exit_code == int(ExitCode.MISUSE)


def test_server_up_invokes_systemctl(
    monkeypatch: pytest.MonkeyPatch,
    synthetic_install_with_toml: Path,
) -> None:
    seen: dict[str, str] = {}

    from axe import cli, systemd
    from axe.systemd import SystemctlVerb, SystemdResult

    def fake(unit: str, verb: SystemctlVerb) -> SystemdResult:
        seen["unit"] = unit
        seen["verb"] = verb
        return SystemdResult(unit=unit, verb=verb, returncode=0, stdout="", stderr="")

    monkeypatch.setattr(systemd, "systemctl_verb", fake)
    monkeypatch.setattr(cli, "systemctl_verb", fake)
    result = runner.invoke(
        app,
        [
            "--json",
            "--config",
            str(synthetic_install_with_toml / "axe.toml"),
            "server",
            "up",
        ],
    )
    assert result.exit_code == 0
    assert seen == {"unit": "axe-conan.service", "verb": "start"}


def test_logs_path_no_dir(synthetic_install_with_toml: Path) -> None:
    result = runner.invoke(
        app,
        [
            "--json",
            "--config",
            str(synthetic_install_with_toml / "axe.toml"),
            "logs",
            "path",
        ],
    )
    assert result.exit_code == int(ExitCode.DISCOVERY)


def test_logs_path_with_logs_dir(synthetic_install_with_toml: Path) -> None:
    from axe.layout import layout_at

    layout = layout_at(synthetic_install_with_toml)
    layout.logs_dir.mkdir(parents=True)
    (layout.logs_dir / "ConanSandbox.log").write_text("hello\n")
    result = runner.invoke(
        app,
        [
            "--json",
            "--config",
            str(synthetic_install_with_toml / "axe.toml"),
            "logs",
            "path",
        ],
    )
    assert result.exit_code == 0
    envelope = json.loads(result.stdout)
    assert envelope["data"]["current_log"].endswith("ConanSandbox.log")


def test_logs_tail_returns_last_lines(synthetic_install_with_toml: Path) -> None:
    from axe.layout import layout_at

    layout = layout_at(synthetic_install_with_toml)
    layout.logs_dir.mkdir(parents=True)
    (layout.logs_dir / "ConanSandbox.log").write_text("one\ntwo\nthree\n")
    result = runner.invoke(
        app,
        [
            "--json",
            "--config",
            str(synthetic_install_with_toml / "axe.toml"),
            "logs",
            "tail",
            "--lines",
            "2",
        ],
    )
    assert result.exit_code == 0
    envelope = json.loads(result.stdout)
    assert envelope["data"]["lines"] == ["two", "three"]


def test_logs_tail_json_follow_is_misuse(synthetic_install_with_toml: Path) -> None:
    result = runner.invoke(
        app,
        [
            "--json",
            "--config",
            str(synthetic_install_with_toml / "axe.toml"),
            "logs",
            "tail",
            "--follow",
        ],
    )
    assert result.exit_code == int(ExitCode.MISUSE)
