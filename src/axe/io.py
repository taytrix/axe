from __future__ import annotations

import contextlib
import os
import time
import uuid
from pathlib import Path

from axe.errors import AxeError


def atomic_write(path: Path, contents: str | bytes) -> None:
    """Atomically replace `path` with `contents` (tmp + rename)."""
    parent = path.parent
    parent.mkdir(parents=True, exist_ok=True)
    tmp = parent / (
        f"{path.name}.{os.getpid()}.{int(time.time_ns())}.{uuid.uuid4().hex[:8]}.tmp"
    )
    data = contents.encode() if isinstance(contents, str) else contents
    try:
        tmp.write_bytes(data)
    except OSError as e:
        raise AxeError("filesystem", f"writing {tmp}: {e}") from e
    try:
        os.replace(tmp, path)
    except OSError as e:
        with contextlib.suppress(OSError):
            tmp.unlink()
        raise AxeError("filesystem", f"renaming {tmp} -> {path}: {e}") from e
