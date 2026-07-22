"""Decision Replay store for audit and historical comparison (設計文件 §19).

Provides in-memory storage for the hackathon demo.
In production, this would use DynamoDB or similar persistent storage.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, List, Optional

from reasoning.models import DecisionRecord


@dataclass
class HumanOverride:
    """Record of human override on a decision."""

    operator: str
    original_route: str
    modified_route: Optional[str]
    reason: str
    action: str  # "accept" | "modify" | "reject"
    timestamp: str
    published: bool = False


@dataclass
class DecisionEntry:
    """A stored decision with optional human override."""

    record: DecisionRecord
    stored_at: str
    override: Optional[HumanOverride] = None


class DecisionReplayStore:
    """Thread-safe in-memory decision store.

    Keys decisions by decision_id. Also supports querying by event_id.
    """

    def __init__(self) -> None:
        self._store: Dict[str, DecisionEntry] = {}
        self._lock = threading.Lock()

    def save(self, record: DecisionRecord) -> str:
        """Save a decision record. Returns decision_id."""
        entry = DecisionEntry(
            record=record,
            stored_at=datetime.now().astimezone().isoformat(timespec="seconds"),
        )
        with self._lock:
            self._store[record.decision_id] = entry
        return record.decision_id

    def get(self, decision_id: str) -> Optional[DecisionEntry]:
        """Retrieve a decision by ID."""
        return self._store.get(decision_id)

    def list_by_event(self, event_id: str) -> List[DecisionEntry]:
        """List all decisions for a given event, sorted by creation time."""
        entries = [
            entry for entry in self._store.values()
            if entry.record.event.event_id == event_id
        ]
        return sorted(entries, key=lambda e: e.record.created_at)

    def list_all(self, limit: int = 50) -> List[DecisionEntry]:
        """List all decisions sorted by creation time (most recent first)."""
        entries = sorted(
            self._store.values(),
            key=lambda e: e.record.created_at,
            reverse=True,
        )
        return entries[:limit]

    def add_override(self, decision_id: str, override: HumanOverride) -> bool:
        """Attach a human override to an existing decision."""
        with self._lock:
            entry = self._store.get(decision_id)
            if entry is None:
                return False
            entry.override = override
            return True

    def count(self) -> int:
        return len(self._store)

    def clear(self) -> None:
        with self._lock:
            self._store.clear()


# Global singleton for the app
replay_store = DecisionReplayStore()
