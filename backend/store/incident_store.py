"""
Temporary in-memory incident store for module 2.

NOTE (見 README 第11節 待確認事項1)：
data/snapshot.py 目前未提供 inject_incident() 共用函式，
因此模組2 暫時在此維護一份事件儲存區。
當 main 分支補上共用注入函式後，此模組應被移除，改呼叫共用層。

風險：此處儲存的事件與其他模組透過 get_snapshot() 查到的
      incidents 清單會不同步。demo 時若其他模組需要看到
      注入事件，請確認共用層已整合或手動對齊。
"""

from typing import Dict, List, Optional

# Module-level in-memory store (process lifetime)
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
