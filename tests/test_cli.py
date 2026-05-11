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


def test_init_works_on_empty_directory(tmp_path: Path) -> None:
    target = tmp_path / "fresh-root"
    result = runner.invoke(app, ["init", str(target)])
    assert result.exit_code == 0
    assert (target / "axe.toml").exists()


def test_init_creates_missing_directory(tmp_path: Path) -> None:
    target = tmp_path / "does" / "not" / "exist"
    result = runner.invoke(app, ["init", str(target)])
    assert result.exit_code == 0
    assert (target / "axe.toml").exists()


def test_install_writes_toml_and_runs_sync(tmp_path: Path) -> None:
    """`axe install <path>` mkdir-p's the dir, writes the toml, and runs sync."""
    from axe import cli, sync
    from axe.sync import SyncOutcome

    captured: dict[str, Path | None] = {"config_path": None}

    def fake_sync(context, **_kwargs):  # noqa: ANN001 — typer test stub
        captured["config_path"] = context.config_path
        return SyncOutcome(
            downloaded=[],
            missing=[],
            modlist_path=str(context.layout.modlist_txt),
            modlist_changed=False,
            log_file=None,
            base_build_updated=True,
            warnings=[],
        )

    monkeypatch = pytest.MonkeyPatch()
    try:
        monkeypatch.setattr(cli, "require_steamcmd_on_path", lambda: "/usr/bin/steamcmd")
        monkeypatch.setattr(sync, "run_sync", fake_sync)
        monkeypatch.setattr(cli, "run_sync", fake_sync)
        target = tmp_path / "fresh-conan"
        result = runner.invoke(app, ["install", str(target)])
        assert result.exit_code == 0
        assert (target / "axe.toml").exists()
        assert captured["config_path"] == target / "axe.toml"
    finally:
        monkeypatch.undo()


def test_install_refuses_existing_toml(synthetic_install_with_toml: Path) -> None:
    result = runner.invoke(app, ["install", str(synthetic_install_with_toml)])
    assert result.exit_code == int(ExitCode.FILESYSTEM)


