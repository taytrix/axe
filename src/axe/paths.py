from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

SteamcmdVerb = Literal["install", "update", "verify", "sync"]


def axe_state_dir(root: Path) -> Path:
    return root / ".axe"


def steamcmd_log_path(root: Path, verb: SteamcmdVerb, when: datetime | None = None) -> Path:
    when = when or datetime.now(UTC)
    stamp = when.strftime("%Y-%m-%dT%H-%M-%S-%fZ")
    return axe_state_dir(root) / f"steamcmd-{verb}-{stamp}.log"


def reserve_steamcmd_log(root: Path, verb: SteamcmdVerb) -> Path:
    state_dir = axe_state_dir(root)
    state_dir.mkdir(parents=True, exist_ok=True)
    return steamcmd_log_path(root, verb)
