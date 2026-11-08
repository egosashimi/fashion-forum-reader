"""Adapter registry. Register new forum software here."""
from __future__ import annotations

from .base import Adapter, ListingPage, Node, PostsPage, SourceConfig
from .invision import InvisionAdapter
from .nodebb import NodeBBAdapter
from .xenforo import XenForoAdapter

ADAPTERS: dict[str, type[Adapter]] = {
    "xenforo": XenForoAdapter,
    "nodebb": NodeBBAdapter,
    "invision": InvisionAdapter,
}

__all__ = ["ADAPTERS", "Adapter", "ListingPage", "Node", "PostsPage", "SourceConfig"]
