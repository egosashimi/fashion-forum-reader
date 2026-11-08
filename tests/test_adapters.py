"""Adapter parsing tests against trimmed copies of real public pages
(fetched 2026-11-08) and one synthetic Invision fixture."""
from collector.adapters.invision import InvisionAdapter
from collector.adapters.nodebb import NodeBBAdapter
from collector.adapters.xenforo import XenForoAdapter, canonical_thread_url, thread_id_from_url

from .conftest import fixture_json, fixture_text


# -- XenForo -----------------------------------------------------------------

def test_xenforo_url_helpers():
    assert thread_id_from_url("/threads/vansons-whiskey-roma-vs-brandy-roma.124285/page-3") == "124285"
    assert thread_id_from_url("https://x.org/threads/124285/") == "124285"
    assert canonical_thread_url("https://x.org", "/threads/a-b.12/post-99") == "https://x.org/threads/a-b.12/"


def test_xenforo_feed(fedora_cfg, client):
    a = XenForoAdapter(fedora_cfg, client)
    threads = a.parse_feed(fixture_text("xenforo_feed.rss"))
    assert len(threads) == 4
    t = threads[0]
    assert t.id == "fedoralounge:124285"
    assert t.title == "Vanson's Whiskey Roma Vs Brandy Roma"
    assert t.url == "https://www.thefedoralounge.com/threads/vansons-whiskey-roma-vs-brandy-roma.124285/"
    assert t.author == "onstar"
    assert t.replies == 15 and t.replies_exact
    assert t.last_post_at == "2026-11-08T16:58:12Z"
    assert t.category == "Outerwear and Workwear"
    assert t.excerpt.startswith("Does anyone have a pictures")
    assert len(t.excerpt) <= fedora_cfg.excerpt_chars + 1
    assert threads[1].megathread  # "Finds and Deals - Leather Jacket Edition"


def test_xenforo_feed_skips_unconfigured_sections(fedora_cfg, client):
    fedora_cfg.nodes[0].path = "hats.3"
    assert XenForoAdapter(fedora_cfg, client).parse_feed(fixture_text("xenforo_feed.rss")) == []


def test_xenforo_listing(fedora_cfg, client):
    a = XenForoAdapter(fedora_cfg, client)
    page = a.parse_listing(fixture_text("xenforo_listing.html"), fedora_cfg.nodes[0])
    assert page.page == 1 and page.page_count == 849
    by_id = {t.source_thread_id: t for t in page.threads}
    sticky = by_id["84057"]
    assert sticky.pinned and sticky.locked
    t = by_id["124285"]
    assert not t.pinned
    assert (t.replies, t.replies_exact, t.views, t.views_exact) == (15, True, 524, True)
    assert t.created_at == "2026-11-07T12:12:44Z"
    assert t.last_post_at == "2026-11-08T16:58:12Z"
    assert t.author == "onstar"
    big = by_id["96976"]
    assert big.replies == 31000 and not big.replies_exact  # shown as "31K"


def test_xenforo_sorted_listing_gives_leaderboard(fedora_cfg, client):
    a = XenForoAdapter(fedora_cfg, client)
    page = a.parse_listing(fixture_text("xenforo_listing_sorted.html"), fedora_cfg.nodes[0])
    normal = [t for t in page.threads if not t.pinned]
    assert normal[0].title == "What Jacket Are You Wearing Today?"
    assert normal[0].replies == 65000
    assert [t.replies for t in normal] == sorted([t.replies for t in normal], reverse=True)


def test_xenforo_past_last_page_is_empty(fedora_cfg, client):
    a = XenForoAdapter(fedora_cfg, client)
    page = a.parse_listing(fixture_text("xenforo_listing.html"), fedora_cfg.nodes[0], requested_page=5)
    # The fixture is page 1; XenForo redirects too-high pages to the last page.
    assert page.threads == []


def test_xenforo_listing_urls(fedora_cfg, client):
    a = XenForoAdapter(fedora_cfg, client)
    n = fedora_cfg.nodes[0]
    assert a.listing_url(n, 1, "recent") == "https://www.thefedoralounge.com/forums/outerwear-and-workwear.4/"
    assert a.listing_url(n, 3, "oldest").endswith("/outerwear-and-workwear.4/page-3?order=post_date&direction=asc")
    assert a.listing_url(n, 2, "replies").endswith("page-2?order=reply_count&direction=desc")


def test_xenforo_thread_posts(fedora_cfg, client):
    a = XenForoAdapter(fedora_cfg, client)
    feed = a.parse_feed(fixture_text("xenforo_feed.rss"))
    page = a.parse_thread_page(fixture_text("xenforo_thread.html"), feed[0], 1)
    assert len(page.posts) == 3
    p = page.posts[0]
    assert p.id == "fedoralounge:3280560"
    assert p.url == "https://www.thefedoralounge.com/threads/vansons-whiskey-roma-vs-brandy-roma.124285/post-3280560"
    assert p.author == "onstar" and p.position == 1
    assert p.posted_at == "2026-11-07T12:12:44Z"
    assert p.excerpt and len(p.excerpt) <= fedora_cfg.excerpt_chars + 1
    assert [x.position for x in page.posts] == [1, 2, 3]


