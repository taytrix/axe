"""The Status snapshot: what is true now (server + mods + warnings)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from axe.context import Context
from axe.errors import AxeError
from axe.mods import ModsStatus, read_mods_status
from axe.systemd import systemctl_show


@dataclass(frozen=True)
class ServerStatus:
    unit: str
    active_state: str
    sub_state: str
    main_pid: int | None
    uptime_seconds: int | None


@dataclass(frozen=True)
class Status:
    config_path: str
    root: str
    server: ServerStatus
    mods: ModsStatus
    warnings: list[str]


def read_server_status(unit: str) -> ServerStatus:
    try:
        show = systemctl_show(unit)
    except AxeError:
        return ServerStatus(
            unit=unit,
            active_state="unknown",
            sub_state="unknown",
            main_pid=None,
            uptime_seconds=None,
        )
    return _server_status_from_show(unit, show)


def _server_status_from_show(unit: str, show: dict[str, str]) -> ServerStatus:
    pid_raw = show.get("MainPID", "0")
    try:
        pid = int(pid_raw)
    except ValueError:
        pid = 0
    return ServerStatus(
        unit=unit,
        active_state=show.get("ActiveState", "inactive"),
        sub_state=show.get("SubState", "dead"),
        main_pid=pid if pid > 0 else None,
        uptime_seconds=_compute_uptime(show),
    )


def _compute_uptime(show: dict[str, str]) -> int | None:
    """ActiveEnterTimestamp is 'DOW YYYY-MM-DD HH:MM:SS TZ'; parse the middle two tokens."""
    tokens = show.get("ActiveEnterTimestamp", "").split()
    if len(tokens) < 3:
        return None
    try:
        dt = datetime.strptime(f"{tokens[1]} {tokens[2]}", "%Y-%m-%d %H:%M:%S").replace(tzinfo=UTC)
    except ValueError:
        return None
    return max(0, int((datetime.now(UTC) - dt).total_seconds()))


def read_status(ctx: Context, *, with_mods: bool = True) -> Status:
    warnings: list[str] = []
    server = read_server_status(ctx.config.effective_unit())
    if with_mods:
        mods_status, mods_warnings = read_mods_status(ctx)
        warnings.extend(mods_warnings)
    else:
        from axe.mods import empty_mods_status

        mods_status = empty_mods_status()
    return Status(
        config_path=str(ctx.config_path),
        root=str(ctx.layout.root),
        server=server,
        mods=mods_status,
        warnings=warnings,
    )
