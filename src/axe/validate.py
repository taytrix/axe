"""`steamcmd +app_update 443030 validate`: integrity check, no hooks fire."""

from __future__ import annotations

import shutil
from dataclasses import dataclass, field
from pathlib import Path

from axe.context import Context
from axe.errors import AxeError
from axe.layout import SERVER_APPID
from axe.steamcmd import (
    AppUpdate,
    SpawnLike,
    SteamcmdRequest,
    reserve_steamcmd_log,
    run_steamcmd,
)


@dataclass(frozen=True)
class ValidateOutcome:
    appid: int
    log_file: Path | None
    warnings: list[str] = field(default_factory=list)


def run_validate(
    ctx: Context,
    *,
    spawn: SpawnLike | None = None,
    log_file: Path | None = None,
    steamcmd_binary: str | None = None,
) -> ValidateOutcome:
    """Force a verify-and-repair pass over the dedicated server install."""
    binary = (
        steamcmd_binary
        or ctx.config.steamcmd.binary
        or shutil.which("steamcmd")
    )
    if not binary:
        raise AxeError(
            "config",
            "steamcmd binary not found; set [steamcmd].binary in axe.toml or install steamcmd",
        )

    out_log = log_file or reserve_steamcmd_log(ctx.layout.root, "validate")
    outcome = run_steamcmd(
        SteamcmdRequest(
            binary=binary,
            force_install_dir=str(ctx.layout.root),
            actions=[AppUpdate(appid=SERVER_APPID, validate=True)],
        ),
        spawn=spawn,
        log_file=out_log,
    )
    warnings: list[str] = []
    if outcome.exit != 0:
        tail = " | ".join(outcome.stderr.strip().splitlines()[-3:])
        warnings.append(
            f"steamcmd exited {outcome.exit}"
            + (f"; tail: {tail}" if tail else "")
            + f"; log: {out_log}"
        )

    return ValidateOutcome(appid=SERVER_APPID, log_file=out_log, warnings=warnings)
