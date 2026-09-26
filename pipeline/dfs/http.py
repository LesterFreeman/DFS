"""HTTP access with retries, plus an offline fixture mode used by tests and the sample build."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/128.0 Safari/537.36"
)


class Http:
    def __init__(self, fixtures_dir: Path | None = None, timeout: float = 30.0):
        self.fixtures_dir = fixtures_dir
        self.timeout = timeout
        self.session = requests.Session()
        retry = Retry(
            total=3,
            backoff_factor=1.5,
            status_forcelist=(429, 500, 502, 503, 504),
            allowed_methods=("GET",),
        )
        self.session.mount("https://", HTTPAdapter(max_retries=retry))
        self.session.headers.update({"User-Agent": USER_AGENT, "Accept-Language": "en-US,en;q=0.9"})
        # Crawling unknown websites: short timeout, no retries, so a slow site can't stall the run.
        self.quick = requests.Session()
        self.quick.headers.update(self.session.headers)

    @property
    def offline(self) -> bool:
        return self.fixtures_dir is not None

    def get_text(self, url: str, *, fixture: str, params: Any = None, headers: dict | None = None,
                 quick: bool = False) -> str:
        if self.fixtures_dir is not None:
            # Missing fixture == source outage; lets tests exercise failure handling.
            return (self.fixtures_dir / fixture).read_text(encoding="utf-8")
        session, timeout = (self.quick, 15.0) if quick else (self.session, self.timeout)
        resp = session.get(url, params=params, headers=headers, timeout=timeout)
        if resp.status_code >= 400:
            # Include the start of the body: APIs often explain a 400 there, and the URL alone doesn't.
            body = " ".join(resp.text.split())[:160]
            raise requests.HTTPError(f"{resp.status_code} {resp.reason}: {body!r}", response=resp)
        return resp.text

    def get_json(self, url: str, *, fixture: str, params: Any = None, headers: dict | None = None) -> Any:
        return json.loads(self.get_text(url, fixture=fixture, params=params, headers=headers))
