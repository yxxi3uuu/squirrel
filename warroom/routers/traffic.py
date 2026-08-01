"""模組一 API：city_traffic_flow.csv + road_network_geometry.json"""

import os, json
import pandas as pd
from fastapi import APIRouter

router = APIRouter()

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data_source")


@router.get("/segments")
def get_segments():
    """取得所有路段最新快照（車速、飽和度、狀態）"""
    df = pd.read_csv(os.path.join(DATA_DIR, "city_traffic_flow.csv"))
    df["Timestamp"] = pd.to_datetime(df["Timestamp"])
    df = df.sort_values("Timestamp")
    latest = df.groupby("Segment_ID").last().reset_index()

    # 分級
    def classify(sat):
        if sat >= 0.95:
            return "A"
        elif sat >= 0.85:
            return "B"
        return "OK"

    latest["level"] = latest["Saturation_Score"].apply(classify)
    records = latest.to_dict(orient="records")
    for r in records:
        if hasattr(r.get("Timestamp"), "isoformat"):
            r["Timestamp"] = r["Timestamp"].isoformat()

    a_count = sum(1 for r in records if r["level"] == "A")
    b_count = sum(1 for r in records if r["level"] == "B")
    avg_speed = latest["Avg_Speed"].mean()

    return {
        "segments": records,
        "summary": {
            "a_count": a_count,
            "b_count": b_count,
            "avg_speed": round(avg_speed, 1),
            "total": len(records),
        },
    }


@router.get("/network")
def get_network():
    """取得路網靜態資料（容量、替代路線、intersections）"""
    with open(os.path.join(DATA_DIR, "road_network_geometry.json"), encoding="utf-8") as f:
        data = json.load(f)
    return {"network": data}


@router.get("/coords")
def get_coords():
    """取得地圖用的路段／站點經緯度座標（路段座標為 OpenStreetMap 實際道路描點）。"""
    with open(os.path.join(DATA_DIR, "road_coords.json"), encoding="utf-8") as f:
        return json.load(f)


@router.get("/sop")
def get_sop():
    """取得 SOP 全文"""
    sop_path = os.path.join(os.path.dirname(__file__), "..", "..", "sop", "emergency_traffic_sop.txt")
    with open(sop_path, encoding="utf-8") as f:
        text = f.read()
    return {"sop_text": text}
