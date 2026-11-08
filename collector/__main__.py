"""Command line entry point.

    python -m collector collect [--source ID ...] [--max-requests N] [--phases recent,top,backfill,posts]
    python -m collector build [--out public/data]
    python -m collector status
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from pathlib import Path

from .build import build
from .config import load_sources
from .pipeline import SourceRun
from .store import DEFAULT_DATA_DIR, Store

ROOT = Path(__file__).resolve().parent.parent


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="collector")
    ap.add_argument("--config", type=Path, default=None, help="sources.toml path")
    ap.add_argument("--data", type=Path, default=DEFAULT_DATA_DIR, help="master data directory")
    ap.add_argument("-v", "--verbose", action="store_true")
    sub = ap.add_subparsers(dest="cmd", required=True)

    c = sub.add_parser("collect", help="run one polite collection pass")
    c.add_argument("--source", action="append", help="limit to source id (repeatable)")
    c.add_argument("--max-requests", type=int, help="override per-source request budget")
    c.add_argument("--backfill-pages", type=int, help="override backfill pages per run")
    c.add_argument("--phases", default="recent,top,backfill,posts")
    c.add_argument("--time-budget", type=float, default=40 * 60, help="stop starting new sources after N seconds")

    b = sub.add_parser("build", help="generate static JSON for the web app")
    b.add_argument("--out", type=Path, default=ROOT / "public" / "data")

    sub.add_parser("status", help="print per-source status and coverage")

    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    sources = load_sources(args.config)
    store = Store(args.data)

    if args.cmd == "collect":
        selected = [s for s in sources if not args.source or s.id in args.source]
        phases = tuple(p.strip() for p in args.phases.split(",") if p.strip())
        started = time.monotonic()
        summary = []
        for cfg in selected:
            if time.monotonic() - started > args.time_budget:
                logging.warning("time budget reached; skipping %s until next run", cfg.id)
                continue
            if args.max_requests:
                cfg.max_requests = args.max_requests
            if args.backfill_pages is not None:
                cfg.backfill_pages = args.backfill_pages
            res = SourceRun(cfg, store).run(phases)
            summary.append(res.__dict__)
            logging.info("[%s] %s: +%d new, %d updated, +%d posts, %d requests%s", cfg.id, res.status,
                         res.new_threads, res.updated_threads, res.new_posts, res.requests,
                         f" — {'; '.join(res.errors)}" if res.errors else "")
        print(json.dumps(summary, indent=2))
        return 0

    if args.cmd == "build":
        m = build(sources, store, args.out)
        print(json.dumps({"threads": m["totals"], "sizes": m["sizes"], "historicalComplete": m["historicalComplete"]}, indent=2))
        return 0

    if args.cmd == "status":
        from .build import source_coverage
        for cfg in sources:
            st = store.load_state(cfg.id)
            cov = source_coverage(cfg, st, store.load_threads(cfg.id))
            print(f"{cfg.id:14} {st.get('status', 'pending'):8} indexed={cov['indexed']:>6} est={cov['estimated']:>6} "
                  f"coverage={cov['coverage']:.1%} backfillComplete={cov['backfillComplete']} last_success={st.get('last_success_at')}")
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
