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
    raw = show.get("ActiveEnterTimestamp", "")
    if not raw:
        return None
    parts = raw.split(maxsplit=1)
    if len(parts) < 2:
        return None
    ts_text = parts[1]
    tokens = ts_text.split()
    if len(tokens) < 2:
        return None
    ts_no_tz = " ".join(tokens[:-1]) if len(tokens) >= 3 else " ".join(tokens[:2])
    try:
        dt = datetime.strptime(ts_no_tz, "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return None
    dt = dt.replace(tzinfo=UTC)
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
