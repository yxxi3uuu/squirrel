"""
SQUIRREL 模組三：對話式策略諮詢顧問（Interactive Strategic Advisory）
AgentCore Strands Agent 部署版

功能：
  - SOP 條款判斷（7 條全覆蓋）
  - What-if 分析（假設情境推演）
  - 多輪對話（延續前一輪情境）
  - 連鎖條款檢查
  - 主動預警（接近門檻時提醒）
  - 規則引擎驗證（Fallback：降低幻覺）

部署：
  cd agentcore-squirrel
  agentcore deploy -y -v
"""

import csv
import json
import os
import re
from pathlib import Path
from typing import Optional

from strands import Agent, tool
from strands.models import BedrockModel

# ── 資料路徑 ──────────────────────────────────────────────────────────────
DATA_DIR = Path(__file__).resolve().parents[2] / "data"
SOP_PATH = DATA_DIR / "emergency_traffic_sop.txt"
TRAFFIC_PATH = DATA_DIR / "city_traffic_flow.csv"
CROWD_PATH = DATA_DIR / "signaling_crowd_density.csv"
ROAD_PATH = DATA_DIR / "road_network_geometry.json"

# 城市應變觸發路段（僅這兩條路段達 B/A 級時才啟動長綠燈、警力淨空）
CONGESTION_ACTION_ROADS = {"RD_TPE_001", "RD_TPE_002"}

# ── System Prompt ─────────────────────────────────────────────────────────
SYSTEM_PROMPT = """你是城市交通指揮中心的 AI 策略顧問「松鼠 SQ」。
你的職責是根據 SOP 條款與即時數據快照，回答指揮官的假設性問題（What-if questions）。

回答規則（嚴格遵守）：
1. 判斷依據必須引用 SOP 條款編號（第 N 條）
2. 必須把假設數值與門檻並列比較（例：40,000 > 25,000）
3. 必須主動檢查連鎖條款（例：觸發第 3 條時，檢查是否連動第 6 條）
4. 不觸發時誠實說「不觸發」，並說明距門檻差多少
5. 回答格式固定為：
   第一段：直接結論（觸發/不觸發哪條 SOP）
   ■ 建議處置：具體動作
   ■ 後續確認：連鎖檢查或升級條件
6. 不使用 markdown 符號（不要 #、*、-）
7. 使用繁體中文
8. 如果下方有「規則引擎參考答案」，你必須完整輸出它，禁止省略或修改數字

你有以下工具可用：
- get_sop()：取得 SOP 全文（7 條應變規則）
- get_snapshot()：取得即時數據快照（路段飽和度 + 站點人潮）
- check_rule(scenario)：呼叫規則引擎驗證 SOP 門檻判定

每次回答前，請先呼叫 get_sop 和 get_snapshot 取得最新資料。
若判斷涉及數值門檻比較，請呼叫 check_rule 做交叉驗證。"""


# ── Tools ─────────────────────────────────────────────────────────────────

@tool
def get_sop() -> str:
    """取得交通應變 SOP 全文（7 條規則）。每次判斷前必須呼叫。"""
    try:
        return SOP_PATH.read_text(encoding="utf-8")
    except FileNotFoundError:
        return _fallback_sop()


@tool
def get_snapshot() -> str:
    """取得即時交通與人流數據快照。每次判斷前必須呼叫。"""
    try:
        return _build_snapshot_text()
    except Exception as e:
        return f"快照讀取失敗：{e}"


@tool
def check_rule(scenario: str) -> str:
    """規則引擎驗證：輸入情境描述，回傳 SOP 門檻判定結果。
    
    用途：當 LLM 判斷涉及數值門檻比較時，呼叫此工具做交叉驗證，降低幻覺。
    範例輸入：「忠孝東路四段飽和度 0.96」、「國父紀念館站 40000 人」、「大巨蛋散場 -0.25」
    """
    snapshot = _get_snapshot_dict()
    return _rule_engine_check(scenario, snapshot)


@tool
def proactive_scan() -> str:
    """主動預警掃描：檢查即時數據中是否有接近 SOP 門檻的站點或路段。"""
    snapshot = _get_snapshot_dict()
    alerts = _scan_alerts(snapshot)
    if not alerts:
        return "目前所有指標正常，無接近門檻的站點或路段。"
    return "\n".join(alerts)


# ── Agent 建立 ────────────────────────────────────────────────────────────

_agent: Optional[Agent] = None


