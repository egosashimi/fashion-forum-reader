"""Persistent master data, committed to the repository under ``data/``.

* ``data/threads/<source>.jsonl``  one thread per line, sorted by thread id
* ``data/posts/<source>.jsonl``    one indexed post per line
* ``data/state/<source>.json``     run status, cursors, coverage estimates

JSON Lines sorted by stable ids keeps git diffs small: a run that refreshes
40 threads changes about 40 lines. Nothing is ever deleted by a run.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .models import Post, Thread

DEFAULT_DATA_DIR = Path(__file__).resolve().parent.parent / "data"


def _sort_key(item_id: str) -> tuple[int, str]:
    tail = item_id.split(":", 1)[-1]
    return (int(tail), "") if tail.isdigit() else (1 << 62, tail)


class Store:
    def __init__(self, root: Path = DEFAULT_DATA_DIR):
        self.root = Path(root)

    # -- paths --------------------------------------------------------------
    def _threads_path(self, source: str) -> Path:
        return self.root / "threads" / f"{source}.jsonl"

    def _posts_path(self, source: str) -> Path:
        return self.root / "posts" / f"{source}.jsonl"

    def _state_path(self, source: str) -> Path:
        return self.root / "state" / f"{source}.json"

    # -- generic jsonl -----------------------------------------------------
    @staticmethod
    def _read_jsonl(path: Path) -> list[dict[str, Any]]:
        if not path.exists():
            return []
        out = []
        with path.open(encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if line:
                    out.append(json.loads(line))
        return out

    @staticmethod
    def _write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".tmp")
        with tmp.open("w", encoding="utf-8") as fh:
            for row in rows:
                fh.write(json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":")))
                fh.write("\n")
        tmp.replace(path)

    # -- threads -----------------------------------------------------------
    def load_threads(self, source: str) -> dict[str, Thread]:
        return {d["id"]: Thread.from_dict(d) for d in self._read_jsonl(self._threads_path(source))}

    def save_threads(self, source: str, threads: dict[str, Thread]) -> None:
        rows = [t.to_dict() for t in sorted(threads.values(), key=lambda t: _sort_key(t.id))]
        self._write_jsonl(self._threads_path(source), rows)

    # -- posts -------------------------------------------------------------
    def load_posts(self, source: str) -> dict[str, Post]:
        return {d["id"]: Post.from_dict(d) for d in self._read_jsonl(self._posts_path(source))}

    def save_posts(self, source: str, posts: dict[str, Post]) -> None:
        rows = [
            p.to_dict()
            for p in sorted(posts.values(), key=lambda p: (_sort_key(p.thread_id), p.position or 0, _sort_key(p.id)))
        ]
        self._write_jsonl(self._posts_path(source), rows)

    # -- state -------------------------------------------------------------
    def load_state(self, source: str) -> dict[str, Any]:
        p = self._state_path(source)
        if not p.exists():
            return {}
        return json.loads(p.read_text(encoding="utf-8"))

    def save_state(self, source: str, state: dict[str, Any]) -> None:
        p = self._state_path(source)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(state, indent=2, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8")
