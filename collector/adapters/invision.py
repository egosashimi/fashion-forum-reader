"""Invision Community (IPS 4.x) adapter (Superfuture / Superdenim).

Public, unauthenticated access only:

* forum RSS          ``/forum/<id>-<slug>/?rss=1`` (topic start dates, excerpts)
* forum listings     ``/forum/<id>-<slug>/page/N/?sortby=...`` with start date,
                     last post date, replies and (abbreviated) views
* topic pages        ``/topic/<id>-<slug>/page/N/`` with 30 posts per page

Access notes (checked 2026-11-08): the site says it is "currently free to
view for guests". From 1 February 2026, full access to *all* sections
requires a paid supermember account. Only pages served to an anonymous guest
are indexed. The site sits behind Cloudflare, which sometimes answers
automated clients with a JavaScript challenge; ``PoliteClient`` treats that
as ``BlockedError`` and the source is reported as *blocked* for that run.
It is never solved or worked around.
"""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from typing import Optional

from bs4 import BeautifulSoup

from ..models import Post, Thread, thread_key
from ..util import clean_text, excerpt, is_megathread, now_iso, parse_count, parse_datetime
from .base import Adapter, ListingPage, Node, PostsPage

ORDER_PARAMS = {
    "recent": "",
    "oldest": "?sortby=start_date&sortdirection=asc",
    "replies": "?sortby=posts&sortdirection=desc",
    "views": "?sortby=views&sortdirection=desc",
}

_TOPIC_RE = re.compile(r"/topic/(\d+)(-[^/?#]*)?")


def topic_id(url: str) -> Optional[str]:
    m = _TOPIC_RE.search(url)
    return m.group(1) if m else None


