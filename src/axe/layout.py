from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

SERVER_APPID = 443030
WORKSHOP_APPID = 440900


@dataclass(frozen=True)
class Layout:
    root: Path
    binary: Path
    server_settings_ini: Path
    engine_ini: Path
    game_ini: Path
    mods_dir: Path
    modlist_txt: Path
    workshop_content: Path
    workshop_acf: Path
    game_db: Path
    logs_dir: Path
    axe_state_dir: Path


def layout_at(root: str | Path) -> Layout:
    root_path = Path(root)
    sandbox = root_path / "ConanSandbox"
    saved = sandbox / "Saved"
    config_dir = saved / "Config" / "LinuxServer"
    return Layout(
        root=root_path,
        binary=sandbox / "Binaries" / "Linux" / "ConanSandboxServer-Linux-Shipping",
        server_settings_ini=config_dir / "ServerSettings.ini",
        engine_ini=config_dir / "Engine.ini",
        game_ini=config_dir / "Game.ini",
        mods_dir=sandbox / "Mods",
        modlist_txt=sandbox / "Mods" / "modlist.txt",
        workshop_content=root_path / "steamapps" / "workshop" / "content" / str(WORKSHOP_APPID),
        workshop_acf=root_path / "steamapps" / "workshop" / f"appworkshop_{WORKSHOP_APPID}.acf",
        game_db=saved / "game.db",
        logs_dir=saved / "Logs",
        axe_state_dir=root_path / ".axe",
    )
