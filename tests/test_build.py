from __future__ import annotations

import subprocess
from collections.abc import Sequence
from pathlib import Path

from axe.build import BuildStatus, parse_app_info_buildid, read_build_status
from axe.context import load_context

APPMANIFEST = """\
"AppState"
{
\t"appid"\t\t"443030"
\t"name"\t\t"Conan Exiles - Dedicated Server"
\t"buildid"\t\t"17234956"
\t"installdir"\t\t"ConanSandbox"
}
"""

APP_INFO_OUTPUT = """\
Steam Console Client (c) Valve Corporation - version 1700000000
-- type 'quit' to exit --
Logging in user 'anonymous' to Steam Public...
Waiting for client config...OK
Waiting for user info...OK
"443030"
{
\t"common"
\t{
\t\t"name"\t\t"Conan Exiles Dedicated Server"
\t\t"type"\t\t"Tool"
\t}
\t"depots"
\t{
\t\t"branches"
\t\t{
\t\t\t"public"
\t\t\t{
\t\t\t\t"buildid"\t\t"17234957"
\t\t\t\t"timeupdated"\t\t"1778100000"
\t\t\t}
\t\t}
\t}
}
"""


def _stub_spawn_app_info(_argv: Sequence[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.CompletedProcess(
        args=list(_argv),
        returncode=0,
        stdout=APP_INFO_OUTPUT,
        stderr="",
    )


def _stub_spawn_missing(_argv: Sequence[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.CompletedProcess(args=list(_argv), returncode=1, stdout="", stderr="error")


def test_parse_app_info_buildid_extracts_public_branch() -> None:
    assert parse_app_info_buildid(APP_INFO_OUTPUT, 443030) == "17234957"


def test_parse_app_info_buildid_missing_marker_returns_none() -> None:
    assert parse_app_info_buildid("nothing relevant here", 443030) is None


def _install_with_manifest(synthetic_install: Path) -> Path:
    (synthetic_install / "steamapps").mkdir(parents=True, exist_ok=True)
    (synthetic_install / "steamapps" / "appmanifest_443030.acf").write_text(APPMANIFEST)
    (synthetic_install / "axe.toml").write_text(
        f"""\
schema = 1

[server]
id = "conan"
root = "{synthetic_install}"

[steamcmd]
binary = "/usr/bin/steamcmd"
"""
    )
    return synthetic_install


def test_read_build_status_drift_when_mismatched(synthetic_install: Path) -> None:
    root = _install_with_manifest(synthetic_install)
    ctx = load_context(root / "axe.toml")
    status = read_build_status(ctx, spawn=_stub_spawn_app_info)
    assert status.installed_buildid == "17234956"
    assert status.latest_buildid == "17234957"
    assert status.drifted is True


def test_read_build_status_aligned_when_equal(synthetic_install: Path) -> None:
    root = synthetic_install
    (root / "steamapps").mkdir(parents=True, exist_ok=True)
    (root / "steamapps" / "appmanifest_443030.acf").write_text(
        APPMANIFEST.replace("17234956", "17234957")
    )
    (root / "axe.toml").write_text(
        f"""\
schema = 1

[server]
id = "conan"
root = "{root}"

[steamcmd]
binary = "/usr/bin/steamcmd"
"""
    )
    ctx = load_context(root / "axe.toml")
    status = read_build_status(ctx, spawn=_stub_spawn_app_info)
    assert status.installed_buildid == status.latest_buildid == "17234957"
    assert status.drifted is False


def test_read_build_status_steamcmd_failure(synthetic_install: Path) -> None:
    root = _install_with_manifest(synthetic_install)
    ctx = load_context(root / "axe.toml")
    status = read_build_status(ctx, spawn=_stub_spawn_missing)
    assert status.installed_buildid == "17234956"
    assert status.latest_buildid is None
    assert status.drifted is False
    assert any("steamcmd exited" in w for w in status.warnings)


def test_empty_build_status() -> None:
    s = BuildStatus(
        installed_buildid=None,
        latest_buildid=None,
        binary_present=False,
        drifted=False,
        warnings=[],
    )
    assert s.drifted is False


def test_binary_missing_is_drift(tmp_path: Path) -> None:
    """A path with no Conan binary reads as drifted (cold-start triggers sync's app_update)."""
    root = tmp_path / "empty"
    root.mkdir()
    (root / "axe.toml").write_text(
        f"""\
schema = 1

[server]
id = "conan"
root = "{root}"
"""
    )
    ctx = load_context(root / "axe.toml")
    status = read_build_status(ctx, spawn=_stub_spawn_missing)
    assert status.binary_present is False
    assert status.drifted is True


def test_binary_present_is_not_drift_when_buildids_align(synthetic_install: Path) -> None:
    root = synthetic_install
    (root / "steamapps").mkdir(parents=True, exist_ok=True)
    (root / "steamapps" / "appmanifest_443030.acf").write_text(
        APPMANIFEST.replace("17234956", "17234957")
    )
    (root / "axe.toml").write_text(
        f"""\
schema = 1

[server]
id = "conan"
root = "{root}"

[steamcmd]
binary = "/usr/bin/steamcmd"
"""
    )
    ctx = load_context(root / "axe.toml")
    status = read_build_status(ctx, spawn=_stub_spawn_app_info)
    assert status.binary_present is True
    assert status.drifted is False
