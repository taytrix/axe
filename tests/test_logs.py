from __future__ import annotations

import time
from pathlib import Path

from axe.layout import layout_at
from axe.logs import find_latest_log, tail_lines


def test_find_latest_log_prefers_conan_sandbox_log(synthetic_install: Path) -> None:
    layout = layout_at(synthetic_install)
    layout.logs_dir.mkdir(parents=True)
    (layout.logs_dir / "OldRun.log").write_text("old")
    primary = layout.logs_dir / "ConanSandbox.log"
    primary.write_text("primary")
    # Make OldRun.log newer to ensure preference is not mtime-only.
    time.sleep(0.01)
    (layout.logs_dir / "OldRun.log").write_text("old still")
    latest = find_latest_log(layout)
    assert latest == primary


def test_find_latest_log_falls_back_to_newest(synthetic_install: Path) -> None:
    layout = layout_at(synthetic_install)
    layout.logs_dir.mkdir(parents=True)
    older = layout.logs_dir / "ConanSandbox-2026.05.01.log"
    newer = layout.logs_dir / "ConanSandbox-2026.05.10.log"
    older.write_text("old")
    time.sleep(0.01)
    newer.write_text("new")
    latest = find_latest_log(layout)
    assert latest == newer


def test_find_latest_log_missing_dir_returns_none(synthetic_install: Path) -> None:
    layout = layout_at(synthetic_install)
    # logs_dir does not exist yet
    assert find_latest_log(layout) is None


def test_tail_lines_returns_last_n(tmp_path: Path) -> None:
    log = tmp_path / "x.log"
    log.write_text("a\nb\nc\nd\ne\n")
    assert tail_lines(log, lines=2) == ["d", "e"]
