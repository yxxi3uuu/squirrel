"""Module 3 demo snapshot overlay.

This keeps official source files intact while letting the advisory demo receive
a complete-enough current snapshot for what-if route selection.
"""

import copy
import json
import os
from pathlib import Path
from typing import Any, Dict, Optional

from .snapshot import get_snapshot


ROOT_DIR = Path(__file__).resolve().parents[1]
DEMO_SNAPSHOT_PATH = ROOT_DIR / "data_source" / "module3_demo_snapshot.json"


def get_module3_snapshot(timestamp: Optional[str] = None, llm_mode: str = "mock") -> Dict[str, Any]:
    """Return the current snapshot, optionally with Module 3 mock-demo overrides."""
    snapshot = get_snapshot(timestamp)
    if not _should_use_demo_overlay(llm_mode) or not DEMO_SNAPSHOT_PATH.exists():
        return snapshot

    overlay = json.loads(DEMO_SNAPSHOT_PATH.read_text(encoding="utf-8"))
    return _deep_merge(copy.deepcopy(snapshot), overlay)


def _should_use_demo_overlay(llm_mode: str) -> bool:
    setting = os.environ.get("MODULE3_USE_DEMO_SNAPSHOT", "").strip().lower()
    if setting in {"1", "true", "yes", "on"}:
        return True
    if setting in {"0", "false", "no", "off"}:
        return False
    return llm_mode == "mock"


def _deep_merge(base: Dict[str, Any], overlay: Dict[str, Any]) -> Dict[str, Any]:
    for key, value in overlay.items():
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            base[key] = _deep_merge(base[key], value)
        else:
            base[key] = value
    return base
