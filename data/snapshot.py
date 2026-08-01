"""
Build TrafficSnapshot dictionaries from official data_source files.

This module is intentionally dependency-free so every feature branch can reuse
the same parsing behavior without installing extra packages.
"""

import csv
import json
from functools import lru_cache
from pathlib import Path
from typing import Dict, List, Optional


ROOT_DIR = Path(__file__).resolve().parents[1]
DATA_SOURCE_DIR = ROOT_DIR / "warroom" / "data_source"

TRAFFIC_FLOW_PATH = DATA_SOURCE_DIR / "city_traffic_flow.csv"
CROWD_DENSITY_PATH = DATA_SOURCE_DIR / "signaling_crowd_density.csv"
ROAD_GEOMETRY_PATH = DATA_SOURCE_DIR / "road_network_geometry.json"
INCIDENTS_PATH = DATA_SOURCE_DIR / "live_incidents.json"


def available_timestamps() -> List[str]:
    """Return sorted timestamps available in traffic or crowd source files."""
    timestamps = {
        row["Timestamp"]
        for row in _traffic_rows()
        if row.get("Timestamp")
    }
    timestamps.update(
        row["Timestamp"]
        for row in _crowd_rows()
        if row.get("Timestamp")
    )
    return sorted(timestamps)


def get_snapshot(timestamp: Optional[str] = None) -> dict:
    """
    Build a snapshot for the requested timestamp.

    If timestamp is omitted, the latest available source timestamp is used.
    Road and station records use the latest row at or before the requested
    timestamp, so sparse source files still produce a complete current state.
    Incidents include records whose timestamp is at or before the snapshot time.
    """
    ts = timestamp or _latest_timestamp()
    if ts not in available_timestamps():
        raise ValueError(
            f"Unknown timestamp {ts!r}; available range is "
            f"{available_timestamps()[0]} ~ {available_timestamps()[-1]}"
        )

    return {
        "timestamp": ts,
        "source": "official_files",
        "road_segments": _build_road_segments(ts),
        "stations": _build_stations(ts),
        "incidents": _build_incidents(ts),
    }


def format_snapshot_for_prompt(snapshot: dict) -> str:
    """Format a TrafficSnapshot-like dict for LLM prompt injection."""
    ts = snapshot.get("timestamp", "未知")
    source = snapshot.get("source", "未知")
    lines = [f"資料時間：{ts}（來源：{source}）\n"]

    lines.append("■ 道路狀態")
    for segment_id, info in snapshot.get("road_segments", {}).items():
        saturation = info.get("saturation_score")
        saturation_text = "未知" if saturation is None else f"{saturation:.2f}"
        lines.append(
            f"  {segment_id} {info['name']}："
            f"Saturation_Score={saturation_text}，"
            f"Avg_Speed={info.get('avg_speed', '未知')}，"
            f"Vehicle_Count={info.get('vehicle_count', '未知')}，"
            f"Lane_Status={info.get('lane_status', '未知')}"
        )

    lines.append("\n■ 人流站點")
    for station_id, info in snapshot.get("stations", {}).items():
        roaming_pct = int(info["roaming_user_pct"] * 100)
        peak = info.get("peak_user_count")
        peak_text = f"，歷史峰值={peak:,}" if peak is not None else ""
        lines.append(
            f"  {station_id} {info['name']}："
            f"User_Count={info['user_count']:,}，"
            f"Growth_Rate={info['growth_rate']:.2f}，"
            f"Roaming={roaming_pct}%{peak_text}"
        )

    incidents = snapshot.get("incidents", [])
    if incidents:
        lines.append("\n■ 已注入事件")
        for inc in incidents:
            lines.append(
                f"  [{inc.get('severity', '?')}] {inc.get('event_id', '')} "
                f"{inc.get('affected_segment', '')}：{inc.get('description', '')}"
            )
    else:
        lines.append("\n■ 已注入事件：無")

    return "\n".join(lines)


def _latest_timestamp() -> str:
    timestamps = available_timestamps()
    if not timestamps:
        raise ValueError("No timestamps found in official source files")
    return timestamps[-1]


