"""Hook-composed lifecycle actions (systemctl + before/after hooks).

Charter: hook-composed lifecycle actions only. `axe server up/down` stay as
thin systemctl_verb wrappers in cli.py because they don't compose hooks.
"""

from __future__ import annotations

from dataclasses import dataclass

from axe.context import Context
from axe.errors import AxeError
from axe.hooks import HookRunner, RestartEnvContext, build_hook_env, run_hook
from axe.systemd import systemctl_show, systemctl_verb


@dataclass(frozen=True)
class RestartOutcome:
    unit: str
    old_pid: int | None
    new_pid: int | None
    warnings: list[str]


def restart_server(
    ctx: Context,
    *,
    hook_runner: HookRunner | None = None,
) -> RestartOutcome:
    """Compose before_restart + systemctl restart + after_restart with strict policy."""
    warnings: list[str] = []
    unit = ctx.config.effective_unit()
    old_pid = _server_main_pid(unit)

    pre = run_hook(
        ctx.config.hooks.before_restart,
        build_hook_env(ctx, "before_restart", restart=RestartEnvContext(old_pid=old_pid)),
        runner=hook_runner,
        strict=ctx.config.hooks.strict.before_restart,
    )
    if pre:
        warnings.append(pre)

    systemctl_verb(unit, "restart")
    new_pid = _server_main_pid(unit)

    post = run_hook(
        ctx.config.hooks.after_restart,
        build_hook_env(
            ctx,
            "after_restart",
            restart=RestartEnvContext(old_pid=old_pid, new_pid=new_pid),
        ),
        runner=hook_runner,
        strict=False,
    )
    if post:
        warnings.append(post)

    return RestartOutcome(unit=unit, old_pid=old_pid, new_pid=new_pid, warnings=warnings)


def _server_main_pid(unit: str) -> int | None:
    try:
        show = systemctl_show(unit)
    except AxeError:
        return None
    try:
        pid = int(show.get("MainPID", "0"))
    except ValueError:
        return None
    return pid if pid > 0 else None
