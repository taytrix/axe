from __future__ import annotations

from pathlib import Path

from axe.acf import parse_acf

FIXTURE = Path(__file__).parent / "fixtures" / "sample_workshop.acf"


def test_parses_four_installed_mods() -> None:
    acf = parse_acf(FIXTURE.read_text())
    assert len(acf.mods) == 4
    ids = sorted(acf.mods.keys())
    assert ids == [3721090132, 3721096154, 3721177576, 3721991191]


def test_bigint_manifest_preserved() -> None:
    acf = parse_acf(FIXTURE.read_text())
    mod = acf.mods[3721090132]
    assert mod.manifest == 3915417666713453363
    assert mod.latest_manifest == 3915417666713453363


def test_all_fixtures_current() -> None:
    acf = parse_acf(FIXTURE.read_text())
    for mod in acf.mods.values():
        assert mod.manifest == mod.latest_manifest
        assert mod.time_updated == mod.latest_time_updated


def test_missing_details_falls_back_to_installed() -> None:
    text = """\
"AppWorkshop"
{
\t"WorkshopItemsInstalled"
\t{
\t\t"1234"
\t\t{
\t\t\t"manifest"\t"5555"
\t\t\t"timeupdated"\t"1000"
\t\t}
\t}
}
"""
    acf = parse_acf(text)
    mod = acf.mods[1234]
    assert mod.manifest == 5555
    assert mod.latest_manifest == 5555
    assert mod.time_updated == 1000
    assert mod.latest_time_updated == 1000


def test_non_numeric_ids_skipped() -> None:
    text = """\
"AppWorkshop"
{
\t"WorkshopItemsInstalled"
\t{
\t\t"abc"
\t\t{
\t\t\t"manifest"\t"1"
\t\t}
\t\t"5678"
\t\t{
\t\t\t"manifest"\t"9"
\t\t}
\t}
}
"""
    acf = parse_acf(text)
    assert list(acf.mods.keys()) == [5678]
