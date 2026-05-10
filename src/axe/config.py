"""Pydantic `Config` + `axe.toml` parse/load/serialize/save."""

from __future__ import annotations

import tomllib
from pathlib import Path

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


class HooksStrictConfig(BaseModel):
    model_config = {"extra": "forbid"}
    before_sync: bool = False
    before_restart: bool = False


class HooksConfig(BaseModel):
    model_config = {"extra": "forbid"}
    on_drift: str = ""
    before_sync: str = ""
    after_sync: str = ""
    before_restart: str = ""
    after_restart: str = ""
    strict: HooksStrictConfig = HooksStrictConfig()


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
    data = config.model_dump(by_alias=True, exclude_none=True)
    # exclude_none strips inner fields but leaves the empty [steamcmd] table behind.
    if data.get("steamcmd") == {}:
        del data["steamcmd"]
    return tomli_w.dumps(data)


def save_config(config: Config, path: Path) -> None:
    text = serialize_config(config)
    try:
        path.write_text(text)
    except OSError as e:
        raise AxeError("filesystem", f"failed to write {path}: {e}") from e
