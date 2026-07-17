"""
llm/clients.py
LLM 抽象層 — 統一介面，依環境變數 LLM_MODE 切換三種後端：
  mock      : 罐頭答案，不需任何 API key（開發初期接通前後端用）
  anthropic : 本機開發，需設 ANTHROPIC_API_KEY
  bedrock   : 正式賽，需 AWS 憑證與 Bedrock model access ⭐
"""

import os
import json
import logging
import re
import time
from functools import lru_cache
from pathlib import Path
from typing import Any, List, Dict, Optional

logger = logging.getLogger(__name__)

LLM_MODE = os.environ.get("LLM_MODE", "mock").lower()

# 可透過環境變數覆寫 model ID
BEDROCK_MODEL_ID = os.environ.get(
    "BEDROCK_MODEL_ID",
    "anthropic.claude-3-5-sonnet-20241022-v2:0",
)
BEDROCK_INFERENCE_PREFIX = os.environ.get("BEDROCK_INFERENCE_PREFIX", "").strip(".")
BEDROCK_MAX_RETRIES = int(os.environ.get("BEDROCK_MAX_RETRIES", "3"))
BEDROCK_RETRY_DELAY_SECONDS = float(os.environ.get("BEDROCK_RETRY_DELAY_SECONDS", "2"))
ANTHROPIC_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-3-5-sonnet-20241022")
PROJECT_ROOT = Path(__file__).resolve().parents[1]
ROAD_GEOMETRY_PATH = PROJECT_ROOT / "data_source" / "road_network_geometry.json"

# Module 3 只回答「假設性問題」，這些名稱用來把自然語言對應回 SOP/路網資料。
ROAD_NAMES = (
    "忠孝東路四段",
    "光復南路",
    "基隆路一段",
    "市民大道四段",
    "仁愛路四段",
    "敦化南路一段",
    "松高路",
    "延吉街",
    "基隆路地下道",
    "市府路",
    "松壽路",
    "敦化南路二段",
    "信義路五段",
    "松智路",
    "復興南路一段",
)

STATION_NAMES = (
    "大巨蛋場館內",
    "捷運國父紀念館站",
    "松山文創園區",
    "捷運忠孝敦化站",
    "信義威秀商圈",
    "台北101廣場",
    "市府轉運站",
    "ATT4FUN周邊",
    "捷運市政府站",
)

INCIDENT_CONGESTION_FOLLOW_UP = (
    "若主疏散路段本身已達 B 級以上壅塞，依 SOP 第 2 條仍維持該路徑，"
    "並同步啟動長綠燈時制，於回報中註明壅塞狀態並建議併行大眾運輸。"
)

SIGNAL_FAILURE_FOLLOW_UP = (
    "若號誌故障造成車流回堵，請同步監測受影響路段與相鄰替代路段壅塞程度；"
    "若忠孝東路四段或光復南路達 B/A 級，需另依 SOP 第 1 條交通壅塞級別判定是否啟動長綠燈時制"
)

CONGESTION_ACTION_ROADS = {"忠孝東路四段", "光復南路"}

# 否定詞：出現在「封閉」「阻斷」等關鍵字前面時，代表使用者明確表示「沒有」該狀態，
# 不可誤判為狀態成立（例如「沒有封閉」不等於「封閉」）。
NEGATION_MARKERS = ("沒有", "沒", "未", "並未", "并未", "不是", "無")


# ---------------------------------------------------------------------------
# 公開介面
# ---------------------------------------------------------------------------

def chat(
    system_prompt: str,
    messages: List[Dict[str, str]],
    snapshot: Optional[Dict[str, Any]] = None,
) -> str:
    """
    統一 LLM 呼叫介面。

    Args:
        system_prompt: 角色設定 + SOP 全文 + 回答規則
        messages: 對話歷史 + 新問題，格式 [{"role": "user"/"assistant", "content": "..."}]

    Returns:
        AI 回答字串
    """
    logger.info("LLM_MODE=%s, messages=%d", LLM_MODE, len(messages))

    if LLM_MODE == "mock":
        answer = _chat_mock(system_prompt, messages, snapshot=snapshot)
    elif LLM_MODE == "anthropic":
        answer = _chat_anthropic(system_prompt, messages)
    elif LLM_MODE == "bedrock":
        answer = _chat_bedrock(system_prompt, messages)
    else:
        raise ValueError(f"未知的 LLM_MODE: {LLM_MODE}，請設為 mock / anthropic / bedrock")

    return _finalize_public_answer(_commanderize_answer(answer))


def get_mode() -> str:
    return LLM_MODE


def _commanderize_answer(answer: str) -> str:
    protected_ids = {}

    def protect_id(match: re.Match) -> str:
        token = f"__KEEP_ID_{len(protected_ids)}__"
        protected_ids[token] = match.group(0)
        return token

    answer = re.sub(r"（RD_[A-Z0-9_]+）", protect_id, answer)

    replacements = {
        "■ 觸發條款：": "■ 判定：",
        "■ 判定依據：": "■ 依據：",
        "■ 預期動作：": "■ 建議處置：",
        "■ 連鎖檢查：": "■ 後續確認：",
        "User_Count": "人潮",
        "Growth_Rate": "人流變化率",
        "Saturation_Score": "壅塞指標",
        "Roaming_User_Pct": "外籍旅客比例",
        "BS_MRT_BL17": "捷運國父紀念館站",
        "BS_MRT_BL18": "捷運市政府站",
        "BS_TPE_DOME": "大巨蛋",
        "BS_TPE_101": "台北101廣場",
        "RD_TPE_001": "忠孝東路四段",
        "RD_TPE_002": "光復南路",
        "ETE": "預計恢復時間",
        "severity": "嚴重度",
        "base_clearance": "基本排除時間",
        "congestion_penalty": "壅塞加成時間",
        "Closed / Blocked / Restricted": "封閉、阻斷或限制通行",
        "Closed": "封閉",
        "Blocked": "阻斷",
        "Restricted": "限制通行",
        "alternatives": "替代道路",
        "CMS": "資訊看板",
        "Critical": "重大",
        "High": "高",
        "Medium": "中",
    }
    for old, new in replacements.items():
        answer = answer.replace(old, new)
    answer = re.sub(r"人潮 = ([\d,]+) ≤", r"人潮為 \1 人，未超過", answer)
    answer = re.sub(r"人潮 = ([\d,]+)", r"人潮達 \1 人", answer)
    answer = answer.replace("人流變化率 = ", "散場人流變化率 ")
    answer = answer.replace("請確認 捷運國父紀念館站 人潮 是否 ≥ 25,000", "請確認捷運國父紀念館站人潮是否達 25,000 人以上")
    answer = answer.replace("光復南路 出現", "光復南路出現")
    answer = answer.replace("從 替代道路", "從替代道路")
    answer = re.sub(r"\bBS_[A-Z0-9_]+\b", "指定站點", answer)
    answer = re.sub(r"\bRD_[A-Z0-9_]+\b", "指定路段", answer)
    for token, original in protected_ids.items():
        answer = answer.replace(token, original)
    return answer


def _finalize_public_answer(answer: str) -> str:
    lines = []
    for line in answer.splitlines():
        cleaned = line.strip()
        cleaned = cleaned.strip("*")
        cleaned = cleaned.strip()
        label_text = re.sub(r"[*_`]", "", cleaned)
        if not cleaned:
            lines.append("")
            continue
        if re.match(r"^(?:■\s*)?(?:判定|觸發條款)\s*[:：]", label_text):
            cleaned = re.sub(r"^(?:■\s*)?(?:[*_`]*\s*)?(?:判定|觸發條款)(?:[*_`]*\s*)[:：]\s*", "", cleaned)
            if cleaned:
                lines.append(cleaned)
            continue
        if re.match(r"^(?:■\s*)?(?:依據|判定依據|法條依據)\s*[:：]", label_text):
            continue
        lines.append(cleaned)
    return "\n".join(lines).strip()


