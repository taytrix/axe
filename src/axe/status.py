"""The Status snapshot: what is true now (server + mods + build + warnings)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

import humanize

from axe.build import BuildStatus, empty_build_status, read_build_status
from axe.context import Context
from axe.errors import AxeError
from axe.mods import ModsStatus, empty_mods_status, read_mods_status
from axe.settings import ServerSettings, empty_server_settings, read_server_settings
from axe.state import SavedState
from axe.steamcmd import SpawnLike
from axe.systemd import systemctl_show
from axe.workshop import FetchLike


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
    build: BuildStatus
    settings: ServerSettings
    warnings: list[str]

    @property
    def drifted(self) -> bool:
        """Any drift at all: mods OR base build. The single UX-level signal."""
        return (
            self.mods.stale > 0
            or self.mods.missing_local > 0
            or self.mods.missing_remote > 0
            or self.build.drifted
        )


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
    """ActiveEnterTimestamp is `@<unix-epoch>` under `--timestamp=unix`.

    Empty string when the unit has never been active. Falls back to a None
    return for any unexpected shape rather than crashing.
    """
    raw = show.get("ActiveEnterTimestamp", "")
    if not raw or not raw.startswith("@"):
        return None
    try:
        epoch = int(raw[1:])
    except ValueError:
        return None
    if epoch == 0:
        return None
    return max(0, int(datetime.now(UTC).timestamp() - epoch))


def status_from_saved(saved: SavedState, ctx: Context) -> Status:
    """Reconstruct a Status from a persisted SavedState (offline path).

    `ctx` provides config-derived values that aren't persisted (config_path,
    root). `unit` falls back to the configured effective unit when the
    state.json is from an older axe that didn't persist it.
    """
    return Status(
        config_path=str(ctx.config_path),
        root=str(ctx.layout.root),
        server=ServerStatus(
            unit=saved.server.unit or ctx.config.effective_unit(),
            active_state=saved.server.active_state,
            sub_state=saved.server.sub_state,
            main_pid=saved.server.main_pid,
            uptime_seconds=saved.server.uptime_seconds,
        ),
        mods=ModsStatus(
            declared=saved.mods.declared,
            current=saved.mods.current,
            stale=saved.mods.stale,
            missing_local=saved.mods.missing_local,
            missing_remote=saved.mods.missing_remote,
        ),
        build=BuildStatus(
            installed_buildid=saved.build.installed_buildid,
            latest_buildid=saved.build.latest_buildid,
            binary_present=saved.build.binary_present,
            drifted=saved.build.drifted,
            warnings=[],
        ),
        settings=ServerSettings(
            server_name=saved.settings.server_name,
            rcon_enabled=saved.settings.rcon_enabled,
            rcon_port=saved.settings.rcon_port,
            rcon_password_set=saved.settings.rcon_password_set,
            admin_password_set=saved.settings.admin_password_set,
            server_password_set=saved.settings.server_password_set,
            max_players=saved.settings.max_players,
            warnings=[],
        ),
        warnings=list(saved.warnings),
    )


def relative_age(checked_at: str) -> str:
    """Return e.g. `5 minutes ago`. Tolerates malformed timestamps."""
    try:
        dt = datetime.fromisoformat(checked_at.replace("Z", "+00:00"))
    except ValueError:
        return "unknown"
    return humanize.naturaltime(dt)


def read_status(
    ctx: Context,
    *,
    with_mods: bool = True,
    with_build: bool = True,
    with_settings: bool = True,
    fetch: FetchLike | None = None,
    spawn: SpawnLike | None = None,
) -> Status:
    warnings: list[str] = []
    server = read_server_status(ctx.config.effective_unit())
    if with_mods:
        mods_status, mods_warnings = read_mods_status(ctx, fetch=fetch)
        warnings.extend(mods_warnings)
    else:
        mods_status = empty_mods_status()
    if with_build:
        build = read_build_status(ctx, spawn=spawn)
        warnings.extend(build.warnings)
    else:
        build = empty_build_status()
    if with_settings:
        settings = read_server_settings(ctx.layout)
        warnings.extend(settings.warnings)
    else:
        settings = empty_server_settings()
    return Status(
        config_path=str(ctx.config_path),
        root=str(ctx.layout.root),
        server=server,
        mods=mods_status,
        build=build,
        settings=settings,
        warnings=warnings,
    )
