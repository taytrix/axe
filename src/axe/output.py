from __future__ import annotations

import json
import os
import sys
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, NoReturn

from rich.console import Console

from axe.errors import AxeError, ExitCode


@dataclass(frozen=True)
class OutputOptions:
    json: bool
    quiet: bool
    color: bool


def read_output_options(*, json_flag: bool, quiet: bool, no_color: bool) -> OutputOptions:
    return OutputOptions(json=json_flag, quiet=quiet, color=should_color(no_color))


def should_color(no_color: bool) -> bool:
    if no_color or os.environ.get("NO_COLOR"):
        return False
    return sys.stdout.isatty()


def render_ok(
    *,
    command: str,
    data: Any,
    opts: OutputOptions,
    human: Callable[[], None] | None = None,
    warnings: list[str] | None = None,
) -> None:
    if opts.json:
        envelope: dict[str, Any] = {
            "ok": True,
            "command": command,
            "data": data,
            "error": None,
        }
        if warnings:
            envelope["warnings"] = warnings
        sys.stdout.write(json.dumps(envelope) + "\n")
        return
    if opts.quiet:
        return
    if human is not None:
        human()


def render_fail(
    *,
    command: str,
    code: ExitCode,
    message: str,
    opts: OutputOptions,
) -> NoReturn:
    if opts.json:
        envelope = {
            "ok": False,
            "command": command,
            "data": None,
            "error": {"code": int(code), "message": message},
        }
        sys.stdout.write(json.dumps(envelope) + "\n")
    else:
        Console(stderr=True, no_color=not opts.color).print(f"[red]error:[/red] {message}")
    raise SystemExit(int(code))


def render_error(
    *,
    command: str,
    error: AxeError,
    opts: OutputOptions,
) -> NoReturn:
    code_map: dict[str, ExitCode] = {
        "config": ExitCode.CONFIG,
        "discovery": ExitCode.DISCOVERY,
        "filesystem": ExitCode.FILESYSTEM,
        "workshop_api": ExitCode.NETWORK,
        "acf_parse": ExitCode.CONFIG,
        "lifecycle": ExitCode.LIFECYCLE,
    }
    code = code_map.get(error.kind, ExitCode.MISUSE)
    render_fail(command=command, code=code, message=error.message, opts=opts)