# ---------------------------------------------------------------------------
# Mock 模式 — 罐頭答案對應驗收標準 T1–T7
# ---------------------------------------------------------------------------

def _chat_mock(
    system_prompt: str,
    messages: List[Dict],
    snapshot: Optional[Dict[str, Any]] = None,
) -> str:
    # Mock 模式不是單純罐頭字串，而是用輕量規則模擬 SOP 判斷流程。
    # 這讓前端和口試 demo 在沒有 API key 時，也能驗證 Module 3 的互動邏輯。
    last = _latest_user_message(messages)
    normalized = _normalize_demo_text(last)

    if _is_sop_overview_request(last):
        return _answer_sop_overview()

    if _is_congestion_rule_request(last):
        return _answer_congestion_rule()

    if _is_roaming_rule_request(last):
        return _answer_roaming_rule()

    if _is_roaming_scan_request(last):
        return _answer_roaming_scan(snapshot)

    road_congestion = _extract_road_congestion(last)
    if road_congestion is not None:
        road_name, saturation = road_congestion
        return _answer_saturation(saturation, road_name)

    # 大巨蛋與捷運國父紀念館站的問題必須先各自解析出使用者實際輸入的
    # 人潮／成長率數值，不可以套用固定的示範數字（例如寫死 40,000 或 -0.25），
    # 否則使用者輸入 10,000 人也會被錯誤地回答成 40,000 人已觸發。
    if "大巨蛋" in last:
        dome_answer = _answer_dome_request(last)
        if dome_answer is not None:
            return dome_answer

    if _is_metro_split_request(last):
        metro_answer = _answer_metro_request(last, snapshot=snapshot)
        if metro_answer is not None:
            return metro_answer

    user_count = _extract_user_count(last)
    if user_count is not None:
        return _answer_metro_split(user_count, snapshot=snapshot)

    increment = _extract_increment(last)
    if increment is not None:
        base = _find_previous_user_count(messages[:-1])
        if base is None:
            return (
                "■ 判定：目前 SOP 內容不足以判定\n"
                "■ 依據：追問提到再增加人數，但缺少上一輪人潮基準\n"
                "■ 建議處置：請先補充例如「假設捷運國父紀念館站人潮增至 40,000 人」\n"
                "■ 後續確認：無"
            )
        return _answer_metro_split(base + increment, snapshot=snapshot)

    if _is_signal_failure(last):
        return _answer_signal_failure(last, snapshot=snapshot)

    if _is_incident_response(last):
        return _answer_incident_response(last, snapshot=snapshot)

    ete_case = _extract_ete_case(last)
    if ete_case is not None:
        return _answer_ete(*ete_case)

    saturation = _extract_saturation(last)
    if saturation is not None:
        return _answer_saturation(saturation)

    growth_rate = _extract_growth_rate(last)
    if growth_rate is not None:
        return _answer_dome_dismissal_full(40000, growth_rate)

    station_roaming = _extract_station_roaming(last)
    if station_roaming is not None:
        station_name, roaming = station_roaming
        if roaming is None:
            snapshot_roaming = _snapshot_station_roaming(snapshot, station_name)
            if snapshot_roaming is None:
                return _answer_station_roaming_missing(station_name)
            roaming = int(round(snapshot_roaming * 100))
        return _answer_roaming(
            roaming,
            station_name,
            from_snapshot=not _has_explicit_percentage(last),
            timestamp=_snapshot_timestamp(snapshot),
            cascade_from_metro=_has_previous_metro_split(messages[:-1]),
        )

    roaming_pct = _extract_roaming_pct(last)
    if roaming_pct is not None:
        return _answer_roaming(roaming_pct, cascade_from_metro=_has_previous_metro_split(messages[:-1]))

    # 保留早期驗收用的極短輸入，例如只打「40000」或「0.96」。
    if "40000" in normalized:
        return _answer_metro_split(40000, snapshot=snapshot)
    if "0.96" in last:
        return _answer_saturation(0.96)
    if "0.90" in last:
        return _answer_saturation(0.90)
    if "0.80" in last:
        return _answer_saturation(0.80)
    if "-0.25" in last:
        return _answer_dome_dismissal_full(40000, -0.25)
    if "35%" in last or ("漫遊" in last and "35" in last):
        return _answer_roaming(35)

    missing = _answer_missing_conditions(last)
    if missing is not None:
        return missing

    # T7 variants where the user omits the comma.
    if "再加5000" in normalized:
        base = _find_previous_user_count(messages[:-1])
        if base is not None:
            return _answer_metro_split(base + 5000, snapshot=snapshot)

    return (
        "■ 判定：目前 SOP 內容不足以判定\n"
        "■ 依據：問題中沒有足夠的假設條件，尚無法對照 SOP 門檻\n"
        "■ 建議處置：請補充地點、事件類型、嚴重度或人流/壅塞數值，例如「光復南路發生嚴重車禍並封鎖」\n"
        "■ 後續確認：無"
    )


def _latest_user_message(messages: List[Dict]) -> str:
    return next((m["content"] for m in reversed(messages) if m["role"] == "user"), "")


def _normalize_demo_text(text: str) -> str:
    return text.replace(",", "").replace("，", "")


# ---------------------------------------------------------------------------
# Mock 輸入解析：從自然語言抽出數值或地點
# ---------------------------------------------------------------------------

def _extract_user_count(text: str) -> Optional[int]:
    if not any(keyword in text for keyword in ("人數", "人潮", "User_Count", "user_count", "增至", "增加到", "達到", "湧進")):
        return None
    match = re.search(r"(\d{1,3}(?:,\d{3})+|\d{4,6})\s*人?", text)
    return int(match.group(1).replace(",", "")) if match else None


def _extract_increment(text: str) -> Optional[int]:
    if not any(keyword in text for keyword in ("再加", "再增加", "再多")):
        return None
    match = re.search(r"(?:再加|再增加|再多)\s*(\d{1,3}(?:,\d{3})+|\d{3,6})\s*人?", text)
    return int(match.group(1).replace(",", "")) if match else None


def _find_previous_user_count(messages: List[Dict]) -> Optional[int]:
    for message in reversed(messages):
        text = message.get("content", "")
        count = _extract_user_count(text)
        if count is not None:
            return count

        # Assistant answers include "User_Count = 40,000"; use it as a fallback.
        match = re.search(r"User_Count\s*=\s*(\d{1,3}(?:,\d{3})+|\d{4,6})", text)
        if match:
            return int(match.group(1).replace(",", ""))
    return None


def _has_previous_metro_split(messages: List[Dict]) -> bool:
    for message in reversed(messages):
        text = message.get("content", "")
        if "第 3 條" in text and "捷運與接駁分流" in text:
            return True
    return False


def _extract_saturation(text: str) -> Optional[float]:
    if "飽和" not in text and "Saturation" not in text:
        return None
    match = re.search(r"0\.\d+", text)
    return float(match.group(0)) if match else None


def _extract_growth_rate(text: str) -> Optional[float]:
    if "Growth_Rate" not in text and "growth_rate" not in text.lower() and "散場" not in text and "下降" not in text:
        return None
    match = re.search(r"-?0\.\d+", text)
    return float(match.group(0)) if match else None


def _extract_roaming_pct(text: str) -> Optional[int]:
    roaming_keywords = ("漫遊", "Roaming", "外籍", "旅客", "比例", "多語", "通報")
    if not any(keyword in text for keyword in roaming_keywords):
        return None
    match = re.search(r"(\d{1,3})\s*%", text)
    return int(match.group(1)) if match else None


def _has_explicit_percentage(text: str) -> bool:
    return re.search(r"(\d{1,3})\s*%", text) is not None


