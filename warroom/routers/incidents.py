"""模組二 API：live_incidents.json + SOP 決策引擎"""

import csv
import json
import os
import time
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Any, Optional

router = APIRouter()

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data_source")
TRIGGER_SEGMENTS = {"RD_TPE_001", "RD_TPE_002"}
SOP2_STATUS = {"Closed", "Blocked", "Restricted"}
SOP2_SEVERITY = {"High", "Critical"}
BASE_CLEARANCE = {"Critical": 60, "High": 40, "Medium": 20, "Low": 10}

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
    _incidents.append(new_event)
    snapshot = _snapshot_at(new_event.get("timestamp"))
    decisions = process_incident(new_event, snapshot)
    elapsed_ms = round((time.monotonic() - t0) * 1000, 2)
    return {
        "success": True,
        "event": new_event,
        "total": len(_incidents),
        "decisions": decisions,
        "snapshot": snapshot,
        "processing_time_ms": elapsed_ms,
    }


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


def process_incident(incident: dict[str, Any], snapshot: dict[str, Any]) -> list[dict[str, Any]]:
    decisions: list[dict[str, Any]] = []
    sop1 = _build_sop1_decision(incident, snapshot)
    if sop1:
        decisions.append(sop1)
    if str(incident.get("affected_segment", "")).startswith("BS_"):
        decisions.extend(_build_station_decisions(incident, snapshot))
    if _is_sop2_triggered(incident):
        decisions.append(_build_sop2_decision(incident, snapshot))
    if _is_sop5_triggered(incident):
        decisions.append(_build_sop5_decision(incident, snapshot))
    if not decisions:
        decisions.append(
            {
                "triggered": False,
                "sop_clause": None,
                "clause_name": "無觸發條款",
                "entity_id": incident.get("affected_segment"),
                "entity_name": incident.get("location", ""),
                "basis": "不符合 SOP 第1/2/5條之程式化觸發條件；若涉及人流站點，轉交模組3/4判斷。",
                "actions": [],
                "cascade_checks": [
                    "若事件間接影響道路容量，建議在 Dashboard 持續監控相關路段。",
                    "若 affected_segment 為 BS_ 站點，建議由策略顧問評估 SOP-3 捷運分流或 SOP-4 散場。",
                ],
                "severity": _map_severity(incident.get("severity", "Medium")),
                "primary_route": None,
                "secondary_routes": [],
                "excluded_routes": [],
                "ete_minutes": None,
                "cms_text": None,
                "timestamp": incident.get("timestamp"),
            }
        )
    return decisions


def _build_sop1_decision(incident: dict[str, Any], snapshot: dict[str, Any]) -> Optional[dict[str, Any]]:
    seg_id = incident.get("affected_segment")
    if not str(seg_id or "").startswith("RD_"):
        seg_id = incident.get("affected_road")
    if seg_id not in TRIGGER_SEGMENTS:
        return None
    segment = snapshot["road_segments"].get(seg_id)
    if not segment:
        return None
    saturation = segment.get("saturation_score")
    if saturation is None or saturation < 0.85:
        return None
    level = "A" if saturation >= 0.95 else "B"
    actions = [
        f"長綠燈時制：替代道路 {', '.join(segment.get('alternatives', []))} 綠燈配時 +25%",
        f"警力淨空路口：派遣警力至 {seg_id} ({segment['name']})",
    ]
    if level == "A":
        actions.append("A 級路段需同步檢查是否啟動 SOP-2 路網重規劃")
    return {
        "triggered": True,
        "sop_clause": "SOP-1",
        "clause_name": "壅塞分級判定",
        "entity_id": seg_id,
        "entity_name": segment["name"],
        "basis": f"飽和度 {saturation:.2f}，達 {level} 級；{seg_id} 屬於城市應變觸發路段。",
        "actions": actions,
        "cascade_checks": ["A 級同時檢查 SOP-2 路網重規劃"] if level == "A" else [],
        "severity": "critical" if level == "A" else "yellow",
        "primary_route": None,
        "secondary_routes": [],
        "excluded_routes": [],
        "ete_minutes": None,
        "cms_text": None,
        "timestamp": incident.get("timestamp"),
    }


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
    user_count = station.get("user_count") or 0
    growth = station.get("growth_rate") or 0
    roaming = station.get("roaming_user_pct") or 0
    if user_count > 25000 or growth > 0.30 or incident.get("type") == "Crowd_Surge_Injury":
        basis = (
            f"{station['name']}人潮 {user_count:,}、成長率 {growth:.2f}；"
            "符合 SOP-3 人潮 >25,000 或成長率 >30% 的捷運與接駁分流判斷。"
        )
        decisions.append(
            {
                "triggered": True,
                "sop_clause": "SOP-3",
                "clause_name": "捷運與接駁分流",
                "entity_id": station_id,
                "entity_name": station["name"],
                "basis": basis,
                "actions": [
                    "通知北捷評估過站不停或班距調整",
                    "公車處加開接駁專車，導引旅客往捷運市政府站分流",
                    "現場動線中斷時，優先開放替代出口與醫護通道",
                ],
                "cascade_checks": ["若大巨蛋人潮峰值 >=30,000 且成長率 <=-0.20，連動 SOP-4 散場啟動。"],
                "severity": _map_severity(incident.get("severity", "High")),
                "primary_route": None,
                "secondary_routes": [],
                "excluded_routes": [],
                "ete_minutes": None,
                "cms_text": f"{station['name']}人潮壅塞，請依現場指引分流至捷運市政府站或接駁車候車區",
                "guidance_text": "已觸發 SOP-3，建議立即啟動捷運與接駁分流，並保留救護動線。",
                "guidance_source": "rules",
                "timestamp": incident.get("timestamp"),
            }
        )

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


