from __future__ import annotations

from pathlib import Path

from axe.layout import layout_at
from axe.settings import read_server_settings


def _write_ini(root: Path, body: str) -> Path:
    ini_path = root / "ConanSandbox" / "Saved" / "Config" / "LinuxServer" / "ServerSettings.ini"
    ini_path.parent.mkdir(parents=True, exist_ok=True)
    ini_path.write_text(body)
    return ini_path


def test_missing_ini_warns(synthetic_install: Path) -> None:
    s = read_server_settings(layout_at(synthetic_install))
    assert s.server_name is None
    assert s.rcon_port is None
    assert s.rcon_enabled is False
    assert any("ServerSettings.ini not found" in w for w in s.warnings)


def test_reads_server_name_and_rcon(synthetic_install: Path) -> None:
    _write_ini(
        synthetic_install,
        """\
[ServerSettings]
ServerName=My Conan Server
AdminPassword=admin-secret
ServerPassword=

[/Script/Engine.GameSession]
MaxPlayers=40

[RconPlugin]
RconEnabled=True
RconPort=25575
RconPassword=rcon-secret
""",
    )
    s = read_server_settings(layout_at(synthetic_install))
    assert s.server_name == "My Conan Server"
    assert s.rcon_enabled is True
    assert s.rcon_port == 25575
    assert s.max_players == 40
    assert s.warnings == []


def test_passwords_are_presence_bool_only(synthetic_install: Path) -> None:
    _write_ini(
        synthetic_install,
        """\
[ServerSettings]
AdminPassword=admin-secret
ServerPassword=

[RconPlugin]
RconPassword=rcon-secret
""",
    )
    s = read_server_settings(layout_at(synthetic_install))
    assert s.admin_password_set is True
    assert s.server_password_set is False
    assert s.rcon_password_set is True


def test_rcon_falsy_variants(synthetic_install: Path) -> None:
    _write_ini(synthetic_install, "[RconPlugin]\nRconEnabled=False\nRconPort=25575\n")
    s = read_server_settings(layout_at(synthetic_install))
    assert s.rcon_enabled is False
    assert s.rcon_port == 25575


def test_int_field_parse_failure_yields_none(synthetic_install: Path) -> None:
    _write_ini(synthetic_install, "[RconPlugin]\nRconPort=not-a-number\n")
    s = read_server_settings(layout_at(synthetic_install))
    assert s.rcon_port is None


def test_tolerates_duplicate_keys(synthetic_install: Path) -> None:
    """UE +Key=Value accumulation is harmless under strict=False."""
    _write_ini(
        synthetic_install,
        """\
[ServerSettings]
+ActiveMods=12345
+ActiveMods=67890
ServerName=Survivor's Edge
""",
    )
    s = read_server_settings(layout_at(synthetic_install))
    assert s.server_name == "Survivor's Edge"


def test_case_insensitive_keys(synthetic_install: Path) -> None:
    _write_ini(synthetic_install, "[ServerSettings]\nservername=lowercase wins\n")
    s = read_server_settings(layout_at(synthetic_install))
    assert s.server_name == "lowercase wins"
