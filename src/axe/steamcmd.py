"""SteamCMD subprocess wrapper: typed actions, argv builder, log capture."""

from __future__ import annotations

import subprocess
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

from axe.errors import AxeError
from axe.io import atomic_write

SteamcmdVerb = Literal["install", "update", "verify", "sync"]


@dataclass(frozen=True)
class AppUpdate:
    appid: int
    validate: bool = False


@dataclass(frozen=True)
class WorkshopDownloadItem:
    appid: int
    workshop_id: int


@dataclass(frozen=True)
class AppInfoPrint:
    appid: int


@dataclass(frozen=True)
class AppInfoUpdate:
    pass


SteamcmdAction = AppUpdate | WorkshopDownloadItem | AppInfoPrint | AppInfoUpdate


@dataclass(frozen=True)
class SteamcmdRequest:
    binary: str
    force_install_dir: str
    actions: Sequence[SteamcmdAction]
    # v0.1 only supports anonymous login; user/password lands when an action earns it.


@dataclass(frozen=True)
class SteamcmdOutcome:
    exit: int
    stdout: str
    stderr: str


SpawnLike = Callable[[Sequence[str]], "subprocess.CompletedProcess[str]"]


def _default_spawn(argv: Sequence[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(list(argv), capture_output=True, text=True, check=False)


def build_argv(req: SteamcmdRequest) -> list[str]:
    """Build steamcmd argv. `+force_install_dir` precedes `+login`; `+quit` is last."""
    argv: list[str] = [
        req.binary,
        "+force_install_dir",
        req.force_install_dir,
        "+login",
        "anonymous",
    ]
    for action in req.actions:
        if isinstance(action, AppUpdate):
            argv += ["+app_update", str(action.appid)]
            if action.validate:
                argv.append("validate")
        elif isinstance(action, WorkshopDownloadItem):
            argv += [
                "+workshop_download_item",
                str(action.appid),
                str(action.workshop_id),
            ]
        elif isinstance(action, AppInfoPrint):
            argv += ["+app_info_print", str(action.appid)]
        elif isinstance(action, AppInfoUpdate):
            argv += ["+app_info_update", "1"]
    argv.append("+quit")
    return argv


def run_steamcmd(
    req: SteamcmdRequest,
    *,
    spawn: SpawnLike | None = None,
    log_file: Path | None = None,
) -> SteamcmdOutcome:
    """Run steamcmd. Throws AxeError(lifecycle) on spawn failure, NOT on non-zero exit."""
    argv = build_argv(req)
    impl = spawn or _default_spawn
    try:
        completed = impl(argv)
    except (FileNotFoundError, OSError) as e:
        raise AxeError("lifecycle", f"spawn steamcmd: {e}") from e

    outcome = SteamcmdOutcome(
        exit=completed.returncode,
        stdout=completed.stdout or "",
        stderr=completed.stderr or "",
    )

    if log_file is not None:
        atomic_write(log_file, _format_log(argv, outcome))

    return outcome


def reserve_steamcmd_log(root: Path, verb: SteamcmdVerb) -> Path:
    """Ensure `<root>/.axe/` exists and return a fresh timestamped log path for `verb`."""
    state_dir = root / ".axe"
    state_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y-%m-%dT%H-%M-%S-%fZ")
    return state_dir / f"steamcmd-{verb}-{stamp}.log"


def _format_log(argv: Sequence[str], outcome: SteamcmdOutcome) -> str:
    return (
        f"# argv: {' '.join(argv)}\n"
        f"# exit: {outcome.exit}\n"
        f"# stdout\n{outcome.stdout}\n"
        f"# stderr\n{outcome.stderr}\n"
    )
