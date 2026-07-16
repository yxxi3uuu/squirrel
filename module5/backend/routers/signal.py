"""信令資料 API"""

import os
import pandas as pd
from fastapi import APIRouter, HTTPException

router = APIRouter()

DATA_PATH = os.path.join("data_source", "signaling_crowd_density.csv")
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
    df = df.sort_values("timestamp")
    latest = df.groupby("station_id").last().reset_index()
    return df, latest


@router.get("/stations")
def get_stations():
    """回傳最新快照所有站點"""
    _, latest = _load()
    records = latest.to_dict(orient="records")
    for r in records:
        if hasattr(r.get("timestamp"), "isoformat"):
            r["timestamp"] = r["timestamp"].isoformat()
    return {"stations": records, "threshold": THRESHOLD}


@router.get("/triggered")
def get_triggered():
    """回傳漫遊率 >= 30% 的站點"""
    _, latest = _load()
    triggered = latest[latest["roaming_rate"] >= THRESHOLD]
    records = triggered.to_dict(orient="records")
    for r in records:
        if hasattr(r.get("timestamp"), "isoformat"):
            r["timestamp"] = r["timestamp"].isoformat()
    return {"triggered": records, "count": len(records)}