def _build_road_segments(timestamp: str) -> Dict[str, dict]:
    flow_by_segment = _latest_rows_by_id(
        _traffic_rows(),
        id_field="Segment_ID",
        timestamp=timestamp,
    )

    segments = {}
    for row in _road_geometry_rows():
        segment_id = row["segment_id"]
        flow = flow_by_segment.get(segment_id, {})
        name = row["name"]
        segments[segment_id] = {
            "name": name,
            "aliases": _road_aliases(segment_id, name),
            "flow_direction": row["flow_direction"],
            "intersections": row.get("intersections", []),
            "capacity_vph": int(row["capacity_vph"]),
            "alternatives": row.get("alternatives", []),
            "nearby_stations": row.get("nearby_stations", []),
            "avg_speed": _optional_int(flow.get("Avg_Speed")),
            "vehicle_count": _optional_int(flow.get("Vehicle_Count")),
            "saturation_score": _optional_float(flow.get("Saturation_Score")),
            "lane_status": flow.get("Lane_Status"),
        }
    return segments


def _build_stations(timestamp: str) -> Dict[str, dict]:
    rows_by_station = _latest_rows_by_id(
        _crowd_rows(),
        id_field="BS_ID",
        timestamp=timestamp,
    )

    stations = {}
    for station_id, row in rows_by_station.items():
        name = row["Location_Name"]
        stations[station_id] = {
            "name": name,
            "aliases": _station_aliases(station_id, name),
            "user_count": int(row["User_Count"]),
            "stay_time_avg": _optional_int(row.get("Stay_Time_Avg")),
            "growth_rate": float(row["Growth_Rate"]),
            "roaming_user_pct": _parse_percent(row["Roaming_User_Pct"]),
            "peak_user_count": _peak_user_count(station_id, timestamp),
        }
    return stations


def _build_incidents(timestamp: str) -> List[dict]:
    return [
        row
        for row in _incident_rows()
        if row.get("timestamp") and row["timestamp"] <= timestamp
    ]


def _latest_rows_by_id(rows: List[dict], id_field: str, timestamp: str) -> Dict[str, dict]:
    latest = {}
    for row in rows:
        row_ts = row.get("Timestamp")
        if not row_ts or row_ts > timestamp:
            continue
        entity_id = row[id_field]
        current = latest.get(entity_id)
        if current is None or row_ts >= current["Timestamp"]:
            latest[entity_id] = row
    return latest


def _peak_user_count(station_id: str, timestamp: str) -> int:
    counts = [
        int(row["User_Count"])
        for row in _crowd_rows()
        if row["BS_ID"] == station_id and row["Timestamp"] <= timestamp
    ]
    return max(counts) if counts else 0


def _road_aliases(segment_id: str, name: str) -> List[str]:
    aliases = {segment_id, name, name.replace("四段", "4段"), name.replace("一段", "1段")}
    return sorted(alias for alias in aliases if alias)


def _station_aliases(station_id: str, name: str) -> List[str]:
    normalized = name.replace("捷運", "").replace("站", "")
    short_name = normalized
    for suffix in ("場館內", "廣場", "周邊", "商圈", "園區"):
        short_name = short_name.replace(suffix, "")
    aliases = {station_id, name, normalized, short_name}
    if station_id.startswith("BS_MRT_"):
        aliases.add(station_id.replace("BS_MRT_", ""))
    return sorted(alias for alias in aliases if alias)


def _parse_percent(value: str) -> float:
    return float(value.strip().rstrip("%")) / 100


def _optional_int(value: Optional[str]) -> Optional[int]:
    if value in (None, ""):
        return None
    return int(float(value))


def _optional_float(value: Optional[str]) -> Optional[float]:
    if value in (None, ""):
        return None
    return float(value)


@lru_cache(maxsize=1)
def _traffic_rows() -> List[dict]:
    return _read_csv(TRAFFIC_FLOW_PATH)


@lru_cache(maxsize=1)
def _crowd_rows() -> List[dict]:
    return _read_csv(CROWD_DENSITY_PATH)


@lru_cache(maxsize=1)
def _road_geometry_rows() -> List[dict]:
    return _read_json(ROAD_GEOMETRY_PATH)


@lru_cache(maxsize=1)
def _incident_rows() -> List[dict]:
    return _read_json(INCIDENTS_PATH)


def _read_csv(path: Path) -> List[dict]:
    with path.open("r", encoding="utf-8-sig", newline="") as file:
        return list(csv.DictReader(file))


def _read_json(path: Path) -> List[dict]:
    with path.open("r", encoding="utf-8") as file:
        return json.load(file)
