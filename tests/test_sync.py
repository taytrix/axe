from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from axe.context import Context, load_context
from axe.sync import sync_modlist

ACF_FIXTURE = Path(__file__).parent / "fixtures" / "sample_workshop.acf"
STUB_BIN = Path(__file__).parent / "fixtures" / "steamcmd_stub.sh"


@pytest.fixture
def synced_install_context(synthetic_install: Path) -> Context:
    """Synthetic install with the four-mod ACF in place + axe.toml declaring them."""
    workshop_dir = synthetic_install / "steamapps" / "workshop"
    workshop_dir.mkdir(parents=True)
    (workshop_dir / "appworkshop_440900.acf").write_text(ACF_FIXTURE.read_text())

    declared_ids = [3721090132, 3721096154, 3721177576, 3721991191]
    toml = f"""\
schema = 1

[server]
id = "conan"
root = "{synthetic_install}"

[steamcmd]
binary = "{STUB_BIN}"

[mods]
ids = {declared_ids}
"""
    (synthetic_install / "axe.toml").write_text(toml)
    return load_context(synthetic_install / "axe.toml")


def _fake_workshop_all_current(_url: str, _form: dict[str, str]):
    import httpx

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
    import json

    payload = {"response": {"publishedfiledetails": items}}
    return httpx.Response(
        200,
        content=json.dumps(payload).encode(),
        request=httpx.Request("POST", "https://api.steampowered.com/"),
    )


def test_sync_all_current_no_download(synced_install_context: Context) -> None:
    outcome = sync_modlist(synced_install_context, fetch=_fake_workshop_all_current)
    assert outcome.downloaded == []
    # No .pak files yet; declared ids are all missing locally on disk.
    # (ACF says installed but content directory is empty.) That's still a noop
    # because freshness says all current. modlist should remain empty/unwritten.
    assert outcome.modlist_changed is False


def test_sync_downloads_via_stub(synthetic_install: Path) -> None:
    # Empty ACF -> all four declared ids are missing_local -> download
    declared = [3721090132, 3721096154]
    toml = f"""\
schema = 1

[server]
id = "conan"
root = "{synthetic_install}"

[steamcmd]
binary = "{STUB_BIN}"

[mods]
ids = {declared}
"""
    (synthetic_install / "axe.toml").write_text(toml)
    ctx = load_context(synthetic_install / "axe.toml")

    def fake_workshop_empty(_url: str, _form: dict[str, str]):
        import json

        import httpx

        payload = {"response": {"publishedfiledetails": []}}
        return httpx.Response(
            200,
            content=json.dumps(payload).encode(),
            request=httpx.Request("POST", "https://api.steampowered.com/"),
        )

    def real_spawn(argv):
        return subprocess.run(list(argv), capture_output=True, text=True, check=False)

    outcome = sync_modlist(ctx, fetch=fake_workshop_empty, spawn=real_spawn)
    assert sorted(outcome.downloaded) == sorted(declared)
    assert outcome.modlist_changed is True
    modlist_text = ctx.layout.modlist_txt.read_text()
    assert "3721090132.pak" in modlist_text
    assert "3721096154.pak" in modlist_text


def test_sync_idempotent_second_run(synthetic_install: Path) -> None:
    declared = [3721090132]
    toml = f"""\
schema = 1

[server]
id = "conan"
root = "{synthetic_install}"

[steamcmd]
binary = "{STUB_BIN}"

[mods]
ids = {declared}
"""
    (synthetic_install / "axe.toml").write_text(toml)
    ctx = load_context(synthetic_install / "axe.toml")

    def fake_workshop_empty(_url: str, _form: dict[str, str]):
        import json

        import httpx

        payload = {"response": {"publishedfiledetails": []}}
        return httpx.Response(
            200,
            content=json.dumps(payload).encode(),
            request=httpx.Request("POST", "https://api.steampowered.com/"),
        )

    def real_spawn(argv):
        return subprocess.run(list(argv), capture_output=True, text=True, check=False)

    sync_modlist(ctx, fetch=fake_workshop_empty, spawn=real_spawn)
    # Second run: pak files now exist, but ACF still empty so they're still
    # missing_local from freshness perspective. Stub re-runs, modlist matches.
    second = sync_modlist(ctx, fetch=fake_workshop_empty, spawn=real_spawn)
    assert second.modlist_changed is False
