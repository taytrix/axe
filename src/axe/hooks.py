"""Hook execution: shell command + AXE_* env vars; failures are warnings, never raise.

Strict mode (per-hook in axe.toml) flips that: strict failure raises
`AxeError('hook')` so the calling verb aborts. Used for `before_sync` /
`before_restart` preflight checks (e.g. backup-completed gates).
"""

from __future__ import annotations

import os
import shlex
import subprocess
from collections.abc import Callable, Mapping, Sequence

from axe.errors import AxeError

HookRunner = Callable[[Sequence[str], Mapping[str, str]], subprocess.CompletedProcess[bytes]]


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
