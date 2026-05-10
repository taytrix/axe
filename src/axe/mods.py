"""Mod freshness: declared (axe.toml) vs local (ACF) vs remote (Workshop API)."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

from axe.acf import AcfFile, parse_acf
from axe.context import Context
from axe.errors import AxeError
from axe.workshop import FetchLike, WorkshopItem, get_published_file_details

FreshnessState = Literal["current", "stale", "missing_local", "missing_remote", "unmanaged"]


@dataclass(frozen=True)
class ModFreshness:
    id: int
    state: FreshnessState
    title: str | None
    local_manifest: int | None
    latest_manifest: int | None
    local_time_updated: int | None
    latest_time_updated: int | None


@dataclass(frozen=True)
class FreshnessReport:
    total: int
    current: int
    stale: int
    missing_local: int
    missing_remote: int
    unmanaged: int
    items: list[ModFreshness]


@dataclass(frozen=True)
class ModsStatus:
    declared: int
    current: int
    stale: int
    missing_local: int
    missing_remote: int


def empty_mods_status() -> ModsStatus:
    return ModsStatus(declared=0, current=0, stale=0, missing_local=0, missing_remote=0)


def check_mod_freshness(
    declared: Sequence[int],
    local: AcfFile,
    remote: Sequence[WorkshopItem],
) -> FreshnessReport:
    remote_by_id = {item.published_file_id: item for item in remote}
    declared_set = set(declared)
    items: list[ModFreshness] = []
    current = stale = missing_local = missing_remote = unmanaged = 0

    for mod_id in declared:
        local_entry = local.mods.get(mod_id)
        remote_entry = remote_by_id.get(mod_id)

        if local_entry is None:
            items.append(
                ModFreshness(
                    id=mod_id,
                    state="missing_local",
                    title=(remote_entry.title if remote_entry else None),
                    local_manifest=None,
                    latest_manifest=None,
                    local_time_updated=None,
                    latest_time_updated=(remote_entry.time_updated if remote_entry else None),
                )
            )
            missing_local += 1
            continue

        if remote_entry and remote_entry.result != 1:
            items.append(
                ModFreshness(
                    id=mod_id,
                    state="missing_remote",
                    title=remote_entry.title or None,
                    local_manifest=local_entry.manifest,
                    latest_manifest=local_entry.latest_manifest,
                    local_time_updated=local_entry.time_updated,
                    latest_time_updated=local_entry.latest_time_updated,
                )
            )
            missing_remote += 1
            continue

        remote_time = (
            remote_entry.time_updated if remote_entry else local_entry.latest_time_updated
        )
        remote_title = remote_entry.title if remote_entry else None

        is_current = (
            local_entry.time_updated >= remote_time
            and local_entry.manifest == local_entry.latest_manifest
        )
        items.append(
            ModFreshness(
                id=mod_id,
                state="current" if is_current else "stale",
                title=remote_title,
                local_manifest=local_entry.manifest,
                latest_manifest=local_entry.latest_manifest,
                local_time_updated=local_entry.time_updated,
                latest_time_updated=remote_time,
            )
        )
        if is_current:
            current += 1
        else:
            stale += 1

    for mod_id, local_entry in local.mods.items():
        if mod_id in declared_set:
            continue
        items.append(
            ModFreshness(
                id=mod_id,
                state="unmanaged",
                title=None,
                local_manifest=local_entry.manifest,
                latest_manifest=local_entry.latest_manifest,
                local_time_updated=local_entry.time_updated,
                latest_time_updated=local_entry.latest_time_updated,
            )
        )
        unmanaged += 1

    return FreshnessReport(
        total=len(declared),
        current=current,
        stale=stale,
        missing_local=missing_local,
        missing_remote=missing_remote,
        unmanaged=unmanaged,
        items=items,
    )


def has_drift(report: FreshnessReport) -> bool:
    return report.stale > 0 or report.missing_local > 0 or report.missing_remote > 0


@dataclass(frozen=True)
class RunModsCheckResult:
    report: FreshnessReport
    warnings: list[str]


def run_mods_check(
    ctx: Context,
    *,
    fetch: FetchLike | None = None,
) -> RunModsCheckResult:
    local = _read_acf(ctx.layout.workshop_acf)
    declared = list(ctx.config.mods.ids)
    warnings: list[str] = []
    remote: list[WorkshopItem] = []
    if declared:
        try:
            remote = get_published_file_details(declared, fetch=fetch)
        except AxeError as e:
            if e.kind == "workshop_api":
                warnings.append(
                    f"workshop API unreachable: {e.message}; using ACF latest_* only"
                )
            else:
                raise
    report = check_mod_freshness(declared, local, remote)
    return RunModsCheckResult(report=report, warnings=warnings)


def read_mods_status(ctx: Context) -> tuple[ModsStatus, list[str]]:
    """Compose ModsStatus + warnings from the freshness report."""
    result = run_mods_check(ctx)
    r = result.report
    return (
        ModsStatus(
            declared=r.total,
            current=r.current,
            stale=r.stale,
            missing_local=r.missing_local,
            missing_remote=r.missing_remote,
        ),
        result.warnings,
    )


def _read_acf(path) -> AcfFile:  # noqa: ANN001 — Path
    try:
        text = path.read_text()
    except FileNotFoundError:
        return AcfFile(mods={})
    except OSError as e:
        raise AxeError("filesystem", f"reading {path}: {e}") from e
    return parse_acf(text)