def _extract_road_congestion(text: str) -> Optional[tuple[str, float]]:
    if not any(keyword in text for keyword in ("壅塞", "擁塞", "塞車", "飽和", "交通", "門檻", "應變")):
        return None
    road_name = _matched_road_name(text)
    if road_name is None:
        return None
    match = re.search(r"0\.\d+", text)
    if match:
        return road_name, float(match.group(0))
    if "A 級" in text or "A級" in text or "癱瘓" in text or "紅燈" in text:
        return road_name, 0.96
    if "B 級" in text or "B級" in text or "壅擠" in text or "黃燈" in text:
        return road_name, 0.90
    if "未達" in text or "不觸發" in text:
        return road_name, 0.80
    return road_name, 0.90
    return None


def _is_metro_split_request(text: str) -> bool:
    return (
        ("國父紀念館站" in text or "BL17" in text)
        and any(keyword in text for keyword in ("分流", "人潮", "接駁", "過站不停", "捷運"))
    )


def _extract_count_in_context(text: str) -> Optional[int]:
    """在已知情境（大巨蛋／捷運站）下抽取人潮數字，不要求特定前綴關鍵字，
    因為「目前有 40,000 人」這類句子不見得會出現「人潮」「達到」等字樣。"""
    match = re.search(r"(\d{1,3}(?:,\d{3})+|\d{4,6})\s*人", text)
    return int(match.group(1).replace(",", "")) if match else None


def _extract_dome_growth_rate(text: str) -> Optional[float]:
    if not any(keyword in text for keyword in ("成長率", "增长率", "變化率", "变化率", "Growth_Rate", "growth_rate")):
        return None
    match = re.search(r"-?0\.\d+", text)
    return float(match.group(0)) if match else None


def _extract_metro_growth_rate(text: str) -> Optional[float]:
    if not any(keyword in text for keyword in ("成長率", "增长率", "變化率", "变化率", "Growth_Rate", "growth_rate")):
        return None
    percent_match = re.search(r"(-?\d{1,3}(?:\.\d+)?)\s*%", text)
    if percent_match:
        return float(percent_match.group(1)) / 100
    decimal_match = re.search(r"-?0\.\d+", text)
    return float(decimal_match.group(0)) if decimal_match else None


def _is_roaming_rule_request(text: str) -> bool:
    return (
        any(keyword in text for keyword in ("多語", "數位通報", "外籍旅客比例"))
        and any(keyword in text for keyword in ("觸發條件", "如何", "怎麼", "門檻", "規則", "判定"))
    )


def _is_roaming_scan_request(text: str) -> bool:
    return (
        any(keyword in text for keyword in ("哪些站點", "哪些基地台", "哪些地點", "哪些區域"))
        and any(keyword in text for keyword in ("多語", "通報"))
    )


def _extract_station_roaming(text: str) -> Optional[tuple[str, Optional[int]]]:
    if not any(keyword in text for keyword in ("多語", "通報", "外籍", "旅客")):
        return None
    # 站名比對時忽略空白，避免「ATT4FUN 周邊」因中間多一個空格而比對不到
    # 「ATT4FUN周邊」。
    normalized = text.replace(" ", "").replace("　", "")
    for station_name in STATION_NAMES:
        if station_name not in normalized:
            continue
        match = re.search(r"(\d{1,3})\s*%", text)
        if match:
            return station_name, int(match.group(1))
        return station_name, None
    return None


def _extract_ete_case(text: str) -> Optional[tuple[str, float]]:
    if not any(keyword in text for keyword in ("ETE", "恢復時間", "預計恢復")):
        return None

    severity = None
    for candidate in ("Critical", "High", "Medium"):
        if candidate.lower() in text.lower():
            severity = candidate
            break
    if severity is None:
        if "嚴重" in text or "全線封鎖" in text:
            severity = "Critical"
        else:
            severity = "High"

    match = re.search(r"0\.\d+", text)
    saturation = float(match.group(0)) if match else 0.85
    return severity, saturation


# ---------------------------------------------------------------------------
# Mock 意圖判斷：判斷使用者正在問哪一條 SOP
# ---------------------------------------------------------------------------

def _is_signal_failure(text: str) -> bool:
    return "號誌" in text and any(keyword in text for keyword in ("故障", "失效", "Power_Failure"))


def _is_incident_response(text: str) -> bool:
    incident_keywords = ("車禍", "事故", "路障", "封鎖", "受阻", "封閉", "撞", "Restricted", "Closed", "Blocked")
    return any(keyword in text for keyword in incident_keywords)


def _is_sop_overview_request(text: str) -> bool:
    overview_keywords = ("有哪些", "總覽", "整理", "說明", "可以問", "能問", "SOP", "sop")
    return any(keyword in text for keyword in overview_keywords) and any(
        scope in text for scope in ("條款", "規則", "功能", "問題", "問什麼", "怎麼用", "顧問")
    )


def _is_congestion_rule_request(text: str) -> bool:
    return (
        any(keyword in text for keyword in ("壅塞級別", "擁塞級別", "壅塞等級", "擁塞等級", "交通壅塞級別", "交通擁塞級別"))
        and any(keyword in text for keyword in ("如何", "怎麼", "判定", "規則", "說明"))
    )


# ---------------------------------------------------------------------------
# Mock 回答產生：每個函式對應一類 SOP 情境
# ---------------------------------------------------------------------------

def _answer_sop_overview() -> str:
    return (
        "■ 判定：可判斷第 1 至第 7 條 SOP\n"
        "■ 依據：本顧問會同時讀取 SOP、使用者假設條件與當前播放時間點快照；使用者明講的值視為假設，其餘現況由快照補足\n"
        "■ 建議處置：可詢問壅塞 A/B 級、車禍與路障、捷運與接駁分流、大巨蛋散場、號誌故障、多語通報、預計恢復時間\n"
        "■ 後續確認：事故與號誌會附帶預計恢復時間；捷運分流若另有外籍旅客比例達 30% 以上，會連動多語通報"
    )


def _answer_congestion_rule() -> str:
    return (
        "根據 SOP 第 1 條交通壅塞級別判定，全部 15 個路段都用同一套飽和度門檻顯示 Dashboard 燈號：0.85 至未滿 0.95 為 B 級壅擠／黃燈，0.95 以上為 A 級癱瘓／紅燈\n"
        "■ 建議處置：若達 B 級或 A 級的是忠孝東路四段或光復南路，需通報交控中心啟動長綠燈時制，將該路段替代道路綠燈配時 +25%，並調度警力淨空路口；若達 A 級，除上述動作外，還要同步啟動替代路徑引導\n"
        "■ 後續確認：其他 13 個路段即使達黃燈或紅燈，也只影響 Dashboard 顯示，不會因第 1 條自動啟動長綠燈、警力淨空或替代路徑引導；若它們是第 2 條事故的主疏散路段，才依第 2 條但書另行處理。"
    )


def _answer_roaming_rule() -> str:
    return (
        "根據 SOP 第 6 條數位通報與多語化之規定，當任一基地台之漫遊率高於 30% 以上，則啟動數位通報與多語化之措施\n"
        "■ 建議處置：請將該區域周邊簡訊、資訊看板同步改為中英日韓越泰法等多語版本，並於同一回應產出。時間格式統一為 YYYY-MM-DD HH:MM。\n"
        "■ 後續確認：若降至 30% 以下，則切回中文簡訊、資訊看板與現場廣播"
    )


