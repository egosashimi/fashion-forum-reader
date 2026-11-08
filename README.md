# Vintage Forum Reader

A mobile-first reader for vintage clothing forums: one feed, all-time leaderboards, cross-forum search, keyword watchlists and a personal research library. It runs as a static site on GitHub Pages. A Python collector on a GitHub Actions schedule keeps the data fresh. There is no paid backend, database or hosting.

| Tab | What it does |
| --- | --- |
| **Feed** | New and recently updated threads from every forum. Filter by forum or category; sort by recently updated, newest, most replies or most views; unread markers. |
| **Best of All Time** | Historical leaderboards: most replied or most viewed, all forums or one forum or one category, all time / last year / month / week, with an option to hide pinned threads and megathreads. Shows per-forum indexing coverage. |
| **Search** | Searches titles, authors and indexed post excerpts across the **historical index**, the **recent feed** or **your library**. Supports phrases (`"duck canvas"`), forum/category filters, sorting and highlighted matches. |
| **Watchlist** | Keyword lists (e.g. `Walls, Kakadu, duck canvas`) with optional forum filters. New matches are highlighted, and you can mark items or the whole list read. |
| **Library** | Saved threads, saved individual posts (indexed ones, or any permalink entered by hand), tags, notes, collections, read state, search/sort, and JSON export/import. |

Every thread and post links to the original discussion. In-app content is limited to metadata and short excerpts.

## Forums and how they are accessed

Investigated on 2026-11-08. All access is anonymous and read-only, and follows each site's robots.txt. The Cloudflare-managed robots files on these sites declare `Content-Signal: search=yes, ai-train=no`. Search=yes permits "building a search index and providing search results (e.g. returning hyperlinks and short excerpts)", which is what this project does. Nothing is used for AI training.

