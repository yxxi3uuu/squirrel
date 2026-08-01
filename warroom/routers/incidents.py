"""
模組二 API：live_incidents.json + SOP 決策引擎（整合版）

使用 warroom.module2.backend.services.sop_engine 的完整 SOP 規則引擎，取代舊版簡化邏輯。
包含上下游判定、LLM 引導文字、精確排除理由等進階功能。
"""

import csv
import json
import os
import time
from typing import Any, Optional

from fastapi import APIRouter
from pydantic import BaseModel

from warroom.module2.backend.services.sop_engine import process_incident as _engine_process_incident
from warroom.module2.backend.services.llm_mock import generate_commander_summary
from warroom.module1.backend.thresholds import evaluate_triggers as _m1_evaluate_triggers
from shared.schemas import TriggerDecision

router = APIRouter()

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data_source")

# In-memory 事件清單（啟動時載入 live_incidents.json）
_incidents: list[dict] = []


def _load_incidents():
    global _incidents
    path = os.path.join(DATA_DIR, "live_incidents.json")
    with open(path, encoding="utf-8") as f:
        _incidents = json.load(f)


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
    affected_road: Optional[str] = None
    status: str = "Closed"
    severity: str = "High"
    description: str = ""
    timestamp: str = ""


@router.post("/inject")
def inject_incident(req: InjectRequest):
    """注入新事件，並用 Module 2 SOP engine 產生即時決策。"""
    t0 = time.monotonic()
    new_event = req.model_dump()

    # 避免同一 event_id 重複加入清單
    existing_ids = {inc.get("event_id") for inc in _incidents}
    if new_event["event_id"] not in existing_ids:
        _incidents.append(new_event)

    snapshot = _snapshot_at(new_event.get("timestamp"))

    # 使用完整 SOP 引擎（含上下游判定、LLM 引導文字）
    decisions_pydantic = _engine_process_incident(new_event, snapshot)

    # 轉為 dict，並加入前端需要的額外欄位（route name 等）
    decisions = []
    for d in decisions_pydantic:
        d_dict = d.model_dump()
        # 補充前端需要的 route name 欄位
        if d.primary_route and d.primary_route in snapshot["road_segments"]:
            d_dict["primary_route_name"] = snapshot["road_segments"][d.primary_route]["name"]
        if d.secondary_routes:
            d_dict["secondary_route_names"] = [
                snapshot["road_segments"][sid]["name"]
                for sid in d.secondary_routes
                if sid in snapshot["road_segments"]
            ]
        # 補充排除路段的 name 欄位（前端 renderDecisionExplanation 使用）
        if d.excluded_routes:
            for route in d_dict["excluded_routes"]:
                sid = route.get("segment_id")
                if sid and sid in snapshot["road_segments"]:
                    route["name"] = snapshot["road_segments"][sid]["name"]
        # 補充 ete_detail（前端 renderDecisionExplanation 使用）
        if d.ete_minutes is not None:
            d_dict["ete_detail"] = _build_ete_detail(new_event, d.primary_route, snapshot)
        decisions.append(d_dict)

    # 處理站點型事件（SOP-3 / SOP-6），這些在 sop_engine 不負責但前端需要
    if str(new_event.get("affected_segment", "")).startswith("BS_"):
        station_decisions = _build_station_decisions(new_event, snapshot)
        decisions.extend(station_decisions)

    # 產生總結指揮官建議：擷取所有 decisions 的 guidance_text，合併成一段
    guidance_items = []
    for d in decisions:
        gt = d.get("guidance_text") or ""
        if not gt:
            # 從 actions 中找「指揮官建議：」開頭的項目
            for action in (d.get("actions") or []):
                if action.startswith("指揮官建議："):
                    gt = action.replace("指揮官建議：", "")
                    break
        if gt:
            guidance_items.append({
                "sop_clause": d.get("sop_clause") or "未分類",
                "guidance_text": gt,
            })

    commander_summary = ""
    commander_summary_source = "none"
    if guidance_items:
        summary_result = generate_commander_summary(guidance_items)
        commander_summary = summary_result.get("commander_summary", "")
        commander_summary_source = summary_result.get("_source", "mock")

    elapsed_ms = round((time.monotonic() - t0) * 1000, 2)

    # 附上 Module 1 在該時間點的門檻觸發結果（SOP-1/3/4），讓前端建議書能直接使用
    m1_triggers = _m1_evaluate_triggers(snapshot)

    return {
        "success": True,
        "event": new_event,
        "total": len(_incidents),
        "decisions": decisions,
        "snapshot": snapshot,
        "processing_time_ms": elapsed_ms,
        "commander_summary": commander_summary,
        "commander_summary_source": commander_summary_source,
        "m1_triggers": m1_triggers,
    }


