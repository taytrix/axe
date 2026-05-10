from __future__ import annotations

from dataclasses import dataclass

from axe.context import Context


@dataclass(frozen=True)
class ModsStatus:
    declared: int
    current: int
    stale: int
    missing_local: int
    missing_remote: int


def empty_mods_status() -> ModsStatus:
    return ModsStatus(declared=0, current=0, stale=0, missing_local=0, missing_remote=0)


def read_mods_status(ctx: Context) -> tuple[ModsStatus, list[str]]:
    """PR1 stub. PR2 replaces with real freshness check."""
    return (
        ModsStatus(
            declared=len(ctx.config.mods.ids),
            current=0,
            stale=0,
            missing_local=0,
            missing_remote=0,
        ),
        ["mod freshness check lands in PR2"],
    )
