"""
FastAPI Router — /api/incidents/*

端點列表：
  POST /api/incidents/inject           注入一筆事件，回傳 List[TriggerDecision]
  GET  /api/incidents/samples          回傳 live_incidents.json 清單（一鍵注入用）
  GET  /api/incidents/active           目前已注入、尚未 resolve 的事件清單
  POST /api/incidents/{event_id}/resolve  清除已處理事件
"""

import json
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from warroom.module2.backend.services.sop_engine import process_incident
from warroom.module2.backend.store.incident_store import get_active, inject, resolve
from data.snapshot import get_snapshot, available_timestamps
from shared.schemas import TriggerDecision

router = APIRouter(prefix="/api/incidents", tags=["incidents"])

DATA_SOURCE_DIR = Path(__file__).resolve().parents[3] / "data_source"
INCIDENTS_PATH = DATA_SOURCE_DIR / "live_incidents.json"


class IncidentIn(BaseModel):
    event_id: str
    type: str
    location: str
    affected_segment: str
    affected_road: Optional[str] = None
    status: str
    severity: str
    description: str
    timestamp: str


class InjectResponse(BaseModel):
    decisions: List[TriggerDecision]
    processing_time_ms: float = Field(description="後端規則運算耗時（毫秒）")
    snapshot: Dict[str, Any] = Field(
        description="注入時間點的 TrafficSnapshot",
        default_factory=dict,
    )


@router.post(
    "/inject",
    response_model=InjectResponse,
    summary="注入事件並取得 SOP 決策",
)
def inject_incident(incident_in: IncidentIn) -> InjectResponse:
    incident = incident_in.model_dump()

    ts = incident["timestamp"]
    available = available_timestamps()
    candidates = [t for t in available if t <= ts]
    if not candidates:
        raise HTTPException(
            status_code=422,
            detail=f"No snapshot available at or before {ts!r}; earliest is {available[0]!r}",
        )
    snapshot_ts = candidates[-1]

    try:
        snapshot = get_snapshot(snapshot_ts)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    inject(incident)

    t0 = time.monotonic()
    decisions = process_incident(incident, snapshot)
    elapsed_ms = round((time.monotonic() - t0) * 1000, 2)

    return InjectResponse(decisions=decisions, processing_time_ms=elapsed_ms, snapshot=snapshot)


@router.get(
    "/samples",
    response_model=List[Dict[str, Any]],
    summary="取得內建情境事件清單",
)
def get_samples() -> List[Dict[str, Any]]:
    if not INCIDENTS_PATH.exists():
        raise HTTPException(status_code=500, detail="live_incidents.json not found")
    with INCIDENTS_PATH.open("r", encoding="utf-8") as fh:
        return json.load(fh)


@router.get(
    "/active",
    response_model=List[Dict[str, Any]],
    summary="取得已注入、尚未 resolve 的事件清單",
)
def get_active_incidents() -> List[Dict[str, Any]]:
    return get_active()


@router.post(
    "/{event_id}/resolve",
    summary="清除已處理事件",
)
def resolve_incident(event_id: str) -> Dict[str, str]:
    removed = resolve(event_id)
    if not removed:
        raise HTTPException(
            status_code=404, detail=f"Event {event_id!r} not found in active store"
        )
    return {"status": "resolved", "event_id": event_id}
