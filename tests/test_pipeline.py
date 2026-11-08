"""HTTP politeness, resumable backfill, error isolation, and the static build."""
import json
from datetime import datetime, timezone

import pytest
import requests

from collector.adapters.base import Adapter, ListingPage, Node, PostsPage, SourceConfig
from collector.build import build
from collector.http import BlockedError, BudgetExceeded, PoliteClient, looks_like_challenge
from collector.models import Post, Thread, thread_key
from collector.pipeline import SourceRun
from collector.store import Store


# -- HTTP client -----------------------------------------------------------------

class FakeResponse:
    def __init__(self, status=200, text="", headers=None):
        self.status_code, self.text, self.headers = status, text, headers or {}


class FakeSession:
    def __init__(self, responses):
        self.responses = responses
        self.calls = []
        self.headers = {}

    def get(self, url, timeout=None, headers=None):
        self.calls.append(url)
        for prefix, resp in self.responses.items():
            if url.startswith(prefix):
                return resp
        return FakeResponse(404)


def make_client(responses, **kw):
    clock = {"t": 0.0}
    sleeps = []

    def sleep(s):
        sleeps.append(s)
        clock["t"] += s

    c = PoliteClient(user_agent="test", session=FakeSession(responses), sleep=sleep,
                     clock=lambda: clock["t"], **kw)
    return c, sleeps


def test_rate_limit_waits_between_requests():
    c, sleeps = make_client({"https://a.org/robots.txt": FakeResponse(200, "User-agent: *\nAllow: /"),
                             "https://a.org/": FakeResponse(200, "ok")}, min_interval=3.0)
    c.get("https://a.org/x")
    c.get("https://a.org/y")
    assert sum(sleeps) >= 6.0  # robots, x, y spaced by 3s each


def test_budget_is_enforced():
    c, _ = make_client({"https://a.org/": FakeResponse(200, "ok")}, min_interval=0, max_requests=3)
    c.get("https://a.org/1")  # robots + 1
    c.get("https://a.org/2")
    with pytest.raises(BudgetExceeded):
        c.get("https://a.org/3")


def test_robots_disallow_is_respected():
    c, _ = make_client({"https://a.org/robots.txt": FakeResponse(200, "User-agent: *\nDisallow: /private"),
                        "https://a.org/": FakeResponse(200, "ok")}, min_interval=0)
    with pytest.raises(BlockedError):
        c.get("https://a.org/private/page")
    assert c.get("https://a.org/public").text == "ok"


def test_cloudflare_challenge_is_reported_not_bypassed():
    page = "<title>Just a moment...</title><script src='/cdn-cgi/challenge-platform/h/b/orchestrate'></script>"
    assert looks_like_challenge(403, page, {})
    c, _ = make_client({"https://sf.com/": FakeResponse(403, page)}, min_interval=0)
    with pytest.raises(BlockedError):
        c.get("https://sf.com/forum/22-superdenim/")
    # One robots attempt plus one page request: no retry loop on a challenge.
    assert len(c.session.calls) == 2


# -- pipeline with a fake adapter --------------------------------------------------

class FakeAdapter(Adapter):
    """Two sections; 'a' has 3 pages of oldest-first listings, 'b' has 1."""

    PAGES = {"a": 3, "b": 1}

    def __init__(self, cfg, client):
        super().__init__(cfg, client)
        self.calls = []

    def _thread(self, node, n, replies):
        return Thread(id=thread_key(self.cfg.id, n), source=self.cfg.id, source_thread_id=str(n),
                      url=f"https://f.example/threads/{n}/", title=f"Thread {n}", category=node.name,
                      category_id=node.path, created_at=f"20{10 + n % 15:02d}-01-01T00:00:00Z",
                      last_post_at="2026-11-01T00:00:00Z", replies=replies, views=replies * 10,
                      seen_via=["listing"])

    def fetch_recent(self):
        self.client._count()
        self.calls.append(("recent",))
        return [self._thread(self.cfg.nodes[0], 999, 5)]

    def fetch_listing(self, node, page, order):
        self.client._count()
        self.calls.append(("listing", node.path, page, order))
        pages = self.PAGES[node.path]
        if page > pages:
            return ListingPage([], page, pages)
        base = (0 if node.path == "a" else 100) + (page - 1) * 2
        return ListingPage([self._thread(node, base + i, base + i) for i in range(2)], page, pages)

    def fetch_posts(self, thread, page):
        self.client._count()
        self.calls.append(("posts", thread.id, page))
        return PostsPage([Post(id=f"{self.cfg.id}:p{thread.source_thread_id}-{page}", source=self.cfg.id,
                               thread_id=thread.id, url=thread.url + "post-1", position=1 if page == 1 else 21,
                               excerpt="hello", page=page)], page, 1)


@pytest.fixture
def cfg():
    return SourceConfig(id="fake", name="Fake", short="F", adapter="fake", base_url="https://f.example",
                        homepage="https://f.example/", nodes=[Node("a", "Alpha"), Node("b", "Beta")],
                        min_interval=0, max_requests=100, backfill_pages=2, top_pages=1, posts_pages_per_run=2)


def run(cfg, store, phases=("recent", "top", "backfill", "posts"), max_requests=None):
    client = PoliteClient(user_agent="t", min_interval=0, max_requests=max_requests or cfg.max_requests,
                          respect_robots=False, sleep=lambda s: None)
    r = SourceRun(cfg, store, client=client, adapter_factory=FakeAdapter)
    return r, r.run(phases)


