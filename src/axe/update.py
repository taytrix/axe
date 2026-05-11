"""`axe update`: query GitHub for the latest python-v* tag, re-run uv tool install.

Assumes the user installed via `uv tool install`. Other install paths (pip,
distro packages, source clones) get a manual upgrade-command string rather
than an attempted in-place install.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from collections.abc import Callable
from dataclasses import dataclass

import httpx

from axe import __version__
from axe.errors import AxeError

REPO = "taytrix/axe"
RELEASES_LATEST_URL = f"https://api.github.com/repos/{REPO}/releases/latest"
_TIMEOUT_SECONDS = 10.0

FetchLike = Callable[[str], httpx.Response]


@dataclass(frozen=True)
class UpdateOutcome:
    previous: str
    target: str
    upgraded: bool
    command: list[str]


def _default_fetch(url: str) -> httpx.Response:
    return httpx.get(
        url,
        timeout=_TIMEOUT_SECONDS,
        headers={"accept": "application/vnd.github+json"},
    )


def latest_release_tag(fetch: FetchLike | None = None) -> str:
    """GET /repos/<owner>/<repo>/releases/latest, return `tag_name`."""
    impl = fetch or _default_fetch
    try:
        response = impl(RELEASES_LATEST_URL)
    except httpx.HTTPError as e:
        raise AxeError("workshop_api", f"GitHub releases fetch: {e}") from e
    if response.status_code != 200:
        raise AxeError(
            "workshop_api",
            f"GitHub releases returned HTTP {response.status_code} {response.reason_phrase}",
        )
    try:
        data = response.json()
    except ValueError as e:
        raise AxeError("workshop_api", f"GitHub releases: parsing JSON: {e}") from e
    tag = data.get("tag_name")
    if not isinstance(tag, str) or not tag:
        raise AxeError("workshop_api", "GitHub releases: no tag_name in response")
    return tag


def run_update(
    target_tag: str | None = None,
    *,
    fetch: FetchLike | None = None,
    spawn: Callable[[list[str]], subprocess.CompletedProcess[str]] | None = None,
) -> UpdateOutcome:
    """Resolve the target tag, then `uv tool install --from git+...@<tag> axe --force`.

    Streams the install output to the user; raises AxeError if uv is missing
    or the install subprocess exits non-zero.
    """
    if shutil.which("uv") is None:
        raise AxeError(
            "config",
            "uv not found in PATH — `axe update` only supports uv-tool installs.\n"
            "  manual upgrade: uv tool install --from "
            f"git+https://github.com/{REPO}@<tag> axe --force",
        )

    target = target_tag or latest_release_tag(fetch=fetch)
    previous = __version__
    if target == f"python-v{previous}":
        return UpdateOutcome(previous=previous, target=target, upgraded=False, command=[])

    cmd = [
        "uv",
        "tool",
        "install",
        "--from",
        f"git+https://github.com/{REPO}@{target}",
        "axe",
        "--force",
    ]
    impl = spawn or _streaming_spawn
    try:
        result = impl(cmd)
    except (FileNotFoundError, OSError) as e:
        raise AxeError("lifecycle", f"spawn uv: {e}") from e
    if result.returncode != 0:
        raise AxeError(
            "lifecycle",
            f"uv tool install failed (exit {result.returncode})",
        )
    return UpdateOutcome(previous=previous, target=target, upgraded=True, command=cmd)


def _streaming_spawn(cmd: list[str]) -> subprocess.CompletedProcess[str]:
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    captured: list[str] = []
    if proc.stdout is not None:
        for line in proc.stdout:
            sys.stderr.write(line)
            sys.stderr.flush()
            captured.append(line)
    proc.wait()
    return subprocess.CompletedProcess(
        args=cmd,
        returncode=proc.returncode,
        stdout="".join(captured),
        stderr="",
    )