class InvisionAdapter(Adapter):
    per_page = 30
    def feed_url(self, node: Node) -> str:
        # IPS exposes a forum's topic feed by appending ?rss=1 to its URL.
        return self.abs_url(f"/forum/{node.path}/?rss=1")

    def parse_feed(self, xml_text: str, node: Node) -> list[Thread]:
        root = ET.fromstring(xml_text.encode("utf-8"))
        out = []
        seen_at = now_iso()
        for item in root.iter("item"):
            link = (item.findtext("link") or "").strip()
            tid = topic_id(link)
            if not tid:
                continue
            title = clean_text(item.findtext("title") or "")
            desc = BeautifulSoup(item.findtext("description") or "", "html.parser").get_text(" ")
            out.append(
                Thread(
                    id=thread_key(self.cfg.id, tid),
                    source=self.cfg.id,
                    source_thread_id=tid,
                    url=self.abs_url(f"/topic/{tid}{_TOPIC_RE.search(link).group(2) or ''}/"),
                    title=title,
                    category=node.name,
                    category_id=node.path,
                    # IPS topic feeds use the topic start date as pubDate.
                    created_at=parse_datetime(item.findtext("pubDate")),
                    megathread=is_megathread(title),
                    excerpt=excerpt(desc, self.cfg.excerpt_chars),
                    first_seen_at=seen_at,
                    updated_at=seen_at,
                    seen_via=["rss"],
                )
            )
        return out

    def fetch_recent(self) -> list[Thread]:
        out: list[Thread] = []
        for node in self.cfg.nodes:
            r = self.client.get(self.feed_url(node), accept="application/rss+xml, application/xml")
            out.extend(self.parse_feed(r.text, node))
            out.extend(self.fetch_listing(node, 1, "recent").threads)
        return out

    def listing_url(self, node: Node, page: int, order: str) -> str:
        suffix = "" if page <= 1 else f"page/{page}/"
        return self.abs_url(f"/forum/{node.path}/{suffix}{ORDER_PARAMS[order]}")

    def fetch_listing(self, node: Node, page: int, order: str) -> ListingPage:
        r = self.client.get(self.listing_url(node, page, order))
        return self.parse_listing(r.text, node, page)

    def parse_listing(self, html: str, node: Node, requested_page: int = 1) -> ListingPage:
        soup = BeautifulSoup(html, "html.parser")
        page_count = None
        pages = soup.select_one("[data-pages]")
        if pages and str(pages.get("data-pages", "")).isdigit():
            page_count = int(pages["data-pages"])
        if page_count and requested_page > page_count:
            return ListingPage(threads=[], page=requested_page, page_count=page_count)
        seen_at = now_iso()
        out = []
        for row in soup.select("li.ipsDataItem[data-rowid]"):
            a = row.select_one(".ipsDataItem_title a[href*='/topic/']")
            if not a:
                continue
            tid = topic_id(a["href"])
            if not tid:
                continue
            stats: dict[str, tuple[Optional[int], bool]] = {}
            for li in row.select(".ipsDataItem_stats li"):
                num = li.select_one(".ipsDataItem_stats_number")
                typ = li.select_one(".ipsDataItem_stats_type")
                if num and typ:
                    kind = typ.get_text(strip=True).lower()
                    key = "reply" if kind.startswith("repl") else "view" if kind.startswith("view") else kind
                    stats[key] = parse_count(num.get_text(strip=True))
            start = row.select_one(".ipsDataItem_meta time")
            last = row.select_one(".ipsDataItem_lastPoster time")
            author = row.select_one(".ipsDataItem_meta a[href*='/profile/']")
            title = clean_text(a.get_text(" "))
            replies, rex = stats.get("reply", (None, True))
            views, vex = stats.get("view", (None, True))
            out.append(
                Thread(
                    id=thread_key(self.cfg.id, tid),
                    source=self.cfg.id,
                    source_thread_id=tid,
                    url=a["href"].split("?")[0],
                    title=title,
                    category=node.name,
                    category_id=node.path,
                    author=clean_text(author.get_text()) if author else None,
                    created_at=parse_datetime(start.get("datetime")) if start else None,
                    last_post_at=parse_datetime(last.get("datetime")) if last else None,
                    replies=replies,
                    replies_exact=rex,
                    views=views,
                    views_exact=vex,
                    pinned=bool(row.select_one("[title='Pinned'], .fa-thumb-tack")),
                    locked=bool(row.select_one("[title='Locked'], .fa-lock")),
                    megathread=is_megathread(title),
                    first_seen_at=seen_at,
                    updated_at=seen_at,
                    seen_via=["listing"],
                )
            )
        return ListingPage(threads=out, page=requested_page, page_count=page_count)

    def fetch_posts(self, thread: Thread, page: int) -> PostsPage:
        base = thread.url.rstrip("/") + "/"
        url = base if page <= 1 else f"{base}page/{page}/"
        r = self.client.get(url)
        return self.parse_topic_page(r.text, thread, page)

    def parse_topic_page(self, html: str, thread: Thread, page: int) -> PostsPage:
        soup = BeautifulSoup(html, "html.parser")
        pag = soup.select_one("[data-pages]")
        page_count = int(pag["data-pages"]) if pag and str(pag.get("data-pages", "")).isdigit() else 1
        per_page = int(pag.get("data-ipspagination-perpage", 30)) if pag else 30
        if page > page_count:
            return PostsPage(posts=[], page=page, page_count=page_count)
        posts: list[Post] = []
        for i, art in enumerate(soup.select("article[id^=elComment_]")):
            cid = art["id"].split("_", 1)[1]
            if not cid.isdigit():
                continue
            author = art.select_one("aside .cAuthorPane_author a") or art.select_one(".cAuthorPane_author a")
            t = art.select_one(".ipsComment_meta time") or art.select_one("time[datetime]")
            body = art.select_one("[data-role=commentContent]")
            text = ""
            if body is not None:
                for q in body.select("blockquote, script, style"):
                    q.decompose()
                text = body.get_text(" ")
            posts.append(Post(
                id=f"{self.cfg.id}:{cid}",
                source=self.cfg.id,
                thread_id=thread.id,
                url=f"{thread.url.rstrip('/')}/?do=findComment&comment={cid}",
                author=clean_text(author.get_text()) if author else None,
                posted_at=parse_datetime(t.get("datetime")) if t else None,
                position=(page - 1) * per_page + i + 1,
                excerpt=excerpt(text, self.cfg.excerpt_chars) or "",
                page=page,
            ))
        return PostsPage(posts=posts, page=page, page_count=page_count)