@router.post("/{event_id}/resolve")
def resolve_incident(event_id: str):
    """解除事件"""
    for inc in _incidents:
        if inc.get("event_id") == event_id:
            inc["status"] = "Resolved"
            return {"success": True, "event_id": event_id}
    return {"success": False, "message": f"找不到 {event_id}"}


@router.post("/import")
def import_incidents(events: list[InjectRequest]):
    """批次匯入多筆事件（JSON 檔上傳用），逐筆注入並回傳所有決策。"""
    results = []
    for req in events:
        new_event = req.model_dump()
        existing_ids = {inc.get("event_id") for inc in _incidents}
        if new_event["event_id"] not in existing_ids:
            _incidents.append(new_event)
        results.append({"event_id": new_event["event_id"], "imported": True})
    return {"success": True, "imported_count": len(results), "total": len(_incidents), "results": results}


@router.get("/reload")
def reload_incidents():
    """重新載入 live_incidents.json"""
    _load_incidents()
    return {"success": True, "count": len(_incidents)}


# ------------------------------------------------------------------
# 站點事件處理（SOP-6，sop_engine 不負責這些）
# SOP-3 捷運分流由 Module 1 thresholds (evaluate_clause3) 負責判斷，
# 注入站點事件時不再重複產出 SOP-3 決策，避免和 Dashboard 已有的 SOP-3 卡重疊。
# ------------------------------------------------------------------
def _build_station_decisions(incident: dict[str, Any], snapshot: dict[str, Any]) -> list[dict[str, Any]]:
    station_id = incident.get("affected_segment")
    station = snapshot["stations"].get(station_id)
    if not station:
        return [
            {
                "triggered": False,
                "sop_clause": None,
                "clause_name": "站點資料不足",
                "entity_id": station_id,
                "entity_name": incident.get("location", ""),
                "basis": f"事件目標 {station_id} 是站點/基地台，但目前快照找不到對應人流資料。",
                "actions": ["請確認站點 ID 是否存在於 signaling_crowd_density.csv。"],
                "cascade_checks": [],
                "severity": _map_severity(incident.get("severity", "Medium")),
                "primary_route": None,
                "secondary_routes": [],
                "excluded_routes": [],
                "ete_minutes": None,
                "cms_text": None,
                "timestamp": incident.get("timestamp"),
            }
        ]

    decisions: list[dict[str, Any]] = []
    roaming = station.get("roaming_user_pct") or 0

    if roaming >= 0.30:
        decisions.append(
            {
                "triggered": True,
                "sop_clause": "SOP-6",
                "clause_name": "數位通報與多語化",
                "entity_id": station_id,
                "entity_name": station["name"],
                "basis": f"{station['name']}外籍旅客比例 {roaming*100:.1f}% >= 30%，符合 SOP-6 多語通報門檻。",
                "actions": ["開啟 Module 5 多語通報，產出中英日韓泰越法七語", "同步簡訊與資訊看板發布"],
                "cascade_checks": [],
                "severity": "yellow",
                "primary_route": None,
                "secondary_routes": [],
                "excluded_routes": [],
                "ete_minutes": None,
                "cms_text": f"{station['name']}人潮壅塞，外籍旅客請留意現場廣播與看板指引",
                "guidance_text": "已觸發 SOP-6，請由右上角多語通報視窗產生並發布七語文案。",
                "guidance_source": "rules",
                "timestamp": incident.get("timestamp"),
            }
        )
    return decisions


# ------------------------------------------------------------------
# 輔助函式
# ------------------------------------------------------------------
BASE_CLEARANCE = {"Critical": 60, "High": 40, "Medium": 20, "Low": 10}


def _build_ete_detail(incident: dict[str, Any], primary_seg_id: Optional[str], snapshot: dict[str, Any]) -> dict[str, Any]:
    """產出前端 renderDecisionExplanation 需要的 ete_detail 物件。"""
    base = BASE_CLEARANCE.get(incident.get("severity", "Medium"), 20)
    affected_ids = [incident.get("affected_segment")]
    if primary_seg_id:
        affected_ids.append(primary_seg_id)
    sats = [
        snapshot["road_segments"][sid]["saturation_score"]
        for sid in affected_ids
        if sid in snapshot["road_segments"] and snapshot["road_segments"][sid].get("saturation_score") is not None
    ]
    avg_sat = sum(sats) / len(sats) if sats else 0.5
    penalty = max(0.0, (avg_sat - 0.5) * 60)
    return {
        "ete_minutes": round(base + penalty, 1),
        "base_clearance": base,
        "avg_saturation": round(avg_sat, 2),
        "congestion_penalty": round(penalty, 1),
        "affected_segments_used": [sid for sid in affected_ids if sid],
        "formula_note": "ETE = base_clearance(依 severity) + max(0,(平均飽和度-0.5)×60)",
    }


