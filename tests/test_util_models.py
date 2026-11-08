import pytest

from collector.models import Thread, dedupe_threads, merge_thread
from collector.util import excerpt, is_megathread, parse_count, parse_datetime


@pytest.mark.parametrize("text,expected", [
    ("524", (524, True)),
    ("1,234", (1234, True)),
    ("65K", (65000, False)),
    ("1.2M", (1200000, False)),
    ("972K", (972000, False)),
    ("–", (None, True)),
    ("", (None, True)),
    (None, (None, True)),
    ("n/a", (None, True)),
])
def test_parse_count(text, expected):
    assert parse_count(text) == expected


@pytest.mark.parametrize("value,expected", [
    ("2026-11-07T12:12:44+0000", "2026-11-07T12:12:44Z"),
    ("2024-11-10T19:37:55-0500", "2024-11-11T00:37:55Z"),
    ("Sun, 08 Nov 2026 16:58:12 +0000", "2026-11-08T16:58:12Z"),
    ("2016-07-27T16:37:14.000Z", "2016-07-27T16:37:14Z"),
    ("1469637434000", "2016-07-27T16:37:14Z"),
    ("garbage", None),
    (None, None),
])
def test_parse_datetime(value, expected):
    assert parse_datetime(value) == expected


def test_excerpt_cuts_on_word_boundary():
    text = "word " * 100
    out = excerpt(text, 50)
    assert len(out) <= 51 and out.endswith("…")
    assert excerpt("short", 50) == "short"
    assert excerpt("", 50) is None


@pytest.mark.parametrize("title,mega", [
    ("What Jacket Are You Wearing Today?", True),
    ("Finds and Deals - Leather Jacket Edition", True),
    ("Show Us Your OVERCOATS", True),
    ("Thurston Bros. - Official Affiliate Thread", True),
    ("What Are You Wearing Today (WAYWT)", True),
    ("Walls hunting jacket - dating help", False),
    ("Kakadu duck canvas coat, USA made?", False),
])
def test_megathread_heuristic(title, mega):
    assert is_megathread(title) is mega


def T(**kw):
    base = dict(id="fl:1", source="fl", source_thread_id="1", url="https://x/threads/a.1/", title="A")
    base.update(kw)
    return Thread(**base)


def test_merge_preserves_history_and_fills_fields():
    old = T(created_at="2010-01-01T00:00:00Z", replies=10, views=100, author="ann",
            first_seen_at="2026-01-01T00:00:00Z", seen_via=["backfill"])
    new = T(last_post_at="2026-11-01T00:00:00Z", replies=12, author=None,
            first_seen_at="2026-11-01T00:00:00Z", seen_via=["rss"])
    m = merge_thread(old, new)
    assert m.created_at == "2010-01-01T00:00:00Z"
    assert m.last_post_at == "2026-11-01T00:00:00Z"
    assert m.replies == 12 and m.views == 100
    assert m.author == "ann"
    assert m.first_seen_at == "2026-01-01T00:00:00Z"
    assert m.seen_via == ["backfill", "rss"]


def test_merge_prefers_exact_over_consistent_abbreviation():
    exact = T(replies=65123, replies_exact=True)
    approx = T(replies=65000, replies_exact=False)
    assert merge_thread(exact, approx).replies == 65123
    assert merge_thread(exact, approx).replies_exact is True
    assert merge_thread(approx, exact).replies == 65123
    # A much larger abbreviated value means real growth; take it.
    grown = T(replies=80000, replies_exact=False)
    m = merge_thread(exact, grown)
    assert m.replies == 80000 and m.replies_exact is False


def test_merge_counts_never_shrink():
    assert merge_thread(T(replies=50), T(replies=40)).replies == 50
    assert merge_thread(T(views=50), T(views=None)).views == 50


def test_merge_rejects_different_ids():
    with pytest.raises(ValueError):
        merge_thread(T(), T(id="fl:2"))


def test_dedupe_threads_by_stable_id():
    out = dedupe_threads([T(replies=1), T(replies=3), T(id="fl:2", source_thread_id="2")])
    assert len(out) == 2
    assert {t.id: t.replies for t in out}["fl:1"] == 3


def test_thread_roundtrip():
    t = T(replies=3, pinned=True, seen_via=["rss"])
    assert Thread.from_dict(t.to_dict()) == t
