from __future__ import annotations

import shutil
from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path

from axe.context import Context
from axe.errors import AxeError
from axe.io import atomic_write
from axe.layout import WORKSHOP_APPID, Layout
from axe.mods import run_mods_check
from axe.paths import reserve_steamcmd_log
from axe.steamcmd import (
    SpawnLike,
    SteamcmdAction,
    SteamcmdRequest,
    WorkshopDownloadItem,
    run_steamcmd,
)
from axe.workshop import FetchLike


@dataclass(frozen=True)
class SyncOutcome:
    downloaded: list[int]
    missing: list[int]
    modlist_path: str
    modlist_changed: bool
    log_file: Path | None
    warnings: list[str] = field(default_factory=list)


def sync_modlist(
    ctx: Context,
    *,
    fetch: FetchLike | None = None,
    spawn: SpawnLike | None = None,
    log_file: Path | None = None,
    steamcmd_binary: str | None = None,
) -> SyncOutcome:
    """Reconcile workshop content: download missing/stale; rewrite modlist."""
    declared = list(ctx.config.mods.ids)
    warnings: list[str] = []
    check = run_mods_check(ctx, fetch=fetch)
    warnings.extend(check.warnings)

    to_download = [
        item.id for item in check.report.items if item.state in ("stale", "missing_local")
    ]

    if not to_download:
        ml = _reconcile_modlist(ctx.layout, declared)
        return SyncOutcome(
            downloaded=[],
            missing=ml.missing,
            modlist_path=str(ctx.layout.modlist_txt),
            modlist_changed=ml.changed,
            log_file=None,
            warnings=warnings,
        )

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

    actions: list[SteamcmdAction] = [
        WorkshopDownloadItem(appid=WORKSHOP_APPID, workshop_id=wsid) for wsid in to_download
    ]
    out_log = log_file or reserve_steamcmd_log(ctx.layout.root, "sync")
    outcome = run_steamcmd(
        SteamcmdRequest(
            binary=binary,
            force_install_dir=str(ctx.layout.root),
            actions=actions,
        ),
        spawn=spawn,
        log_file=out_log,
    )
    if outcome.exit != 0:
        tail = " | ".join(outcome.stderr.strip().splitlines()[-3:])
        warnings.append(
            f"steamcmd exited {outcome.exit}"
            + (f"; tail: {tail}" if tail else "")
            + f"; log: {out_log}"
        )

    ml = _reconcile_modlist(ctx.layout, declared)
    still_missing = set(ml.missing)
    downloaded = [wsid for wsid in to_download if wsid not in still_missing]

    return SyncOutcome(
        downloaded=downloaded,
        missing=ml.missing,
        modlist_path=str(ctx.layout.modlist_txt),
        modlist_changed=ml.changed,
        log_file=out_log,
        warnings=warnings,
    )


@dataclass(frozen=True)
class _ModlistResult:
    changed: bool
    missing: list[int]


def _reconcile_modlist(layout: Layout, declared: Sequence[int]) -> _ModlistResult:
    missing: list[int] = []
    lines: list[str] = []
    for wsid in declared:
        paks = _scan_paks(layout.workshop_content, wsid)
        if not paks:
            missing.append(wsid)
        lines.extend(str(p) for p in paks)

    expected = ("\n".join(lines) + "\n") if lines else ""
    current: str | None
    try:
        current = layout.modlist_txt.read_text()
    except FileNotFoundError:
        current = None
    except OSError as e:
        raise AxeError("filesystem", f"reading {layout.modlist_txt}: {e}") from e

    if current == expected:
        return _ModlistResult(changed=False, missing=missing)
    if expected == "" and current is None:
        return _ModlistResult(changed=False, missing=missing)

    layout.mods_dir.mkdir(parents=True, exist_ok=True)
    atomic_write(layout.modlist_txt, expected)
    return _ModlistResult(changed=True, missing=missing)


def _scan_paks(workshop_content: Path, wsid: int) -> list[Path]:
    directory = workshop_content / str(wsid)
    try:
        entries = sorted(directory.iterdir())
    except FileNotFoundError:
        return []
    except NotADirectoryError:
        return []
    except OSError as e:
        raise AxeError("filesystem", f"reading {directory}: {e}") from e
    return [p for p in entries if p.name.lower().endswith(".pak")]