def _map_severity(raw: str) -> str:
    return {
        "Critical": "critical",
        "High": "red",
        "Medium": "yellow",
        "Low": "info",
    }.get(raw, "yellow")


def _snapshot_at(timestamp: Optional[str]) -> dict[str, Any]:
    traffic_rows = _read_csv("city_traffic_flow.csv")
    crowd_rows = _read_csv("signaling_crowd_density.csv")
    road_rows = _read_json("road_network_geometry.json")
    all_ts = sorted(
        {r["Timestamp"] for r in traffic_rows if r.get("Timestamp")}
        | {r["Timestamp"] for r in crowd_rows if r.get("Timestamp")}
    )
    ts = _nearest_timestamp(timestamp, all_ts)
    flow_by_segment = _latest_by_id(traffic_rows, "Segment_ID", ts)
    crowd_by_station = _latest_by_id(crowd_rows, "BS_ID", ts)
    roads = {}
    for row in road_rows:
        sid = row["segment_id"]
        flow = flow_by_segment.get(sid, {})
        roads[sid] = {
            "name": row["name"],
            "flow_direction": row.get("flow_direction", ""),
            "intersections": row.get("intersections", []),
            "capacity_vph": int(row.get("capacity_vph", 0)),
            "alternatives": row.get("alternatives", []),
            "nearby_stations": row.get("nearby_stations", []),
            "aliases": _road_aliases(sid, row["name"]),
            "avg_speed": _optional_int(flow.get("Avg_Speed")),
            "vehicle_count": _optional_int(flow.get("Vehicle_Count")),
            "saturation_score": _optional_float(flow.get("Saturation_Score")),
            "lane_status": flow.get("Lane_Status"),
        }
    stations = {
        sid: {
            "name": row["Location_Name"],
            "aliases": _station_aliases(sid, row["Location_Name"]),
            "user_count": int(row["User_Count"]),
            "stay_time_avg": _optional_int(row.get("Stay_Time_Avg")),
            "growth_rate": float(row["Growth_Rate"]),
            "roaming_user_pct": _parse_percent(row["Roaming_User_Pct"]),
        }
        for sid, row in crowd_by_station.items()
    }
    return {"timestamp": ts, "source": "warroom_files", "road_segments": roads, "stations": stations}


def _road_aliases(segment_id: str, name: str) -> list[str]:
    aliases = {segment_id, name, name.replace("四段", "4段"), name.replace("一段", "1段")}
    return sorted(alias for alias in aliases if alias)


def _station_aliases(station_id: str, name: str) -> list[str]:
    normalized = name.replace("捷運", "").replace("站", "")
    short_name = normalized
    for suffix in ("場館內", "廣場", "周邊", "商圈", "園區"):
        short_name = short_name.replace(suffix, "")
    aliases = {station_id, name, normalized, short_name}
    if station_id.startswith("BS_MRT_"):
        aliases.add(station_id.replace("BS_MRT_", ""))
    return sorted(alias for alias in aliases if alias)


def _nearest_timestamp(timestamp: Optional[str], timestamps: list[str]) -> str:
    if not timestamps:
        return ""
    if not timestamp:
        return timestamps[-1]
    candidates = [ts for ts in timestamps if ts <= timestamp]
    return candidates[-1] if candidates else timestamps[0]


def _latest_by_id(rows: list[dict[str, str]], id_field: str, timestamp: str) -> dict[str, dict[str, str]]:
    latest = {}
    for row in rows:
        row_ts = row.get("Timestamp")
        if not row_ts or row_ts > timestamp:
            continue
        key = row[id_field]
        if key not in latest or row_ts >= latest[key]["Timestamp"]:
            latest[key] = row
    return latest


def _read_csv(filename: str) -> list[dict[str, str]]:
    with open(os.path.join(DATA_DIR, filename), encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def _read_json(filename: str) -> Any:
    with open(os.path.join(DATA_DIR, filename), encoding="utf-8") as f:
        return json.load(f)


def _parse_percent(value: str) -> float:
    return float(str(value).strip().rstrip("%")) / 100


def _optional_int(value: Optional[str]) -> Optional[int]:
    if value in (None, ""):
        return None
    return int(float(value))


def _optional_float(value: Optional[str]) -> Optional[float]:
    if value in (None, ""):
        return None
    return float(value)
