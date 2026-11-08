"""Small parsing helpers shared by adapters."""
from __future__ import annotations

import html
import re
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Optional

_COUNT_RE = re.compile(r"^\s*([0-9][0-9,.\s]*)\s*([KkMmBb]?)\s*$")


def parse_count(text: Optional[str]) -> tuple[Optional[int], bool]:
    """Parse forum counters such as ``"524"``, ``"1,234"``, ``"65K"``, ``"1.2M"``.

    Returns ``(value, exact)``; ``exact`` is False for abbreviated values.
    """
    if text is None:
        return None, True
    t = text.strip().replace(" ", " ")
    if not t or t in ("-", "–", "—"):
        return None, True
    m = _COUNT_RE.match(t)
    if not m:
        return None, True
    num, suffix = m.group(1).replace(" ", ""), m.group(2).upper()
    if suffix:
        num = num.replace(",", "")
        mult = {"K": 1_000, "M": 1_000_000, "B": 1_000_000_000}[suffix]
        try:
            return int(round(float(num) * mult)), False
        except ValueError:
            return None, True
    # No suffix: commas/dots are thousands separators.
    digits = re.sub(r"[^0-9]", "", num)
    return (int(digits), True) if digits else (None, True)


def iso_utc(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def now_iso() -> str:
    return iso_utc(datetime.now(timezone.utc))


def parse_datetime(value: Optional[str]) -> Optional[str]:
    """Normalise ISO-8601, RFC-822 or epoch strings to ISO-8601 UTC."""
    if value is None or value == "":
        return None
    v = str(value).strip()
    if re.fullmatch(r"\d{9,13}", v):
        n = int(v)
        if n > 10**11:  # milliseconds
            n //= 1000
        return iso_utc(datetime.fromtimestamp(n, tz=timezone.utc))
    try:
        # Python's fromisoformat handles "+0000" and "Z" from 3.11 on.
        return iso_utc(datetime.fromisoformat(v.replace("Z", "+00:00")))
    except ValueError:
        pass
    try:
        return iso_utc(parsedate_to_datetime(v))
    except (TypeError, ValueError):
        return None


_WS = re.compile(r"\s+")


def clean_text(text: str) -> str:
    return _WS.sub(" ", html.unescape(text or "")).strip()


def excerpt(text: Optional[str], limit: int = 280) -> Optional[str]:
    """Cut text to a short excerpt on a word boundary."""
    if not text:
        return None
    t = clean_text(text)
    if len(t) <= limit:
        return t or None
    cut = t[:limit]
    if " " in cut[limit // 2 :]:
        cut = cut[: cut.rfind(" ")]
    return cut.rstrip(" ,.;:") + "…"


# Long-running "post your pictures" style megathreads dominate reply-count
# rankings; the UI can hide them. Patterns are matched case-insensitively
# against thread titles. Pinned threads are flagged separately.
MEGATHREAD_PATTERNS = [
    r"\bwhat .{0,30}\b(wearing|wore)\b",
    r"\bwaywt\b",
    r"\bfinds and deals\b",
    r"\bshow us your\b",
    r"\bpost (your|a) (pics?|photos?|pictures?)\b",
    r"\b(pics?|photos?|pictures?) (thread|of the day)\b",
    r"\bgeneral (discussion|chat|thread)\b",
    r"\bofficial .{0,40}\bthread\b",
    r"\baffiliate thread\b",
    r"\bjackets? (are you|you have) (wearing|coming)\b",
    r"\bhow many .{0,40}\bcoming\b",
    r"\bask a question,? get an answer\b",
    r"\bintroduce yourself\b",
    r"\bfresh vintage\b",
    r"\bfashion parade\b",
    r"\bwhat did you (buy|get)\b",
    r"\bcurrent(ly)? (wearing|reading)\b",
    r"\bfit pics?\b",
]
_MEGA_RE = re.compile("|".join(MEGATHREAD_PATTERNS), re.IGNORECASE)


def is_megathread(title: str) -> bool:
    return bool(_MEGA_RE.search(title or ""))
