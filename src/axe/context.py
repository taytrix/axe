from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from axe.config import Config, load_config
from axe.layout import Layout, layout_at


@dataclass(frozen=True)
class Context:
    config: Config
    layout: Layout
    config_path: Path


def load_context(config_path: Path | str | None) -> Context:
    path = Path(config_path) if config_path is not None else Path("axe.toml")
    config = load_config(path)
    layout = layout_at(config.server.root)
    return Context(config=config, layout=layout, config_path=path)
