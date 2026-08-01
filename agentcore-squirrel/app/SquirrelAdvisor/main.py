"""
SQUIRREL 策略諮詢顧問 — AgentCore Strands Agent

比賽當天部署：
  cd agentcore-squirrel
  agentcore deploy -y -v
  agentcore status
"""

import csv
import json
import os
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

# ── System Prompt ─────────────────────────────────────────────────────────
SYSTEM_PROMPT = """你是城市交通指揮中心的 AI 策略顧問「松鼠 SQ」。
你的職責是根據 SOP 條款與即時數據快照，回答指揮官的假設性問題（What-if questions）。

回答規則（嚴格遵守）：
1. 判斷依據必須引用 SOP 條款編號（第 N 條）
2. 必須把假設數值與門檻並列比較（例：40,000 > 25,000）
3. 必須主動檢查連鎖條款（例：觸發第 3 條時，檢查是否連動第 6 條）
4. 不觸發時誠實說「不觸發」，並說明距門檻差多少
5. 回答格式：
   結論（觸發/不觸發哪條 SOP）
   ■ 建議處置：具體動作
   ■ 後續確認：連鎖檢查或升級條件
6. 不使用 markdown，使用繁體中文

你有兩個工具可用：
- get_sop()：取得 SOP 全文
- get_snapshot()：取得即時數據快照

每次回答前，請先呼叫這兩個工具取得最新資料，再進行判斷。"""


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
            region_name=os.environ.get("AWS_REGION", "us-west-2"),
        )
        _agent = Agent(
            model=model,
            system_prompt=SYSTEM_PROMPT,
            tools=[get_sop, get_snapshot],
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


# ── 輔助函式 ──────────────────────────────────────────────────────────────

def _build_snapshot_text() -> str:
    """讀取 CSV/JSON 產生結構化快照文字。"""
    lines = []

    # 車流
    if TRAFFIC_PATH.exists():
        rows = list(csv.DictReader(TRAFFIC_PATH.open(encoding="utf-8-sig")))
        ts = sorted({r["Timestamp"] for r in rows})[-1]
        latest = {}
        for r in rows:
            if r["Timestamp"] <= ts:
                latest[r["Segment_ID"]] = r
        lines.append(f"快照時間：{ts}")
        lines.append("路段狀態（飽和度 ≥ 0.80）：")
        for sid, r in latest.items():
            sat = float(r["Saturation_Score"])
            if sat >= 0.80:
                lines.append(f"  {r['Road_Name']}({sid}) 飽和度={sat:.2f} 車速={r['Avg_Speed']}km/h")

    # 人流
    if CROWD_PATH.exists():
        rows = list(csv.DictReader(CROWD_PATH.open(encoding="utf-8-sig")))
        ts = sorted({r["Timestamp"] for r in rows})[-1]
        latest = {}
        for r in rows:
            if r["Timestamp"] <= ts:
                latest[r["BS_ID"]] = r
        lines.append("\n站點狀態：")
        for sid, r in latest.items():
            roaming = float(r["Roaming_User_Pct"].strip().rstrip("%")) / 100
            lines.append(
                f"  {r['Location_Name']}({sid}) "
                f"人數={int(r['User_Count']):,} "
                f"成長率={float(r['Growth_Rate']):.2f} "
                f"漫遊率={roaming*100:.0f}%"
            )

    return "\n".join(lines) if lines else "無法讀取快照資料"


def _fallback_sop() -> str:
    """SOP 備案（如果檔案不存在）。"""
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
