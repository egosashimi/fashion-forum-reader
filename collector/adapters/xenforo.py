"""XenForo 2.x adapter (The Fedora Lounge, Vintage Fashion Guild, VLJ forum).

Access methods, all public and unauthenticated:

* RSS 2.0 feeds  ``/forums/<node>/index.rss`` and ``/forums/-/index.rss``:
  exact reply counts (``slash:comments``), author, last activity, short
  first-post text.
* Section listings ``/forums/<node>/page-N``: 20 threads per page with start
  date, last post date, replies, views and sticky state. XenForo supports
  server-side ordering (``?order=reply_count|view_count|post_date``), which
  gives true per-section leaderboards in a handful of requests and a stable
  oldest-first order for the resumable historical backfill.
* Thread pages ``/threads/<slug>.<id>/page-N``: individual posts with
  permalinks; only short excerpts are stored.
"""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from typing import Optional
from urllib.parse import urlsplit

from bs4 import BeautifulSoup, Tag

from ..models import Post, Thread, thread_key
from ..util import clean_text, excerpt, is_megathread, now_iso, parse_count, parse_datetime
from .base import Adapter, ListingPage, Node, PostsPage

NS = {
    "dc": "http://purl.org/dc/elements/1.1/",
    "content": "http://purl.org/rss/1.0/modules/content/",
    "slash": "http://purl.org/rss/1.0/modules/slash/",
}

ORDER_PARAMS = {
    "recent": "",
    "oldest": "?order=post_date&direction=asc",
    "replies": "?order=reply_count&direction=desc",
    "views": "?order=view_count&direction=desc",
}

_THREAD_ID_RE = re.compile(r"/threads/(?:[^/]*\.)?(\d+)/?")
_POST_ID_RE = re.compile(r"post-(\d+)")


def thread_id_from_url(url: str) -> Optional[str]:
    m = _THREAD_ID_RE.search(urlsplit(url).path)
    return m.group(1) if m else None


def canonical_thread_url(base_url: str, href: str) -> str:
    """Strip page/post suffixes: ``/threads/x.123/page-4`` -> ``/threads/x.123/``."""
    path = urlsplit(href).path
    m = re.match(r"(/threads/[^/]+/)", path)
    path = m.group(1) if m else path
    return base_url.rstrip("/") + path


