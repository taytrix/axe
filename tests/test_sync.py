from __future__ import annotations

import json
import subprocess
from collections.abc import Sequence
from pathlib import Path

import httpx
import pytest

from axe.context import Context, load_context
from axe.sync import run_sync

ACF_FIXTURE = Path(__file__).parent / "fixtures" / "sample_workshop.acf"
STUB_BIN = Path(__file__).parent / "fixtures" / "steamcmd_stub.sh"


def _fake_response(payload: dict[str, object]) -> httpx.Response:
    return httpx.Response(
        200,
        content=json.dumps(payload).encode(),
        request=httpx.Request("POST", "https://api.steampowered.com/"),
    )


def _empty_workshop(_url: str, _form: dict[str, str]) -> httpx.Response:
    return _fake_response({"response": {"publishedfiledetails": []}})


def _all_current_workshop(_url: str, _form: dict[str, str]) -> httpx.Response:
    items = [
        {
            "publishedfileid": "3721090132",
            "title": "A",
            "time_updated": 1778205653,
            "visibility": 0,
            "result": 1,
        },
        {
            "publishedfileid": "3721096154",
            "title": "B",
            "time_updated": 1778205824,
            "visibility": 0,
            "result": 1,
        },
        {
            "publishedfileid": "3721177576",
            "title": "C",
            "time_updated": 1778277955,
            "visibility": 0,
            "result": 1,
        },
        {
            "publishedfileid": "3721991191",
            "title": "D",
            "time_updated": 1778267869,
            "visibility": 0,
            "result": 1,
        },
    ]
    return _fake_response({"response": {"publishedfiledetails": items}})


def _real_spawn(argv: Sequence[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(list(argv), capture_output=True, text=True, check=False)


@pytest.fixture
def synced_install_context(synthetic_install: Path) -> Context:
    """Synthetic install with the four-mod ACF in place + axe.toml declaring them."""
    workshop_dir = synthetic_install / "steamapps" / "workshop"
    workshop_dir.mkdir(parents=True)
    (workshop_dir / "appworkshop_440900.acf").write_text(ACF_FIXTURE.read_text())

    declared_ids = [3721090132, 3721096154, 3721177576, 3721991191]
    (synthetic_install / "axe.toml").write_text(
        f"""\
schema = 1

[server]
id = "conan"
root = "{synthetic_install}"

[steamcmd]
binary = "{STUB_BIN}"

[mods]
ids = {declared_ids}
"""
    )
    return load_context(synthetic_install / "axe.toml")


def test_sync_all_current_no_download(synced_install_context: Context) -> None:
    outcome = run_sync(synced_install_context, fetch=_all_current_workshop)
    assert outcome.downloaded == []
    # No .pak files yet; declared ids are all missing locally on disk.
    # (ACF says installed but content directory is empty.) That's still a noop
    # because freshness says all current. modlist should remain empty/unwritten.
    assert outcome.modlist_changed is False


def test_sync_downloads_via_stub(synthetic_install: Path) -> None:
    declared = [3721090132, 3721096154]
    (synthetic_install / "axe.toml").write_text(
        f"""\
schema = 1
[server]
id = "conan"
root = "{synthetic_install}"
[steamcmd]
binary = "{STUB_BIN}"
[mods]
ids = {declared}
"""
    )
    ctx = load_context(synthetic_install / "axe.toml")
    outcome = run_sync(ctx, fetch=_empty_workshop, spawn=_real_spawn)
    assert sorted(outcome.downloaded) == sorted(declared)
    assert outcome.modlist_changed is True
    modlist_text = ctx.layout.modlist_txt.read_text()
    assert "3721090132.pak" in modlist_text
    assert "3721096154.pak" in modlist_text


def test_sync_base_build_drift_triggers_app_update(synthetic_install: Path) -> None:
    """Pre-place an appmanifest with an old buildid; stub's +app_info_print returns 99999."""
    (synthetic_install / "steamapps").mkdir(parents=True, exist_ok=True)
    (synthetic_install / "steamapps" / "appmanifest_443030.acf").write_text(
        '"AppState"\n{\n\t"buildid"\t"100"\n}\n'
    )
    (synthetic_install / "axe.toml").write_text(
        f"""\
schema = 1
[server]
id = "conan"
root = "{synthetic_install}"
[steamcmd]
binary = "{STUB_BIN}"
"""
    )
    ctx = load_context(synthetic_install / "axe.toml")
    outcome = run_sync(ctx, fetch=_empty_workshop, spawn=_real_spawn)
    assert outcome.base_build_updated is True
    # The stub's +app_update creates the ConanSandboxServer binary; verify side effect.
    binary = (
        synthetic_install
        / "ConanSandbox"
        / "Binaries"
        / "Linux"
        / "ConanSandboxServer-Linux-Shipping"
    )
    assert binary.exists()


def test_sync_no_drift_skips_steamcmd(synthetic_install: Path) -> None:
    """Aligned appmanifest + no mods declared -> no steamcmd actions queued."""
    (synthetic_install / "steamapps").mkdir(parents=True, exist_ok=True)
    (synthetic_install / "steamapps" / "appmanifest_443030.acf").write_text(
        '"AppState"\n{\n\t"buildid"\t"99999"\n}\n'
    )
    (synthetic_install / "axe.toml").write_text(
        f"""\
schema = 1
[server]
id = "conan"
root = "{synthetic_install}"
[steamcmd]
binary = "{STUB_BIN}"
"""
    )
    ctx = load_context(synthetic_install / "axe.toml")
    outcome = run_sync(ctx, fetch=_empty_workshop, spawn=_real_spawn)
    assert outcome.base_build_updated is False
    assert outcome.downloaded == []
    assert outcome.log_file is None


def test_sync_idempotent_second_run(synthetic_install: Path) -> None:
    declared = [3721090132]
    (synthetic_install / "axe.toml").write_text(
        f"""\
schema = 1
[server]
id = "conan"
root = "{synthetic_install}"
[steamcmd]
binary = "{STUB_BIN}"
[mods]
ids = {declared}
"""
    )
    ctx = load_context(synthetic_install / "axe.toml")
    run_sync(ctx, fetch=_empty_workshop, spawn=_real_spawn)
    second = run_sync(ctx, fetch=_empty_workshop, spawn=_real_spawn)
    assert second.modlist_changed is False
