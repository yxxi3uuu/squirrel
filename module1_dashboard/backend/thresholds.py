"""
Pure SOP threshold evaluation for Module 1.

只做 SPEC.md 第 3 節列出的兩條：
- 第 1 條：交通擁塞級別判定（全 15 路段紅黃燈；RD_TPE_001/002 額外觸發長綠燈時制）
- 第 3 條：捷運與接駁分流（BS_MRT_BL17）

輸出全部是 shared/schemas.py 的 TriggerDecision，門檻數值判斷完全在這裡完成，
LLM（見 llm_summary.py）只負責把結果轉成中文提示文字，不重新計算門檻。
"""

from typing import Dict, List, Literal, Optional, Set, Tuple

from shared.schemas import TriggerDecision

SaturationLevel = Literal["info", "yellow", "red"]

# SOP 第 1 條
CLAUSE1_B_LEVEL_THRESHOLD = 0.85
CLAUSE1_A_LEVEL_THRESHOLD = 0.95

# SOP 第 3 條
CLAUSE3_STATION_ID = "BS_MRT_BL17"
CLAUSE3_GROWTH_THRESHOLD = 0.30
CLAUSE3_USER_COUNT_THRESHOLD = 25000


def saturation_level(score: Optional[float]) -> SaturationLevel:
    """Saturation_Score -> Dashboard 紅黃燈顏色（SOP 第 1 條分級）。"""
    if score is None:
        return "info"
    if score >= CLAUSE1_A_LEVEL_THRESHOLD:
        return "red"
    if score >= CLAUSE1_B_LEVEL_THRESHOLD:
        return "yellow"
    return "info"


def evaluate_clause1(snapshot: dict) -> List[dict]:
    """對全部 15 路段做擁塞分級，回傳所有達 B 級以上的 TriggerDecision。"""
    decisions = []
    road_segments = snapshot.get("road_segments", {})

    for segment_id, segment in road_segments.items():
        score = segment.get("saturation_score")
        level = saturation_level(score)
        if level == "info":
            continue

        level_label = "A 級 (癱瘓)" if level == "red" else "B 級 (壅擠)"
        # 模組一只做門檻判斷與預警提示，不產出調度/引導等行動建議
        # （那是模組二事件處置的職責），所以這裡不填 actions。

        decisions.append(
            TriggerDecision(
                triggered=True,
                sop_clause="第 1 條",
                clause_name="交通擁塞級別判定",
                entity_id=segment_id,
                entity_name=segment.get("name", segment_id),
                basis=f"Saturation_Score {score:.2f} 達 {level_label}",
                severity=level,
                timestamp=snapshot.get("timestamp"),
            ).model_dump()
        )

    return decisions


def evaluate_clause3(snapshot: dict) -> List[dict]:
    """BS_MRT_BL17 人流/成長率門檻，觸發時回傳單一 TriggerDecision。"""
    station = snapshot.get("stations", {}).get(CLAUSE3_STATION_ID)
    if not station:
        return []

    growth_rate = station.get("growth_rate", 0.0)
    user_count = station.get("user_count", 0)

    growth_exceeded = growth_rate > CLAUSE3_GROWTH_THRESHOLD
    count_exceeded = user_count > CLAUSE3_USER_COUNT_THRESHOLD
    if not (growth_exceeded or count_exceeded):
        return []

    basis_parts = []
    if growth_exceeded:
        basis_parts.append(f"Growth_Rate {growth_rate:.2f} > 門檻 {CLAUSE3_GROWTH_THRESHOLD}")
    if count_exceeded:
        basis_parts.append(f"User_Count {user_count:,} > 門檻 {CLAUSE3_USER_COUNT_THRESHOLD:,}")

    # 模組一只做門檻判斷與預警提示，不產出分流/調度等行動建議
    # （引導旅客走哪個出口、接駁車調度是模組二事件處置的職責），所以不填 actions。
    return [
        TriggerDecision(
            triggered=True,
            sop_clause="第 3 條",
            clause_name="捷運與接駁分流",
            entity_id=CLAUSE3_STATION_ID,
            entity_name=station.get("name", CLAUSE3_STATION_ID),
            basis="；".join(basis_parts),
            severity="yellow",
            timestamp=snapshot.get("timestamp"),
        ).model_dump()
    ]


def evaluate_triggers(snapshot: dict) -> List[dict]:
    """Module 1 目前範圍內（第 1/3 條）的完整觸發清單。"""
    return evaluate_clause1(snapshot) + evaluate_clause3(snapshot)


def _trigger_key(decision: dict) -> Tuple[str, str]:
    return (decision["sop_clause"], decision["entity_id"])


def new_triggers(previous: List[dict], current: List[dict]) -> List[dict]:
    """回傳 current 中「上一個時間點未觸發、這個時間點才觸發」的項目。

    對應 SPEC.md 開放問題：由 API 層在每次請求時，用前一個可用時間點的
    快照重算一次來取得比對基準，不需要 Module 1 自己保存 session 狀態。
    """
    previous_keys: Set[Tuple[str, str]] = {_trigger_key(d) for d in previous}
    return [d for d in current if _trigger_key(d) not in previous_keys]
