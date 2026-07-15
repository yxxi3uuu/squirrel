"""
FastAPI Router — /api/incidents/*

端點列表（見規格書第5節）：
  POST /api/incidents/inject           注入一筆事件，回傳 List[TriggerDecision]
  GET  /api/incidents/samples          回傳 live_incidents.json 清單（一鍵注入用）
  GET  /api/incidents/active           目前已注入、尚未 resolve 的事件清單
  POST /api/incidents/{event_id}/resolve  清除已處理事件
"""

import json
import time
from pathlib import Path
from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.services.sop_engine import process_incident
from backend.store.incident_store import get_active, inject, resolve
from data.snapshot import get_snapshot, available_timestamps
from shared.schemas import TriggerDecision

router = APIRouter(prefix="/api/incidents", tags=["incidents"])

DATA_SOURCE_DIR = Path(__file__).resolve().parents[2] / "data_source"
INCIDENTS_PATH = DATA_SOURCE_DIR / "live_incidents.json"


# ------------------------------------------------------------------
# Request / Response models
# ------------------------------------------------------------------
class IncidentIn(BaseModel):
    """事件注入的 Request body，欄位鏡射 live_incidents.json。"""

    event_id: str
    type: str
    location: str
    affected_segment: str
    affected_road: str | None = None
    status: str
    severity: str
    description: str
    timestamp: str


class InjectResponse(BaseModel):
    """注入端點的 Response wrapper，含決策清單與處理時間。"""

    decisions: List[TriggerDecision]
    processing_time_ms: float = Field(description="後端規則運算耗時（毫秒）")


# ------------------------------------------------------------------
# POST /api/incidents/inject
# ------------------------------------------------------------------
@router.post(
    "/inject",
    response_model=InjectResponse,
    summary="注入事件並取得 SOP 決策",
    description=(
        "注入一筆突發事件，後端即時執行 SOP 規則引擎，"
        "回傳 0 到多筆 TriggerDecision（陣列長度代表觸發了幾條 SOP 條款）。"
    ),
)
def inject_incident(incident_in: IncidentIn) -> InjectResponse:
    incident = incident_in.model_dump()

    # 找到 <= 事件時間的最新可用快照時間戳（事件時間可能不是整點）
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

    # 儲存到 in-memory store
    inject(incident)

    # 規則引擎計時
    t0 = time.monotonic()
    decisions = process_incident(incident, snapshot)
    elapsed_ms = round((time.monotonic() - t0) * 1000, 2)

    return InjectResponse(decisions=decisions, processing_time_ms=elapsed_ms)


# ------------------------------------------------------------------
# GET /api/incidents/samples
# ------------------------------------------------------------------
@router.get(
    "/samples",
    response_model=List[Dict[str, Any]],
    summary="取得內建情境事件清單",
    description="回傳 data_source/live_incidents.json 的全部事件，供前端一鍵注入使用。",
)
def get_samples() -> List[Dict[str, Any]]:
    if not INCIDENTS_PATH.exists():
        raise HTTPException(status_code=500, detail="live_incidents.json not found")
    with INCIDENTS_PATH.open("r", encoding="utf-8") as fh:
        return json.load(fh)


# ------------------------------------------------------------------
# GET /api/incidents/active
# ------------------------------------------------------------------
@router.get(
    "/active",
    response_model=List[Dict[str, Any]],
    summary="取得已注入、尚未 resolve 的事件清單",
)
def get_active_incidents() -> List[Dict[str, Any]]:
    return get_active()


# ------------------------------------------------------------------
# POST /api/incidents/{event_id}/resolve
# ------------------------------------------------------------------
@router.post(
    "/{event_id}/resolve",
    summary="清除已處理事件",
    description="Demo 用途：把事件標記為已處理並從 active 清單移除。",
)
def resolve_incident(event_id: str) -> Dict[str, str]:
    removed = resolve(event_id)
    if not removed:
        raise HTTPException(
            status_code=404, detail=f"Event {event_id!r} not found in active store"
        )
    return {"status": "resolved", "event_id": event_id}
