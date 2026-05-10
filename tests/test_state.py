from __future__ import annotations

from pathlib import Path

from axe.state import SavedState, load_state, save_state, state_path


def _example_state() -> SavedState:
    return SavedState.model_validate(
        {
            "schema": 1,
            "axe_version": "0.1.0",
            "checked_at": "2026-05-10T12:00:00Z",
            "server": {"active_state": "active", "sub_state": "running", "main_pid": 12345},
            "mods": {
                "declared": 4,
                "current": 4,
                "stale": 0,
                "missing_local": 0,
                "missing_remote": 0,
            },
            "drift": False,
            "warnings": [],
        }
    )


def test_round_trip(tmp_path: Path) -> None:
    target = tmp_path / "state.json"
    state = _example_state()
    save_state(target, state)
    loaded = load_state(target)
    assert loaded is not None
    assert loaded.schema_version == 1
    assert loaded.server.main_pid == 12345
    assert loaded.mods.declared == 4
    assert loaded.drift is False


def test_load_missing_returns_none(tmp_path: Path) -> None:
    assert load_state(tmp_path / "absent.json") is None


def test_state_path_layout() -> None:
    p = state_path(Path("/home/tay/conan"))
    assert p == Path("/home/tay/conan/.axe/state.json")
