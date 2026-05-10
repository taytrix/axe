"""Conan log file discovery + tail/follow."""

from __future__ import annotations

import time
from collections.abc import Iterator
from pathlib import Path

from axe.errors import AxeError
from axe.layout import Layout


def find_latest_log(layout: Layout) -> Path | None:
    logs_dir = layout.logs_dir
    if not logs_dir.is_dir():
        return None
    primary = logs_dir / "ConanSandbox.log"
    if primary.exists():
        return primary
    candidates = [p for p in logs_dir.iterdir() if p.is_file() and p.suffix == ".log"]
    if not candidates:
        return None
    return max(candidates, key=lambda p: p.stat().st_mtime)


def tail_lines(path: Path, *, lines: int) -> list[str]:
    try:
        text = path.read_text()
    except OSError as e:
        raise AxeError("filesystem", f"reading {path}: {e}") from e
    return text.splitlines()[-lines:]


def follow_log(path: Path, *, lines: int, poll_seconds: float = 0.5) -> Iterator[str]:
    """Yield the last `lines` then stream new lines as the file grows."""
    try:
        with path.open() as f:
            initial = f.read().splitlines()[-lines:]
            for line in initial:
                yield line
            while True:
                line = f.readline()
                if line:
                    yield line.rstrip("\n")
                    continue
                time.sleep(poll_seconds)
    except OSError as e:
        raise AxeError("filesystem", f"reading {path}: {e}") from e
