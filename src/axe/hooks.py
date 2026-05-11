"""Hook execution + AXE_* env construction (single source of truth).

`build_hook_env` is the only place AXE_* keys are written; sync, monitor, and
lifecycle all funnel through it. Strict mode (per-hook in axe.toml) flips
failure-as-warning into `AxeError('hook')`, used for `before_sync` /
`before_restart` preflight gates.
"""

from __future__ import annotations

import os
import shlex
import subprocess
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING

from axe.errors import AxeError

if TYPE_CHECKING:
    from axe.build import BuildStatus
    from axe.context import Context
    from axe.sync import SyncOutcome

HookRunner = Callable[[Sequence[str], Mapping[str, str]], subprocess.CompletedProcess[bytes]]


@dataclass(frozen=True)
class SyncEnvContext:
    """Mods counts + build state for sync/drift hooks. `outcome` is set for after_sync only."""

    mods_stale: int
    mods_missing_local: int
    mods_missing_remote: int
    build: BuildStatus
    outcome: SyncOutcome | None = None


@dataclass(frozen=True)
class RestartEnvContext:
    """PID transition data for before_/after_restart hooks."""

    old_pid: int | None = None
    new_pid: int | None = None


def build_hook_env(
    ctx: Context,
    event: str,
    *,
    sync: SyncEnvContext | None = None,
    restart: RestartEnvContext | None = None,
) -> dict[str, str]:
    """Build AXE_* env vars for a hook invocation."""
    env: dict[str, str] = {
        "AXE_ROOT": str(ctx.layout.root),
        "AXE_STATE": str(ctx.layout.root / ".axe" / "state.json"),
        "AXE_EVENT": event,
    }
    if sync is not None:
        env["AXE_MODS_STALE"] = str(sync.mods_stale)
        env["AXE_MODS_MISSING_LOCAL"] = str(sync.mods_missing_local)
        env["AXE_MODS_MISSING_REMOTE"] = str(sync.mods_missing_remote)
        env["AXE_BUILD_DRIFTED"] = "1" if sync.build.drifted else "0"
        env["AXE_BUILD_INSTALLED"] = sync.build.installed_buildid or ""
        env["AXE_BUILD_LATEST"] = sync.build.latest_buildid or ""
        if sync.outcome is not None:
            env["AXE_SYNC_DOWNLOADED"] = str(len(sync.outcome.downloaded))
            env["AXE_SYNC_MISSING"] = str(len(sync.outcome.missing))
            env["AXE_SYNC_MODLIST_CHANGED"] = "1" if sync.outcome.modlist_changed else "0"
    if restart is not None:
        if restart.old_pid is not None:
            env["AXE_RESTART_OLD_PID"] = str(restart.old_pid)
        if restart.new_pid is not None:
            env["AXE_RESTART_NEW_PID"] = str(restart.new_pid)
    return env


def _default_runner(
    argv: Sequence[str],
    env: Mapping[str, str],
) -> subprocess.CompletedProcess[bytes]:
    merged_env = {**os.environ, **env}
    return subprocess.run(list(argv), env=merged_env, check=False, capture_output=True)


def run_hook(
    command: str,
    env: Mapping[str, str],
    *,
    runner: HookRunner | None = None,
    strict: bool = False,
) -> str | None:
    """Run a hook with AXE_* env. Strict failure raises; else returns a warning string."""
    cleaned = command.strip()
    if not cleaned:
        return None
    argv = shlex.split(cleaned)
    impl = runner or _default_runner
    msg: str
    try:
        completed = impl(argv, env)
    except FileNotFoundError:
        msg = f"hook command not found: {argv[0]}"
    except OSError as e:
        msg = f"hook spawn failure: {e}"
    else:
        if completed.returncode == 0:
            return None
        msg = f"hook exited {completed.returncode}: {argv[0]}"
    if strict:
        raise AxeError("hook", msg)
    return msg
