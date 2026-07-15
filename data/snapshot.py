"""
data/snapshot.py
提供「當前數據快照」給 prompt 組裝使用。
目前為 mock 靜態資料，之後可替換成讀 CSV 或呼叫 API / DynamoDB（7/17 定案）。
數值對齊 sop/emergency_traffic_sop.txt 中的 ID 與門檻。
"""

from datetime import datetime


MOCK_SNAPSHOT = {
    "timestamp": "2026-07-15T20:00:00+08:00",
    "source": "mock",

    # 捷運站 (Bus/Metro Stations，BS_ 開頭)
    "metro_stations": {
        "BS_MRT_BL17": {
            "name": "國父紀念館",
            "aliases": ["國父紀念館站", "BL17", "MRT BL17", "BS_MRT_BL17"],
            "user_count": 18500,
            "growth_rate": 0.12,       # 正值=人潮湧入
            "roaming_user_pct": 0.08,  # 8%，外籍漫遊旅客比例
            "capacity": 30000,
            "related_cell_towers": ["CT_BL17_AREA"],
        },
        "BS_MRT_BL18": {
            "name": "忠孝敦化",
            "aliases": ["忠孝敦化站", "BL18", "MRT BL18", "BS_MRT_BL18"],
            "user_count": 9200,
            "growth_rate": 0.05,
            "roaming_user_pct": 0.05,
            "capacity": 25000,
            "related_cell_towers": [],
        },
        "BS_MRT_BL16": {
            "name": "永春",
            "aliases": ["永春站", "BL16", "MRT BL16", "BS_MRT_BL16"],
            "user_count": 7800,
            "growth_rate": 0.03,
            "roaming_user_pct": 0.04,
            "capacity": 25000,
            "related_cell_towers": [],
        },
    },

    # 道路路段 (RD_ 開頭)
    "road_segments": {
        "RD_TPE_001": {
            "name": "忠孝東路",
            "aliases": ["忠孝東路四段", "忠孝東路4段", "忠孝東路", "RD_TPE_001"],
            "saturation_score": 0.78,
            "capacity_vph": 2400,
            "flow_direction": "east",
            "alternatives": ["RD_TPE_002", "RD_TPE_003"],
            "intersections": ["INT_001", "INT_002"],
        },
        "RD_TPE_002": {
            "name": "光復南路",
            "aliases": ["光復南路", "光復南路一段", "光復南路1段", "RD_TPE_002"],
            "saturation_score": 0.55,
            "capacity_vph": 1800,
            "flow_direction": "south",
            "alternatives": ["RD_TPE_001"],
            "intersections": ["INT_001", "INT_003"],
        },
        "RD_TPE_003": {
            "name": "仁愛路四段",
            "aliases": ["仁愛路四段", "仁愛路4段", "仁愛路", "RD_TPE_003"],
            "saturation_score": 0.62,
            "capacity_vph": 2000,
            "flow_direction": "east",
            "alternatives": ["RD_TPE_001"],
            "intersections": ["INT_002"],
        },
    },

    # 大型場館
    "venues": {
        "BS_TPE_DOME": {
            "name": "台北大巨蛋",
            "aliases": ["大巨蛋", "臺北大巨蛋", "台北大巨蛋", "Taipei Dome", "BS_TPE_DOME"],
            "user_count": 38000,
            "peak_user_count": 40000,  # 歷史峰值
            "growth_rate": 0.02,       # 正值代表仍在湧入，負值代表散場
            "event_status": "ongoing",
            "related_stations": ["BS_MRT_BL17", "BS_MRT_BL18"],
            "related_cell_towers": ["CT_BL17_AREA"],
        },
        "BS_TPE_101": {
            "name": "台北101廣場",
            "aliases": ["台北101", "臺北101", "101廣場", "台北101廣場", "BS_TPE_101"],
            "user_count": 5200,
            "growth_rate": -0.05,
            "roaming_user_pct": 0.28,  # 28%，接近 30% 門檻
            "event_status": "ongoing",
            "related_stations": [],
            "related_cell_towers": ["CT_101_AREA"],
        },
    },

    # 基地台漫遊資料（第 6 條觸發來源）
    "cell_towers": {
        "CT_BL17_AREA": {
            "area": "國父紀念館周邊",
            "aliases": ["國父紀念館周邊", "BL17周邊", "大巨蛋周邊", "CT_BL17_AREA"],
            "roaming_user_pct": 0.08,
            "related_entities": ["BS_MRT_BL17", "BS_TPE_DOME"],
        },
        "CT_101_AREA": {
            "area": "台北101周邊",
            "aliases": ["台北101周邊", "臺北101周邊", "101周邊", "CT_101_AREA"],
            "roaming_user_pct": 0.28,
            "related_entities": ["BS_TPE_101"],
        },
    },

    # 交通事件
    "incidents": [],

    # 號誌狀態
    "signals": {
        "INT_001": {"status": "normal", "related_segments": ["RD_TPE_001", "RD_TPE_002"]},
        "INT_002": {"status": "normal", "related_segments": ["RD_TPE_001", "RD_TPE_003"]},
    },
}


def get_snapshot() -> dict:
    """
    回傳當前數據快照。
    未來替換此函式即可對接真實資料來源：
      - 讀取 CSV 檔案
      - 呼叫模組 1 的 API
      - 查詢 DynamoDB
    """
    return MOCK_SNAPSHOT


def format_snapshot_for_prompt(snapshot: dict) -> str:
    """將快照格式化成易讀文字，供 system prompt 注入使用。"""
    ts = snapshot.get("timestamp", "未知")
    source = snapshot.get("source", "未知")
    lines = [f"資料時間：{ts}（來源：{source}）\n"]

    # 捷運站
    lines.append("■ 捷運站人數")
    for sid, info in snapshot.get("metro_stations", {}).items():
        roaming_pct = int(info["roaming_user_pct"] * 100)
        lines.append(
            f"  {sid} {info['name']}：User_Count={info['user_count']:,}，"
            f"Growth_Rate={info['growth_rate']:.2f}，"
            f"Roaming={roaming_pct}%，容量={info['capacity']:,}"
        )

    # 道路飽和度
    lines.append("\n■ 道路飽和度 (Saturation_Score)")
    for rid, info in snapshot.get("road_segments", {}).items():
        lines.append(f"  {rid} {info['name']}：{info['saturation_score']:.2f}")

    # 場館
    lines.append("\n■ 場館狀況")
    for key, info in snapshot.get("venues", {}).items():
        gr = info.get("growth_rate", 0)
        roaming = info.get("roaming_user_pct")
        peak = info.get("peak_user_count")
        detail = f"User_Count={info['user_count']:,}，Growth_Rate={gr:.2f}"
        if peak:
            detail += f"，歷史峰值={peak:,}"
        if roaming is not None:
            detail += f"，Roaming={int(roaming*100)}%"
        lines.append(f"  {key} {info['name']}：{detail}")

    # 基地台漫遊
    lines.append("\n■ 基地台漫遊率")
    for cid, info in snapshot.get("cell_towers", {}).items():
        pct = int(info["roaming_user_pct"] * 100)
        lines.append(f"  {info['area']}：Roaming={pct}%")

    # 交通事件
    incidents = snapshot.get("incidents", [])
    if incidents:
        lines.append("\n■ 現行交通事件")
        for inc in incidents:
            lines.append(f"  [{inc.get('severity','?')}] {inc.get('description','')}")
    else:
        lines.append("\n■ 現行交通事件：無")

    return "\n".join(lines)
