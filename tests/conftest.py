import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from collector.adapters.base import Node, SourceConfig  # noqa: E402
from collector.http import PoliteClient  # noqa: E402

FIXTURES = Path(__file__).parent / "fixtures"


def fixture_text(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


def fixture_json(name: str):
    return json.loads(fixture_text(name))


@pytest.fixture
def client():
    return PoliteClient(user_agent="test-agent", min_interval=0, sleep=lambda s: None)


@pytest.fixture
def fedora_cfg():
    return SourceConfig(
        id="fedoralounge", name="The Fedora Lounge", short="FL", adapter="xenforo",
        base_url="https://www.thefedoralounge.com", homepage="https://www.thefedoralounge.com/",
        nodes=[Node(path="outerwear-and-workwear.4", name="Outerwear and Workwear")],
    )


@pytest.fixture
def ironheart_cfg():
    return SourceConfig(
        id="ironheart", name="Iron Heart Forum", short="IH", adapter="nodebb",
        base_url="https://forum.ironheart.co.uk", homepage="https://forum.ironheart.co.uk/",
        extra={"exclude_categories": [151, 28, 37, 119, 4, 15]},
    )


@pytest.fixture
def superfuture_cfg():
    return SourceConfig(
        id="superfuture", name="Superfuture", short="SF", adapter="invision",
        base_url="https://supertalk.superfuture.com", homepage="https://supertalk.superfuture.com/",
        nodes=[Node(path="22-superdenim", name="Superdenim")],
    )
