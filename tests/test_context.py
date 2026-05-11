from __future__ import annotations

from pathlib import Path

import pytest

from axe.context import load_context
from axe.errors import AxeError


def _write_toml(root: Path) -> Path:
    root.mkdir(parents=True, exist_ok=True)
    binary = root / "ConanSandbox" / "Binaries" / "Linux" / "ConanSandboxServer-Linux-Shipping"
    binary.parent.mkdir(parents=True, exist_ok=True)
    binary.touch()
    toml = root / "axe.toml"
    toml.write_text(
        f"""\
schema = 1

[server]
id = "conan"
root = "{root}"
"""
    )
    return toml


def test_explicit_path_loads(synthetic_install_with_toml: Path) -> None:
    ctx = load_context(synthetic_install_with_toml / "axe.toml")
    assert ctx.config.server.id == "conan"


def test_walk_up_from_subdir_finds_toml(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = tmp_path / "conan"
    _write_toml(root)
    deep = root / "ConanSandbox" / "Saved"
    deep.mkdir(parents=True, exist_ok=True)
    monkeypatch.chdir(deep)
    monkeypatch.delenv("AXE_ROOT", raising=False)
    ctx = load_context(None)
    assert ctx.config_path == root / "axe.toml"


def test_axe_root_env_var_overrides_cwd(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    one = tmp_path / "one"
    two = tmp_path / "two"
    _write_toml(one)
    _write_toml(two)
    monkeypatch.chdir(one)  # cwd has its own toml; AXE_ROOT should still win
    monkeypatch.setenv("AXE_ROOT", str(two))
    ctx = load_context(None)
    assert ctx.config_path == two / "axe.toml"


def test_axe_root_env_pointing_at_empty_dir_errors(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("AXE_ROOT", str(tmp_path / "nowhere"))
    with pytest.raises(AxeError, match="AXE_ROOT="):
        load_context(None)


def test_no_toml_anywhere_errors(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("AXE_ROOT", raising=False)
    with pytest.raises(AxeError, match="no axe.toml"):
        load_context(None)