def get_agent() -> Agent:
    global _agent
    if _agent is None:
        model = BedrockModel(
            model_id=os.environ.get(
                "BEDROCK_MODEL_ID",
                "us.anthropic.claude-sonnet-4-5-20250929-v1:0"
            ),
            region_name=os.environ.get("BEDROCK_REGION", "us-west-2"),
        )
        _agent = Agent(
            model=model,
            system_prompt=SYSTEM_PROMPT,
            tools=[get_sop, get_snapshot, check_rule, proactive_scan],
        )
    return _agent


# ── Entrypoint（AgentCore Runtime 呼叫此函式）────────────────────────────

try:
    from bedrock_agentcore.runtime import BedrockAgentCoreApp
    app = BedrockAgentCoreApp()

    @app.entrypoint
    async def invoke(payload, context):
        """AgentCore Runtime 入口。"""
        agent = get_agent()
        prompt = payload.get("prompt", "")
        stream = agent.stream_async(prompt)
        async for event in stream:
            if "data" in event and isinstance(event["data"], str):
                yield event["data"]

except ImportError:
    # 本機測試用（不需要 AgentCore SDK）
    pass


# ── 本機測試入口 ──────────────────────────────────────────────────────────

def local_test(question: str) -> str:
    """不透過 AgentCore，直接本機測試 Agent。"""
    agent = get_agent()
    result = agent(question)
    return str(result)


# ══════════════════════════════════════════════════════════════════════════
# 規則引擎（確定性判斷，提供 Ground Truth 給 LLM 交叉驗證）
# ══════════════════════════════════════════════════════════════════════════

def _rule_engine_check(scenario: str, snapshot: dict) -> str:
    """根據情境文字，用規則引擎做 SOP 門檻判定。"""
    results = []

    # --- SOP-1 壅塞級別 ---
    road = _match_road(scenario, snapshot)
    saturation = _extract_saturation(scenario)
    if road and saturation is not None:
        seg_id, seg = road
        level = _congestion_level(saturation)
        is_action_road = seg_id in CONGESTION_ACTION_ROADS
        results.append(
            f"SOP-1 判定：{seg['name']} 飽和度 {saturation:.2f} → {level}。"
            f"{'屬城市應變觸發路段，需啟動長綠燈/警力淨空。' if is_action_road and saturation >= 0.85 else '非觸發路段或未達門檻。'}"
        )

    # --- SOP-3 捷運分流 ---
    count = _extract_count(scenario)
    growth = _extract_growth(scenario)
    if ("國父紀念館" in scenario or "捷運" in scenario or "BL17" in scenario):
        if count is not None and count > 25000:
            results.append(f"SOP-3 判定：人潮 {count:,} > 25,000 門檻 → 觸發捷運分流。")
        elif growth is not None and growth > 0.30:
            results.append(f"SOP-3 判定：成長率 {growth:.2f} > 0.30 門檻 → 觸發捷運分流。")
        elif count is not None:
            results.append(f"SOP-3 判定：人潮 {count:,} < 25,000 門檻 → 不觸發。距門檻差 {25000 - count:,} 人。")

    # --- SOP-4 大巨蛋散場 ---
    if "大巨蛋" in scenario or "散場" in scenario:
        if count is not None and growth is not None:
            triggered = count >= 30000 and growth <= -0.20
            results.append(
                f"SOP-4 判定：峰值 {count:,}{'≥' if count >= 30000 else '<'}30,000，"
                f"成長率 {growth:.2f}{'≤' if growth <= -0.20 else '>'}-0.20 → "
                f"{'觸發散場啟動。' if triggered else '不觸發。'}"
            )

    # --- SOP-6 多語通報 ---
    if "漫遊" in scenario or "外籍" in scenario or "多語" in scenario:
        station = _match_station(scenario, snapshot)
        if station:
            sid, sta = station
            roaming = sta.get("roaming_user_pct", 0)
            results.append(
                f"SOP-6 判定：{sta['name']} 漫遊率 {roaming*100:.0f}%"
                f"{'≥' if roaming >= 0.30 else '<'}30% → "
                f"{'觸發多語通報。' if roaming >= 0.30 else '不觸發。'}"
            )

    # --- SOP-5 號誌故障 ---
    if "號誌" in scenario or "紅綠燈" in scenario:
        if "故障" in scenario or "失效" in scenario:
            results.append("SOP-5 判定：號誌故障 → 觸發人工指揮派遣。")

    if not results:
        return "規則引擎無法從輸入中識別明確的 SOP 情境，請提供路段名/站點名 + 數值。"

    return "\n".join(results)


