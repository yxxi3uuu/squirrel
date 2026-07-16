"""
Module 1 — Dynamic Time-Series Dashboard prototype API.

執行方式（於 repo 根目錄）：
    python -m uvicorn module1_dashboard.backend.main:app --reload

啟動後開 http://127.0.0.1:8000 即可看到前端 dashboard。
"""

import sys
from pathlib import Path
from typing import Optional

# 確保用任何方式啟動（uvicorn console script 或 python -m）都能 import 到
# repo 根目錄的 data / shared 套件。
ROOT_DIR = Path(__file__).resolve().parents[2]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles

from data.snapshot import available_timestamps, get_snapshot
from module1_dashboard.backend.llm_summary import generate_summary
from module1_dashboard.backend.thresholds import evaluate_triggers, new_triggers

FRONTEND_DIR = Path(__file__).resolve().parents[1] / "frontend"

app = FastAPI(title="Module 1 — Dynamic Time-Series Dashboard (prototype)")


@app.get("/api/timestamps")
def api_timestamps() -> list:
    return available_timestamps()


@app.get("/api/snapshot")
def api_snapshot(timestamp: Optional[str] = None) -> dict:
    try:
        return get_snapshot(timestamp)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.get("/api/history")
def api_history(entity_id: str) -> dict:
    """單一路段/站點跨時間軸的主要指標，供前端畫時間序列圖表用。"""
    timestamps = available_timestamps()
    points = []
    for ts in timestamps:
        snapshot = get_snapshot(ts)
        if entity_id in snapshot["road_segments"]:
            value = snapshot["road_segments"][entity_id]["saturation_score"]
            metric = "saturation_score"
        elif entity_id in snapshot["stations"]:
            value = snapshot["stations"][entity_id]["user_count"]
            metric = "user_count"
        else:
            raise HTTPException(status_code=404, detail=f"Unknown entity_id {entity_id!r}")
        points.append({"timestamp": ts, "value": value})
    return {"entity_id": entity_id, "metric": metric, "points": points}


@app.get("/api/dashboard")
def api_dashboard(timestamp: Optional[str] = None) -> dict:
    """整合端點：快照 + 門檻判斷 + 本次新觸發 + LLM 摘要，前端只打這支即可。"""
    timestamps = available_timestamps()
    ts = timestamp or timestamps[-1]
    if ts not in timestamps:
        raise HTTPException(status_code=404, detail=f"Unknown timestamp {ts!r}")

    snapshot = get_snapshot(ts)
    triggers = evaluate_triggers(snapshot)

    idx = timestamps.index(ts)
    previous_triggers = evaluate_triggers(get_snapshot(timestamps[idx - 1])) if idx > 0 else []
    newly_triggered = new_triggers(previous_triggers, triggers)

    return {
        "timestamp": ts,
        "timestamps": timestamps,
        "snapshot": snapshot,
        "triggers": triggers,
        "newly_triggered": newly_triggered,
        "summary": generate_summary(snapshot, newly_triggered),
    }


# 靜態前端掛在最後，確保 /api/* 路由優先比對。
app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
