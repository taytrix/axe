from __future__ import annotations

import pytest

from axe.config import Config, parse_config, serialize_config
from axe.errors import AxeError

VALID_TOML = """\
schema = 1

[server]
id = "conan"
root = "/home/tay/conan"

[mods]
ids = [880454836, 3915417666713453363]
"""


def _build_config(
    *, id: str = "conan", root: str = "/srv/conan", unit: str | None = None
) -> Config:
    server: dict[str, object] = {"id": id, "root": root}
    if unit is not None:
        server["unit"] = unit
    return Config.model_validate({"schema": 1, "server": server})


def test_parse_minimal_valid() -> None:
    config = parse_config(VALID_TOML)
    assert config.schema_version == 1
    assert config.server.id == "conan"
    assert config.server.root == "/home/tay/conan"
    assert config.mods.ids == [880454836, 3915417666713453363]
    assert config.steamcmd.binary is None


def test_parse_rejects_unknown_field() -> None:
    bad = VALID_TOML + "\n[server]\nfrobnicate = \"nope\"\n"
    with pytest.raises(AxeError) as exc_info:
        parse_config(bad)
    assert exc_info.value.kind == "config"


def test_effective_unit_defaults_to_id() -> None:
    config = _build_config()
    assert config.effective_unit() == "axe-conan.service"


def test_effective_unit_honors_override() -> None:
    config = _build_config(unit="custom.service")
    assert config.effective_unit() == "custom.service"


def test_serialize_round_trip() -> None:
    config = parse_config(VALID_TOML)
    serialized = serialize_config(config)
    reparsed = parse_config(serialized)
    assert reparsed.schema_version == 1
    assert reparsed.server.id == "conan"
    assert reparsed.mods.ids == [880454836, 3915417666713453363]


def test_serialize_omits_unset_steamcmd_binary() -> None:
    config = _build_config()
    serialized = serialize_config(config)
    assert "[steamcmd]" not in serialized
    assert "schema = 1" in serialized
