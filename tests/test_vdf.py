from __future__ import annotations

import pytest

from axe.errors import AxeError
from axe.vdf import parse_vdf


def test_quoted_string_with_escape() -> None:
    text = '"AppWorkshop"\n{\n\t"name"\t\t"a\\"b"\n}\n'
    tree = parse_vdf(text)
    assert tree == {"name": 'a"b'}


def test_nested_objects() -> None:
    text = '"AppWorkshop"\n{\n\t"a"\n\t{\n\t\t"b"\t"c"\n\t}\n}\n'
    tree = parse_vdf(text)
    assert tree == {"a": {"b": "c"}}


def test_line_comment_stripped() -> None:
    text = '"Outer"\n{\n// drop\n\t"k"\t"v"\n}\n'
    tree = parse_vdf(text)
    assert tree == {"k": "v"}


def test_unterminated_quoted_string_raises() -> None:
    with pytest.raises(AxeError) as exc_info:
        parse_vdf('"AppWorkshop"\n{\n\t"k"\t"unterminated\n')
    assert exc_info.value.kind == "acf_parse"


def test_backslash_escape() -> None:
    tree = parse_vdf('"Outer"\n{\n\t"k"\t"a\\\\b"\n}\n')
    assert tree == {"k": "a\\b"}
