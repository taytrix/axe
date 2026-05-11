"""`load_context(path)` -> bundled `Config` + `Layout`; every verb opens with this.

When `path` is None we discover axe.toml via `$AXE_ROOT` (if set) or by
walking up from the current directory. `--config` always wins.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from axe.config import Config, load_config
from axe.errors import AxeError
from axe.layout import Layout, layout_at


@dataclass(frozen=True)
class Context:
    config: Config
    layout: Layout
    config_path: Path


def load_context(config_path: Path | str | None) -> Context:
    path = Path(config_path) if config_path is not None else _discover_config()
    config = load_config(path)
    layout = layout_at(config.server.root)
    return Context(config=config, layout=layout, config_path=path)


def _discover_config() -> Path:
    """`$AXE_ROOT/axe.toml`, then walk up from cwd; raises if nothing found."""
    root_env = os.environ.get("AXE_ROOT")
    if root_env:
        candidate = Path(root_env) / "axe.toml"
        if not candidate.exists():
            raise AxeError(
                "config",
                f"AXE_ROOT={root_env} but no axe.toml at {candidate}",
            )
        return candidate

    cwd = Path.cwd().resolve()
    for parent in [cwd, *cwd.parents]:
        candidate = parent / "axe.toml"
        if candidate.exists():
            return candidate

    raise AxeError(
        "config",
        "no axe.toml in cwd or any parent; pass --config, set AXE_ROOT, or run 'axe init'",
    )