def _answer_roaming_scan(snapshot: Optional[Dict[str, Any]]) -> str:
    triggered = []
    if snapshot:
        for station in snapshot.get("stations", {}).values():
            roaming = station.get("roaming_user_pct")
            if roaming is not None and roaming >= 0.30:
                triggered.append(f"{station['name']}（{int(round(roaming * 100))}%）")

    if not triggered:
        return (
            "依據 SOP 第 6 條數位通報與多語化規定，目前快照中沒有站點外籍旅客比例達 30% 門檻，暫不需啟動多語通報\n"
            "■ 建議處置：維持一般通報，持續監測各站點外籍旅客比例\n"
            "■ 後續確認：若任一基地台外籍旅客比例升至 30% 以上，需立即切換為多語通報"
        )

    stations_text = "、".join(triggered)
    return (
        f"依據 SOP 第 6 條數位通報與多語化規定，目前快照中外籍旅客比例達 30% 的站點為{stations_text}，需啟動多語通報\n"
        "■ 建議處置：請針對達標站點同步產出中英日韓越泰法多語簡訊與資訊看板內容，並統一使用 YYYY-MM-DD HH:MM 時間格式\n"
        "■ 後續確認：未達 30% 的站點維持一般通報並持續監測；若後續任一基地台外籍旅客比例升至 30% 以上，需立即切換為多語通報"
    )


def _answer_missing_conditions(text: str) -> Optional[str]:
    if not any(keyword in text for keyword in ("怎麼", "如何", "處理", "應變", "啟動", "需要", "要不要", "判斷", "嗎", "呢")):
        return None

    if "壅塞" in text or "塞車" in text or "擁塞" in text or "交通" in text:
        return (
            "目前資訊不足，尚不能判定屬於何種級別\n"
            "■ 建議處置：請補充路段名稱與壅塞程度，例如「忠孝東路四段壅塞程度達 0.90」或「光復南路達 A 級」\n"
            "■ 後續確認：第 1 條分級顏色適用全 15 路段，但只有忠孝東路四段與光復南路達 B 級或 A 級時，才會啟動長綠燈時制、警力淨空；A 級另需啟動替代路徑引導"
        )

    if "捷運" in text or "國父紀念館" in text or "BL17" in text:
        return (
            "■ 判定：目前 SOP 內容不足以判定\n"
            "■ 依據：第 3 條需要知道捷運國父紀念館站人潮是否超過 25,000 人，或人流成長率是否大於 30%\n"
            "■ 建議處置：請補充例如「假設捷運國父紀念館站人潮增至 40,000 人」\n"
            "■ 後續確認：若另有外籍旅客比例達 30% 以上，才需連動第 6 條"
        )

    if "大巨蛋" in text or "散場" in text:
        return (
            "■ 判定：目前 SOP 內容不足以判定\n"
            "■ 依據：第 4 條需要同時知道大巨蛋歷史峰值是否曾達 30,000 人，以及目前人流是否已明顯轉為散場\n"
            "■ 建議處置：請補充例如「假設大巨蛋人潮曾達 40,000 人且開始散場」\n"
            "■ 後續確認：若第 4 條成立，需提前連動第 3 條接駁機制"
        )

    if "多語" in text or "外籍" in text or "通報" in text:
        return (
            "目前資訊不足，尚不能判定是否啟動 SOP 第 6 條數位通報與多語化\n"
            "■ 建議處置：請指定站點或區域，例如「檢查台北101廣場是否需要啟動多語通報」；若要全域檢查，也可以詢問「目前哪些站點需要啟動多語通報？」\n"
            "■ 後續確認：第 6 條觸發條件為任一基地台外籍旅客比例達 30% 以上，系統會從目前快照讀取比例，不需指揮官手動提供"
        )

    if "號誌" in text or "故障" in text:
        return (
            "■ 判定：第 5 條（號誌故障應變）可能成立，但仍需指定地點\n"
            "■ 依據：問題提到號誌情境；若描述含號誌故障或失效，即符合第 5 條觸發條件\n"
            "■ 建議處置：請指定受影響路段；每路口配置 2 名警力，資訊看板加註「號誌故障，請依現場指揮通行」\n"
            "■ 後續確認：需附帶第 7 條預計恢復時間"
        )

    return (
        "■ 判定：目前 SOP 內容不足以判定\n"
        "■ 依據：自由輸入尚未包含足夠的假設條件，例如地點、數值、事件類型或嚴重度\n"
        "■ 建議處置：請補充具體情境，例如「光復南路發生嚴重車禍並封鎖」或「國父紀念館站人潮增至 40,000 人」\n"
        "■ 後續確認：無"
    )


def _answer_metro_split(
    user_count: int,
    snapshot: Optional[Dict[str, Any]] = None,
) -> str:
    formatted = f"{user_count:,}"
    if user_count > 25000:
        follow_up = _metro_roaming_follow_up(snapshot)
        return (
            f"■ 判定：假設捷運國父紀念館站人潮達 {formatted} 人，已超過 SOP 門檻 25,000 人，觸發第 3 條（捷運與接駁分流），應立即啟動過站不停與接駁分流\n"
            "■ 依據：第 3 條規定，捷運國父紀念館站人潮超過 25,000 人，或人流成長率超過 30%，即需啟動捷運與接駁分流\n"
            "■ 建議處置：請通知北捷評估過站不停，同步調度接駁專車，並引導人潮改往捷運市政府站分散進站\n"
            f"■ 後續確認：{follow_up}"
        )
    gap = 25000 - user_count + 1
    return (
        f"■ 判定：假設捷運國父紀念館站人潮為 {formatted} 人，尚未超過 SOP 門檻 25,000 人，不觸發第 3 條（捷運與接駁分流）\n"
        f"■ 依據：第 3 條的人潮門檻為 25,000 人；目前距觸發約差 {gap:,} 人\n"
        "■ 建議處置：暫不啟動過站不停或接駁分流，持續觀察國父紀念館站進站人潮與成長速度\n"
        "■ 後續確認：若後續人潮升破 25,000 人，或現場出現快速湧入情形，需重新判定第 3 條"
    )


def _answer_metro_request(text: str, snapshot: Optional[Dict[str, Any]] = None) -> Optional[str]:
    """依 SOP 第 3 條回答捷運國父紀念館站分流問題。

    人潮與人流成長率任一達標即觸發，兩者都沒有明講時要請使用者補充，
    不可以套用固定示範數字。
    """
    count = _extract_count_in_context(text)
    growth = _extract_metro_growth_rate(text)

    if count is None and growth is None:
        return _answer_metro_missing_info()
    if count is not None:
        return _answer_metro_split(count, snapshot=snapshot)
    return _answer_metro_growth_trigger(growth, snapshot=snapshot)


def _answer_metro_growth_trigger(
    growth_rate: float,
    snapshot: Optional[Dict[str, Any]] = None,
) -> str:
    percent = growth_rate * 100
    if growth_rate > 0.30:
        follow_up = _metro_roaming_follow_up(snapshot)
        return (
            f"捷運國父紀念館站人流成長率超過 30%，符合 SOP 第 3 條捷運與接駁分流觸發條件，應立即啟動過站不停與接駁分流\n"
            "■ 建議處置：請通知北捷評估過站不停，通知公車處調度接駁專車，並引導群眾步行至捷運市政府站分散進站\n"
            f"■ 後續確認：{follow_up}"
        )
    return (
        f"捷運國父紀念館站人流成長率為 {percent:.0f}%，尚未超過 SOP 第 3 條 30% 門檻，暫不啟動捷運與接駁分流\n"
        "■ 建議處置：持續監測國父紀念館站人潮與人流成長率，暫不通知北捷過站不停或調度接駁專車\n"
        "■ 後續確認：若人潮升至 25,000 人以上，或人流成長率超過 30%，需立即啟動過站不停、接駁專車與步行引導至捷運市政府站"
    )


def _answer_metro_missing_info() -> str:
    return (
        "目前資訊不足，尚不能判定是否觸發 SOP 第 3 條捷運與接駁分流\n"
        "■ 建議處置：請補充捷運國父紀念館站目前人潮或人流成長率，例如「人潮達 40,000 人」或「人流成長率超過 30%」\n"
        "■ 後續確認：第 3 條任一條件成立即可觸發；若成立，需通知北捷評估過站不停、調度接駁專車，並引導群眾步行至捷運市政府站"
    )


