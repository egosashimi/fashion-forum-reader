"""Turn the master data in ``data/`` into static JSON for the web app.

Output layout (``public/data`` by default; GitHub Pages serves it as-is):

  manifest.json                 sources, status, coverage, chunk lists
  feed.json                     recently active threads (full records)
  leaderboards/all.json         cross-forum top lists
  leaderboards/<source>.json    per-forum and per-category top lists
  index/<source>-<n>.json       compact search index chunks (titles + metadata)
  text/<source>-<n>.json        excerpt text chunks (opening post + indexed posts)
  posts/<source>/<thread>.json  indexed posts of one thread (loaded on demand)

The browser downloads only the manifest and the feed at start-up.
Leaderboards, search chunks and post files are fetched when needed, so page
loads stay small as the archive grows.
"""
from __future__ import annotations

import json
import shutil
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable, Optional

from .adapters.base import SourceConfig
from .models import Post, Thread
from .store import Store
from .util import now_iso

FLAG_PINNED, FLAG_MEGA, FLAG_REPLIES_APPROX, FLAG_VIEWS_APPROX, FLAG_LOCKED = 1, 2, 4, 8, 16
FEED_DAYS = 45
FEED_MAX = 1200
INDEX_CHUNK = 4000
LEADERBOARD_ALL = 100
LEADERBOARD_SOURCE = 100
LEADERBOARD_CATEGORY = 50
WINDOWS = {"all": None, "year": 365, "month": 30, "week": 7}
COMPLETE_COVERAGE = 0.95


def flags(t: Thread) -> int:
    f = 0
    if t.pinned:
        f |= FLAG_PINNED
    if t.megathread:
        f |= FLAG_MEGA
    if t.replies is not None and not t.replies_exact:
        f |= FLAG_REPLIES_APPROX
    if t.views is not None and not t.views_exact:
        f |= FLAG_VIEWS_APPROX
    if t.locked:
        f |= FLAG_LOCKED
    return f


def record(t: Thread, post_pages: Optional[int] = None, with_excerpt: bool = True) -> dict[str, Any]:
    r: dict[str, Any] = {"id": t.id, "s": t.source, "t": t.title, "u": t.url, "c": t.category, "ci": t.category_id}
    for key, val in (("a", t.author), ("ca", t.created_at), ("la", t.last_post_at), ("r", t.replies),
                     ("v", t.views), ("e", t.excerpt if with_excerpt else None)):
        if val is not None and val != "":
            r[key] = val
    f = flags(t)
    if f:
        r["f"] = f
    if post_pages:
        r["pp"] = post_pages
    return r


def _write(path: Path, data: Any) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    path.write_text(text, encoding="utf-8")
    return len(text.encode("utf-8"))


def _date(iso: Optional[str]) -> Optional[str]:
    return iso[:10] if iso else None


def top_ids(threads: Iterable[Thread], metric: str, limit: int, since: Optional[str], clean: bool) -> list[str]:
    def val(t: Thread) -> Optional[int]:
        return t.replies if metric == "replies" else t.views

    pool = []
    for t in threads:
        v = val(t)
        if v is None:
            continue
        if since and (not t.created_at or t.created_at < since):
            continue
        if clean and (t.pinned or t.megathread):
            continue
        pool.append(t)
    pool.sort(key=lambda t: (val(t) or 0, t.last_post_at or ""), reverse=True)
    return [t.id for t in pool[:limit]]