def _scan_alerts(snapshot: dict) -> list:
    """掃描即時數據，找出接近 SOP 門檻的項目。"""
    alerts = []

    # 路段接近 B 級（0.80~0.84）
    for sid, seg in snapshot["road_segments"].items():
        sat = seg.get("saturation_score")
        if sat is not None and 0.80 <= sat < 0.85 and sid in CONGESTION_ACTION_ROADS:
            alerts.append(f"⚠️ {seg['name']}飽和度 {sat:.2f}，距 B 級門檻 0.85 僅差 {0.85 - sat:.2f}")

    # 站點接近人潮門檻
    for sid, sta in snapshot["stations"].items():
        count = sta.get("user_count") or 0
        if sid == "BS_MRT_BL17" and 20000 <= count < 25000:
            alerts.append(f"⚠️ {sta['name']}人潮 {count:,} 人，距分流門檻 25,000 僅差 {25000 - count:,} 人")

    # 漫遊率接近門檻（25%~29%）
    for sid, sta in snapshot["stations"].items():
        roaming = sta.get("roaming_user_pct") or 0
        if 0.25 <= roaming < 0.30:
            alerts.append(f"📡 {sta['name']}漫遊率 {roaming*100:.0f}%，接近多語通報門檻 30%")

    # 大巨蛋散場前兆
    dome = snapshot["stations"].get("BS_TPE_DOME")
    if dome:
        g = dome.get("growth_rate") or 0
        c = dome.get("user_count") or 0
        if c >= 30000 and -0.20 < g <= -0.10:
            alerts.append(f"🏟️ 大巨蛋人潮 {c:,} 人，成長率 {g:.2f}，可能即將散場")

    return alerts


# ══════════════════════════════════════════════════════════════════════════
# 資料讀取輔助函式
# ══════════════════════════════════════════════════════════════════════════

def _get_snapshot_dict() -> dict:
    """讀取原始 CSV/JSON 產生結構化 snapshot dict。"""
    traffic_rows = _read_csv(TRAFFIC_PATH)
    crowd_rows = _read_csv(CROWD_PATH)
    road_data = _read_json(ROAD_PATH)

    ts = sorted({r["Timestamp"] for r in traffic_rows})[-1]
    flow_by_seg = _latest_by_id(traffic_rows, "Segment_ID", ts)
    crowd_by_sta = _latest_by_id(crowd_rows, "BS_ID", ts)

    roads = {}
    for row in road_data:
        sid = row["segment_id"]
        flow = flow_by_seg.get(sid, {})
        roads[sid] = {
            "name": row["name"],
            "capacity_vph": _opt_int(row.get("capacity_vph")),
            "intersections": row.get("intersections", []),
            "alternatives": row.get("alternatives", []),
            "avg_speed": _opt_int(flow.get("Avg_Speed")),
            "saturation_score": _opt_float(flow.get("Saturation_Score")),
        }

    stations = {}
    for sid, row in crowd_by_sta.items():
        stations[sid] = {
            "name": row["Location_Name"],
            "user_count": _opt_int(row.get("User_Count")),
            "growth_rate": _opt_float(row.get("Growth_Rate")),
            "roaming_user_pct": _parse_pct(row.get("Roaming_User_Pct", "0%")),
        }

    return {"timestamp": ts, "road_segments": roads, "stations": stations}


def _build_snapshot_text() -> str:
    """讀取 CSV/JSON 產生結構化快照文字（給 LLM 閱讀）。"""
    snapshot = _get_snapshot_dict()
    lines = [f"快照時間：{snapshot['timestamp']}"]

    # 路段
    lines.append("\n路段狀態（飽和度 ≥ 0.80）：")
    for sid, seg in snapshot["road_segments"].items():
        sat = seg.get("saturation_score")
        if sat is not None and sat >= 0.80:
            trigger_mark = " ★觸發路段" if sid in CONGESTION_ACTION_ROADS else ""
            lines.append(f"  {seg['name']}({sid}) 飽和度={sat:.2f} 車速={seg.get('avg_speed')}km/h{trigger_mark}")

    # 站點
    lines.append("\n站點狀態：")
    for sid, sta in snapshot["stations"].items():
        roaming = sta.get("roaming_user_pct") or 0
        lines.append(
            f"  {sta['name']}({sid}) "
            f"人數={sta.get('user_count', 0):,} "
            f"成長率={sta.get('growth_rate', 0):.2f} "
            f"漫遊率={roaming*100:.0f}%"
        )

    # 主動預警
    alerts = _scan_alerts(snapshot)
    if alerts:
        lines.append("\n⚠️ 主動預警：")
        for a in alerts:
            lines.append(f"  {a}")

    return "\n".join(lines)


