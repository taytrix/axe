"""ServerSettings.ini read (configparser, stdlib). Read-only; passwords surface as bool only.

Conan distributes settings across several sections (`[ServerSettings]`,
`[/Script/Engine.GameSession]`, `[RconPlugin]`, …). We walk every section
looking for the few well-known keys we surface and never expose password
values — only the boolean "non-empty value present" signal.
"""

from __future__ import annotations

import configparser
from dataclasses import dataclass

from axe.layout import Layout


@dataclass(frozen=True)
class ServerSettings:
    server_name: str | None
    rcon_enabled: bool
    rcon_port: int | None
    rcon_password_set: bool
    admin_password_set: bool
    server_password_set: bool
    max_players: int | None
    warnings: list[str]


def empty_server_settings(warnings: list[str] | None = None) -> ServerSettings:
    return ServerSettings(
        server_name=None,
        rcon_enabled=False,
        rcon_port=None,
        rcon_password_set=False,
        admin_password_set=False,
        server_password_set=False,
        max_players=None,
        warnings=warnings or [],
    )


def read_server_settings(layout: Layout) -> ServerSettings:
    """Parse ServerSettings.ini if present. ENOENT and parse errors degrade to warnings."""
    path = layout.server_settings_ini
    if not path.exists():
        return empty_server_settings(
            warnings=[f"ServerSettings.ini not found at {path}"],
        )
    parser = configparser.ConfigParser(strict=False, interpolation=None)
    try:
        parser.read(path, encoding="utf-8")
    except (configparser.Error, OSError) as e:
        return empty_server_settings(warnings=[f"ServerSettings.ini parse error: {e}"])

    return ServerSettings(
        server_name=_find(parser, "servername"),
        rcon_enabled=_truthy(_find(parser, "rconenabled")),
        rcon_port=_int_or_none(_find(parser, "rconport")),
        rcon_password_set=_set(_find(parser, "rconpassword")),
        admin_password_set=_set(_find(parser, "adminpassword")),
        server_password_set=_set(_find(parser, "serverpassword")),
        max_players=_int_or_none(_find(parser, "maxplayers")),
        warnings=[],
    )


def _find(parser: configparser.ConfigParser, key: str) -> str | None:
    """First non-empty value across all sections for `key` (case-insensitive)."""
    for section in parser.sections():
        if parser.has_option(section, key):
            value = parser.get(section, key)
            if value != "":
                return value
    return None


def _truthy(value: str | None) -> bool:
    return value is not None and value.strip().lower() in {"true", "1", "yes", "on"}


def _int_or_none(value: str | None) -> int | None:
    if value is None:
        return None
    try:
        return int(value.strip())
    except ValueError:
        return None


def _set(value: str | None) -> bool:
    return value is not None and value.strip() != ""
