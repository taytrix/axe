"""`axe doctor`: walk the install, report what's in order and what isn't.

Each check is a tiny independent function returning (ok, label, detail). The
verb composes them; nothing here touches disk other than read-only stats.
"""

from __future__ import annotations

import shutil
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from axe.context import Context
from axe.state import load_state, state_path
from axe.systemd import systemctl_show


@dataclass(frozen=True)
class Check:
    name: str
    ok: bool
    detail: str


@dataclass(frozen=True)
class DoctorReport:
    checks: list[Check]

    @property
    def all_ok(self) -> bool:
        return all(c.ok for c in self.checks)


def run_doctor(ctx: Context) -> DoctorReport:
    """Run the ordered checks. Independent functions; order is presentation only."""
    checks = [
        _check_steamcmd(),
        _check_server_binary(ctx),
        _check_unit_installed(ctx, "server"),
        _check_unit_installed(ctx, "monitor-service"),
        _check_unit_installed(ctx, "monitor-timer"),
        _check_monitor_timer_active(ctx),
        _check_state_json_fresh(ctx),
    ]
    return DoctorReport(checks=checks)


def _check_steamcmd() -> Check:
    path = shutil.which("steamcmd")
    if path:
        return Check(name="steamcmd", ok=True, detail=path)
    return Check(
        name="steamcmd",
        ok=False,
        detail="not on PATH — install: `paru -S steamcmd` (arch) or `sudo apt install steamcmd`",
    )


def _check_server_binary(ctx: Context) -> Check:
    if ctx.layout.binary.exists():
        return Check(name="server binary", ok=True, detail=str(ctx.layout.binary))
    return Check(
        name="server binary",
        ok=False,
        detail=f"missing at {ctx.layout.binary} — run `axe sync` to install",
    )


def _check_unit_installed(ctx: Context, target: str) -> Check:
    base = ctx.config.effective_unit().removesuffix(".service")
    user_dir = Path.home() / ".config" / "systemd" / "user"
    if target == "server":
        name = f"{base}.service"
        path = user_dir / name
        label = "server unit"
    elif target == "monitor-service":
        name = f"{base}-monitor.service"
        path = user_dir / name
        label = "monitor service"
    else:  # monitor-timer
        name = f"{base}-monitor.timer"
        path = user_dir / name
        label = "monitor timer"

    if path.exists():
        return Check(name=label, ok=True, detail=str(path))
    return Check(
        name=label,
        ok=False,
        detail=f"missing at {path} — run `axe unit install` to write it",
    )


def _check_monitor_timer_active(ctx: Context) -> Check:
    base = ctx.config.effective_unit().removesuffix(".service")
    timer_name = f"{base}-monitor.timer"
    try:
        show = systemctl_show(timer_name)
    except Exception as e:  # noqa: BLE001 — doctor stays best-effort
        return Check(name="monitor timer active", ok=False, detail=f"systemctl show: {e}")
    state = show.get("ActiveState", "")
    if state == "active":
        return Check(name="monitor timer active", ok=True, detail="active")
    return Check(
        name="monitor timer active",
        ok=False,
        detail=f"{state or 'inactive'} — run `systemctl --user enable --now {timer_name}`",
    )


def _check_state_json_fresh(ctx: Context) -> Check:
    path = state_path(ctx.layout.root)
    state = load_state(path)
    if state is None:
        return Check(
            name="state.json",
            ok=False,
            detail=f"missing — run `axe monitor` to populate {path}",
        )
    try:
        dt = datetime.fromisoformat(state.checked_at.replace("Z", "+00:00"))
    except ValueError:
        return Check(
            name="state.json",
            ok=False,
            detail=f"unparseable checked_at: {state.checked_at}",
        )
    age_min = (datetime.now(UTC) - dt).total_seconds() / 60
    if age_min < 30:
        return Check(name="state.json", ok=True, detail=f"{state.checked_at} ({int(age_min)}m old)")
    return Check(
        name="state.json",
        ok=False,
        detail=(
            f"stale ({int(age_min)}m old) — the monitor timer should refresh "
            "every 5m; check `systemctl --user status axe-conan-monitor.timer`"
        ),
    )