def _answer_dome_request(text: str) -> Optional[str]:
    """依 SOP 第 4 條回答大巨蛋散場問題。

    第 4 條需要「歷史峰值 >= 30,000 人」與「當前成長率 <= -0.20」同時成立，
    兩項都沒有明講數字時，只有在使用者明確講「散場／退場／離場」時才套用
    保守示範假設（沿用既有快捷鍵行為），否則一律請使用者補充。
    """
    peak = _extract_count_in_context(text)
    growth = _extract_dome_growth_rate(text)
    explicit_dismissal_wording = any(keyword in text for keyword in ("散場", "退場", "離場"))

    if peak is None and growth is None:
        if not explicit_dismissal_wording:
            return None
        return _answer_dome_missing_both()

    if growth is None and explicit_dismissal_wording:
        growth = -0.25

    if peak is not None and growth is None:
        return _answer_dome_missing_growth(peak)
    if peak is None and growth is not None:
        return _answer_dome_missing_peak(growth)
    return _answer_dome_dismissal_full(peak, growth)


def _answer_dome_dismissal_full(peak: int, growth_rate: float) -> str:
    peak_formatted = f"{peak:,}"
    if peak >= 30000 and growth_rate <= -0.20:
        return (
            f"大巨蛋人潮曾達 {peak_formatted} 人，且目前人流成長率為 {growth_rate:.2f}，已符合 SOP 第 4 條大巨蛋散場啟動條件，應立即標記散場啟動\n"
            "■ 建議處置：請切換為散場應變，提前連動 SOP 第 3 條捷運與接駁分流，通知北捷評估過站不停、通知公車處預備接駁專車，並提醒現場人員引導人潮分批離場\n"
            "■ 後續確認：請同步檢查捷運國父紀念館站人潮是否超過 25,000 人，或人流成長率是否超過 30%；若任一成立，需立即啟動過站不停、接駁專車與步行引導至捷運市政府站"
        )
    if peak < 30000:
        return (
            f"大巨蛋人潮曾達 {peak_formatted} 人，未達 SOP 第 4 條大巨蛋散場啟動規定之歷史峰值門檻，即使目前人流成長率為 {growth_rate:.2f}，也不觸發相應措施\n"
            "■ 建議處置：暫不標記散場啟動，維持一般人流監測與現場秩序引導\n"
            "■ 後續確認：若大巨蛋人潮歷史峰值升至 30,000 人以上，且目前人流成長率降至 -0.20 以下，才需啟動散場應變並提前連動 SOP 第 3 條捷運與接駁分流"
        )
    return (
        f"大巨蛋人潮曾達 {peak_formatted} 人，但目前人流成長率為 {growth_rate:.2f}，尚未降至 SOP 第 4 條大巨蛋散場啟動規定之 -0.20 以下門檻，不觸發大巨蛋散場啟動\n"
        "■ 建議處置：暫不標記散場啟動，持續監測場館出口與周邊人流變化\n"
        "■ 後續確認：若人流成長率降至 -0.20 以下，需立即標記散場啟動，並提前連動 SOP 第 3 條捷運與接駁分流"
    )


def _answer_dome_missing_growth(peak: int) -> str:
    return (
        "目前資訊不足，尚不能判定是否觸發 SOP 第 4 條大巨蛋散場啟動\n"
        "■ 建議處置：請補充目前人流成長率是否降至 -0.20 以下，例如「現在人潮成長率為 -0.25」\n"
        "■ 後續確認：第 4 條需同時符合歷史峰值達 30,000 人以上，且目前人流成長率降至 -0.20 以下；兩項都成立才會標記散場啟動並提前連動 SOP 第 3 條"
    )


def _answer_dome_missing_peak(growth_rate: float) -> str:
    return (
        "目前資訊不足，尚不能判定是否觸發 SOP 第 4 條大巨蛋散場啟動\n"
        "■ 建議處置：請補充大巨蛋人潮歷史峰值是否曾達 30,000 人以上，例如「大巨蛋人潮曾達 40,000 人」\n"
        "■ 後續確認：第 4 條需同時符合歷史峰值達 30,000 人以上，且目前人流成長率降至 -0.20 以下；兩項都成立才會標記散場啟動並提前連動 SOP 第 3 條"
    )


def _answer_dome_missing_both() -> str:
    return (
        "目前資訊不足，尚不能判定是否觸發 SOP 第 4 條大巨蛋散場啟動\n"
        "■ 建議處置：請補充大巨蛋人潮歷史峰值與目前人流成長率，例如「大巨蛋人潮曾達 40,000 人且現在人潮成長率為 -0.25」\n"
        "■ 後續確認：第 4 條需要同時確認歷史峰值是否達 30,000 人以上，以及目前人流成長率是否降至 -0.20 以下；兩項都成立才會啟動散場應變"
    )


def _metro_roaming_follow_up(snapshot: Optional[Dict[str, Any]]) -> str:
    roaming = _snapshot_station_roaming(snapshot, "捷運國父紀念館站")
    if roaming is None:
        return "若現場外籍旅客比例達 30% 以上，需同步啟動第 6 條多語數位通報；目前快照未提供該比例，先不自行判定"

    roaming_pct = int(roaming * 100)
    if roaming >= 0.30:
        return f"目前快照顯示捷運國父紀念館站外籍旅客比例為 {roaming_pct}%，已達 30% 門檻，需同步啟動第 6 條多語數位通報"
    return f"目前快照顯示捷運國父紀念館站外籍旅客比例為 {roaming_pct}%，未達 30% 門檻，暫不連動第 6 條多語數位通報"


def _answer_saturation(saturation: float, road_name: str = "") -> str:
    value = f"{saturation:.2f}"
    subject = road_name or ""
    grade = _congestion_grade(saturation)
    if grade and subject and subject not in CONGESTION_ACTION_ROADS:
        return _answer_visual_only_congestion(subject, saturation, grade)

    alt_names = _alternative_road_names(subject)
    alt_phrase = "、".join(alt_names) if alt_names else "替代路段"

    if saturation >= 0.95:
        return (
            f"■ 判定：假設{subject}壅塞程度達 {value}，已達 SOP A 級門檻 0.95，觸發第 1 條 A 級壅塞應變，應先啟動長綠燈時制與路口淨空，並加上替代路徑引導\n"
            "■ 依據：第 1 條規定，壅塞程度達 0.95 以上為 A 級（癱瘓／紅燈），城市應變觸發路段需加開替代路徑引導\n"
            f"■ 建議處置：請啟動替代路徑引導，將{alt_phrase}綠燈配時延長 25%，並調度警力淨空關鍵路口\n"
            "■ 後續確認：持續確認替代路段是否也升至 B 級以上，避免分流後形成二次壅塞"
        )
    if saturation >= 0.85:
        gap = 0.95 - saturation
        return (
            f"■ 判定：假設{subject}壅塞程度達 {value}，已超過 SOP B 級門檻 0.85，觸發第 1 條 B 級壅塞應變，應先啟動長綠燈時制與路口淨空\n"
            "■ 依據：第 1 條規定，壅塞程度介於 0.85 至 0.95 之間為 B 級（壅擠／黃燈）\n"
            f"■ 建議處置：請先延長{alt_phrase}綠燈配時 25%，並調派警力維持路口淨空\n"
            f"■ 後續確認：距 A 級門檻約差 {gap:.2f}；若升至 A 級，需加開替代路徑引導"
        )
    gap = 0.85 - saturation
    if subject and subject not in CONGESTION_ACTION_ROADS:
        return (
            f"■ 判定：假設{subject}壅塞程度為 {value}，低於 B 級黃燈門檻 0.85，Dashboard 維持一般狀態；該路段也不屬於第 1 條城市應變觸發路段\n"
            "■ 建議處置：維持監測即可，不啟動長綠燈時制、警力淨空或替代路徑引導\n"
            "■ 後續確認：若後續成為事故主疏散路段，應依第 2 條事故應變邏輯重新判斷。"
        )
    return (
        "■ 判定：不觸發第 1 條壅塞應變\n"
        f"■ 依據：{subject}壅塞程度為 {value}，低於 B 級門檻 0.85，距觸發約差 {gap:.2f}\n"
        "■ 建議處置：暫不啟動交通改道或長綠燈時制，維持監測即可\n"
        "■ 後續確認：若後續升至 0.85 以上，再啟動 B 級應變"
    )