def _is_sop2_triggered(incident: dict[str, Any]) -> bool:
    return (
        incident.get("status") in SOP2_STATUS
        and incident.get("severity") in SOP2_SEVERITY
        and str(incident.get("affected_segment", "")).startswith("RD_")
    )


def _build_sop2_decision(incident: dict[str, Any], snapshot: dict[str, Any]) -> dict[str, Any]:
    seg_id = incident["affected_segment"]
    segment = snapshot["road_segments"].get(seg_id, {"name": seg_id, "alternatives": []})
    plan = _plan_routes(seg_id, snapshot)
    primary = plan["primary"]
    primary_id = primary["segment_id"] if primary else None
    ete = _calculate_ete(incident, primary_id, snapshot)
    primary_name = primary["name"] if primary else "無可用主疏散路徑"
    cms_text = (
        f"{incident.get('location', segment['name'])}封閉，請改道 {primary_name}，預計延誤 {ete['ete_minutes']:.0f} 分鐘"
        if primary
        else f"{incident.get('location', segment['name'])}事故，請注意行車安全，預計延誤 {ete['ete_minutes']:.0f} 分鐘"
    )
    secondary_ids = [r["segment_id"] for r in plan["secondary"]]
    excluded_routes = [
        {"segment_id": r["segment_id"], "name": r["name"], "reason": r["reason"]}
        for r in plan["excluded"]
    ]
    basis_parts = [
        f"事件符合 SOP-2：status={incident.get('status')}、severity={incident.get('severity')}、affected_segment={seg_id}。",
    ]
    if primary:
        basis_parts.append(
            f"主疏散選擇 {primary['name']} ({primary_id})，容量 {primary['capacity_vph']} vph，飽和度 {primary['saturation_score']:.2f}，為可用替代道路中飽和度最低者。"
        )
    if secondary_ids:
        basis_parts.append(
            "次疏散：" + "、".join(f"{r['name']} ({r['segment_id']})" for r in plan["secondary"]) + "。"
        )
    if excluded_routes:
        basis_parts.append(
            "排除候選：" + "；".join(f"{r['name']} ({r['segment_id']}): {r['reason']}" for r in plan["excluded"]) + "。"
        )
    basis_parts.append(
        f"ETE = {ete['ete_minutes']} 分鐘（base={ete['base_clearance']} + 壅塞加罰={ete['congestion_penalty']}，平均飽和度={ete['avg_saturation']:.2f}）。"
    )
    return {
        "triggered": True,
        "sop_clause": "SOP-2",
        "clause_name": "事故與路障應變",
        "entity_id": seg_id,
        "entity_name": segment["name"],
        "basis": " ".join(basis_parts),
        "actions": [
            f"重新導引車流：主疏散路徑 {primary_id or '無'}",
            f"CMS 電子看板更新：{cms_text}",
        ],
        "cascade_checks": ["同一路段已同步檢查 SOP-1 壅塞分級判定"] if seg_id in TRIGGER_SEGMENTS else [],
        "severity": _map_severity(incident.get("severity", "High")),
        "primary_route": primary_id,
        "primary_route_name": primary["name"] if primary else None,
        "secondary_routes": secondary_ids,
        "secondary_route_names": [r["name"] for r in plan["secondary"]],
        "excluded_routes": excluded_routes,
        "ete_minutes": ete["ete_minutes"],
        "ete_detail": ete,
        "cms_text": cms_text,
        "guidance_text": _guidance_text("SOP-2", primary, ete, cms_text),
        "guidance_source": "rules",
        "timestamp": incident.get("timestamp"),
    }


def _is_sop5_triggered(incident: dict[str, Any]) -> bool:
    desc = incident.get("description", "")
    return incident.get("type") == "Power_Failure" or "號誌失效" in desc or "號誌故障" in desc


