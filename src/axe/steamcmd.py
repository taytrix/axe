"""SteamCMD subprocess wrapper: typed actions, argv builder, streaming + log capture."""

from __future__ import annotations

import shutil
import subprocess
import sys
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

from axe.errors import AxeError
from axe.io import atomic_write

SteamcmdVerb = Literal["install", "update", "verify", "sync", "validate"]


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


@dataclass(frozen=True)
class SteamcmdOutcome:
    exit: int
    stdout: str
    stderr: str


SpawnLike = Callable[[Sequence[str]], "subprocess.CompletedProcess[str]"]


_STEAMCMD_INSTALL_HINT = (
    "steamcmd not found in PATH.\n"
    "  install on cachyos/arch:  paru -S steamcmd\n"
    "  install on debian/ubuntu: sudo apt install steamcmd\n"
    "  other distros:            https://developer.valvesoftware.com/wiki/SteamCMD"
)


def resolve_steamcmd(config_binary: str | None) -> str:
    """Prefer the configured binary; fall back to PATH. Raise AxeError with install hint."""
    binary = config_binary or shutil.which("steamcmd")
    if not binary:
        raise AxeError("config", _STEAMCMD_INSTALL_HINT)
    return binary


def require_steamcmd_on_path() -> str:
    """Same as resolve_steamcmd(None) — used by `axe install` before any toml exists."""
    return resolve_steamcmd(None)


def _default_spawn(argv: Sequence[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(list(argv), capture_output=True, text=True, check=False)


def _streaming_spawn(argv: Sequence[str]) -> subprocess.CompletedProcess[str]:
    """Tee subprocess output to stderr while capturing for return/log.

    stderr is merged into stdout in the pipe to preserve interleaving order —
    steamcmd writes progress and errors freely across both streams. We then
    emit the merged stream to OUR stderr so axe's stdout stays reserved for
    the JSON envelope (or the human renderer).
    """
    proc = subprocess.Popen(
        list(argv),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    captured: list[str] = []
    if proc.stdout is not None:
        for line in proc.stdout:
            sys.stderr.write(line)
            sys.stderr.flush()
            captured.append(line)
    proc.wait()
    return subprocess.CompletedProcess(
        args=list(argv),
        returncode=proc.returncode,
        stdout="".join(captured),
        stderr="",
    )


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
    stream: bool = False,
    timeout: float | None = None,
) -> SteamcmdOutcome:
    """Run steamcmd. `stream=True` tees stdout to the user; `timeout` aborts in seconds."""
    argv = build_argv(req)
    try:
        if spawn is not None:
            completed = spawn(argv)
        elif timeout is not None:
            completed = subprocess.run(
                list(argv),
                capture_output=True,
                text=True,
                check=False,
                timeout=timeout,
            )
        elif stream:
            completed = _streaming_spawn(argv)
        else:
            completed = _default_spawn(argv)
    except (FileNotFoundError, OSError) as e:
        raise AxeError("lifecycle", f"spawn steamcmd: {e}") from e
    except subprocess.TimeoutExpired as e:
        raise AxeError(
            "lifecycle",
            f"steamcmd timed out after {timeout}s (argv: {' '.join(argv)})",
        ) from e

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
