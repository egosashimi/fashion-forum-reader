"""NodeBB adapter (Iron Heart Forum).

NodeBB serves every public page as JSON under ``/api/...`` — the same data
the site's own front end renders, available to guests:

* ``/api/categories``                    category tree with exact topic counts
* ``/api/recent?page=N``                 recently active topics
* ``/api/category/<cid>?page=N&sort=S``  20 topics/page; S = most_posts,
                                         most_views, recently_created, ...
* ``/api/topic/<tid>?page=N``            20 posts/page with permalinks

Counts are exact. ``postcount`` includes the opening post, so
replies = postcount - 1.
"""
from __future__ import annotations

from typing import Any, Optional

from bs4 import BeautifulSoup

from ..models import Post, Thread, thread_key
from ..util import clean_text, excerpt, is_megathread, now_iso, parse_datetime
from .base import Adapter, ListingPage, Node, PostsPage

SORTS = {
    "recent": "recently_replied",
    # Newest-created first. New topics push older ones to later pages, so a
    # forward walk can re-see a topic but never skips one.
    "oldest": "recently_created",
    "replies": "most_posts",
    "views": "most_views",
}


class NodeBBAdapter(Adapter):
    def __init__(self, cfg, client):
        super().__init__(cfg, client)
        self._nodes: Optional[list[Node]] = None
        self.category_totals: dict[str, int] = {}

    # -- categories -------------------------------------------------------
    def parse_categories(self, data: dict[str, Any]) -> list[Node]:
        exclude = {int(x) for x in self.cfg.extra.get("exclude_categories", [])}
        nodes: list[Node] = []

        def walk(cats: list[dict[str, Any]], trail: list[str]) -> None:
            for c in cats:
                cid = int(c["cid"])
                if cid in exclude or c.get("link"):
                    continue
                name = clean_text(c.get("name", ""))
                path = trail + [name]
                if int(c.get("topic_count") or 0) > 0:
                    parent = path[-2] if len(path) > 1 else ""
                    label = name if not parent or name.lower().startswith(parent.lower()) else f"{parent} › {name}"
                    nodes.append(Node(path=str(cid), name=label))
                    self.category_totals[str(cid)] = int(c.get("topic_count") or 0)
                # Top-level "sections" are only headings; don't prefix children with them.
                walk(c.get("children") or [], [] if c.get("isSection") and not c.get("parentCid") else path)

        walk(data.get("categories", []), [])
        return nodes

    def nodes(self) -> list[Node]:
        if self._nodes is None:
            if self.cfg.nodes:
                self._nodes = self.cfg.nodes
            else:
                r = self.client.get(self.abs_url("/api/categories"), accept="application/json")
                self._nodes = self.parse_categories(r.json())
        return self._nodes

    def known_totals(self) -> dict[str, int]:
        return dict(self.category_totals)

    def node_names(self) -> dict[str, str]:
        return {n.path: n.name for n in self._nodes or []}

    def _node_name(self, cid: Any, fallback: str = "") -> str:
        for n in self._nodes or []:
            if n.path == str(cid):
                return n.name
        return clean_text(fallback)

    def _included(self, cid: Any) -> bool:
        if self._nodes is None:
            return True
        return any(n.path == str(cid) for n in self._nodes)

    # -- topics -----------------------------------------------------------
    def topic_to_thread(self, t: dict[str, Any], via: str, seen_at: Optional[str] = None) -> Thread:
        seen_at = seen_at or now_iso()
        tid = str(t["tid"])
        title = clean_text(t.get("titleRaw") or t.get("title") or "")
        cat = t.get("category") or {}
        postcount = t.get("postcount")
        user = t.get("user") or {}
        return Thread(
            id=thread_key(self.cfg.id, tid),
            source=self.cfg.id,
            source_thread_id=tid,
            url=self.abs_url(f"/topic/{t.get('slug') or tid}"),
            title=title,
            category=self._node_name(t.get("cid"), cat.get("name", "")),
            category_id=str(t.get("cid", "")),
            author=user.get("displayname") or user.get("username") or None,
            created_at=parse_datetime(t.get("timestampISO") or t.get("timestamp")),
            last_post_at=parse_datetime(t.get("lastposttimeISO") or t.get("lastposttime")),
            replies=max(0, int(postcount) - 1) if postcount is not None else None,
            replies_exact=True,
            views=int(t["viewcount"]) if t.get("viewcount") is not None else None,
            views_exact=True,
            pinned=bool(t.get("pinned")),
            locked=bool(t.get("locked")),
            megathread=is_megathread(title),
            first_seen_at=seen_at,
            updated_at=seen_at,
            seen_via=[via],
        )

    def parse_topic_list(self, data: dict[str, Any], via: str = "api") -> list[Thread]:
        seen_at = now_iso()
        out = []
        for t in data.get("topics", []):
            if t.get("deleted") or t.get("scheduled"):
                continue
            if not self._included(t.get("cid")):
                continue
            out.append(self.topic_to_thread(t, via, seen_at))
        return out

    def fetch_recent(self) -> list[Thread]:
        self.nodes()
        r = self.client.get(self.abs_url("/api/recent?page=1"), accept="application/json")
        return self.parse_topic_list(r.json(), via="api")

    def fetch_listing(self, node: Node, page: int, order: str) -> ListingPage:
        self.nodes()
        url = self.abs_url(f"/api/category/{node.path}?page={max(1, page)}&sort={SORTS[order]}")
        r = self.client.get(url, accept="application/json")
        return self.parse_listing(r.json(), page)

    def parse_listing(self, data: dict[str, Any], page: int) -> ListingPage:
        pag = data.get("pagination") or {}
        page_count = pag.get("pageCount")
        current = pag.get("currentPage", page)
        threads = [] if (page_count and page > page_count) or current < page else self.parse_topic_list(data, via="api")
        total = data.get("topic_count")
        return ListingPage(threads=threads, page=page, page_count=page_count, total_items=int(total) if total is not None else None)

    # -- posts ------------------------------------------------------------
    def fetch_posts(self, thread: Thread, page: int) -> PostsPage:
        url = self.abs_url(f"/api/topic/{thread.source_thread_id}?page={max(1, page)}")
        r = self.client.get(url, accept="application/json")
        return self.parse_topic(r.json(), thread, page)

    def parse_topic(self, data: dict[str, Any], thread: Thread, page: int) -> PostsPage:
        pag = data.get("pagination") or {}
        page_count = pag.get("pageCount")
        if page_count and page > page_count:
            return PostsPage(posts=[], page=page, page_count=page_count)
        posts = []
        for p in data.get("posts", []):
            if p.get("deleted"):
                continue
            text = BeautifulSoup(p.get("content") or "", "html.parser")
            for q in text.select("blockquote"):
                q.decompose()
            user = p.get("user") or {}
            idx = p.get("index")
            posts.append(
                Post(
                    id=f"{self.cfg.id}:{p['pid']}",
                    source=self.cfg.id,
                    thread_id=thread.id,
                    url=self.abs_url(f"/post/{p['pid']}"),
                    author=user.get("displayname") or user.get("username") or None,
                    posted_at=parse_datetime(p.get("timestampISO") or p.get("timestamp")),
                    position=int(idx) + 1 if isinstance(idx, int) else None,
                    excerpt=excerpt(text.get_text(" "), self.cfg.excerpt_chars) or "",
                    page=page,
                )
            )
        refreshed = None
        if data.get("tid"):
            meta = dict(data)
            meta.setdefault("category", data.get("category") or {})
            refreshed = self.topic_to_thread(meta, via="api")
            if posts and posts[0].position == 1 and not refreshed.excerpt:
                refreshed.excerpt = posts[0].excerpt or None
        return PostsPage(posts=posts, page=page, page_count=page_count, thread=refreshed)
