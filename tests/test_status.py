from __future__ import annotations

from axe.status import _server_status_from_show


def test_active_status() -> None:
    show = {
        "ActiveState": "active",
        "SubState": "running",
        "MainPID": "12345",
        "ActiveEnterTimestamp": "Sat 2026-05-10 12:00:00 UTC",
    }
    s = _server_status_from_show("axe-conan.service", show)
    assert s.unit == "axe-conan.service"
    assert s.active_state == "active"
    assert s.sub_state == "running"
    assert s.main_pid == 12345
    assert s.uptime_seconds is not None
    assert s.uptime_seconds >= 0


def test_inactive_status() -> None:
    show = {
        "ActiveState": "inactive",
        "SubState": "dead",
        "MainPID": "0",
        "ActiveEnterTimestamp": "",
    }
    s = _server_status_from_show("axe-conan.service", show)
    assert s.active_state == "inactive"
    assert s.main_pid is None
    assert s.uptime_seconds is None


def test_missing_main_pid_treated_as_zero() -> None:
    show = {"ActiveState": "active", "SubState": "running"}
    s = _server_status_from_show("axe-conan.service", show)
    assert s.main_pid is None


def test_non_numeric_pid_is_none() -> None:
    show = {"MainPID": "not-a-number"}
    s = _server_status_from_show("axe-conan.service", show)
    assert s.main_pid is None
