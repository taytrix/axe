"""Pydantic `SavedState` for `<root>/.axe/state.json` (one snapshot, atomic write)."""

from __future__ import annotations

import json
from pathlib import Path

from pydantic import BaseModel, Field, ValidationError

from axe.errors import AxeError
from axe.io import atomic_write


class SavedServer(BaseModel):
    model_config = {"extra": "allow"}
    unit: str = ""
    active_state: str
    sub_state: str
    main_pid: int | None = None
    uptime_seconds: int | None = None


class SavedMods(BaseModel):
    model_config = {"extra": "allow"}
    declared: int
    current: int
    stale: int
    missing_local: int
    missing_remote: int


class SavedBuild(BaseModel):
    model_config = {"extra": "allow"}
    installed_buildid: str | None = None
    latest_buildid: str | None = None
    binary_present: bool = False
    drifted: bool = False


class SavedSettings(BaseModel):
    model_config = {"extra": "allow"}
    server_name: str | None = None
    rcon_enabled: bool = False
    rcon_port: int | None = None
    rcon_password_set: bool = False
    admin_password_set: bool = False
    server_password_set: bool = False
    max_players: int | None = None


def empty_saved_build() -> SavedBuild:
    return SavedBuild()


class SavedState(BaseModel):
    model_config = {"extra": "allow"}
    schema_version: int = Field(alias="schema")
    axe_version: str
    checked_at: str  # ISO 8601 UTC
    server: SavedServer
    mods: SavedMods
    build: SavedBuild = SavedBuild()
    settings: SavedSettings = SavedSettings()
    drift: bool
    warnings: list[str] = []


def state_path(root: Path) -> Path:
    return root / ".axe" / "state.json"


def load_state(path: Path) -> SavedState | None:
    try:
        text = path.read_text()
    except FileNotFoundError:
        return None
    except OSError as e:
        raise AxeError("filesystem", f"reading {path}: {e}") from e
    try:
        raw = json.loads(text)
    except ValueError as e:
        raise AxeError("filesystem", f"parsing {path}: {e}") from e
    try:
        return SavedState.model_validate(raw)
    except ValidationError as e:
        raise AxeError("filesystem", f"invalid state at {path}: {e}") from e


def save_state(path: Path, state: SavedState) -> None:
    text = state.model_dump_json(indent=2, by_alias=True) + "\n"
    atomic_write(path, text)
