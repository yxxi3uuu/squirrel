"""
In-memory incident store for Module 2.

暫時維護一份事件儲存區。當共用層提供 inject_incident() 後可移除此模組。
"""

from typing import Dict, List, Optional

_incidents: Dict[str, dict] = {}


def inject(incident: dict) -> None:
    """Persist a single incident dict into the in-memory store."""
    _incidents[incident["event_id"]] = incident


def get_active() -> List[dict]:
    """Return all injected incidents (not yet resolved)."""
    return list(_incidents.values())


def resolve(event_id: str) -> bool:
    """Remove a resolved incident. Returns True if it existed."""
    return _incidents.pop(event_id, None) is not None


def get(event_id: str) -> Optional[dict]:
    """Look up a single incident by ID."""
    return _incidents.get(event_id)


def clear_all() -> None:
    """Wipe all incidents (useful for testing)."""
    _incidents.clear()