def _congestion_grade(saturation: float) -> Optional[str]:
    if saturation >= 0.95:
        return "A"
    if saturation >= 0.85:
        return "B"
    return None


def _answer_visual_only_congestion(road_name: str, saturation: float, grade: str) -> str:
    value = f"{saturation:.2f}"
    segment_id = _road_segment_id_by_name(road_name)
    road_label = f"{road_name}（{segment_id}）" if segment_id else road_name
    if grade == "A":
        rule_text = "飽和度 ≥ 0.95 為 A 級"
        grade_text = "A 級紅燈"
    else:
        rule_text = "0.85 ≤ 飽和度 < 0.95 為 B 級"
        grade_text = "B 級黃燈"
    return (
        f"■ 判定：{road_label}壅塞程度達 {value}，依第 1 條分級規則（{rule_text}）應顯示為 {grade_text}；"
        f"但城市應變觸發路段僅限忠孝東路四段、光復南路兩段，{road_name}不在名單內，因此不會因第 1 條自動啟動長綠燈時制、警力淨空或替代路徑引導\n"
        f"■ 建議處置：Dashboard 依分級規則標示 {grade_text}並持續監測即可，無需額外動作；若後續有事故發生且該路段被列為主疏散路段，才需另行評估\n"
        f"■ 後續確認：若{road_name}是第 2 條某事故的主疏散路段，且本身已壅塞（≥0.85），長綠燈時制的依據應回到第 2 條主疏散路段但書，而非第 1 條——同一動作，不同觸發路徑要引用正確條款。"
    )


def _answer_roaming(
    roaming_pct: int,
    station_name: str = "",
    cascade_from_metro: bool = False,
    from_snapshot: bool = False,
    timestamp: Optional[str] = None,
) -> str:
    subject = f"{station_name}" if station_name else "該區域"
    time_text = f"{timestamp} 快照顯示" if from_snapshot and timestamp else "目前快照顯示" if from_snapshot else "假設"
    source_phrase = "已達" if from_snapshot else "已超過"
    if roaming_pct >= 30:
        cascade = "承接上一輪第 3 條捷運分流，此外籍旅客比例已達第 6 條門檻，需同步啟動多語通報" if cascade_from_metro else "無"
        return (
            f"■ 判定：{time_text}{subject}外籍旅客比例為 {roaming_pct}%，{source_phrase} SOP 門檻 30%，觸發第 6 條（數位通報與多語化），應立即切換為多語通報\n"
            "■ 依據：第 6 條規定，任一基地台或站點外籍旅客比例達 30% 以上，即需啟動中英日韓多語訊息\n"
            f"■ 建議處置：請將{subject}的簡訊、資訊看板與現場廣播同步改為中英日韓多語版本；所有通報時間統一採 YYYY-MM-DD HH:MM 格式\n"
            f"■ 後續確認：{cascade}"
        )
    gap = 30 - roaming_pct
    return (
        f"■ 判定：{time_text}{subject}外籍旅客比例為 {roaming_pct}%，低於 SOP 第 6 條 30% 門檻，距觸發約差 {gap}%，暫不啟動多語數位通報\n"
        "■ 建議處置：暫不啟動多語通報，維持一般通報即可\n"
        "■ 後續確認：若外籍旅客比例升至 30% 以上，需立即切換為多語通報"
    )


def _answer_station_roaming_missing(station_name: str) -> str:
    return (
        f"目前快照沒有找到{station_name}的外籍旅客比例，尚不能判定 SOP 第 6 條是否成立\n"
        "■ 建議處置：請確認該站點基地台漫遊率資料是否已匯入 TrafficSnapshot，或改選有資料的站點\n"
        "■ 後續確認：第 6 條觸發條件是任一基地台外籍旅客比例達 30% 以上；沒有比例資料時不可自行推定觸發。"
    )


def _answer_incident_response(
    text: str,
    snapshot: Optional[Dict[str, Any]] = None,
) -> str:
    """依 SOP 第 2 條回答車禍與路障應變。

    第 2 條成立需要三個條件同時具備：
    1. affected_segment 是道路路段；
    2. status 是封閉、阻斷或限制通行；
    3. severity 是高或重大。

    使用者只說「有車禍」時，不可以替他補成高嚴重度。
    """
    road_name = _matched_road_name(text)
    segment_info = _snapshot_road_by_name(snapshot, road_name) or _road_segment_by_name(road_name)
    segment = segment_info["name"] if segment_info else (road_name or "受影響路段")
    status_value = _incident_status_value(text)
    severity_value = _incident_severity_value(text)

    # 使用者明確表示「沒有封閉」等否定語句時，不可以跟一般缺資訊混為一談，
    # 要清楚說明「嚴重度已足夠，但通行狀態不成立」。
    if segment_info and status_value == "Negated" and severity_value in ("Critical", "High"):
        return _answer_incident_status_missing_after_severity(segment)

    # 使用者明確表示「輕微」時，屬於「明確不觸發」而不是「缺資訊」。
    if segment_info and status_value in ("Closed", "Blocked", "Restricted") and severity_value == "Low":
        return _answer_incident_severity_too_low(segment)

    status = status_value if status_value in ("Closed", "Blocked", "Restricted") else None
    severity = severity_value if severity_value in ("Critical", "High") else None

    missing = _missing_incident_fields(segment_info, status, severity)
    if missing:
        return _answer_incident_missing_conditions(missing)

    severity_text = _severity_text(severity)
    ete_minutes = _calculate_ete_minutes(
        severity,
        _incident_saturation(severity, segment_info, snapshot),
    )
    route = _select_primary_evacuation_routes(segment_info, snapshot)["route_text"]
    return (
        f"■ 判定：{segment}出現關閉、封鎖或通行受阻情境，事故等級為{severity_text}，符合 SOP 第 2 條車禍與路障應變觸發條件\n"
        f"■ 建議處置：請先將車流導往{route}，並發布資訊看板：「{segment}封閉，請改道{route}，預計延誤 {ete_minutes} 分鐘」\n"
        f"■ 後續確認：{INCIDENT_CONGESTION_FOLLOW_UP}"
    )


# ---------------------------------------------------------------------------
# SOP 第 2 條輔助邏輯：事故條件、路網資料、疏散路徑
# ---------------------------------------------------------------------------

def _missing_incident_fields(
    segment_info: Optional[Dict],
    status: Optional[str],
    severity: Optional[str],
) -> List[str]:
    missing = []
    if not segment_info:
        missing.append("事故發生地點")
    if status is None:
        missing.append("通行狀態是否為封閉、阻斷或限制通行")
    if severity is None:
        missing.append("事故嚴重度是否為高或重大")
    return missing


def _answer_incident_missing_conditions(missing: List[str]) -> str:
    missing_text = "、".join(missing)
    return (
        "目前資訊不足，尚不能判定 SOP 第 2 條車禍與路障應變是否成立\n"
        f"■ 建議處置：請補充{missing_text}，例如「光復南路發生嚴重車禍並造成路段封鎖」\n"
        "■ 後續確認：第 2 條需同時確認道路路段、通行狀態與事故嚴重度；"
        "三項成立後，才會產生改道路徑、資訊看板文字與預計恢復時間。"
    )


