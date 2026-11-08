"""Data model for indexed threads and posts, plus merge/dedup rules."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field, fields
from typing import Any, Optional


def thread_key(source: str, source_thread_id: str | int) -> str:
    """Stable global id for a thread: ``<source>:<forum's own thread id>``."""
    return f"{source}:{source_thread_id}"


@dataclass
class Thread:
    id: str  # "<source>:<thread id>" — the dedup key
    source: str
    source_thread_id: str
    url: str  # canonical thread URL
    title: str
    category: str = ""
    category_id: str = ""
    author: Optional[str] = None
    created_at: Optional[str] = None  # ISO-8601 UTC
    last_post_at: Optional[str] = None  # ISO-8601 UTC
    replies: Optional[int] = None
    replies_exact: bool = True  # False when the forum only showed "65K"
    views: Optional[int] = None
    views_exact: bool = True
    pinned: bool = False
    locked: bool = False
    megathread: bool = False
    excerpt: Optional[str] = None  # first-post excerpt, short, when available
    first_seen_at: Optional[str] = None
    updated_at: Optional[str] = None  # when the collector last observed it
    seen_via: list[str] = field(default_factory=list)  # e.g. ["rss", "listing", "top"]

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        # Drop empty values to keep the committed JSON compact.
        return {k: v for k, v in d.items() if v not in (None, "", [], False) or k in ("replies_exact", "views_exact")}

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Thread":
        names = {f.name for f in fields(cls)}
        return cls(**{k: v for k, v in d.items() if k in names})


@dataclass
class Post:
    id: str  # "<source>:<post id>"
    source: str
    thread_id: str  # global thread id
    url: str  # permalink to the exact post
    author: Optional[str] = None
    posted_at: Optional[str] = None
    position: Optional[int] = None  # 1 = opening post
    excerpt: str = ""
    page: int = 1

    def to_dict(self) -> dict[str, Any]:
        return {k: v for k, v in asdict(self).items() if v not in (None, "")}

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Post":
        names = {f.name for f in fields(cls)}
        return cls(**{k: v for k, v in d.items() if k in names})


def _merge_count(old: Optional[int], old_exact: bool, new: Optional[int], new_exact: bool) -> tuple[Optional[int], bool]:
    """Merge two observations of a monotonically growing counter.

    * Missing values never erase known ones.
    * An exact value is preferred over an abbreviated one ("65K") when the
      abbreviated value is consistent with it (within rounding).
    * Otherwise the larger value wins: replies/views only grow, and a lower
      number usually comes from a stale cache or rounding.
    """
    if new is None:
        return old, old_exact
    if old is None:
        return new, new_exact
    if old_exact and not new_exact:
        tolerance = max(1, int(new * 0.06))
        if abs(old - new) <= tolerance or old > new:
            return old, True
        return new, False
    if new_exact and not old_exact:
        tolerance = max(1, int(old * 0.06))
        if new >= old - tolerance:
            return new, True
        return old, False
    # Both exact or both abbreviated: the larger (fresher) value wins.
    if new >= old:
        return new, new_exact
    return old, old_exact


def _earliest(a: Optional[str], b: Optional[str]) -> Optional[str]:
    vals = [v for v in (a, b) if v]
    return min(vals) if vals else None


def _latest(a: Optional[str], b: Optional[str]) -> Optional[str]:
    vals = [v for v in (a, b) if v]
    return max(vals) if vals else None


def merge_thread(old: Optional[Thread], new: Thread) -> Thread:
    """Merge a fresh observation into a previously indexed thread.

    Previously indexed data is never dropped: fields only get filled in or
    refreshed. ``first_seen_at`` is preserved.
    """
    if old is None:
        return new
    if old.id != new.id:
        raise ValueError(f"cannot merge different threads {old.id} / {new.id}")
    replies, replies_exact = _merge_count(old.replies, old.replies_exact, new.replies, new.replies_exact)
    views, views_exact = _merge_count(old.views, old.views_exact, new.views, new.views_exact)
    return Thread(
        id=old.id,
        source=old.source,
        source_thread_id=old.source_thread_id,
        url=new.url or old.url,
        title=new.title or old.title,
        category=new.category or old.category,
        category_id=new.category_id or old.category_id,
        author=new.author or old.author,
        created_at=_earliest(old.created_at, new.created_at),
        last_post_at=_latest(old.last_post_at, new.last_post_at),
        replies=replies,
        replies_exact=replies_exact,
        views=views,
        views_exact=views_exact,
        # Pinned/locked state reflects the latest observation when one says so.
        pinned=new.pinned if "listing" in new.seen_via or "api" in new.seen_via else (old.pinned or new.pinned),
        locked=new.locked if "listing" in new.seen_via or "api" in new.seen_via else (old.locked or new.locked),
        megathread=old.megathread or new.megathread,
        excerpt=new.excerpt or old.excerpt,
        first_seen_at=_earliest(old.first_seen_at, new.first_seen_at),
        updated_at=_latest(old.updated_at, new.updated_at),
        seen_via=sorted(set(old.seen_via) | set(new.seen_via)),
    )


def dedupe_threads(threads: list[Thread]) -> list[Thread]:
    """Collapse multiple observations of the same thread (same stable id)."""
    by_id: dict[str, Thread] = {}
    for t in threads:
        by_id[t.id] = merge_thread(by_id.get(t.id), t)
    return list(by_id.values())
