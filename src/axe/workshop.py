"""Steam Workshop API client: `GetPublishedFileDetails` via httpx, no API key."""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass

import httpx
from pydantic import BaseModel, ValidationError

from axe.errors import AxeError

_URL = "https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/"
_TIMEOUT_SECONDS = 15.0


class _RawItem(BaseModel):
    model_config = {"extra": "allow"}
    publishedfileid: str
    title: str
    time_updated: int
    visibility: int
    result: int


class _RawResponseInner(BaseModel):
    publishedfiledetails: list[_RawItem]


class _RawResponse(BaseModel):
    response: _RawResponseInner


@dataclass(frozen=True)
class WorkshopItem:
    published_file_id: int
    title: str
    time_updated: int
    visibility: int
    result: int  # 1 = published; non-1 = errored / deleted


FetchLike = Callable[[str, dict[str, str]], httpx.Response]


def _default_fetch(url: str, form: dict[str, str]) -> httpx.Response:
    return httpx.post(
        url,
        data=form,
        timeout=_TIMEOUT_SECONDS,
        headers={"content-type": "application/x-www-form-urlencoded"},
    )


def get_published_file_details(
    ids: Sequence[int],
    *,
    fetch: FetchLike | None = None,
) -> list[WorkshopItem]:
    """Query Workshop API for the given file IDs. Raises AxeError(workshop_api)."""
    if not ids:
        return []
    form: dict[str, str] = {"itemcount": str(len(ids))}
    for i, file_id in enumerate(ids):
        form[f"publishedfileids[{i}]"] = str(file_id)

    impl = fetch or _default_fetch
    try:
        response = impl(_URL, form)
    except httpx.HTTPError as e:
        raise AxeError("workshop_api", f"HTTP request: {e}") from e

    if response.status_code != 200:
        raise AxeError(
            "workshop_api", f"HTTP {response.status_code} {response.reason_phrase}"
        )

    try:
        raw = response.json()
    except ValueError as e:
        raise AxeError("workshop_api", f"parsing JSON: {e}") from e

    try:
        parsed = _RawResponse.model_validate(raw)
    except ValidationError as e:
        raise AxeError("workshop_api", f"unexpected response shape: {e}") from e

    return [
        WorkshopItem(
            published_file_id=int(item.publishedfileid),
            title=item.title,
            time_updated=item.time_updated,
            visibility=item.visibility,
            result=item.result,
        )
        for item in parsed.response.publishedfiledetails
    ]