def _answer_incident_severity_too_low(segment: str) -> str:
    return (
        f"{segment}出現關閉、封鎖或通行受阻情境，但事故嚴重度為輕微，未達 SOP 第 2 條車禍與路障應變要求的高或重大等級，因此不觸發車禍與路障應變\n"
        "■ 建議處置：暫不啟動替代路徑引導與預計恢復時間計算，請持續監測現場通行狀態\n"
        "■ 後續確認：若事故嚴重度升高為高或重大，且維持封閉、阻斷或限制通行，才需重新判定"
    )


def _answer_incident_status_missing_after_severity(segment: str) -> str:
    return (
        f"{segment}雖發生嚴重車禍，但目前未提供封閉、阻斷或限制通行狀態，尚未符合 SOP 第 2 條車禍與路障應變的完整觸發條件\n"
        "■ 建議處置：請確認現場通行狀態是否為封閉、阻斷或限制通行；若仍可正常通行，暫不啟動替代路徑引導\n"
        "■ 後續確認：SOP 第 2 條需同時符合道路路段、通行受阻狀態，以及高或重大事故等級"
    )


def _incident_saturation(
    severity: str,
    segment_info: Optional[Dict],
    snapshot: Optional[Dict[str, Any]],
) -> float:
    # 第 7 條 ETE 需要壅塞程度；若快照有受影響路段現況，優先使用快照。
    # 沒有快照時才退回固定值，讓單元 demo 仍能運作。
    snapshot_value = _snapshot_road_saturation(snapshot, segment_info)
    if snapshot_value is not None:
        return snapshot_value
    return 0.90 if severity == "Critical" else 0.80


def _snapshot_road_saturation(
    snapshot: Optional[Dict[str, Any]],
    segment_info: Optional[Dict],
) -> Optional[float]:
    if not snapshot or not segment_info:
        return None
    road_state = snapshot.get("road_segments", {}).get(segment_info.get("segment_id"))
    if not road_state:
        return None
    saturation = road_state.get("saturation_score")
    return float(saturation) if saturation is not None else None


def _snapshot_station_roaming(
    snapshot: Optional[Dict[str, Any]],
    station_name: str,
) -> Optional[float]:
    if not snapshot:
        return None
    for station in snapshot.get("stations", {}).values():
        if station.get("name") == station_name:
            roaming = station.get("roaming_user_pct")
            return float(roaming) if roaming is not None else None
    return None


def _snapshot_timestamp(snapshot: Optional[Dict[str, Any]]) -> Optional[str]:
    if not snapshot:
        return None
    timestamp = snapshot.get("timestamp")
    return str(timestamp) if timestamp else None


def _snapshot_road_by_name(
    snapshot: Optional[Dict[str, Any]],
    road_name: Optional[str],
) -> Optional[Dict]:
    if not snapshot or not road_name:
        return None
    for segment_id, segment in snapshot.get("road_segments", {}).items():
        if segment.get("name") == road_name:
            return {"segment_id": segment_id, **segment}
    return None


