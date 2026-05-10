"""Exit-code taxonomy and the single error class axe raises across boundaries."""

from __future__ import annotations

from enum import IntEnum
from typing import Literal


class ExitCode(IntEnum):
    OK = 0
    MISUSE = 2
    CONFIG = 10
    DISCOVERY = 11
    NETWORK = 20
    LIFECYCLE = 30
    FILESYSTEM = 40
    DRIFT = 50


AxeErrorKind = Literal[
    "config",
    "discovery",
    "filesystem",
    "workshop_api",
    "acf_parse",
    "lifecycle",
    "hook",
]


class AxeError(Exception):
    def __init__(self, kind: AxeErrorKind, message: str) -> None:
        super().__init__(message)
        self.kind: AxeErrorKind = kind
        self.message = message
