"""`systemctl --user` shell-out: show parser + start/stop/restart verbs."""

from __future__ import annotations

import shutil
import subprocess
from dataclasses import dataclass
from typing import Literal

from axe.errors import AxeError

SystemctlVerb = Literal["start", "stop", "restart"]


@dataclass(frozen=True)
class SystemdResult:
    unit: str
    verb: SystemctlVerb
    returncode: int
    stdout: str
    stderr: str


def parse_show(text: str) -> dict[str, str]:
    result: dict[str, str] = {}
    for line in text.splitlines():
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        result[key] = value
    return result


def systemctl_show(unit: str) -> dict[str, str]:
    """Run `systemctl --user show <unit> --timestamp=unix`.

    `--timestamp=unix` returns ActiveEnterTimestamp as `@<epoch>` instead of
    a local-wallclock string. This keeps uptime math TZ-free. Requires
    systemd 244+ (October 2019) — universal on any vaguely modern distro.
    """
    if shutil.which("systemctl") is None:
        raise AxeError("lifecycle", "systemctl not found on PATH")
    try:
        proc = subprocess.run(
            ["systemctl", "--user", "show", unit, "--timestamp=unix"],
            capture_output=True,
            text=True,
            check=False,
            timeout=10,
        )
    except subprocess.TimeoutExpired as e:
        raise AxeError("lifecycle", f"systemctl show {unit} timed out after 10s") from e
    if proc.returncode != 0:
        raise AxeError(
            "lifecycle",
            f"systemctl show {unit} failed (exit {proc.returncode}): {proc.stderr.strip()}",
        )
    return parse_show(proc.stdout)


def systemctl_verb(unit: str, verb: SystemctlVerb) -> SystemdResult:
    if shutil.which("systemctl") is None:
        raise AxeError("lifecycle", "systemctl not found on PATH")
    proc = subprocess.run(
        ["systemctl", "--user", verb, unit],
        capture_output=True,
        text=True,
        check=False,
    )
    result = SystemdResult(
        unit=unit,
        verb=verb,
        returncode=proc.returncode,
        stdout=proc.stdout,
        stderr=proc.stderr,
    )
    if result.returncode != 0:
        raise AxeError(
            "lifecycle",
            f"systemctl {verb} {unit} failed (exit {result.returncode}): "
            f"{result.stderr.strip()}",
        )
    return result
