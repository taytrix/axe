from __future__ import annotations

from datetime import UTC, datetime, timedelta

from axe.status import _server_status_from_show, relative_age


def test_active_status() -> None:
    started = int((datetime.now(UTC) - timedelta(seconds=900)).timestamp())
    show = {
        "ActiveState": "active",
        "SubState": "running",
        "MainPID": "12345",
        "ActiveEnterTimestamp": f"@{started}",
    }
    s = _server_status_from_show("axe-conan.service", show)
    assert s.unit == "axe-conan.service"
    assert s.active_state == "active"
    assert s.sub_state == "running"
    assert s.main_pid == 12345
    assert s.uptime_seconds is not None
    assert 890 <= s.uptime_seconds <= 910  # ~15 minutes, allow some skew


def test_uptime_is_tz_independent() -> None:
    """Regression: 0.3.3 parsed local-wallclock as UTC and overshot by the offset."""
    fifty_seconds_ago = int((datetime.now(UTC) - timedelta(seconds=50)).timestamp())
    show = {
        "ActiveState": "active",
        "SubState": "running",
        "ActiveEnterTimestamp": f"@{fifty_seconds_ago}",
    }
    s = _server_status_from_show("axe-conan.service", show)
    assert s.uptime_seconds is not None
    assert s.uptime_seconds < 120  # NOT 5h+ regardless of host TZ


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


def test_zero_epoch_timestamp_is_none() -> None:
    """systemd reports `@0` for units that haven't entered active yet."""
    show = {"ActiveEnterTimestamp": "@0"}
    s = _server_status_from_show("axe-conan.service", show)
    assert s.uptime_seconds is None


def test_malformed_timestamp_is_none() -> None:
    show = {"ActiveEnterTimestamp": "@not-a-number"}
    s = _server_status_from_show("axe-conan.service", show)
    assert s.uptime_seconds is None


def test_missing_main_pid_treated_as_zero() -> None:
    show = {"ActiveState": "active", "SubState": "running"}
    s = _server_status_from_show("axe-conan.service", show)
    assert s.main_pid is None


def test_non_numeric_pid_is_none() -> None:
    show = {"MainPID": "not-a-number"}
    s = _server_status_from_show("axe-conan.service", show)
    assert s.main_pid is None


def test_relative_age_recent() -> None:
    five_min_ago = (datetime.now(UTC) - timedelta(minutes=5)).strftime("%Y-%m-%dT%H:%M:%SZ")
    assert "minutes ago" in relative_age(five_min_ago)


def test_relative_age_hours() -> None:
    hours_ago = (datetime.now(UTC) - timedelta(hours=3)).strftime("%Y-%m-%dT%H:%M:%SZ")
    assert "hour" in relative_age(hours_ago)


def test_relative_age_malformed_returns_unknown() -> None:
    assert relative_age("not-a-timestamp") == "unknown"
