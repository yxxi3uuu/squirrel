"""模組一 API（整合自 module-1-dynamicTS）：動態時序戰情儀表板。

沿用 warroom/module1/backend 的 thresholds.py（SOP 第 1/3 條門檻判斷）與
llm_summary.py（LLM 趨勢摘要），以 APIRouter 掛進 warroom 主 server。
"""

from typing import Optional

from fastapi import APIRouter, HTTPException

from data.snapshot import available_timestamps, get_snapshot
from warroom.module1.backend.llm_summary import generate_summary
from warroom.module1.backend.thresholds import evaluate_triggers, new_triggers

router = APIRouter()


@router.get("/timestamps")
def api_timestamps() -> list:
    return available_timestamps()


@router.get("/snapshot")
def api_snapshot(timestamp: Optional[str] = None) -> dict:
    try:
        return get_snapshot(timestamp)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.get("/history")
def api_history(entity_id: str) -> dict:
    """單一路段/站點跨時間軸的指標，供前端畫時間序列圖表用。
    路段回傳飽和度＋車速雙指標；站點回傳人流數＋成長率雙指標。

    路段/站點不必從第一個時間點就有資料——中途才出現的實體，缺資料的時間點
    直接跳過，不會讓整支 API 失敗；只有「從頭到尾都找不到這個 entity_id」
    才視為真的不存在，回傳 404。"""
    timestamps = available_timestamps()
    points = []
    entity_type = None
    for ts in timestamps:
        snapshot = get_snapshot(ts)
        if entity_id in snapshot["road_segments"]:
            entity_type = "road_segment"
            seg = snapshot["road_segments"][entity_id]
            points.append({
                "timestamp": ts,
                "saturation_score": seg["saturation_score"],
                "avg_speed": seg["avg_speed"],
            })
        elif entity_id in snapshot["stations"]:
            entity_type = "station"
            station = snapshot["stations"][entity_id]
            points.append({
                "timestamp": ts,
                "user_count": station["user_count"],
                "growth_rate": station["growth_rate"],
            })
        # 這個時間點還沒有這個實體的資料（例如中途才上線的站點）——跳過，不中斷。

    if entity_type is None:
        raise HTTPException(status_code=404, detail=f"Unknown entity_id {entity_id!r}")
    return {"entity_id": entity_id, "entity_type": entity_type, "points": points}


@router.get("/network-history")
def api_network_history() -> dict:
    """全市每個時間點的平均飽和度／平均車速，供飽和度／車速時序圖表使用。"""
    timestamps = available_timestamps()
    avg_saturation = []
    avg_speed = []
    for ts in timestamps:
        segments = get_snapshot(ts)["road_segments"].values()
        saturations = [s["saturation_score"] for s in segments if s["saturation_score"] is not None]
        speeds = [s["avg_speed"] for s in segments if s["avg_speed"] is not None]
        avg_saturation.append(sum(saturations) / len(saturations) if saturations else None)
        avg_speed.append(sum(speeds) / len(speeds) if speeds else None)
    return {"timestamps": timestamps, "avg_saturation": avg_saturation, "avg_speed": avg_speed}


@router.get("/dashboard")
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
