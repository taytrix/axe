"""Hook execution: shell command + AXE_* env vars; failures are warnings, never raise."""

from __future__ import annotations

import os
import shlex
import subprocess
from collections.abc import Callable, Mapping, Sequence

HookRunner = Callable[[Sequence[str], Mapping[str, str]], "subprocess.CompletedProcess[bytes]"]


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
) -> str | None:
    """Run a hook command with AXE_* env vars. Returns warning text on failure, else None."""
    command = command.strip()
    if not command:
        return None
    argv = shlex.split(command)
    impl = runner or _default_runner
    try:
        completed = impl(argv, env)
    except FileNotFoundError:
        return f"hook command not found: {argv[0]}"
    except OSError as e:
        return f"hook spawn failure: {e}"
    if completed.returncode != 0:
        return f"hook exited {completed.returncode}: {argv[0]}"
    return None
