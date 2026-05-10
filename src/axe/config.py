from __future__ import annotations

import tomllib
from pathlib import Path
from typing import Any

import tomli_w
from pydantic import BaseModel, Field, ValidationError

from axe.errors import AxeError


class ServerConfig(BaseModel):
    model_config = {"extra": "forbid"}
    id: str = Field(min_length=1)
    root: str = Field(min_length=1)
    unit: str | None = None


class SteamcmdConfig(BaseModel):
    model_config = {"extra": "forbid"}
    binary: str | None = None


class ModsConfig(BaseModel):
    model_config = {"extra": "forbid"}
    ids: list[int] = Field(default_factory=list)


class HooksConfig(BaseModel):
    model_config = {"extra": "forbid"}
    on_drift: str = ""
    before_sync: str = ""
    after_sync: str = ""


class Config(BaseModel):
    model_config = {"extra": "forbid"}
    schema_version: int = Field(alias="schema")
    server: ServerConfig
    steamcmd: SteamcmdConfig = SteamcmdConfig()
    mods: ModsConfig = ModsConfig()
    hooks: HooksConfig = HooksConfig()

    def effective_unit(self) -> str:
        return self.server.unit or f"axe-{self.server.id}.service"


def parse_config(text: str) -> Config:
    try:
        data = tomllib.loads(text)
    except tomllib.TOMLDecodeError as e:
        raise AxeError("config", f"failed to parse axe.toml: {e}") from e
    try:
        return Config.model_validate(data)
    except ValidationError as e:
        raise AxeError("config", f"invalid axe.toml: {e}") from e


def load_config(path: Path) -> Config:
    try:
        text = path.read_text()
    except FileNotFoundError as e:
        raise AxeError("config", f"axe.toml not found at {path}") from e
    except OSError as e:
        raise AxeError("config", f"failed to read {path}: {e}") from e
    return parse_config(text)


def serialize_config(config: Config) -> str:
    data: dict[str, Any] = {
        "schema": config.schema_version,
        "server": config.server.model_dump(exclude_none=True),
        "mods": {"ids": list(config.mods.ids)},
        "hooks": {
            "on_drift": config.hooks.on_drift,
            "before_sync": config.hooks.before_sync,
            "after_sync": config.hooks.after_sync,
        },
    }
    if config.steamcmd.binary is not None:
        data["steamcmd"] = {"binary": config.steamcmd.binary}
    return tomli_w.dumps(data)


def save_config(config: Config, path: Path) -> None:
    text = serialize_config(config)
    try:
        path.write_text(text)
    except OSError as e:
        raise AxeError("filesystem", f"failed to write {path}: {e}") from e
