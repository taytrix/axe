from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from axe import __version__
from axe.context import Context
from axe.hooks import HookRunner, run_hook
from axe.state import SavedState, load_state, save_state, state_path
from axe.status import read_status


@dataclass(frozen=True)
class MonitorOutcome:
    state: SavedState
    state_path_str: str
    hook_fired: bool
    hook_warning: str | None


def run_monitor_tick(
    ctx: Context,
    *,
    hook_runner: HookRunner | None = None,
    now: datetime | None = None,
) -> MonitorOutcome:
    """One tick: read status -> write state.json -> fire on_drift if drift is new."""
    when = now or datetime.now(UTC)
    path = state_path(ctx.layout.root)
    prev = load_state(path)

    snapshot = read_status(ctx, with_mods=True)
    drift = (
        snapshot.mods.stale > 0
        or snapshot.mods.missing_local > 0
        or snapshot.mods.missing_remote > 0
    )
    warnings = list(snapshot.warnings)

    state = SavedState.model_validate(
        {
            "schema": 1,
            "axe_version": __version__,
            "checked_at": when.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "server": {
                "active_state": snapshot.server.active_state,
                "sub_state": snapshot.server.sub_state,
                "main_pid": snapshot.server.main_pid,
                "uptime_seconds": snapshot.server.uptime_seconds,
            },
            "mods": {
                "declared": snapshot.mods.declared,
                "current": snapshot.mods.current,
                "stale": snapshot.mods.stale,
                "missing_local": snapshot.mods.missing_local,
                "missing_remote": snapshot.mods.missing_remote,
            },
            "drift": drift,
            "warnings": warnings,
        }
    )

    hook_fired = False
    hook_warning: str | None = None
    if drift and _is_new_drift(prev, drift):
        hook_cmd = ctx.config.hooks.on_drift
        if hook_cmd:
            hook_fired = True
            hook_warning = run_hook(
                hook_cmd,
                env={
                    "AXE_ROOT": str(ctx.layout.root),
                    "AXE_STATE": str(path),
                    "AXE_EVENT": "drift",
                    "AXE_MODS_STALE": str(state.mods.stale),
                    "AXE_MODS_MISSING_LOCAL": str(state.mods.missing_local),
                    "AXE_MODS_MISSING_REMOTE": str(state.mods.missing_remote),
                },
                runner=hook_runner,
            )
            if hook_warning:
                state = state.model_copy(update={"warnings": [*state.warnings, hook_warning]})

    save_state(path, state)
    return MonitorOutcome(
        state=state,
        state_path_str=str(path),
        hook_fired=hook_fired,
        hook_warning=hook_warning,
    )


def _is_new_drift(prev: SavedState | None, drift: bool) -> bool:
    if not drift:
        return False
    if prev is None:
        return True
    return prev.drift is False
