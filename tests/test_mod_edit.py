from __future__ import annotations

from pathlib import Path

import pytest
import tomlkit

from axe.errors import AxeError
from axe.mod_edit import insert_mod, move_mod, remove_mod


def _seed(tmp_path: Path, ids: list[int], extra: str = "") -> Path:
    body = f"""\
schema = 1

[server]
id = "conan"
root = "/tmp/conan"

[mods]
ids = {ids}
{extra}"""
    target = tmp_path / "axe.toml"
    target.write_text(body)
    return target


def _ids(path: Path) -> list[int]:
    return [int(x) for x in tomlkit.parse(path.read_text())["mods"]["ids"]]


def test_insert_top(tmp_path: Path) -> None:
    path = _seed(tmp_path, [111, 222])
    result = insert_mod(path, 999, "top")
    assert result == [999, 111, 222]
    assert _ids(path) == [999, 111, 222]


def test_insert_bottom(tmp_path: Path) -> None:
    path = _seed(tmp_path, [111, 222])
    result = insert_mod(path, 999, "bottom")
    assert result == [111, 222, 999]


def test_insert_above_ordinal(tmp_path: Path) -> None:
    path = _seed(tmp_path, [111, 222, 333])
    result = insert_mod(path, 999, "above", anchor=2)
    assert result == [111, 999, 222, 333]


def test_insert_below_ordinal(tmp_path: Path) -> None:
    path = _seed(tmp_path, [111, 222, 333])
    result = insert_mod(path, 999, "below", anchor=2)
    assert result == [111, 222, 999, 333]


def test_insert_into_empty(tmp_path: Path) -> None:
    path = _seed(tmp_path, [])
    result = insert_mod(path, 999, "top")
    assert result == [999]


def test_insert_duplicate_refused(tmp_path: Path) -> None:
    path = _seed(tmp_path, [111, 222])
    with pytest.raises(AxeError, match="already declared at ordinal 2"):
        insert_mod(path, 222, "top")


def test_above_without_anchor_refused(tmp_path: Path) -> None:
    path = _seed(tmp_path, [111])
    with pytest.raises(AxeError, match="requires an anchor"):
        insert_mod(path, 999, "above")


def test_anchor_out_of_range_refused(tmp_path: Path) -> None:
    path = _seed(tmp_path, [111, 222])
    with pytest.raises(AxeError, match="out of range 1..2"):
        insert_mod(path, 999, "above", anchor=5)


def test_move_top(tmp_path: Path) -> None:
    path = _seed(tmp_path, [111, 222, 333])
    result = move_mod(path, 333, "top")
    assert result == [333, 111, 222]


def test_move_bottom(tmp_path: Path) -> None:
    path = _seed(tmp_path, [111, 222, 333])
    result = move_mod(path, 111, "bottom")
    assert result == [222, 333, 111]


def test_move_above_ordinal(tmp_path: Path) -> None:
    path = _seed(tmp_path, [111, 222, 333])
    result = move_mod(path, 333, "above", anchor=2)
    assert result == [111, 333, 222]


def test_move_below_ordinal(tmp_path: Path) -> None:
    path = _seed(tmp_path, [111, 222, 333, 444])
    # After removing 333, list is [111,222,444]; insert below ordinal 1 (the 111) = position 1
    result = move_mod(path, 333, "below", anchor=1)
    assert result == [111, 333, 222, 444]


def test_move_missing_refused(tmp_path: Path) -> None:
    path = _seed(tmp_path, [111])
    with pytest.raises(AxeError, match="not declared"):
        move_mod(path, 999, "top")


def test_remove(tmp_path: Path) -> None:
    path = _seed(tmp_path, [111, 222, 333])
    result = remove_mod(path, 222)
    assert result == [111, 333]


def test_remove_missing_refused(tmp_path: Path) -> None:
    path = _seed(tmp_path, [111])
    with pytest.raises(AxeError, match="not declared"):
        remove_mod(path, 999)


def test_preserves_comments_above_mods(tmp_path: Path) -> None:
    body = """\
schema = 1

[server]
id = "conan"
root = "/tmp/conan"

# Mod stack: priority order, top = loads first
[mods]
ids = [111, 222]

[hooks]
on_drift = "echo"  # ping me when drift appears
"""
    path = tmp_path / "axe.toml"
    path.write_text(body)
    insert_mod(path, 999, "top")
    text = path.read_text()
    assert "# Mod stack: priority order, top = loads first" in text
    assert "# ping me when drift appears" in text


def test_creates_mods_table_if_absent(tmp_path: Path) -> None:
    body = """\
schema = 1

[server]
id = "conan"
root = "/tmp/conan"
"""
    path = tmp_path / "axe.toml"
    path.write_text(body)
    result = insert_mod(path, 999, "top")
    assert result == [999]
    assert _ids(path) == [999]
