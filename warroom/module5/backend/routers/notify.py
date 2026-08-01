"""多語化告警生成與發布 API"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import datetime

from warroom.module5.backend.services.llm import (
    generate_alerts, mock_alerts, check_ollama, LANG_META
)

router = APIRouter()

# ── 發布日誌（in-memory，demo 用）─────────────────────────────────────────────
_pub_log: list[dict] = []


class GenerateRequest(BaseModel):
    station_id:   str
    station_name: str
    user_count:   int
    roaming_rate: float
    growth_rate:  float
    timestamp:    str
    multilingual: bool = True


class PublishRequest(BaseModel):
    station_name: str
    roaming_rate: float
    alerts:       dict
    channels:     list[str] = ["cell_broadcast", "cms"]


@router.get("/ollama-status")
def ollama_status():
    return check_ollama()


@router.post("/generate")
def generate(req: GenerateRequest):
    status = check_ollama()
    if not status["ok"]:
        alerts = mock_alerts(req.station_name)
        return {"alerts": alerts, "source": "mock", "llm_status": status}
    try:
        alerts = generate_alerts(
            req.station_id, req.station_name, req.user_count,
            req.roaming_rate, req.growth_rate, req.timestamp, req.multilingual,
        )
        from warroom.module5.backend.services.llm import LLM_MODE
        source = "bedrock" if LLM_MODE == "bedrock" else "ollama"
        return {"alerts": alerts, "source": source, "llm_status": status}
    except Exception as e:
        alerts = mock_alerts(req.station_name)
        return {"alerts": alerts, "source": "mock", "error": str(e)}


@router.post("/publish")
def publish(req: PublishRequest):
    lang_count = sum(1 for v in req.alerts.values() if v and v.strip())
    entry = {
        "time":         datetime.datetime.now().strftime("%H:%M:%S"),
        "station":      req.station_name,
        "roaming_rate": f"{req.roaming_rate*100:.1f}%",
        "lang_count":   lang_count,
        "channels":     req.channels,
        "status":       "success",
    }
    _pub_log.append(entry)
    return {
        "success":   True,
        "published_at": datetime.datetime.now().isoformat(),
        "channels":  req.channels,
        "lang_count": lang_count,
        "log_entry": entry,
    }


@router.get("/publish-log")
def publish_log():
    return {"log": _pub_log}


@router.get("/lang-meta")
def lang_meta():
    return {k: {"flag_name": v[0], "board_title": v[1]} for k, v in LANG_META.items()}
