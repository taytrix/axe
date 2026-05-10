from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from axe.errors import AxeError
from axe.workshop import get_published_file_details


def _fake_response(status_code: int, payload: Any) -> httpx.Response:
    return httpx.Response(
        status_code=status_code,
        content=json.dumps(payload).encode(),
        request=httpx.Request("POST", "https://api.steampowered.com/"),
    )


def _ok_payload(items: list[dict[str, Any]]) -> dict[str, Any]:
    return {"response": {"publishedfiledetails": items}}


def test_success_returns_typed_items() -> None:
    response = _fake_response(
        200,
        _ok_payload(
            [
                {
                    "publishedfileid": "3721090132",
                    "title": "A Mod",
                    "time_updated": 1778205653,
                    "visibility": 0,
                    "result": 1,
                }
            ]
        ),
    )

    def fake(_url: str, _form: dict[str, str]) -> httpx.Response:
        return response

    items = get_published_file_details([3721090132], fetch=fake)
    assert len(items) == 1
    assert items[0].published_file_id == 3721090132
    assert items[0].title == "A Mod"
    assert items[0].result == 1


def test_empty_ids_short_circuits() -> None:
    def must_not_call(_url: str, _form: dict[str, str]) -> httpx.Response:
        raise AssertionError("fetch must not be called for empty ids")

    assert get_published_file_details([], fetch=must_not_call) == []


def test_http_error_raises() -> None:
    def fake(_url: str, _form: dict[str, str]) -> httpx.Response:
        return _fake_response(500, _ok_payload([]))

    with pytest.raises(AxeError) as exc_info:
        get_published_file_details([1], fetch=fake)
    assert exc_info.value.kind == "workshop_api"


def test_bad_shape_raises() -> None:
    def fake(_url: str, _form: dict[str, str]) -> httpx.Response:
        return _fake_response(200, {"wrong": "shape"})

    with pytest.raises(AxeError) as exc_info:
        get_published_file_details([1], fetch=fake)
    assert exc_info.value.kind == "workshop_api"


def test_form_body_shape() -> None:
    seen: dict[str, str] = {}

    def fake(_url: str, form: dict[str, str]) -> httpx.Response:
        seen.update(form)
        return _fake_response(200, _ok_payload([]))

    get_published_file_details([1, 2, 3], fetch=fake)
    assert seen["itemcount"] == "3"
    assert seen["publishedfileids[0]"] == "1"
    assert seen["publishedfileids[1]"] == "2"
    assert seen["publishedfileids[2]"] == "3"
