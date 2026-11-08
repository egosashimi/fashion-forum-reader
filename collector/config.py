"""Load collector/sources.toml into SourceConfig objects."""
from __future__ import annotations

import tomllib
from dataclasses import fields
from pathlib import Path
from typing import Any, Optional

from .adapters.base import Node, SourceConfig

DEFAULT_CONFIG = Path(__file__).with_name("sources.toml")


def load_sources(path: Optional[Path] = None) -> list[SourceConfig]:
    raw = tomllib.loads(Path(path or DEFAULT_CONFIG).read_text(encoding="utf-8"))
    return parse_sources(raw)


def parse_sources(raw: dict[str, Any]) -> list[SourceConfig]:
    defaults = raw.get("defaults", {})
    known = {f.name for f in fields(SourceConfig)}
    out: list[SourceConfig] = []
    seen: set[str] = set()
    for block in raw.get("source", []):
        merged = {**defaults, **block}
        nodes = [Node(path=str(n["path"]), name=n.get("name", str(n["path"]))) for n in merged.pop("nodes", [])]
        kwargs = {k: v for k, v in merged.items() if k in known}
        extra = {k: v for k, v in merged.items() if k not in known}
        cfg = SourceConfig(nodes=nodes, extra=extra, **kwargs)
        if cfg.id in seen:
            raise ValueError(f"duplicate source id {cfg.id!r}")
        if ":" in cfg.id or "/" in cfg.id:
            raise ValueError(f"source id {cfg.id!r} must not contain ':' or '/'")
        seen.add(cfg.id)
        out.append(cfg)
    return out