class XenForoAdapter(Adapter):
    # -- feeds ------------------------------------------------------------
    def feed_urls(self) -> list[str]:
        if len(self.cfg.nodes) == 1:
            return [self.abs_url(f"/forums/{self.cfg.nodes[0].path}/index.rss")]
        return [self.abs_url("/forums/-/index.rss")]

    def node_for_category_url(self, url: str) -> Optional[Node]:
        for n in self.cfg.nodes:
            if f"/forums/{n.path}/" in url:
                return n
        return None

    def parse_feed(self, xml_text: str) -> list[Thread]:
        root = ET.fromstring(xml_text.encode("utf-8") if isinstance(xml_text, str) else xml_text)
        out: list[Thread] = []
        seen_at = now_iso()
        for item in root.iter("item"):
            link = (item.findtext("link") or "").strip()
            tid = (item.findtext("guid") or "").strip() or thread_id_from_url(link)
            if not tid or not tid.isdigit():
                tid = thread_id_from_url(link)
            if not tid:
                continue
            cat_el = item.find("category")
            cat_url = cat_el.get("domain", "") if cat_el is not None else ""
            node = self.node_for_category_url(cat_url)
            if node is None:
                continue  # not one of the configured (public) sections
            body_html = item.findtext("content:encoded", default="", namespaces=NS)
            body = BeautifulSoup(body_html, "html.parser")
            for q in body.select("blockquote, .bbCodeBlock--quote"):
                q.decompose()
            replies_txt = item.findtext("slash:comments", default=None, namespaces=NS)
            title = clean_text(item.findtext("title") or "")
            out.append(
                Thread(
                    id=thread_key(self.cfg.id, tid),
                    source=self.cfg.id,
                    source_thread_id=tid,
                    url=canonical_thread_url(self.cfg.base_url, link),
                    title=title,
                    category=node.name,
                    category_id=node.path,
                    author=(item.findtext("dc:creator", default=None, namespaces=NS) or None),
                    last_post_at=parse_datetime(item.findtext("pubDate")),
                    replies=int(replies_txt) if replies_txt and replies_txt.strip().isdigit() else None,
                    replies_exact=True,
                    megathread=is_megathread(title),
                    excerpt=excerpt(body.get_text(" "), self.cfg.excerpt_chars),
                    first_seen_at=seen_at,
                    updated_at=seen_at,
                    seen_via=["rss"],
                )
            )
        return out

    def fetch_recent(self) -> list[Thread]:
        threads: list[Thread] = []
        for url in self.feed_urls():
            r = self.client.get(url, accept="application/rss+xml, application/xml")
            threads.extend(self.parse_feed(r.text))
        for node in self.cfg.nodes:
            threads.extend(self.fetch_listing(node, 1, "recent").threads)
        return threads

    # -- listings ---------------------------------------------------------
    def listing_url(self, node: Node, page: int, order: str) -> str:
        suffix = "" if page <= 1 else f"page-{page}"
        return self.abs_url(f"/forums/{node.path}/{suffix}{ORDER_PARAMS[order]}")

    def fetch_listing(self, node: Node, page: int, order: str) -> ListingPage:
        r = self.client.get(self.listing_url(node, page, order))
        return self.parse_listing(r.text, node, requested_page=page)

    @staticmethod
    def _page_nav(soup: BeautifulSoup) -> tuple[Optional[int], Optional[int]]:
        nav = soup.select_one(".pageNav")
        if nav is None:
            return 1, 1
        current = nav.select_one(".pageNav-page--current")
        nums = [int(a.get_text(strip=True)) for a in nav.select(".pageNav-page a") if a.get_text(strip=True).isdigit()]
        cur = int(current.get_text(strip=True)) if current and current.get_text(strip=True).isdigit() else None
        return cur, (max(nums) if nums else cur)

    def parse_listing(self, html: str, node: Node, requested_page: int = 1) -> ListingPage:
        soup = BeautifulSoup(html, "html.parser")
        current, page_count = self._page_nav(soup)
        if current is not None and current < requested_page:
            # XenForo redirects past-the-end pages to the last page.
            return ListingPage(threads=[], page=requested_page, page_count=page_count)
        seen_at = now_iso()
        out: list[Thread] = []
        for row in soup.select(".structItem--thread"):
            t = self._parse_row(row, node, seen_at)
            if t:
                out.append(t)
        return ListingPage(threads=out, page=current or requested_page, page_count=page_count)

    def _parse_row(self, row: Tag, node: Node, seen_at: str) -> Optional[Thread]:
        link = row.select_one(".structItem-title a[data-tp-primary]") or row.select_one(".structItem-title a[href*='/threads/']")
        if link is None:
            return None
        href = link.get("href", "")
        tid = thread_id_from_url(href)
        if not tid:
            return None
        title = clean_text(link.get_text(" "))
        stats: dict[str, tuple[Optional[int], bool]] = {}
        for dl in row.select(".structItem-cell--meta dl"):
            dt, dd = dl.find("dt"), dl.find("dd")
            if dt and dd:
                stats[dt.get_text(strip=True).lower()] = parse_count(dd.get_text(strip=True))
        start = row.select_one(".structItem-startDate time")
        latest = row.select_one("time.structItem-latestDate") or row.select_one(".structItem-cell--latest time")
        author = row.get("data-author") or None
        in_sticky_group = any("structItemContainer-group--sticky" in (p.get("class") or []) for p in row.parents if isinstance(p, Tag))
        pinned = bool(row.select_one(".structItem-status--sticky")) or in_sticky_group
        locked = bool(row.select_one(".structItem-status--locked"))
        replies, replies_exact = stats.get("replies", (None, True))
        views, views_exact = stats.get("views", (None, True))
        return Thread(
            id=thread_key(self.cfg.id, tid),
            source=self.cfg.id,
            source_thread_id=tid,
            url=canonical_thread_url(self.cfg.base_url, href),
            title=title,
            category=node.name,
            category_id=node.path,
            author=author,
            created_at=parse_datetime(start.get("datetime")) if start else None,
            last_post_at=parse_datetime(latest.get("datetime")) if latest else None,
            replies=replies,
            replies_exact=replies_exact,
            views=views,
            views_exact=views_exact,
            pinned=pinned,
            locked=locked,
            megathread=is_megathread(title),
            first_seen_at=seen_at,
            updated_at=seen_at,
            seen_via=["listing"],
        )

    # -- posts ------------------------------------------------------------
    def fetch_posts(self, thread: Thread, page: int) -> PostsPage:
        url = thread.url if page <= 1 else thread.url.rstrip("/") + f"/page-{page}"
        r = self.client.get(url)
        return self.parse_thread_page(r.text, thread, page)

    def parse_thread_page(self, html: str, thread: Thread, page: int) -> PostsPage:
        soup = BeautifulSoup(html, "html.parser")
        current, page_count = self._page_nav(soup)
        if current is not None and current < page:
            return PostsPage(posts=[], page=page, page_count=page_count)
        posts: list[Post] = []
        for art in soup.select("article.message--post"):
            m = _POST_ID_RE.search(art.get("data-content", "") or art.get("id", ""))
            if not m:
                continue
            pid = m.group(1)
            t = art.select_one(".message-attribution-main time") or art.select_one("time.u-dt")
            pos = None
            for a in art.select(".message-attribution-opposite a"):
                txt = a.get_text(strip=True)
                if txt.startswith("#") and txt[1:].replace(",", "").isdigit():
                    pos = int(txt[1:].replace(",", ""))
            body = art.select_one(".message-body .bbWrapper") or art.select_one(".bbWrapper")
            text = ""
            if body is not None:
                for q in body.select("blockquote, .bbCodeBlock--quote, script, style"):
                    q.decompose()
                text = body.get_text(" ")
            posts.append(
                Post(
                    id=f"{self.cfg.id}:{pid}",
                    source=self.cfg.id,
                    thread_id=thread.id,
                    url=thread.url.rstrip("/") + f"/post-{pid}",
                    author=art.get("data-author") or None,
                    posted_at=parse_datetime(t.get("datetime")) if t else None,
                    position=pos,
                    excerpt=excerpt(text, self.cfg.excerpt_chars) or "",
                    page=page,
                )
            )
        return PostsPage(posts=posts, page=current or page, page_count=page_count)