def _latest_by_id(rows: list, id_field: str, timestamp: str) -> dict:
    latest = {}
    for row in rows:
        if row.get("Timestamp") and row["Timestamp"] <= timestamp:
            key = row[id_field]
            if key not in latest or row["Timestamp"] >= latest[key]["Timestamp"]:
                latest[key] = row
    return latest


def _read_csv(path: Path) -> list:
    if not path.exists():
        return []
    with path.open(encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def _read_json(path: Path) -> list:
    if not path.exists():
        return []
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def _parse_pct(value) -> float:
    return float(str(value).strip().rstrip("%")) / 100


def _opt_int(value) -> Optional[int]:
    if value in (None, ""):
        return None
    return int(float(value))


def _opt_float(value) -> Optional[float]:
    if value in (None, ""):
        return None
    return float(value)


# ── 文字解析輔助 ──────────────────────────────────────────────────────────

def _extract_saturation(text: str) -> Optional[float]:
    match = re.search(r"0\.\d+", text)
    if match:
        return float(match.group(0))
    if "A 級" in text or "A級" in text:
        return 0.96
    if "B 級" in text or "B級" in text:
        return 0.90
    return None


def _extract_count(text: str) -> Optional[int]:
    match = re.search(r"(\d{1,3}(?:,\d{3})+|\d{4,6})\s*人?", text)
    return int(match.group(1).replace(",", "")) if match else None


def _extract_growth(text: str) -> Optional[float]:
    pct = re.search(r"(-?\d{1,3}(?:\.\d+)?)\s*%", text)
    if pct and any(k in text for k in ("成長率", "變化率", "人流")):
        return float(pct.group(1)) / 100
    dec = re.search(r"-?0\.\d+", text)
    if dec and any(k in text for k in ("成長率", "變化率", "散場", "人流")):
        return float(dec.group(0))
    return None


def _congestion_level(saturation: Optional[float]) -> str:
    if saturation is None:
        return "資料不足"
    if saturation >= 0.95:
        return "A 級癱瘓／紅燈"
    if saturation >= 0.85:
        return "B 級壅擠／黃燈"
    return "一般監測（未達 B 級門檻）"


def _match_road(text: str, snapshot: dict):
    compact = text.replace(" ", "").replace("臺", "台")
    for seg_id, seg in snapshot.get("road_segments", {}).items():
        names = {seg_id, seg["name"], seg["name"].replace("四段", "4段")}
        if any(n and n.replace(" ", "") in compact for n in names):
            return seg_id, seg
    return None


def _match_station(text: str, snapshot: dict):
    compact = text.replace(" ", "").replace("臺", "台").replace("捷運", "").replace("站", "")
    for sid, sta in snapshot.get("stations", {}).items():
        names = {sid, sta["name"], sta["name"].replace("捷運", "").replace("站", "")}
        if any(n and n.replace(" ", "").replace("捷運", "").replace("站", "") in compact for n in names):
            return sid, sta
    return None


def _fallback_sop() -> str:
    """SOP 備案。"""
    return """SOP 第 1 條 壅塞分級：B級 0.85~0.95，A級 >=0.95。觸發路段：忠孝東路/光復南路。
SOP 第 2 條 車禍路障：status=Closed/Blocked/Restricted + severity=High/Critical + RD_開頭。
SOP 第 3 條 捷運分流：BL17 人潮>25,000 或 Growth_Rate>0.30。
SOP 第 4 條 大巨蛋散場：歷史峰值>=30,000 且 Growth_Rate<=-0.20。
SOP 第 5 條 號誌故障：type=Power_Failure 或描述含號誌失效。
SOP 第 6 條 多語通報：Roaming_User_Pct>=30%。
SOP 第 7 條 ETE：base_clearance + max(0,(avg_sat-0.5)*60)。"""


# ── 直接跑此檔案可測試 ────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys
    question = " ".join(sys.argv[1:]) or "如果捷運國父紀念館站目前有 40,000 人，應該怎麼分流？"
    print(f"Q: {question}")
    print(f"A: {local_test(question)}")
