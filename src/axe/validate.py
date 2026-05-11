"""`steamcmd +app_update 443030 validate`: integrity check, no hooks fire."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from axe.context import Context
from axe.layout import SERVER_APPID
from axe.steamcmd import (
    AppUpdate,
    SpawnLike,
    resolve_steamcmd,
    run_steamcmd_streaming,
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
    binary = steamcmd_binary or resolve_steamcmd(ctx.config.steamcmd.binary)
    _, out_log, warnings = run_steamcmd_streaming(
        binary,
        ctx.layout.root,
        "validate",
        [AppUpdate(appid=SERVER_APPID, validate=True)],
        spawn=spawn,
        log_file=log_file,
    )
    return ValidateOutcome(appid=SERVER_APPID, log_file=out_log, warnings=warnings)