def leaderboard_lists(threads: list[Thread], limit: int, now: datetime, prefix: str = "") -> dict[str, list[str]]:
    lists: dict[str, list[str]] = {}
    for metric in ("replies", "views"):
        for win, days in WINDOWS.items():
            since = (now - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ") if days else None
            for mode in ("any", "clean"):
                ids = top_ids(threads, metric, limit, since, mode == "clean")
                if ids:
                    lists[f"{prefix}{metric}:{win}:{mode}"] = ids
    return lists


def source_coverage(cfg: SourceConfig, state: dict[str, Any], threads: dict[str, Thread]) -> dict[str, Any]:
    per_cat: dict[str, int] = defaultdict(int)
    cat_names: dict[str, str] = {}
    for t in threads.values():
        per_cat[t.category_id] += 1
        cat_names.setdefault(t.category_id, t.category)
    nodes_state = state.get("nodes", {})
    order = [n.path for n in cfg.nodes] + [k for k in nodes_state if k not in {n.path for n in cfg.nodes}]
    order += [k for k in per_cat if k not in order]
    categories = []
    est_total = 0
    all_done = bool(order)
    for cid in order:
        ns = nodes_state.get(cid, {})
        indexed = per_cat.get(cid, 0)
        name = ns.get("name") or cat_names.get(cid) or next((n.name for n in cfg.nodes if n.path == cid), cid)
        done = bool(ns.get("backfill_done"))
        est = max(int(ns.get("estimated_threads") or 0), indexed)
        if done and not ns.get("estimate_exact"):
            # A finished walk is a better count than "pages x 20".
            est = indexed
        if not done and (ns or cid in {n.path for n in cfg.nodes}):
            all_done = False
        est_total += est
        categories.append({
            "id": cid, "name": name, "indexed": indexed, "estimated": est,
            "estimateExact": bool(ns.get("estimate_exact")), "backfillDone": done,
        })
    indexed_total = len(threads)
    coverage = (indexed_total / est_total) if est_total else 0.0
    bf = state.get("backfill", {})
    return {
        "categories": categories,
        "indexed": indexed_total,
        "estimated": max(est_total, indexed_total),
        "coverage": round(min(coverage, 1.0), 4),
        "backfillComplete": all_done and bool(bf.get("complete") or bf.get("cycle", 1) > 1),
        "backfillPagesWalked": int(bf.get("pages_walked", 0)),
        "backfillCycle": int(bf.get("cycle", 1)),
        "topRefreshedAt": (state.get("top") or {}).get("refreshed_at"),
    }


def build(sources: list[SourceConfig], store: Store, out_dir: Path, now: Optional[datetime] = None) -> dict[str, Any]:
    now = now or datetime.now(timezone.utc)
    out_dir = Path(out_dir)
    for sub in ("leaderboards", "index", "text", "posts"):
        if (out_dir / sub).exists():
            shutil.rmtree(out_dir / sub)
    out_dir.mkdir(parents=True, exist_ok=True)

    manifest_sources = []
    all_threads: list[Thread] = []
    post_pages_by_thread: dict[str, int] = {}
    index_chunks, text_chunks = [], []
    sizes: dict[str, int] = defaultdict(int)

    for cfg in sources:
        state = store.load_state(cfg.id)
        threads = store.load_threads(cfg.id)
        posts = store.load_posts(cfg.id)
        cov = source_coverage(cfg, state, threads)
        cat_index = {c["id"]: i for i, c in enumerate(cov["categories"])}

        # -- posts per thread
        by_thread: dict[str, list[Post]] = defaultdict(list)
        for p in posts.values():
            by_thread[p.thread_id].append(p)
        pstate = state.get("posts", {})
        for tid, plist in by_thread.items():
            plist.sort(key=lambda p: (p.page, p.position or 0))
            ps = pstate.get(tid, {})
            pages = sorted({p.page for p in plist})
            post_pages_by_thread[tid] = len(pages)
            local = tid.split(":", 1)[1]
            sizes["posts"] += _write(out_dir / "posts" / cfg.id / f"{local}.json", {
                "id": tid, "pageCount": ps.get("page_count"), "pagesIndexed": pages,
                "posts": [{"id": p.id, "u": p.url, "a": p.author, "d": p.posted_at, "n": p.position,
                           "e": p.excerpt, "pg": p.page} for p in plist],
            })

        # -- compact search index + text chunks
        ordered = sorted(threads.values(), key=lambda t: t.last_post_at or t.created_at or "", reverse=True)
        for n in range(0, len(ordered), INDEX_CHUNK):
            chunk = ordered[n:n + INDEX_CHUNK]
            rows = [[t.source_thread_id, t.title, cat_index.get(t.category_id, -1), _date(t.created_at),
                     _date(t.last_post_at), t.replies, t.views, flags(t), t.author] for t in chunk]
            name = f"index/{cfg.id}-{n // INDEX_CHUNK}.json"
            sizes["index"] += _write(out_dir / name, rows)
            index_chunks.append({"source": cfg.id, "file": name, "count": len(rows)})
            texts = []
            for t in chunk:
                parts = [t.excerpt] if t.excerpt else []
                parts += [p.excerpt for p in by_thread.get(t.id, []) if p.excerpt and p.position != 1]
                if parts:
                    texts.append([t.source_thread_id, " … ".join(parts)])
            if texts:
                tname = f"text/{cfg.id}-{n // INDEX_CHUNK}.json"
                sizes["text"] += _write(out_dir / tname, texts)
                text_chunks.append({"source": cfg.id, "file": tname, "count": len(texts)})

        # -- per-source leaderboards
        tl = list(threads.values())
        lists = leaderboard_lists(tl, LEADERBOARD_SOURCE, now)
        cat_groups: dict[str, list[Thread]] = defaultdict(list)
        for t in tl:
            cat_groups[t.category_id].append(t)
        for cid, group in cat_groups.items():
            lists.update(leaderboard_lists(group, LEADERBOARD_CATEGORY, now, prefix=f"cat:{cid}:"))
        ids = {i for l in lists.values() for i in l}
        sizes["leaderboards"] += _write(out_dir / "leaderboards" / f"{cfg.id}.json", {
            "scope": cfg.id, "generatedAt": now_iso(), "lists": lists,
            "threads": {i: record(threads[i], post_pages_by_thread.get(i), with_excerpt=False) for i in sorted(ids)},
        })

        status = state.get("status") or "pending"
        manifest_sources.append({
            "id": cfg.id, "name": cfg.name, "short": cfg.short, "adapter": cfg.adapter,
            "homepage": cfg.homepage, "baseUrl": cfg.base_url, "color": cfg.color, "notes": cfg.notes,
            "threadUrl": {"xenforo": "/threads/{id}/", "nodebb": "/topic/{id}", "invision": "/topic/{id}/"}.get(cfg.adapter, "/{id}"),
            "status": status,
            "lastAttemptAt": state.get("last_attempt_at"), "lastSuccessAt": state.get("last_success_at"),
            "lastError": state.get("last_error"), "lastRun": state.get("last_run"),
            "postsIndexedThreads": len(by_thread), "postsIndexed": len(posts),
            **cov,
        })
        all_threads.extend(tl)

    # -- global feed
    cutoff = (now - timedelta(days=FEED_DAYS)).strftime("%Y-%m-%dT%H:%M:%SZ")
    recent = [t for t in all_threads if (t.last_post_at or "") >= cutoff or (t.created_at or "") >= cutoff]
    recent.sort(key=lambda t: t.last_post_at or t.created_at or "", reverse=True)
    feed = [record(t, post_pages_by_thread.get(t.id)) for t in recent[:FEED_MAX]]
    sizes["feed"] = _write(out_dir / "feed.json", {"generatedAt": now_iso(), "days": FEED_DAYS, "threads": feed})

    # -- global leaderboards
    lists = leaderboard_lists(all_threads, LEADERBOARD_ALL, now)
    by_id = {t.id: t for t in all_threads}
    ids = {i for l in lists.values() for i in l}
    sizes["leaderboards"] += _write(out_dir / "leaderboards" / "all.json", {
        "scope": "all", "generatedAt": now_iso(), "lists": lists,
        "threads": {i: record(by_id[i], post_pages_by_thread.get(i), with_excerpt=False) for i in sorted(ids)},
    })

    complete = bool(manifest_sources) and all(
        s["backfillComplete"] and s["coverage"] >= COMPLETE_COVERAGE and s["status"] != "blocked" for s in manifest_sources
    )
    manifest = {
        "version": 1,
        "generatedAt": now_iso(),
        "historicalComplete": complete,
        "totals": {"threads": len(all_threads), "posts": sum(s["postsIndexed"] for s in manifest_sources),
                   "feed": len(feed)},
        "sources": manifest_sources,
        "index": index_chunks,
        "text": text_chunks,
        "flags": {"pinned": FLAG_PINNED, "megathread": FLAG_MEGA, "repliesApprox": FLAG_REPLIES_APPROX,
                  "viewsApprox": FLAG_VIEWS_APPROX, "locked": FLAG_LOCKED},
        "sizes": dict(sizes),
    }
    _write(out_dir / "manifest.json", manifest)
    return manifest