# -- NodeBB ------------------------------------------------------------------

def test_nodebb_categories(ironheart_cfg, client):
    a = NodeBBAdapter(ironheart_cfg, client)
    nodes = a.parse_categories(fixture_json("nodebb_categories.json"))
    paths = {n.path: n.name for n in nodes}
    assert paths["9"] == "Bottoms"
    assert paths["30"] == "Triple Works › Bottoms"
    assert "4" not in paths and "28" not in paths  # marketplace excluded
    assert all(not n.name.startswith("Iron Heart Products ›") for n in nodes)  # sections not prefixed
    assert a.category_totals["9"] == 447


def test_nodebb_listing(ironheart_cfg, client):
    a = NodeBBAdapter(ironheart_cfg, client)
    a._nodes = a.parse_categories(fixture_json("nodebb_categories.json"))
    page = a.parse_listing(fixture_json("nodebb_category.json"), 1)
    assert page.page_count == 23 and page.total_items == 447
    t = {x.source_thread_id: x for x in page.threads}["934"]
    assert t.replies == 4599  # postcount 4600 includes the opening post
    assert t.views == 2200078 and t.views_exact
    assert t.created_at == "2011-09-02T06:05:34Z"
    assert t.url == "https://forum.ironheart.co.uk/topic/934/ih-666-xhs-25oz-selvedge-denim-slim-straight-cut-jeans-indigo"
    assert t.category == "Bottoms"
    assert {x.source_thread_id: x for x in page.threads}["5618"].pinned
    assert a.parse_listing(fixture_json("nodebb_category.json"), 99).threads == []


def test_nodebb_recent(ironheart_cfg, client):
    a = NodeBBAdapter(ironheart_cfg, client)
    a._nodes = a.parse_categories(fixture_json("nodebb_categories.json"))
    threads = a.parse_topic_list(fixture_json("nodebb_recent.json"))
    assert threads and all(t.id.startswith("ironheart:") for t in threads)
    assert all(t.last_post_at for t in threads)


def test_nodebb_topic_posts(ironheart_cfg, client):
    a = NodeBBAdapter(ironheart_cfg, client)
    a._nodes = a.parse_categories(fixture_json("nodebb_categories.json"))
    thread = a.parse_listing(fixture_json("nodebb_category.json"), 1).threads[4]
    page = a.parse_topic(fixture_json("nodebb_topic.json"), thread, 1)
    assert page.page_count == 230
    assert page.posts[1].url == "https://forum.ironheart.co.uk/post/99022"
    assert page.posts[1].position == 2
    assert page.posts[1].excerpt == "are these VMC 666s sanforized?"
    assert page.thread.replies == 4599


# -- Invision (trimmed real guest pages) -----------------------------------------

def test_invision_listing(superfuture_cfg, client):
    a = InvisionAdapter(superfuture_cfg, client)
    page = a.parse_listing(fixture_text("invision_listing.html"), superfuture_cfg.nodes[0])
    assert page.page_count == 202
    by_id = {t.source_thread_id: t for t in page.threads}
    waywt = by_id["163426"]
    assert waywt.pinned and waywt.megathread
    assert waywt.title == "WAYWT 2026 Edition"
    assert waywt.url == "https://supertalk.superfuture.com/topic/163426-waywt-2026-edition/"
    assert (waywt.replies, waywt.replies_exact) == (723, True)
    assert (waywt.views, waywt.views_exact) == (131700, False)  # "131.7k"
    assert waywt.author == "ATWM"
    assert waywt.created_at == "2026-01-01T15:31:18Z"
    assert waywt.last_post_at == "2026-11-08T13:13:07Z"
    assert len(page.threads) == 4 and sum(t.pinned for t in page.threads) == 2


def test_invision_feed(superfuture_cfg, client):
    a = InvisionAdapter(superfuture_cfg, client)
    threads = a.parse_feed(fixture_text("invision_feed.rss"), superfuture_cfg.nodes[0])
    assert threads[0].id == "superfuture:35852"
    assert threads[0].title == "Leepro Appreciation"
    assert threads[0].url == "https://supertalk.superfuture.com/topic/35852-leepro-appreciation/"
    assert threads[0].created_at == "2007-09-18T13:58:06Z"
    assert threads[0].excerpt.startswith("Enough about Levi's")


def test_invision_topic_posts(superfuture_cfg, client):
    a = InvisionAdapter(superfuture_cfg, client)
    from collector.models import Thread
    t = Thread(id="superfuture:788", source="superfuture", source_thread_id="788",
               url="https://supertalk.superfuture.com/topic/788-selvedge-denim/", title="Selvedge Denim")
    page = a.parse_topic_page(fixture_text("invision_topic.html"), t, 1)
    assert page.page_count == 12
    p = page.posts[0]
    assert p.id == "superfuture:3970" and p.author == "eldave04" and p.position == 1
    assert p.posted_at == "2004-10-31T14:59:00Z"
    assert p.url == "https://supertalk.superfuture.com/topic/788-selvedge-denim/?do=findComment&comment=3970"
    assert p.excerpt.startswith("Recently I have run into some jeans")
    assert [x.position for x in page.posts] == [1, 2, 3]