def test_install_preflight_steamcmd_missing_does_not_write_toml(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """When steamcmd is absent, `axe install` fails BEFORE touching disk."""
    from axe import cli
    from axe.errors import AxeError as AE

    def fail() -> str:
        raise AE("config", "steamcmd not found in PATH.\n  install: ...")

    monkeypatch.setattr(cli, "require_steamcmd_on_path", fail)
    target = tmp_path / "should-not-exist"
    result = runner.invoke(app, ["install", str(target)])
    assert result.exit_code == int(ExitCode.CONFIG)
    assert not target.exists()  # NO partial state


def test_install_toml_exists_error_points_to_sync(synthetic_install_with_toml: Path) -> None:
    result = runner.invoke(app, ["install", str(synthetic_install_with_toml)])
    assert "axe sync" in result.stderr or "axe sync" in (result.stdout or "")


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
    # settings block is always present; the synthetic install has no .ini → all None/False
    assert data["settings"]["server_name"] is None
    assert data["settings"]["rcon_enabled"] is False
    assert data["settings"]["admin_password_set"] is False


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


# ---------- mods verbs (PR4) -----------------------------------------------


def _block_workshop_api(monkeypatch: pytest.MonkeyPatch) -> None:
    """Force the Workshop API to fail so mod list runs offline (no fixture noise)."""
    from axe import mods, workshop
    from axe.errors import AxeError

    def fail(_ids, fetch=None):  # noqa: ANN001
        raise AxeError("workshop_api", "test: API blocked")

    monkeypatch.setattr(workshop, "get_published_file_details", fail)
    monkeypatch.setattr(mods, "get_published_file_details", fail)


def _read_ids(toml_path: Path) -> list[int]:
    import tomlkit

    return [int(x) for x in tomlkit.parse(toml_path.read_text())["mods"]["ids"]]


def test_mods_add_top_writes_toml(synthetic_install_with_toml: Path) -> None:
    toml = synthetic_install_with_toml / "axe.toml"
    result = runner.invoke(app, ["--config", str(toml), "mods", "add", "top", "12345"])
    assert result.exit_code == 0
    assert _read_ids(toml) == [12345]


def test_mods_add_above_reorders(synthetic_install_with_toml: Path) -> None:
    toml = synthetic_install_with_toml / "axe.toml"
    runner.invoke(app, ["--config", str(toml), "mods", "add", "top", "111"])
    runner.invoke(app, ["--config", str(toml), "mods", "add", "bottom", "222"])
    result = runner.invoke(app, ["--config", str(toml), "mods", "add", "above", "2", "999"])
    assert result.exit_code == 0
    assert _read_ids(toml) == [111, 999, 222]


def test_mods_add_below_reorders(synthetic_install_with_toml: Path) -> None:
    toml = synthetic_install_with_toml / "axe.toml"
    runner.invoke(app, ["--config", str(toml), "mods", "add", "top", "111"])
    runner.invoke(app, ["--config", str(toml), "mods", "add", "bottom", "222"])
    result = runner.invoke(app, ["--config", str(toml), "mods", "add", "below", "1", "999"])
    assert result.exit_code == 0
    assert _read_ids(toml) == [111, 999, 222]


def test_mods_move_top(synthetic_install_with_toml: Path) -> None:
    toml = synthetic_install_with_toml / "axe.toml"
    runner.invoke(app, ["--config", str(toml), "mods", "add", "top", "111"])
    runner.invoke(app, ["--config", str(toml), "mods", "add", "bottom", "222"])
    runner.invoke(app, ["--config", str(toml), "mods", "add", "bottom", "333"])
    result = runner.invoke(app, ["--config", str(toml), "mods", "move", "top", "333"])
    assert result.exit_code == 0
    assert _read_ids(toml) == [333, 111, 222]


def test_mods_rm(synthetic_install_with_toml: Path) -> None:
    toml = synthetic_install_with_toml / "axe.toml"
    runner.invoke(app, ["--config", str(toml), "mods", "add", "top", "111"])
    runner.invoke(app, ["--config", str(toml), "mods", "add", "bottom", "222"])
    result = runner.invoke(app, ["--config", str(toml), "mods", "rm", "111"])
    assert result.exit_code == 0
    assert _read_ids(toml) == [222]


def test_mods_rm_missing_is_config_error(synthetic_install_with_toml: Path) -> None:
    toml = synthetic_install_with_toml / "axe.toml"
    result = runner.invoke(app, ["--config", str(toml), "mods", "rm", "12345"])
    assert result.exit_code == int(ExitCode.CONFIG)


def test_mods_anchor_out_of_range_is_config_error(synthetic_install_with_toml: Path) -> None:
    toml = synthetic_install_with_toml / "axe.toml"
    runner.invoke(app, ["--config", str(toml), "mods", "add", "top", "111"])
    result = runner.invoke(app, ["--config", str(toml), "mods", "add", "above", "9", "222"])
    assert result.exit_code == int(ExitCode.CONFIG)


def test_mods_add_duplicate_is_config_error(synthetic_install_with_toml: Path) -> None:
    toml = synthetic_install_with_toml / "axe.toml"
    runner.invoke(app, ["--config", str(toml), "mods", "add", "top", "111"])
    result = runner.invoke(app, ["--config", str(toml), "mods", "add", "top", "111"])
    assert result.exit_code == int(ExitCode.CONFIG)


def test_mods_list_envelope_has_ordinals(
    monkeypatch: pytest.MonkeyPatch, synthetic_install_with_toml: Path
) -> None:
    _block_workshop_api(monkeypatch)
    toml = synthetic_install_with_toml / "axe.toml"
    runner.invoke(app, ["--config", str(toml), "mods", "add", "top", "111"])
    runner.invoke(app, ["--config", str(toml), "mods", "add", "bottom", "222"])
    result = runner.invoke(app, ["--json", "--config", str(toml), "mods", "list"])
    envelope = json.loads(result.stdout)
    items = envelope["data"]["items"]
    assert [it["ordinal"] for it in items] == [1, 2]
    assert [it["id"] for it in items] == [111, 222]


def test_mods_bare_invokes_list(
    monkeypatch: pytest.MonkeyPatch, synthetic_install_with_toml: Path
) -> None:
    _block_workshop_api(monkeypatch)
    toml = synthetic_install_with_toml / "axe.toml"
    runner.invoke(app, ["--config", str(toml), "mods", "add", "top", "111"])
    result = runner.invoke(app, ["--json", "--config", str(toml), "mods"])
    envelope = json.loads(result.stdout)
    assert envelope["command"] == "mods"
    assert envelope["data"]["items"][0]["id"] == 111
