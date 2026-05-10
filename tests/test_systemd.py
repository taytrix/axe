from __future__ import annotations

from axe.systemd import parse_show

SAMPLE_SHOW = """\
ActiveState=active
SubState=running
MainPID=12345
ActiveEnterTimestamp=Sat 2026-05-10 12:00:00 UTC
LoadState=loaded
"""


def test_parse_show_extracts_known_keys() -> None:
    show = parse_show(SAMPLE_SHOW)
    assert show["ActiveState"] == "active"
    assert show["SubState"] == "running"
    assert show["MainPID"] == "12345"


def test_parse_show_ignores_lines_without_equals() -> None:
    show = parse_show("garbage line\nActiveState=active\n")
    assert show == {"ActiveState": "active"}


def test_parse_show_preserves_value_with_equals() -> None:
    show = parse_show("Foo=a=b=c\n")
    assert show["Foo"] == "a=b=c"


def test_parse_show_empty() -> None:
    assert parse_show("") == {}
