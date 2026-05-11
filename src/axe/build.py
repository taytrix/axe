"""Server base build status: installed vs latest from steamcmd, drift detection."""

from __future__ import annotations

import shutil
from dataclasses import dataclass

from axe.context import Context
from axe.errors import AxeError
from axe.layout import SERVER_APPID
from axe.steamcmd import (
    AppInfoPrint,
    SpawnLike,
    SteamcmdRequest,
    run_steamcmd,
)
from axe.vdf import parse_vdf


@dataclass(frozen=True)
class BuildStatus:
    installed_buildid: str | None
    latest_buildid: str | None
    binary_present: bool
    drifted: bool
    warnings: list[str]


def empty_build_status() -> BuildStatus:
    return BuildStatus(
        installed_buildid=None,
        latest_buildid=None,
        binary_present=False,
        drifted=False,
        warnings=[],
    )


def read_build_status(ctx: Context, *, spawn: SpawnLike | None = None) -> BuildStatus:
    warnings: list[str] = []
    binary_present = ctx.layout.binary.exists()
    installed = _read_installed_buildid(ctx, warnings)
    latest = _read_latest_buildid(ctx, warnings, spawn=spawn)
    drifted = (not binary_present) or (
        installed is not None and latest is not None and installed != latest
    )
    return BuildStatus(
        installed_buildid=installed,
        latest_buildid=latest,
        binary_present=binary_present,
        drifted=drifted,
        warnings=warnings,
    )


def _read_installed_buildid(ctx: Context, warnings: list[str]) -> str | None:
    manifest = ctx.layout.root / "steamapps" / f"appmanifest_{SERVER_APPID}.acf"
    try:
        text = manifest.read_text()
    except FileNotFoundError:
        return None
    except OSError as e:
        warnings.append(f"reading {manifest}: {e}")
        return None
    try:
        tree = parse_vdf(text)
    except AxeError as e:
        warnings.append(f"parsing {manifest}: {e.message}")
        return None
    buildid = tree.get("buildid")
    return buildid if isinstance(buildid, str) else None


def _read_latest_buildid(
    ctx: Context,
    warnings: list[str],
    *,
    spawn: SpawnLike | None,
) -> str | None:
    binary = ctx.config.steamcmd.binary or shutil.which("steamcmd")
    if not binary:
        warnings.append("steamcmd binary not found; latest build unknown")
        return None
    req = SteamcmdRequest(
        binary=binary,
        force_install_dir=str(ctx.layout.root),
        actions=[AppInfoPrint(appid=SERVER_APPID)],
    )
    try:
        outcome = run_steamcmd(req, spawn=spawn, timeout=60)
    except AxeError as e:
        warnings.append(f"steamcmd app_info_print: {e.message}")
        return None
    if outcome.exit != 0:
        warnings.append(f"steamcmd exited {outcome.exit}; latest build unknown")
        return None
    return parse_app_info_buildid(outcome.stdout, SERVER_APPID)


def parse_app_info_buildid(text: str, appid: int) -> str | None:
    """Strip steamcmd preamble; find depots.branches.public.buildid in the VDF block."""
    marker = f'"{appid}"'
    start = text.find(marker)
    if start < 0:
        return None
    try:
        tree = parse_vdf(text[start:])
    except AxeError:
        return None
    depots = tree.get("depots")
    if not isinstance(depots, dict):
        return None
    branches = depots.get("branches")
    if not isinstance(branches, dict):
        return None
    public = branches.get("public")
    if not isinstance(public, dict):
        return None
    buildid = public.get("buildid")
    return buildid if isinstance(buildid, str) else None
