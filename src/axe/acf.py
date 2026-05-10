from __future__ import annotations

import re
from dataclasses import dataclass

from axe.vdf import VdfObject, parse_vdf

WorkshopId = int
ManifestId = int

_NUMERIC_ID = re.compile(r"^\d+$")


@dataclass(frozen=True)
class ModManifest:
    workshop_id: WorkshopId
    manifest: ManifestId
    time_updated: int
    latest_manifest: ManifestId
    latest_time_updated: int


@dataclass(frozen=True)
class AcfFile:
    mods: dict[WorkshopId, ModManifest]


def parse_acf(text: str) -> AcfFile:
    tree = parse_vdf(text)
    mods: dict[WorkshopId, ModManifest] = {}
    installed = _collect_section(tree, "WorkshopItemsInstalled")
    details = _collect_section(tree, "WorkshopItemDetails")

    for id_str, fields in installed.items():
        if not _NUMERIC_ID.match(id_str):
            continue
        workshop_id = int(id_str)
        manifest = _parse_int(fields.get("manifest"))
        time_updated = _parse_int(fields.get("timeupdated"))
        detail_fields = details.get(id_str, {})
        latest_manifest = _parse_int(detail_fields.get("latest_manifest"), fallback=manifest)
        latest_time_updated = _parse_int(
            detail_fields.get("latest_timeupdated"), fallback=time_updated
        )
        mods[workshop_id] = ModManifest(
            workshop_id=workshop_id,
            manifest=manifest,
            time_updated=time_updated,
            latest_manifest=latest_manifest,
            latest_time_updated=latest_time_updated,
        )
    return AcfFile(mods=mods)


def _collect_section(tree: VdfObject, name: str) -> dict[str, dict[str, str]]:
    out: dict[str, dict[str, str]] = {}
    section = tree.get(name)
    if not isinstance(section, dict):
        return out
    for key, value in section.items():
        if not isinstance(value, dict):
            continue
        fields: dict[str, str] = {}
        for fk, fv in value.items():
            if isinstance(fv, str):
                fields[fk] = fv
        out[key] = fields
    return out


def _parse_int(s: str | None, fallback: int = 0) -> int:
    if s is None or s == "":
        return fallback
    try:
        n = int(s)
    except ValueError:
        return fallback
    if n == 0 and fallback != 0:
        return fallback
    return n


