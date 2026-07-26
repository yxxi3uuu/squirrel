"""信令資料 API"""

import os
from typing import Optional

import pandas as pd
from fastapi import APIRouter, HTTPException

router = APIRouter()

DATA_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "..", "data_source", "signaling_crowd_density.csv")
THRESHOLD = 0.30

def _load():
    df = pd.read_csv(DATA_PATH)
    df = df.rename(columns={
        "BS_ID": "station_id", "Location_Name": "station_name",
        "User_Count": "user_count", "Growth_Rate": "growth_rate",
        "Stay_Time_Avg": "stay_time", "Roaming_User_Pct": "roaming_pct",
        "Timestamp": "timestamp",
    })
    df["roaming_rate"] = df["roaming_pct"].apply(
        lambda v: float(str(v).rstrip("%")) / 100 if "%" in str(v)
                  else (float(v) / 100 if float(v) > 1 else float(v))
    )
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    return df.sort_values("timestamp")


def _snapshot_at(timestamp: Optional[str] = None) -> pd.DataFrame:
    """取得指定時間點（或最新）每個站點的快照：每個站點取「該時間點之前（含）最新一筆」，
    邏輯跟 data/snapshot.py 的 get_snapshot() 一致，讓模組五也能跟著模組一的時間軸走。"""
    df = _load()
    if timestamp:
        ts = pd.to_datetime(timestamp)
        df = df[df["timestamp"] <= ts]
        if df.empty:
            raise HTTPException(status_code=404, detail=f"No data at or before {timestamp!r}")
    return df.groupby("station_id").last().reset_index()


@router.get("/stations")
def get_stations(timestamp: Optional[str] = None):
    """回傳指定時間點（省略則為最新）所有站點快照"""
    latest = _snapshot_at(timestamp)
    records = latest.to_dict(orient="records")
    for r in records:
        if hasattr(r.get("timestamp"), "isoformat"):
            r["timestamp"] = r["timestamp"].isoformat()
    return {"stations": records, "threshold": THRESHOLD}


@router.get("/triggered")
def get_triggered(timestamp: Optional[str] = None):
    """回傳指定時間點（省略則為最新）漫遊率 >= 30% 的站點"""
    latest = _snapshot_at(timestamp)
    triggered = latest[latest["roaming_rate"] >= THRESHOLD]
    records = triggered.to_dict(orient="records")
    for r in records:
        if hasattr(r.get("timestamp"), "isoformat"):
            r["timestamp"] = r["timestamp"].isoformat()
    return {"triggered": records, "count": len(records)}
