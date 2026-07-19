"""模組二 API：live_incidents.json"""

import os, json
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional

router = APIRouter()

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data_source")

# In-memory 事件清單（啟動時載入 live_incidents.json）
_incidents: list[dict] = []


def _load_incidents():
    global _incidents
    path = os.path.join(DATA_DIR, "live_incidents.json")
    with open(path, encoding="utf-8") as f:
        _incidents = json.load(f)


# 啟動時載入
_load_incidents()


@router.get("/list")
def list_incidents():
    """取得所有事件"""
    return {"incidents": _incidents, "count": len(_incidents)}


@router.get("/active")
def active_incidents():
    """取得仍未解除的事件（status != Resolved）"""
    active = [i for i in _incidents if i.get("status") != "Resolved"]
    return {"active": active, "count": len(active)}


class InjectRequest(BaseModel):
    event_id: str
    type: str
    location: str
    affected_segment: str
    status: str = "Closed"
    severity: str = "High"
    description: str = ""
    timestamp: str = ""


@router.post("/inject")
def inject_incident(req: InjectRequest):
    """注入新事件"""
    new_event = req.model_dump()
    _incidents.append(new_event)
    return {"success": True, "event": new_event, "total": len(_incidents)}


@router.post("/{event_id}/resolve")
def resolve_incident(event_id: str):
    """解除事件"""
    for inc in _incidents:
        if inc.get("event_id") == event_id:
            inc["status"] = "Resolved"
            return {"success": True, "event_id": event_id}
    return {"success": False, "message": f"找不到 {event_id}"}


@router.get("/reload")
def reload_incidents():
    """重新載入 live_incidents.json"""
    _load_incidents()
    return {"success": True, "count": len(_incidents)}
