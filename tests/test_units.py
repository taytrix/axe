from __future__ import annotations

from pathlib import Path

from axe.config import Config
from axe.layout import layout_at
from axe.units import render_monitor_units, render_server_unit


def _config() -> Config:
    return Config.model_validate(
        {"schema": 1, "server": {"id": "conan", "root": "/home/tay/conan"}}
    )


def test_server_unit_contains_exec_start_with_conan_binary() -> None:
    layout = layout_at("/home/tay/conan")
    text = render_server_unit(_config(), layout)
    assert "ExecStart=/home/tay/conan/ConanSandbox/Binaries/Linux/" in text
    assert "ConanSandbox -log" in text
    assert "WorkingDirectory=/home/tay/conan" in text


def test_server_unit_emits_default_target() -> None:
    text = render_server_unit(_config(), layout_at("/home/tay/conan"))
    assert "WantedBy=default.target" in text
    assert "multi-user.target" not in text


def test_server_unit_has_no_user_directive() -> None:
    text = render_server_unit(_config(), layout_at("/home/tay/conan"))
    assert "\nUser=" not in text


def test_monitor_units_pair() -> None:
    units = render_monitor_units(
        _config(),
        Path("/home/tay/conan/axe.toml"),
        axe_path="/usr/local/bin/axe",
    )
    assert "Type=oneshot" in units.service
    expected_exec = "ExecStart=/usr/local/bin/axe --config /home/tay/conan/axe.toml monitor"
    assert expected_exec in units.service
    assert "OnUnitActiveSec=5min" in units.timer
    assert "Unit=axe-conan-monitor.service" in units.timer
    assert "WantedBy=timers.target" in units.timer


def test_monitor_units_default_axe_path() -> None:
    units = render_monitor_units(_config(), Path("/home/tay/conan/axe.toml"))
    # Default uses sys.argv[0] resolved — any non-empty absolute path is fine.
    assert "ExecStart=" in units.service
    assert "/home/tay/conan/axe.toml" in units.service
