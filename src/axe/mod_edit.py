"""axe.toml round-trip mutations via tomlkit. Preserves comments and structure.

Mod ids are a stack; insertions are always relative (top/bottom or above/below
an ordinal). `axe mods rm` removes by id (ordinals shift after removal so
ordinal-based delete would be ambiguous).
"""

from __future__ import annotations

from pathlib import Path
from typing import Literal

import tomlkit
from tomlkit import TOMLDocument
from tomlkit.exceptions import TOMLKitError

from axe.errors import AxeError

PositionKind = Literal["top", "bottom", "above", "below"]


def insert_mod(
    path: Path,
    mod_id: int,
    kind: PositionKind,
    *,
    anchor: int | None = None,
) -> list[int]:
    """Insert mod_id at the given position. Returns the post-mutation ids list."""
    doc = _load(path)
    ids = _ids(doc)
    if mod_id in ids:
        raise AxeError(
            "config",
            f"mod {mod_id} already declared at ordinal {ids.index(mod_id) + 1}",
        )
    new_ids = _placed(ids, mod_id, kind, anchor)
    _set_ids(doc, new_ids)
    _save(path, doc)
    return new_ids


def move_mod(
    path: Path,
    mod_id: int,
    kind: PositionKind,
    *,
    anchor: int | None = None,
) -> list[int]:
    """Move mod_id to the given position. Anchor (ordinal) required for above/below."""
    doc = _load(path)
    ids = _ids(doc)
    if mod_id not in ids:
        raise AxeError("config", f"mod {mod_id} not declared")
    without = [x for x in ids if x != mod_id]
    new_ids = _placed(without, mod_id, kind, anchor)
    _set_ids(doc, new_ids)
    _save(path, doc)
    return new_ids


def remove_mod(path: Path, mod_id: int) -> list[int]:
    """Remove mod_id. Returns the post-removal ids list."""
    doc = _load(path)
    ids = _ids(doc)
    if mod_id not in ids:
        raise AxeError("config", f"mod {mod_id} not declared")
    new_ids = [x for x in ids if x != mod_id]
    _set_ids(doc, new_ids)
    _save(path, doc)
    return new_ids


def _placed(
    ids: list[int],
    mod_id: int,
    kind: PositionKind,
    anchor: int | None,
) -> list[int]:
    if kind == "top":
        return [mod_id, *ids]
    if kind == "bottom":
        return [*ids, mod_id]
    if anchor is None:
        raise AxeError("config", f"position '{kind}' requires an anchor ordinal")
    if anchor < 1 or anchor > len(ids):
        valid = f"1..{len(ids)}" if ids else "(no mods declared)"
        raise AxeError("config", f"anchor ordinal {anchor} out of range {valid}")
    insert_at = anchor - 1 if kind == "above" else anchor
    return [*ids[:insert_at], mod_id, *ids[insert_at:]]


def _load(path: Path) -> TOMLDocument:
    try:
        text = path.read_text()
    except FileNotFoundError as e:
        raise AxeError("config", f"axe.toml not found at {path}") from e
    except OSError as e:
        raise AxeError("config", f"failed to read {path}: {e}") from e
    try:
        return tomlkit.parse(text)
    except TOMLKitError as e:
        raise AxeError("config", f"failed to parse axe.toml: {e}") from e


def _save(path: Path, doc: TOMLDocument) -> None:
    try:
        path.write_text(tomlkit.dumps(doc))
    except OSError as e:
        raise AxeError("filesystem", f"failed to write {path}: {e}") from e


def _ids(doc: TOMLDocument) -> list[int]:
    mods = doc.get("mods")
    if mods is None or "ids" not in mods:
        return []
    return [int(x) for x in mods["ids"]]


def _set_ids(doc: TOMLDocument, ids: list[int]) -> None:
    if "mods" not in doc:
        doc["mods"] = tomlkit.table()
    doc["mods"]["ids"] = ids
