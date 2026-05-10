from __future__ import annotations

from pathlib import Path

import pytest


@pytest.fixture
def synthetic_install(tmp_path: Path) -> Path:
    """A tmp Conan install with just enough files to satisfy probe + layout."""
    root = tmp_path / "conan"
    binary = root / "ConanSandbox" / "Binaries" / "Linux" / "ConanSandboxServer-Linux-Shipping"
    binary.parent.mkdir(parents=True)
    binary.touch()
    binary.chmod(0o755)
    return root


@pytest.fixture
def synthetic_install_with_toml(synthetic_install: Path) -> Path:
    """Synthetic install plus a minimal axe.toml at the root."""
    toml_text = f"""\
schema = 1

[server]
id = "conan"
root = "{synthetic_install}"

[mods]
ids = []
"""
    (synthetic_install / "axe.toml").write_text(toml_text)
    return synthetic_install