def _build_sop5_decision(incident: dict[str, Any], snapshot: dict[str, Any]) -> dict[str, Any]:
    seg_id = incident.get("affected_segment", "")
    segment = snapshot["road_segments"].get(seg_id, {"name": seg_id, "intersections": []})
    police_needed = max(1, len(segment.get("intersections", []))) * 2
    ete = _calculate_ete(incident, None, snapshot)
    cms_text = f"{segment['name']}號誌故障，請依現場指揮通行，預計延誤 {ete['ete_minutes']:.0f} 分鐘"
    return {
        "triggered": True,
        "sop_clause": "SOP-5",
        "clause_name": "號誌故障應變",
        "entity_id": seg_id,
        "entity_name": segment["name"],
        "basis": f"事件 type={incident.get('type')} 或描述含號誌故障；受影響路口數={len(segment.get('intersections', []))}，所需警力={police_needed} 人。ETE={ete['ete_minutes']} 分鐘。",
        "actions": [
            f"人工指揮派遣：{segment['name']} 派遣 {police_needed} 名警力接管交通指揮",
            f"CMS 更新：{cms_text}",
        ],
        "cascade_checks": [],
        "severity": _map_severity(incident.get("severity", "Medium")),
        "primary_route": None,
        "secondary_routes": [],
        "excluded_routes": [],
        "ete_minutes": ete["ete_minutes"],
        "ete_detail": ete,
        "cms_text": cms_text,
        "guidance_text": _guidance_text("SOP-5", None, ete, cms_text),
        "guidance_source": "rules",
        "timestamp": incident.get("timestamp"),
    }


def _plan_routes(seg_id: str, snapshot: dict[str, Any]) -> dict[str, Any]:
    segment = snapshot["road_segments"].get(seg_id, {})
    candidates = []
    for alt_id in segment.get("alternatives", []):
        alt = snapshot["road_segments"].get(alt_id)
        if not alt:
            continue
        item = {
            "segment_id": alt_id,
            "name": alt["name"],
            "capacity_vph": alt.get("capacity_vph", 0),
            "saturation_score": alt.get("saturation_score"),
        }
        if item["capacity_vph"] < 1000:
            item["reason"] = f"容量不足（{item['capacity_vph']} vph < 1000 vph）"
        elif item["saturation_score"] is None:
            item["reason"] = "缺少即時飽和度資料，無法比較"
        candidates.append(item)

    eligible = [c for c in candidates if "reason" not in c]
    eligible.sort(key=lambda c: c["saturation_score"])
    primary = eligible[0] if eligible else None
    secondary = eligible[1:3]
    excluded = [c for c in candidates if "reason" in c]
    for extra in eligible[3:]:
        excluded.append({**extra, "reason": "可用但非前三優先疏散路徑"})
    return {"primary": primary, "secondary": secondary, "excluded": excluded}


def _calculate_ete(incident: dict[str, Any], primary_seg_id: Optional[str], snapshot: dict[str, Any]) -> dict[str, Any]:
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
        "formula_note": "ETE = base_clearance(依 severity) + max(0,(平均飽和度-0.5)*60)",
    }


def _guidance_text(clause: str, primary: Optional[dict[str, Any]], ete: dict[str, Any], cms_text: str) -> str:
    if clause == "SOP-2":
        route = primary["name"] if primary else "現場指揮路線"
        return f"已觸發 SOP-2，建議立即導引車流改走{route}，同步發布 CMS，預估延誤 {ete['ete_minutes']:.0f} 分鐘。"
    return f"已觸發 SOP-5，請派員接管號誌並發布 CMS，預估延誤 {ete['ete_minutes']:.0f} 分鐘。"


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
    all_ts = sorted({r["Timestamp"] for r in traffic_rows if r.get("Timestamp")} | {r["Timestamp"] for r in crowd_rows if r.get("Timestamp")})
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
            "avg_speed": _optional_int(flow.get("Avg_Speed")),
            "vehicle_count": _optional_int(flow.get("Vehicle_Count")),
            "saturation_score": _optional_float(flow.get("Saturation_Score")),
            "lane_status": flow.get("Lane_Status"),
        }
    stations = {
        sid: {
            "name": row["Location_Name"],
            "user_count": int(row["User_Count"]),
            "stay_time_avg": _optional_int(row.get("Stay_Time_Avg")),
            "growth_rate": float(row["Growth_Rate"]),
            "roaming_user_pct": _parse_percent(row["Roaming_User_Pct"]),
        }
        for sid, row in crowd_by_station.items()
    }
    return {"timestamp": ts, "source": "warroom_files", "road_segments": roads, "stations": stations}


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
