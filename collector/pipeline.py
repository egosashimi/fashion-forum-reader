"""One collector run for one source: recent → top lists → backfill → posts.

Every phase draws from the same per-run request budget. When the budget is
used up the run stops cleanly, and the cursors in ``data/state`` let the
next run pick up where this one stopped. A failing source never affects the
others.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Optional

from .adapters import ADAPTERS, Adapter, ListingPage, Node, SourceConfig
from .http import BlockedError, BudgetExceeded, FetchError, PoliteClient
from .models import Post, Thread, merge_thread
from .store import Store
from .util import now_iso

log = logging.getLogger(__name__)

BACKFILL_RECYCLE_DAYS = 30
MAX_POST_PAGES_PER_THREAD = 3
POST_CANDIDATES_TOP = 25
POST_CANDIDATES_RECENT = 25


@dataclass
class RunResult:
    source: str
    status: str = "ok"  # ok | partial | error | blocked
    new_threads: int = 0
    updated_threads: int = 0
    new_posts: int = 0
    requests: int = 0
    errors: list[str] = field(default_factory=list)


def _parse_iso(v: Optional[str]) -> Optional[datetime]:
    if not v:
        return None
    return datetime.fromisoformat(v.replace("Z", "+00:00"))


def _hours_since(v: Optional[str], now: datetime) -> float:
    dt = _parse_iso(v)
    return float("inf") if dt is None else (now - dt).total_seconds() / 3600


class SourceRun:
    def __init__(self, cfg: SourceConfig, store: Store, client: Optional[PoliteClient] = None,
                 adapter_factory: Optional[Callable[[SourceConfig, PoliteClient], Adapter]] = None,
                 now: Optional[datetime] = None):
        self.cfg = cfg
        self.store = store
        self.client = client or PoliteClient(
            user_agent=cfg.user_agent, min_interval=cfg.min_interval,
            max_requests=cfg.max_requests, timeout=cfg.timeout,
        )
        factory = adapter_factory or ADAPTERS[cfg.adapter]
        self.adapter = factory(cfg, self.client)
        self.now = now or datetime.now(timezone.utc)
        self.state: dict[str, Any] = store.load_state(cfg.id)
        self.threads: dict[str, Thread] = store.load_threads(cfg.id)
        self.posts: dict[str, Post] = store.load_posts(cfg.id)
        self.result = RunResult(source=cfg.id)

    # -- helpers --------------------------------------------------------------
    def absorb(self, threads: list[Thread], via: Optional[str] = None) -> None:
        for t in threads:
            if via and via not in t.seen_via:
                t.seen_via = t.seen_via + [via]
            old = self.threads.get(t.id)
            if old is None:
                self.result.new_threads += 1
            else:
                self.result.updated_threads += 1
            self.threads[t.id] = merge_thread(old, t)

    def node_state(self, node: Node) -> dict[str, Any]:
        nodes = self.state.setdefault("nodes", {})
        ns = nodes.setdefault(node.path, {})
        ns["name"] = node.name
        return ns

    def note_listing(self, node: Node, page: ListingPage) -> None:
        per_page = self.adapter.per_page
        ns = self.node_state(node)
        if page.page_count:
            ns["pages"] = page.page_count
        if page.total_items is not None:
            ns["estimated_threads"] = page.total_items
            ns["estimate_exact"] = True
        elif page.page_count:
            # Last page may be partly filled; estimate from full pages.
            ns["estimated_threads"] = page.page_count * per_page
            ns["estimate_exact"] = False

    # -- phases ---------------------------------------------------------------
    def phase_recent(self) -> None:
        recent = self.adapter.fetch_recent()
        self.absorb(recent)
        self.state["recent_refreshed_at"] = now_iso()

    def phase_top(self) -> None:
        top = self.state.setdefault("top", {})
        cursor = int(top.get("cursor", 0))
        if cursor == 0 and _hours_since(top.get("refreshed_at"), self.now) < self.cfg.top_refresh_hours:
            return
        tasks = [(n, metric, p) for n in self.adapter.nodes() for metric in self.adapter.top_metrics
                 for p in range(1, self.cfg.top_pages + 1)]
        fetched = 0
        cap = int(self.cfg.extra.get("top_requests_per_run", 12))
        while cursor < len(tasks):
            if fetched >= cap:
                return  # resume from the cursor next run
            node, metric, page = tasks[cursor]
            if self._top_task_redundant(node, page):
                cursor += 1
                top["cursor"] = cursor
                continue
            listing = self.adapter.fetch_listing(node, page, metric)
            fetched += 1
            self.note_listing(node, listing)
            self.absorb(listing.threads, via="top")
            cursor += 1
            top["cursor"] = cursor
        top["cursor"] = 0
        top["refreshed_at"] = now_iso()

    def _top_task_redundant(self, node: Node, page: int) -> bool:
        """Skip sorted pages that cannot exist, and whole sections whose every
        thread the backfill has already seen (their counts come from there)."""
        ns = self.state.get("nodes", {}).get(node.path, {})
        known_pages = ns.get("pages")
        if known_pages is not None and page > int(known_pages):
            return True
        if ns.get("backfill_done") and known_pages is not None and int(known_pages) <= self.cfg.top_pages \
                and _hours_since(ns.get("backfill_done_at"), self.now) < self.cfg.top_refresh_hours:
            return True
        return False

    def phase_backfill(self) -> None:
        bf = self.state.setdefault("backfill", {"node_index": 0, "page": 1, "cycle": 1})
        if bf.get("complete"):
            if _hours_since(bf.get("completed_at"), self.now) < BACKFILL_RECYCLE_DAYS * 24:
                return
            # Start another pass to refresh reply/view counts of old threads.
            bf.update({"complete": False, "node_index": 0, "page": 1, "cycle": int(bf.get("cycle", 1)) + 1})
        bf.setdefault("started_at", now_iso())
        nodes = self.adapter.nodes()
        pages_this_run = 0
        while pages_this_run < self.cfg.backfill_pages:
            idx = int(bf.get("node_index", 0))
            if idx >= len(nodes):
                bf["complete"] = True
                bf["completed_at"] = now_iso()
                return
            node = nodes[idx]
            page = int(bf.get("page", 1))
            listing = self.adapter.fetch_listing(node, page, "oldest")
            pages_this_run += 1
            self.note_listing(node, listing)
            self.absorb(listing.threads, via="backfill")
            bf["pages_walked"] = int(bf.get("pages_walked", 0)) + 1
            ns = self.node_state(node)
            ns["backfill_page"] = page
            last = listing.page_count
            if not listing.threads or (last is not None and page >= last):
                ns["backfill_done"] = True
                ns["backfill_done_at"] = now_iso()
                bf["node_index"] = idx + 1
                bf["page"] = 1
                if idx + 1 >= len(nodes):
                    bf["complete"] = True
                    bf["completed_at"] = now_iso()
                    return
            else:
                bf["page"] = page + 1

    def post_candidates(self) -> list[Thread]:
        pstate = self.state.setdefault("posts", {})
        by_replies = sorted(self.threads.values(), key=lambda t: t.replies or 0, reverse=True)[:POST_CANDIDATES_TOP]
        by_recent = sorted(self.threads.values(), key=lambda t: t.last_post_at or "", reverse=True)[:POST_CANDIDATES_RECENT]
        out, seen = [], set()
        # Interleave so both lists make progress under a small budget.
        for pair in zip(by_recent, by_replies):
            for t in pair:
                if t.id in seen:
                    continue
                seen.add(t.id)
                ps = pstate.get(t.id, {})
                if self._next_post_page(t, ps) is not None:
                    out.append(t)
        return out

    @staticmethod
    def _next_post_page(t: Thread, ps: dict[str, Any]) -> Optional[int]:
        fetched = set(ps.get("pages", []))
        page_count = ps.get("page_count")
        limit = MAX_POST_PAGES_PER_THREAD if page_count is None else min(page_count, MAX_POST_PAGES_PER_THREAD)
        for p in range(1, limit + 1):
            if p not in fetched:
                return p
        return None

    def phase_posts(self) -> None:
        pstate = self.state.setdefault("posts", {})
        budget = self.cfg.posts_pages_per_run
        for t in self.post_candidates():
            if budget <= 0:
                return
            ps = pstate.setdefault(t.id, {})
            page = self._next_post_page(t, ps)
            if page is None:
                continue
            result = self.adapter.fetch_posts(t, page)
            budget -= 1
            ps["pages"] = sorted(set(ps.get("pages", [])) | {page})
            if result.page_count:
                ps["page_count"] = result.page_count
            elif not result.posts:
                ps["page_count"] = max(ps["pages"]) if ps["pages"] else 0
            ps["fetched_at"] = now_iso()
            for p in result.posts:
                if p.id not in self.posts:
                    self.result.new_posts += 1
                self.posts[p.id] = p
            if result.thread is not None:
                result.thread.category = result.thread.category or t.category
                self.absorb([result.thread])
            # Opening post gives XenForo threads their excerpt and author.
            first = next((p for p in result.posts if p.position == 1), None)
            if first and self.threads.get(t.id) and not self.threads[t.id].excerpt:
                self.threads[t.id].excerpt = first.excerpt or None

    # -- orchestration ---------------------------------------------------------
    def run(self, phases: tuple[str, ...] = ("recent", "top", "backfill", "posts")) -> RunResult:
        self.state["last_attempt_at"] = now_iso()
        stopped = False
        for name in phases:
            if stopped:
                break
            try:
                getattr(self, f"phase_{name}")()
            except BudgetExceeded:
                log.info("[%s] request budget used up during %s", self.cfg.id, name)
                stopped = True
            except BlockedError as e:
                log.warning("[%s] blocked: %s", self.cfg.id, e)
                self.result.status = "blocked"
                self.result.errors.append(str(e))
                stopped = True
            except FetchError as e:
                log.warning("[%s] %s failed: %s", self.cfg.id, name, e)
                self.result.errors.append(f"{name}: {e}")
            except Exception as e:  # parsing bugs must not take down other sources
                log.exception("[%s] %s crashed", self.cfg.id, name)
                self.result.errors.append(f"{name}: {type(e).__name__}: {e}")
        # Exact section sizes (e.g. NodeBB's category topic counts) beat page-based estimates.
        nodes_state = self.state.setdefault("nodes", {})
        for path, total in self.adapter.known_totals().items():
            ns = nodes_state.setdefault(path, {})
            ns["estimated_threads"] = total
            ns["estimate_exact"] = True
            ns.setdefault("name", self.adapter.node_names().get(path, path))
        self.result.requests = self.client.requests_made
        if self.result.status != "blocked" and self.result.errors:
            self.result.status = "error" if not (self.result.new_threads or self.result.updated_threads) else "partial"
        self.state["status"] = self.result.status
        self.state["last_error"] = "; ".join(self.result.errors)[:1000] if self.result.errors else None
        if self.result.status in ("ok", "partial"):
            self.state["last_success_at"] = now_iso()
        self.state["last_run"] = {
            "at": now_iso(), "requests": self.result.requests, "new_threads": self.result.new_threads,
            "updated_threads": self.result.updated_threads, "new_posts": self.result.new_posts,
        }
        self.store.save_threads(self.cfg.id, self.threads)
        self.store.save_posts(self.cfg.id, self.posts)
        self.store.save_state(self.cfg.id, self.state)
        return self.result
