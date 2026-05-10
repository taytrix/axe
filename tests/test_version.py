from __future__ import annotations

import json

from typer.testing import CliRunner

from axe import __version__
from axe.cli import app

runner = CliRunner()


def test_version_human() -> None:
    result = runner.invoke(app, ["version"])
    assert result.exit_code == 0
    assert __version__ in result.stdout


def test_version_json_envelope() -> None:
    result = runner.invoke(app, ["--json", "version"])
    assert result.exit_code == 0
    envelope = json.loads(result.stdout)
    assert envelope["ok"] is True
    assert envelope["command"] == "version"
    assert envelope["data"]["version"] == __version__
    assert envelope["error"] is None
    assert "warnings" not in envelope
