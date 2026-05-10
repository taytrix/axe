"""Drift reconciliation: mods + base build in one SteamCMD batch + hook lifecycle."""

from __future__ import annotations

import shutil
from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path

from axe.build import BuildStatus, read_build_status
from axe.context import Context
from axe.errors import AxeError
from axe.hooks import HookRunner, run_hook
from axe.io import atomic_write
from axe.layout import SERVER_APPID, WORKSHOP_APPID, Layout
from axe.mods import FreshnessReport, run_mods_check
from axe.steamcmd import (
    AppUpdate,
    SpawnLike,
    SteamcmdAction,
    SteamcmdRequest,
    WorkshopDownloadItem,
    reserve_steamcmd_log,
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
    base_build_updated: bool = False
    warnings: list[str] = field(default_factory=list)


def run_sync(
    ctx: Context,
    *,
    fetch: FetchLike | None = None,
    spawn: SpawnLike | None = None,
    hook_runner: HookRunner | None = None,
    log_file: Path | None = None,
    steamcmd_binary: str | None = None,
) -> SyncOutcome:
    """Reconcile any drift: mods + base build. Single steamcmd invocation when work needed."""
    declared = list(ctx.config.mods.ids)
    warnings: list[str] = []

    mods_result = run_mods_check(ctx, fetch=fetch)
    warnings.extend(mods_result.warnings)
    build = read_build_status(ctx, spawn=spawn)
    warnings.extend(build.warnings)

    # before_sync hook (strict-capable; raises AxeError('hook') on strict failure)
    pre_warn = run_hook(
        ctx.config.hooks.before_sync,
        _sync_env(ctx, mods_result.report, build, "before_sync"),
        runner=hook_runner,
        strict=ctx.config.hooks.strict.before_sync,
    )
    if pre_warn:
        warnings.append(pre_warn)

    to_download = [
        item.id
        for item in mods_result.report.items
        if item.state in ("stale", "missing_local")
    ]

    actions: list[SteamcmdAction] = []
    if build.drifted:
        actions.append(AppUpdate(appid=SERVER_APPID, validate=False))
    actions.extend(WorkshopDownloadItem(appid=WORKSHOP_APPID, workshop_id=w) for w in to_download)

    if not actions:
        ml = _reconcile_modlist(ctx.layout, declared)
        outcome = SyncOutcome(
            downloaded=[],
            missing=ml.missing,
            modlist_path=str(ctx.layout.modlist_txt),
            modlist_changed=ml.changed,
            log_file=None,
            base_build_updated=False,
            warnings=warnings,
        )
        _fire_after_sync(ctx, mods_result.report, build, outcome, hook_runner, warnings)
        return outcome

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

    out_log = log_file or reserve_steamcmd_log(ctx.layout.root, "sync")
    outcome_steamcmd = run_steamcmd(
        SteamcmdRequest(
            binary=binary,
            force_install_dir=str(ctx.layout.root),
            actions=actions,
        ),
        spawn=spawn,
        log_file=out_log,
    )
    if outcome_steamcmd.exit != 0:
        tail = " | ".join(outcome_steamcmd.stderr.strip().splitlines()[-3:])
        warnings.append(
            f"steamcmd exited {outcome_steamcmd.exit}"
            + (f"; tail: {tail}" if tail else "")
            + f"; log: {out_log}"
        )

    ml = _reconcile_modlist(ctx.layout, declared)
    still_missing = set(ml.missing)
    downloaded = [w for w in to_download if w not in still_missing]

    outcome = SyncOutcome(
        downloaded=downloaded,
        missing=ml.missing,
        modlist_path=str(ctx.layout.modlist_txt),
        modlist_changed=ml.changed,
        log_file=out_log,
        base_build_updated=build.drifted and outcome_steamcmd.exit == 0,
        warnings=warnings,
    )
    _fire_after_sync(ctx, mods_result.report, build, outcome, hook_runner, warnings)
    return outcome


def _fire_after_sync(
    ctx: Context,
    report: FreshnessReport,
    build: BuildStatus,
    outcome: SyncOutcome,
    runner: HookRunner | None,
    warnings: list[str],
) -> None:
    warn = run_hook(
        ctx.config.hooks.after_sync,
        _sync_env(ctx, report, build, "after_sync", outcome=outcome),
        runner=runner,
        strict=False,
    )
    if warn:
        warnings.append(warn)


def _sync_env(
    ctx: Context,
    report: FreshnessReport,
    build: BuildStatus,
    event: str,
    *,
    outcome: SyncOutcome | None = None,
) -> dict[str, str]:
    env: dict[str, str] = {
        "AXE_ROOT": str(ctx.layout.root),
        "AXE_STATE": str(ctx.layout.root / ".axe" / "state.json"),
        "AXE_EVENT": event,
        "AXE_MODS_STALE": str(report.stale),
        "AXE_MODS_MISSING_LOCAL": str(report.missing_local),
        "AXE_MODS_MISSING_REMOTE": str(report.missing_remote),
        "AXE_BUILD_DRIFTED": "1" if build.drifted else "0",
        "AXE_BUILD_INSTALLED": build.installed_buildid or "",
        "AXE_BUILD_LATEST": build.latest_buildid or "",
    }
    if outcome is not None:
        env["AXE_SYNC_DOWNLOADED"] = str(len(outcome.downloaded))
        env["AXE_SYNC_MISSING"] = str(len(outcome.missing))
        env["AXE_SYNC_MODLIST_CHANGED"] = "1" if outcome.modlist_changed else "0"
    return env


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


# Backward-compat alias: 0.1 callers used `sync_modlist`.
sync_modlist = run_sync