def test_backfill_is_resumable_across_runs(cfg, tmp_path):
    store = Store(tmp_path)
    r1, res1 = run(cfg, store, phases=("backfill",))
    st = store.load_state("fake")["backfill"]
    assert (st["node_index"], st["page"], st.get("complete")) == (0, 3, None)
    r2, _ = run(cfg, store, phases=("backfill",))
    st = store.load_state("fake")["backfill"]
    # Page 3 of 'a' finished section a; page 1 of 'b' finished section b.
    assert st["complete"] is True
    assert [c for c in r2.adapter.calls] == [("listing", "a", 3, "oldest"), ("listing", "b", 1, "oldest")]
    assert len(store.load_threads("fake")) == 8
    # Further runs do nothing until the recycle interval.
    r3, _ = run(cfg, store, phases=("backfill",))
    assert r3.adapter.calls == []


def test_budget_exhaustion_stops_cleanly_and_saves(cfg, tmp_path):
    store = Store(tmp_path)
    _, res = run(cfg, store, max_requests=2)
    assert res.status == "ok"
    assert res.requests == 2
    assert store.load_state("fake")["status"] == "ok"
    assert len(store.load_threads("fake")) >= 1


def test_previously_indexed_threads_are_preserved(cfg, tmp_path):
    store = Store(tmp_path)
    run(cfg, store, phases=("backfill",))
    before = set(store.load_threads("fake"))
    run(cfg, store, phases=("recent",))
    after = set(store.load_threads("fake"))
    assert before <= after and "fake:999" in after


def test_top_phase_resumes_and_respects_refresh_interval(cfg, tmp_path):
    store = Store(tmp_path)
    cfg.extra["top_requests_per_run"] = 3
    r1, _ = run(cfg, store, phases=("top",))
    assert len(r1.adapter.calls) == 3 and store.load_state("fake")["top"]["cursor"] == 3
    r2, _ = run(cfg, store, phases=("top",))
    assert len(r2.adapter.calls) == 1  # 4 tasks total (2 nodes x 2 metrics x 1 page)
    assert store.load_state("fake")["top"]["refreshed_at"]
    r3, _ = run(cfg, store, phases=("top",))
    assert r3.adapter.calls == []


def test_posts_phase_indexes_and_tracks_pages(cfg, tmp_path):
    store = Store(tmp_path)
    run(cfg, store, phases=("backfill",))
    r, res = run(cfg, store, phases=("posts",))
    assert res.new_posts == 2
    posts = store.load_posts("fake")
    assert len(posts) == 2
    pstate = store.load_state("fake")["posts"]
    assert all(v["page_count"] == 1 and v["pages"] == [1] for v in pstate.values())


class BlockedAdapter(FakeAdapter):
    def fetch_recent(self):
        raise BlockedError("HTTP 403 bot protection challenge")


def test_blocked_source_is_marked_and_isolated(cfg, tmp_path):
    store = Store(tmp_path)
    client = PoliteClient(user_agent="t", min_interval=0, respect_robots=False, sleep=lambda s: None)
    res = SourceRun(cfg, store, client=client, adapter_factory=BlockedAdapter).run()
    assert res.status == "blocked"
    st = store.load_state("fake")
    assert st["status"] == "blocked" and "challenge" in st["last_error"]
    assert "last_success_at" not in st


class CrashingAdapter(FakeAdapter):
    def fetch_recent(self):
        raise ValueError("unexpected markup")


def test_parser_crash_is_recorded_and_other_phases_continue(cfg, tmp_path):
    store = Store(tmp_path)
    client = PoliteClient(user_agent="t", min_interval=0, respect_robots=False, sleep=lambda s: None)
    res = SourceRun(cfg, store, client=client, adapter_factory=CrashingAdapter).run(("recent", "backfill"))
    assert res.status == "partial"
    assert len(store.load_threads("fake")) == 4


# -- static build ---------------------------------------------------------------------

def test_build_outputs_and_coverage_labels(cfg, tmp_path):
    store = Store(tmp_path / "data")
    run(cfg, store, phases=("backfill",))
    out = tmp_path / "out"
    m = build([cfg], store, out, now=datetime(2026, 11, 8, tzinfo=timezone.utc))
    src = m["sources"][0]
    assert src["indexed"] == 4 and src["estimated"] >= 8
    assert src["backfillComplete"] is False
    assert m["historicalComplete"] is False  # backfill not finished -> "Indexed Threads" label
    run(cfg, store, phases=("backfill",))
    m = build([cfg], store, out, now=datetime(2026, 11, 8, tzinfo=timezone.utc))
    assert m["sources"][0]["backfillComplete"] is True
    assert m["historicalComplete"] is True

    lb = json.loads((out / "leaderboards" / "all.json").read_text())
    top = lb["lists"]["replies:all:any"]
    assert [lb["threads"][i]["r"] for i in top] == sorted([lb["threads"][i]["r"] for i in top], reverse=True)
    per = json.loads((out / "leaderboards" / "fake.json").read_text())
    assert "cat:a:replies:all:any" in per["lists"]
    chunks = m["index"]
    assert chunks and (out / chunks[0]["file"]).exists()
    rows = json.loads((out / chunks[0]["file"]).read_text())
    assert len(rows) == 8 and len(rows[0]) == 9
    feed = json.loads((out / "feed.json").read_text())
    assert feed["threads"] and all("u" in t for t in feed["threads"])


def test_build_blocked_source_prevents_complete_claim(cfg, tmp_path):
    store = Store(tmp_path / "data")
    run(cfg, store, phases=("backfill",))
    run(cfg, store, phases=("backfill",))
    blocked = SourceConfig(id="sf", name="SF", short="SF", adapter="invision", base_url="https://sf",
                           homepage="https://sf/", nodes=[Node("22", "Superdenim")])
    store.save_state("sf", {"status": "blocked", "last_error": "challenge"})
    m = build([cfg, blocked], store, tmp_path / "out")
    assert m["historicalComplete"] is False
    assert m["sources"][1]["status"] == "blocked"
