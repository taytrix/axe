from enum import IntEnum


class ExitCode(IntEnum):
    OK = 0
    MISUSE = 2
    CONFIG = 10
    DISCOVERY = 11
    NETWORK = 20
    LIFECYCLE = 30
    FILESYSTEM = 40
    DRIFT = 50


AxeErrorKind = str


class AxeError(Exception):
    def __init__(self, kind: AxeErrorKind, message: str) -> None:
        super().__init__(message)
        self.kind = kind
        self.message = message