@lru_cache(maxsize=1)
def _road_geometry() -> Dict[str, Dict]:
    try:
        rows = json.loads(ROAD_GEOMETRY_PATH.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    return {row["segment_id"]: row for row in rows}


def _road_segment_by_name(name: Optional[str]) -> Optional[Dict]:
    if not name:
        return None
    return next((row for row in _road_geometry().values() if row.get("name") == name), None)


def _has_negation_before(text: str, idx: int, window: int = 4) -> bool:
    prefix = text[max(0, idx - window):idx]
    return any(marker in prefix for marker in NEGATION_MARKERS)


def _incident_status_value(text: str) -> Optional[str]:
    """回傳 Closed/Blocked/Restricted、"Negated"（使用者明確表示沒有此狀態）或 None（未提及）。

    比對時要檢查關鍵字前面是否有否定詞，避免「沒有封閉」被誤判成「封閉」。
    """
    keywords = (
        ("全線封鎖", "Closed"), ("封鎖", "Closed"), ("封閉", "Closed"), ("Closed", "Closed"),
        ("路障", "Blocked"), ("阻斷", "Blocked"), ("Blocked", "Blocked"),
        ("通行受阻", "Restricted"), ("受阻", "Restricted"), ("限制通行", "Restricted"), ("Restricted", "Restricted"),
    )
    negated = False
    for keyword, status in keywords:
        idx = text.find(keyword)
        if idx == -1:
            continue
        if _has_negation_before(text, idx):
            negated = True
            continue
        return status
    return "Negated" if negated else None


def _incident_severity_value(text: str) -> Optional[str]:
    """回傳 Critical/High/Low（使用者明確表示輕微）或 None（未提及）。

    必須先比對「輕微」，否則「嚴重度輕微」會因為包含「嚴重」子字串被誤判成 High。
    """
    if any(keyword in text for keyword in ("輕微", "轻微", "輕度")):
        return "Low"
    if any(keyword in text for keyword in ("Critical", "重大", "全線封鎖")):
        return "Critical"
    if any(keyword in text for keyword in ("High", "嚴重", "高")):
        return "High"
    return None


def _severity_text(severity: str) -> str:
    return {"Critical": "重大", "High": "高或嚴重", "Medium": "中"}[severity]


def _select_primary_evacuation_routes(
    segment_info: Optional[Dict],
    snapshot: Optional[Dict[str, Any]] = None,
) -> Dict[str, str]:
    if not segment_info:
        return {
            "route_text": "該路段 alternatives 中容量足夠、直接相交且位於事故點上游的替代道路",
            "basis_text": "目前未能對應到官方路網資料，需由現場補足事故路段 ID 後篩選主疏散路段。",
        }

    roads = _road_geometry()
    segment_intersections = set(segment_info.get("intersections", []))
    passed = []
    rejected = []
    for alt_id in segment_info.get("alternatives", []):
        alt = roads.get(alt_id)
        if not alt:
            continue

        # SOP 第 2 條主疏散路徑篩選：
        # 1. 容量足夠；2. 與事故路段直接相交；3. 位於上游。
        # 現有 mock 路網資料尚未提供完整上下游座標，先以直接相交與容量作為可驗證條件。
        capacity_ok = int(alt.get("capacity_vph", 0)) >= 1000
        direct_points = [alt["name"]] if alt.get("name") in segment_intersections else []
        directly_intersects = segment_info["name"] in alt.get("intersections", [])
        if capacity_ok and directly_intersects:
            passed.append((alt, direct_points or [segment_info["name"]]))
        else:
            reasons = []
            if not capacity_ok:
                reasons.append(f"容量 {alt.get('capacity_vph')} < 1000")
            if not directly_intersects:
                reasons.append("未與事故路段直接相交")
            rejected.append(f"{alt.get('name', alt_id)}（{'、'.join(reasons)}）")

    if not passed:
        return {
            "route_text": "替代道路中容量足夠且位於上游的可行路段",
            "basis_text": "事故路段 alternatives 尚未篩出同時符合容量與直接相交條件的主疏散路段。",
        }

    route_candidates = _rank_routes_by_snapshot_saturation(passed, snapshot)
    route_names = [alt["name"] for alt, _ in route_candidates]
    route_text = "或".join(route_names) if route_names else "替代道路中容量足夠且位於上游的可行路段"
    passed_text = "、".join(
        f"{alt['name']}（capacity_vph={alt['capacity_vph']}，相交點：{'/'.join(points)}）"
        for alt, points in passed
    )
    rejected_text = f"；排除：{'、'.join(rejected)}" if rejected else ""
    return {
        "route_text": route_text,
        "basis_text": f"主疏散路段從 {segment_info['name']} 的 alternatives 篩選：{passed_text} 同時符合 capacity_vph >= 1000 且與事故路段直接相交{rejected_text}。",
    }


def _rank_routes_by_snapshot_saturation(
    candidates: List[tuple[Dict, List[str]]],
    snapshot: Optional[Dict[str, Any]],
) -> List[tuple[Dict, List[str]]]:
    if not candidates:
        return []

    # SOP 第 2 條要求取 Saturation_Score 最低者；這個值不屬於使用者假設，
    # 所以要從目前播放時間點的 TrafficSnapshot 查。
    ranked = []
    for alt, points in candidates:
        saturation = _snapshot_road_saturation(snapshot, alt)
        if saturation is not None:
            ranked.append((saturation, alt, points))

    if not ranked:
        return candidates

    lowest = min(score for score, _, _ in ranked)
    return [(alt, points) for score, alt, points in ranked if score == lowest]


def _answer_signal_failure(
    text: str,
    snapshot: Optional[Dict[str, Any]] = None,
) -> str:
    road_name = _matched_road_name(text)
    segment_info = _snapshot_road_by_name(snapshot, road_name) or _road_segment_by_name(road_name)

    if not segment_info:
        # 沒有指定路段時不可自行估算預計恢復時間（ETE 需要該路段的壅塞程度），
        # 只能先給出人力派遣建議，並請使用者補充路段以便算出 ETE。
        return (
            "受影響路段出現號誌故障或失效，符合 SOP 第 5 條（號誌故障應變），應立即啟動人工指揮、資訊看板與預計恢復時間回報\n"
            "■ 建議處置：請啟動人工指揮派遣，受影響路口每路口配置 2 名警力；資訊看板發布：「受影響路段號誌故障，請依現場指揮通行」。\n"
            "■ 後續確認：若需要確認預估持續時間，請提供號誌故障路段。並更新到人工指揮的派遣建議。"
        )

    segment = segment_info["name"]

    # 使用者只假設「號誌故障」時，壅塞程度屬於當前現況，應從快照補足。
    # 若 demo 沒有快照或該路段缺值，才退回中度壅塞的保守估算。
    saturation = _snapshot_road_saturation(snapshot, segment_info)
    ete_minutes = _calculate_ete_minutes("Medium", saturation if saturation is not None else 0.75)

    return (
        f"{segment}出現號誌故障或失效，符合 SOP 第 5 條（號誌故障應變），應立即啟動人工指揮、資訊看板與預計恢復時間回報\n"
        "■ 建議處置：請啟動人工指揮派遣，受影響路口每路口配置 2 名警力；資訊看板發布：「"
        f"{segment}號誌故障，請依現場指揮通行」，預估持續 {ete_minutes} 分鐘\n"
        f"■ 後續確認：{SIGNAL_FAILURE_FOLLOW_UP}"
    )


def _matched_road_name(text: str) -> Optional[str]:
    aliases = {
        "忠孝東路": "忠孝東路四段",
        "光復南路": "光復南路",
        "基隆路": "基隆路一段",
        "市民大道": "市民大道四段",
        "仁愛路": "仁愛路四段",
        "敦化南路一段": "敦化南路一段",
        "敦化南路二段": "敦化南路二段",
        "松高路": "松高路",
        "延吉街": "延吉街",
        "基隆路地下道": "基隆路地下道",
        "市府路": "市府路",
        "松壽路": "松壽路",
        "信義路": "信義路五段",
        "松智路": "松智路",
        "復興南路": "復興南路一段",
    }
    for name in ROAD_NAMES:
        if name in text:
            return name
    return next((name for alias, name in aliases.items() if alias in text), None)


def _road_segment_id_by_name(road_name: str) -> Optional[str]:
    segment = _road_segment_by_name(road_name)
    return segment.get("segment_id") if segment else None


def _alternative_road_names(road_name: str) -> List[str]:
    segment = _road_segment_by_name(road_name)
    if not segment:
        return []
    roads = _road_geometry()
    return [
        roads[alt_id]["name"]
        for alt_id in segment.get("alternatives", [])
        if alt_id in roads and roads[alt_id].get("name")
    ]


def _answer_ete(severity: str, saturation: float) -> str:
    ete_minutes = _calculate_ete_minutes(severity, saturation)
    base = {"Critical": 60, "High": 40, "Medium": 20}[severity]
    penalty = max((saturation - 0.5) * 60, 0)
    return (
        "■ 判定：第 7 條（預計恢復時間）可計算\n"
        f"■ 依據：事故等級為{severity}，基本排除時間 {base} 分鐘；現場壅塞程度 {saturation:.2f}，壅塞加成約 {penalty:.0f} 分鐘\n"
        f"■ 建議處置：回報預計恢復時間約 {ete_minutes} 分鐘，並同步說明估算依據\n"
        "■ 後續確認：若事故同時造成封閉、阻斷或限制通行，需回到第 2 條產生改道路徑與資訊看板內容"
    )


def _calculate_ete_minutes(severity: str, saturation: float) -> int:
    base = {"Critical": 60, "High": 40, "Medium": 20}[severity]
    penalty = max((saturation - 0.5) * 60, 0)
    return round(base + penalty)


# ---------------------------------------------------------------------------
# Anthropic 模式（本機開發）
# ---------------------------------------------------------------------------

def _chat_anthropic(system_prompt: str, messages: List[Dict]) -> str:
    try:
        import anthropic
    except ImportError:
        raise ImportError("請先安裝：pip install anthropic")

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise ValueError("請設定環境變數 ANTHROPIC_API_KEY")

    client = anthropic.Anthropic(api_key=api_key)
    response = client.messages.create(
        model=ANTHROPIC_MODEL,
        max_tokens=1024,
        temperature=0.1,  # 低 temperature，提升回答穩定性
        system=system_prompt,
        messages=messages,
    )
    return response.content[0].text


# ---------------------------------------------------------------------------
# Bedrock 模式（正式賽 ⭐）
# ---------------------------------------------------------------------------

def _chat_bedrock(system_prompt: str, messages: List[Dict]) -> str:
    try:
        import boto3
        from botocore.exceptions import ClientError
    except ImportError:
        raise ImportError("請先安裝：pip install boto3")

    region = os.environ.get("BEDROCK_REGION") or os.environ.get("AWS_REGION", "us-east-1")
    client = boto3.client("bedrock-runtime", region_name=region)

    args = dict(
        modelId=_bedrock_model_id(),
        system=[{"text": system_prompt}],
        messages=[
            {"role": m["role"], "content": [{"text": m["content"]}]}
            for m in messages
        ],
        inferenceConfig={
            "maxTokens": 1024,
            "temperature": 0.1,
        },
    )
    response = _bedrock_converse_with_retry(client, args, ClientError)
    return response["output"]["message"]["content"][0]["text"]


def _bedrock_model_id() -> str:
    if not BEDROCK_INFERENCE_PREFIX:
        return BEDROCK_MODEL_ID
    known_prefixes = ("global.", "us.", "eu.", "apac.")
    if BEDROCK_MODEL_ID.startswith(known_prefixes):
        return BEDROCK_MODEL_ID
    return f"{BEDROCK_INFERENCE_PREFIX}.{BEDROCK_MODEL_ID}"


def _bedrock_converse_with_retry(client, args: dict, client_error_cls):
    retryable_codes = {
        "ThrottlingException",
        "TooManyRequestsException",
        "ServiceQuotaExceededException",
    }
    attempts = max(BEDROCK_MAX_RETRIES, 1)
    for attempt in range(1, attempts + 1):
        try:
            return client.converse(**args)
        except client_error_cls as exc:
            code = exc.response.get("Error", {}).get("Code", "")
            if code not in retryable_codes or attempt == attempts:
                raise
            delay = BEDROCK_RETRY_DELAY_SECONDS * (2 ** (attempt - 1))
            logger.warning(
                "Bedrock throttled request (%s), retrying in %.1fs (%d/%d)",
                code,
                delay,
                attempt,
                attempts,
            )
            time.sleep(delay)
