from __future__ import annotations

from axe.acf import AcfFile, ModManifest
from axe.mods import check_mod_freshness, has_drift
from axe.workshop import WorkshopItem


def _acf(*entries: ModManifest) -> AcfFile:
    return AcfFile(mods={e.workshop_id: e for e in entries})


def _entry(
    wid: int,
    *,
    manifest: int,
    time_updated: int,
    latest_manifest: int | None = None,
    latest_time_updated: int | None = None,
) -> ModManifest:
    return ModManifest(
        workshop_id=wid,
        manifest=manifest,
        time_updated=time_updated,
        latest_manifest=latest_manifest if latest_manifest is not None else manifest,
        latest_time_updated=(
            latest_time_updated if latest_time_updated is not None else time_updated
        ),
    )


def _wi(wid: int, *, time_updated: int, result: int = 1, title: str = "T") -> WorkshopItem:
    return WorkshopItem(
        published_file_id=wid,
        title=title,
        time_updated=time_updated,
        visibility=0,
        result=result,
    )


def test_all_current() -> None:
    local = _acf(_entry(1, manifest=10, time_updated=100))
    report = check_mod_freshness([1], local, [_wi(1, time_updated=100)])
    assert report.current == 1
    assert report.stale == 0
    assert has_drift(report) is False


def test_stale_when_remote_newer() -> None:
    local = _acf(_entry(1, manifest=10, time_updated=100))
    report = check_mod_freshness([1], local, [_wi(1, time_updated=200)])
    assert report.stale == 1
    assert report.items[0].state == "stale"
    assert has_drift(report) is True


def test_missing_local() -> None:
    local = _acf()
    report = check_mod_freshness([1], local, [_wi(1, time_updated=100)])
    assert report.missing_local == 1
    assert report.items[0].title == "T"
    assert has_drift(report) is True


def test_missing_remote_when_result_non_one() -> None:
    local = _acf(_entry(1, manifest=10, time_updated=100))
    report = check_mod_freshness([1], local, [_wi(1, time_updated=100, result=0)])
    assert report.missing_remote == 1
    assert has_drift(report) is True


def test_unmanaged_does_not_trigger_drift() -> None:
    local = _acf(_entry(1, manifest=10, time_updated=100), _entry(2, manifest=20, time_updated=200))
    report = check_mod_freshness([1], local, [_wi(1, time_updated=100)])
    assert report.unmanaged == 1
    assert report.items[-1].state == "unmanaged"
    assert has_drift(report) is False


def test_empty_remote_falls_back_to_acf_latest() -> None:
    local = _acf(
        _entry(1, manifest=10, time_updated=100, latest_manifest=10, latest_time_updated=100)
    )
    report = check_mod_freshness([1], local, [])
    assert report.current == 1
    assert report.items[0].title is None