| Forum | Software | Method used | Notes |
| --- | --- | --- | --- |
| [The Fedora Lounge](https://www.thefedoralounge.com/forums/outerwear-and-workwear.4/), Outerwear and Workwear | XenForo 2 | Section RSS (`/forums/<node>/index.rss`) plus public listing pages | ~17k threads. Listings show views and rounded counts ("65K"); RSS supplies exact reply counts. |
| [Superfuture](https://supertalk.superfuture.com/forum/22-superdenim/), Superdenim | Invision Community 4 | Forum RSS (`?rss=1`), guest listings and topic pages | The site says it is "currently free to view for guests"; since 1 Feb 2026, full access to *all* sections needs a paid supermember account. Only guest-visible pages are read. Cloudflare sometimes challenges automated clients. When that happens the source is marked **blocked** for the run, and the challenge is never solved or bypassed. |
| [Vintage Fashion Guild](https://forums.vintagefashionguild.org/) | XenForo 2 | Site RSS plus listings | **Public sections only.** Member-only forums are never requested. |
| [Vintage Leather Jackets Forum](https://www.vintageleatherjackets.org/) | XenForo 2 | Site RSS plus listings | 14 jacket/gear sections configured. |
| [Iron Heart Forum](https://forum.ironheart.co.uk/) | NodeBB | Official public JSON API (`/api/categories`, `/api/recent`, `/api/category/<cid>`, `/api/topic/<tid>`) | Exact reply/view counts. Marketplace categories are skipped. |

XenForo and NodeBB sort listings on the server by reply count and view count. The collector uses that to check each section's real top threads in a handful of requests, so the Best of All Time lists are meaningful long before the full archive is indexed.

## Architecture

```
collector/            Python: adapters, polite HTTP client, pipeline, static build
  sources.toml        forum configuration (add forums here)
  adapters/           xenforo.py, nodebb.py, invision.py (+ base.py interface)
data/                 master data, committed by the scheduled workflow
  threads/<src>.jsonl one thread per line, sorted by id (small git diffs)
  posts/<src>.jsonl   indexed post excerpts with permalinks
  state/<src>.json    status, cursors, coverage estimates, errors
public/data/          generated for the site (gitignored; built in CI)
src/                  React + TypeScript + Vite app
tests/                pytest suite with trimmed real-page fixtures
src/test/             Vitest suite (sorting, dedup, search, library, storage, watchlists)
```

### Collection run (`python -m collector collect`)

For each source, with a hard **request budget** (default 60), **at least 3 s between requests to a host**, robots.txt checks and an identifying User-Agent:

1. **recent**: feeds and the first listing page of each section (new threads, refreshed counts).
2. **top**: the forum's own "most replies" / "most views" sort, the first `top_pages` pages per section, refreshed every 72 h and capped per run.
3. **backfill**: walks each section oldest-first, `backfill_pages` pages per run. The cursor is stored in `data/state`, so every run resumes where the last stopped. When finished it marks the section complete. After 30 days it starts another pass to refresh old counts.
4. **posts**: indexes the first pages of popular and recently active threads (excerpts plus permalinks), a few pages per run.

Threads are deduplicated by a stable id (`<source>:<forum thread id>`). Merging never drops known data: counts only grow, an exact count beats a rounded "65K", and `first_seen_at` and the creation date are kept. Each source is isolated: a block, network error or parser crash is recorded in its state and shown in the UI, and the other sources carry on.

### Static output (`python -m collector build`)

| File | Loaded |
| --- | --- |
| `manifest.json` | at start (sources, status, coverage, chunk list) |
| `feed.json` | at start (threads active in the last 45 days, max 1200) |
| `leaderboards/<scope>.json` | when the Best tab opens (precomputed top lists per forum/category/metric/window) |
| `index/<src>-<n>.json` | when you search (compact rows, 4000 threads per chunk, only for the selected forums) |
| `text/<src>-<n>.json` | when searching with "Include post text" |
| `posts/<src>/<thread>.json` | when you open a thread |

The browser never downloads the whole archive on page load. A compact index row is about 100 bytes (≈7 MB uncompressed, roughly 2 MB gzipped, for 70k threads), and it is fetched only for the forums being searched. If the archive grows far beyond that, the next step is a term-sharded inverted index (see *Known limitations*).

## Deployment (GitHub Pages)

1. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
2. **Settings → Actions → General → Workflow permissions: Read and write**, so the collector can commit `data/`.
3. Merge to `main`. `collect-and-deploy.yml` then:
   * runs on a schedule (`23 */3 * * *`, about every three hours), and on demand from **Actions → Collect forum data and deploy → Run workflow** (optionally for selected sources, or deploy only),
   * collects, commits `data/` to `main`, builds the static JSON and the site, and deploys to Pages,
   * on a plain push to `main`, only rebuilds and deploys.
4. `ci.yml` runs both test suites and a build on pull requests and non-main branches.

The site uses relative URLs and hash routing (`#/search?q=walls`), so it works at `https://<user>.github.io/<repo>/` without configuration. No secrets or API keys are used anywhere. All forum endpoints are public.

## Running locally

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
npm install

.venv/bin/python -m collector build      # data/ -> public/data (no network)
npm run dev                              # http://localhost:5173

.venv/bin/python -m collector collect --source ironheart   # one polite pass (network)
.venv/bin/python -m collector status                       # coverage per forum

.venv/bin/python -m pytest -q            # collector tests
npm test                                 # frontend tests
```

Useful collector flags: `--max-requests N`, `--backfill-pages N`, `--phases recent,top,backfill,posts`, `--time-budget SECONDS`.

## Adding a forum

1. **Same software as an existing adapter** (XenForo, NodeBB, Invision): add a `[[source]]` block to `collector/sources.toml` with a unique `id`, `name`, `short`, `adapter`, `base_url`, `homepage`, `color` and the public `nodes` (sections) to index. Per-source settings can override `min_interval`, `max_requests`, `backfill_pages`, `top_pages`, and so on.
2. **Other software** (phpBB, vBulletin, Discourse, ...): add `collector/adapters/<name>.py` subclassing `Adapter`. Implement `fetch_recent()`, `fetch_listing(node, page, order)` with `order` in `recent | oldest | replies | views`, and `fetch_posts(thread, page)`. Register it in `adapters/__init__.py` and add a `threadUrl` pattern in `build.py`. Discourse, for example, has a public JSON API (`/latest.json`, `/top.json`, `/t/<id>.json`).
3. Save trimmed copies of real pages in `tests/fixtures/` and add parser tests.
4. Check the site's robots.txt and terms first. Prefer official feeds and APIs, and never index members-only areas.

## Backup and restore

Saved threads, saved posts, tags, notes, collections, watchlists and read state are stored **only in your browser** (IndexedDB). They **do not sync between devices**; that would need an extra service such as an account server or cloud storage. Use **Library → Backup**:

* **Export library (JSON)** downloads everything as a versioned file (`format: vintage-forum-reader-library`).
* **Import from file** merges a backup into the current library. Existing items keep their notes; tags and collections are combined; nothing is deleted. Invalid entries (e.g. non-http links) are skipped and counted.

Clearing site data or using private browsing deletes the local library, so export regularly.

## Known limitations

* **Historical coverage is incomplete at first.** The backfill is deliberately slow (a few pages per forum every three hours). Until a forum is fully walked, the leaderboards say **"Most Replied — Indexed Threads"** and show coverage figures. They switch to "All Time" only when every forum is fully walked, has ≥95% estimated coverage and is not blocked. Totals for XenForo and Invision sections are estimates (pages × threads per page) until the walk finishes.
* **Rounded counts.** XenForo and Invision listings show large numbers rounded ("65K", "131.7k"). They are stored as approximate (shown with `~`) until an RSS feed or API gives the exact figure. Rankings among threads with rounded counts can be slightly off.
* **Posts are excerpts, not copies.** Only short excerpts (≤280 characters, quotes removed) of the first few pages of selected threads are indexed. Images and full text stay on the forums. Saving a post stores its permalink; the excerpt is optional.
* **Watchlists check the recent feed** (last 45 days) when you open the app. There are no push notifications.
* **Superfuture availability** depends on Cloudflare and the site's guest policy. When blocked, the UI says so and the existing data stays.
* **Time filters** on leaderboards use the thread's start date.
* **Search** runs in the browser over the downloaded index chunks: word-prefix and phrase matching, not stemming or fuzzy matching.
* **Megathread detection** is a title heuristic (`collector/util.py`). Pinned state comes from the forum.

## Politeness and content policy

* One request at a time per host, ≥3 s apart (raised automatically if robots.txt sets a crawl-delay), capped at 60 requests per forum per run. Server errors back off exponentially, and `Retry-After` is honoured.
* No logins, cookies, paywalls or member-only areas. Bot challenges are reported, never solved.
* Only metadata, short excerpts and links are republished. Every view points to the original thread or post.
