"""Adapter interface. One adapter per forum *software*; configured per source."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional

from ..http import PoliteClient
from ..models import Post, Thread


@dataclass
class Node:
    """A forum section ("node", "forum", "category") to index."""

    path: str  # adapter-specific identifier, e.g. "outerwear-and-workwear.4"
    name: str


@dataclass
class SourceConfig:
    id: str
    name: str
    short: str
    adapter: str
    base_url: str
    homepage: str
    color: str = "#666666"
    nodes: list[Node] = field(default_factory=list)
    notes: str = ""
    user_agent: str = "VintageForumReader/0.1"
    min_interval: float = 3.0
    max_requests: int = 60
    timeout: float = 30.0
    backfill_pages: int = 12
    top_pages: int = 3
    top_refresh_hours: float = 72
    posts_pages_per_run: int = 6
    excerpt_chars: int = 280
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass
class ListingPage:
    threads: list[Thread]
    page: int
    page_count: Optional[int]  # total pages in this listing, if known
    total_items: Optional[int] = None  # exact total, if the source reports it


@dataclass
class PostsPage:
    posts: list[Post]
    page: int
    page_count: Optional[int]
    thread: Optional[Thread] = None  # refreshed thread metadata, if available


class Adapter:
    """Base class. Subclasses implement the fetch_* methods.

    Every method performs a bounded number of HTTP requests through the shared
    PoliteClient, which enforces rate limits and the per-run budget.
    """

    #: metrics the forum can sort listings by server-side, for leaderboards
    top_metrics: tuple[str, ...] = ("replies", "views")
    #: threads per listing page, used to estimate section sizes from page counts
    per_page: int = 20

    def __init__(self, cfg: SourceConfig, client: PoliteClient):
        self.cfg = cfg
        self.client = client

    # Units of work the pipeline iterates over. Defaults to configured nodes.
    def nodes(self) -> list[Node]:
        return self.cfg.nodes

    def known_totals(self) -> dict[str, int]:
        """Exact thread counts per section, when the forum reports them."""
        return {}

    def node_names(self) -> dict[str, str]:
        return {n.path: n.name for n in self.cfg.nodes}

    def fetch_recent(self) -> list[Thread]:
        """Recently active threads (feeds and/or first listing page)."""
        raise NotImplementedError

    def fetch_listing(self, node: Node, page: int, order: str) -> ListingPage:
        """One page of a section listing. ``order`` is one of
        ``"oldest"`` (stable, for backfill), ``"replies"``, ``"views"``, ``"recent"``."""
        raise NotImplementedError

    def fetch_posts(self, thread: Thread, page: int) -> PostsPage:
        """One page of posts in a thread (short excerpts only)."""
        raise NotImplementedError

    def abs_url(self, path: str) -> str:
        if path.startswith("http://") or path.startswith("https://"):
            return path
        return self.cfg.base_url.rstrip("/") + "/" + path.lstrip("/")
