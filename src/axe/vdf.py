from __future__ import annotations

from axe.errors import AxeError

VdfObject = dict[str, "VdfValue"]
VdfValue = str | VdfObject

_ESCAPES = {"n": "\n", "t": "\t", '"': '"', "\\": "\\"}
_WHITESPACE = {" ", "\t", "\n", "\r"}
_STRUCTURAL = {"{", "}", '"'}


def _skip_whitespace_and_comments(text: str, start: int) -> int:
    i = start
    n = len(text)
    while i < n:
        c = text[i]
        if c in _WHITESPACE:
            i += 1
            continue
        if c == "/" and i + 1 < n and text[i + 1] == "/":
            while i < n and text[i] != "\n":
                i += 1
            continue
        return i
    return i


def _read_quoted_string(text: str, start: int) -> tuple[str, int]:
    i = start + 1
    n = len(text)
    parts: list[str] = []
    while i < n and text[i] != '"':
        if text[i] == "\\" and i + 1 < n:
            parts.append(_ESCAPES.get(text[i + 1], text[i + 1]))
            i += 2
        else:
            parts.append(text[i])
            i += 1
    if i >= n:
        raise AxeError("acf_parse", "unterminated quoted string")
    return "".join(parts), i + 1


def _read_unquoted_string(text: str, start: int) -> tuple[str, int]:
    i = start
    n = len(text)
    parts: list[str] = []
    while i < n:
        c = text[i]
        if c in _WHITESPACE or c in _STRUCTURAL:
            break
        parts.append(c)
        i += 1
    return "".join(parts), i


def _tokenize(text: str) -> list[tuple[str, str]]:
    """Return a list of (kind, value) tokens. kind: 'str' | 'open' | 'close'."""
    tokens: list[tuple[str, str]] = []
    i = 0
    n = len(text)
    while i < n:
        i = _skip_whitespace_and_comments(text, i)
        if i >= n:
            break
        c = text[i]
        if c == "{":
            tokens.append(("open", ""))
            i += 1
            continue
        if c == "}":
            tokens.append(("close", ""))
            i += 1
            continue
        if c == '"':
            value, i = _read_quoted_string(text, i)
        else:
            value, i = _read_unquoted_string(text, i)
        tokens.append(("str", value))
    return tokens


def parse_vdf(text: str) -> VdfObject:
    """Parse VDF/KeyValues. Unwraps outer `"Key" { ... }` if present."""
    tokens = _tokenize(text)
    pos = 0

    def parse_object() -> VdfObject:
        nonlocal pos
        obj: VdfObject = {}
        while pos < len(tokens):
            kind, value = tokens[pos]
            if kind == "close":
                pos += 1
                return obj
            if kind != "str":
                raise AxeError("acf_parse", f"expected key, got {kind}")
            key = value
            pos += 1
            if pos >= len(tokens):
                raise AxeError("acf_parse", f"unexpected end after key '{key}'")
            nkind, nvalue = tokens[pos]
            if nkind == "str":
                obj[key] = nvalue
                pos += 1
            elif nkind == "open":
                pos += 1
                obj[key] = parse_object()
            else:
                raise AxeError("acf_parse", f"expected value or '{{' after key '{key}'")
        return obj

    if (
        len(tokens) >= 2
        and tokens[0][0] == "str"
        and tokens[1][0] == "open"
    ):
        pos = 2
        return parse_object()
    return parse_object()
