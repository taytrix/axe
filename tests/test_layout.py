from __future__ import annotations

from pathlib import Path

from axe.layout import SERVER_APPID, WORKSHOP_APPID, layout_at


def test_layout_paths_under_root() -> None:
    root = Path("/srv/conan")
    layout = layout_at(root)
    assert layout.root == root
    assert layout.binary == root / "ConanSandbox/Binaries/Linux/ConanSandboxServer-Linux-Shipping"
    assert layout.server_settings_ini == (
        root / "ConanSandbox/Saved/Config/LinuxServer/ServerSettings.ini"
    )
    assert layout.engine_ini == root / "ConanSandbox/Saved/Config/LinuxServer/Engine.ini"
    assert layout.game_ini == root / "ConanSandbox/Saved/Config/LinuxServer/Game.ini"
    assert layout.modlist_txt == root / "ConanSandbox/Mods/modlist.txt"
    assert layout.workshop_content == root / "steamapps/workshop/content/440900"
    assert layout.workshop_acf == root / "steamapps/workshop/appworkshop_440900.acf"
    assert layout.logs_dir == root / "ConanSandbox/Saved/Logs"
    assert layout.axe_state_dir == root / ".axe"


def test_appids_locked() -> None:
    assert SERVER_APPID == 443030
    assert WORKSHOP_APPID == 440900
