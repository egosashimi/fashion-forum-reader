"""Polite HTTP client: per-host rate limiting, robots.txt, request budgets.

The collector never logs in, never sends cookies it was not given, and never
tries to solve or evade bot challenges. A challenge page is reported as
``BlockedError`` and the source is marked *blocked* for that run.
"""
from __future__ import annotations

import logging
import time
import urllib.robotparser
from dataclasses import dataclass, field
from typing import Callable, Optional
from urllib.parse import urlsplit

import requests

log = logging.getLogger(__name__)


class FetchError(Exception):
    """A request failed (network error, 4xx/5xx after retries)."""


class BlockedError(FetchError):
    """The site refused automated access (bot challenge, 401/403, robots)."""


class BudgetExceeded(Exception):
    """The per-run request budget for a source is used up."""


def looks_like_challenge(status: int, text: str, headers: dict) -> bool:
    if status in (401, 403, 429, 503):
        low = text[:5000].lower()
        markers = ("just a moment", "challenge-platform", "cf-chl", "attention required", "captcha", "enable javascript and cookies")
        if any(m in low for m in markers) or headers.get("cf-mitigated") == "challenge":
            return True
    return False


@dataclass
class PoliteClient:
    user_agent: str
    min_interval: float = 3.0
    max_requests: int = 60
    timeout: float = 30.0
    retries: int = 2
    respect_robots: bool = True
    session: requests.Session = field(default_factory=requests.Session)
    sleep: Callable[[float], None] = time.sleep
    clock: Callable[[], float] = time.monotonic

    def __post_init__(self) -> None:
        self.session.headers.update({"User-Agent": self.user_agent, "Accept-Language": "en"})
        self.requests_made = 0
        self._last_request: dict[str, float] = {}
        self._robots: dict[str, Optional[urllib.robotparser.RobotFileParser]] = {}

    # -- politeness -------------------------------------------------------
    def _wait_for_slot(self, host: str) -> None:
        last = self._last_request.get(host)
        if last is not None:
            elapsed = self.clock() - last
            if elapsed < self.min_interval:
                self.sleep(self.min_interval - elapsed)
        self._last_request[host] = self.clock()

    def _robots_for(self, url: str) -> Optional[urllib.robotparser.RobotFileParser]:
        parts = urlsplit(url)
        origin = f"{parts.scheme}://{parts.netloc}"
        if origin not in self._robots:
            rp = urllib.robotparser.RobotFileParser()
            try:
                self._count()
                self._wait_for_slot(parts.netloc)
                r = self.session.get(origin + "/robots.txt", timeout=self.timeout)
                if r.status_code == 200 and not looks_like_challenge(r.status_code, r.text, r.headers):
                    rp.parse(r.text.splitlines())
                    self._robots[origin] = rp
                else:
                    # No usable robots.txt: fall back to allowed (RFC 9309 §2.3.1.3 for 4xx).
                    self._robots[origin] = None
            except requests.RequestException as e:
                log.warning("robots.txt fetch failed for %s: %s", origin, e)
                self._robots[origin] = None
        return self._robots[origin]

    def allowed(self, url: str) -> bool:
        if not self.respect_robots:
            return True
        rp = self._robots_for(url)
        if rp is None:
            return True
        return rp.can_fetch(self.user_agent, url)

    def crawl_delay(self, url: str) -> Optional[float]:
        rp = self._robots_for(url) if self.respect_robots else None
        if rp is None:
            return None
        d = rp.crawl_delay(self.user_agent)
        return float(d) if d is not None else None

    def _count(self) -> None:
        if self.requests_made >= self.max_requests:
            raise BudgetExceeded(f"request budget of {self.max_requests} used up")
        self.requests_made += 1

    @property
    def remaining(self) -> int:
        return max(0, self.max_requests - self.requests_made)

    # -- fetching ---------------------------------------------------------
    def get(self, url: str, *, accept: str = "text/html") -> requests.Response:
        if not self.allowed(url):
            raise BlockedError(f"disallowed by robots.txt: {url}")
        delay = self.crawl_delay(url)
        if delay and delay > self.min_interval:
            self.min_interval = delay
        host = urlsplit(url).netloc
        attempt = 0
        while True:
            self._count()
            self._wait_for_slot(host)
            try:
                r = self.session.get(url, timeout=self.timeout, headers={"Accept": accept})
            except requests.RequestException as e:
                if attempt >= self.retries:
                    raise FetchError(f"{url}: {e}") from e
                attempt += 1
                self.sleep(self.min_interval * (2**attempt))
                continue
            if looks_like_challenge(r.status_code, r.text, r.headers):
                raise BlockedError(f"{url}: HTTP {r.status_code} bot protection challenge — not bypassing")
            if r.status_code in (401, 403):
                raise BlockedError(f"{url}: HTTP {r.status_code} (login or permission required)")
            if r.status_code == 429 or r.status_code >= 500:
                if attempt >= self.retries:
                    raise FetchError(f"{url}: HTTP {r.status_code}")
                attempt += 1
                retry_after = r.headers.get("Retry-After")
                wait = float(retry_after) if retry_after and retry_after.isdigit() else self.min_interval * (2**attempt) * 2
                self.sleep(min(wait, 120))
                continue
            if r.status_code >= 400:
                raise FetchError(f"{url}: HTTP {r.status_code}")
            return r
