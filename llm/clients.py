"""
llm/clients.py
LLM 抽象層 — 統一介面，依環境變數 LLM_MODE 切換三種後端：
  mock      : 罐頭答案，不需任何 API key（開發初期接通前後端用）
  anthropic : 本機開發，需設 ANTHROPIC_API_KEY
  bedrock   : 正式賽，需 AWS 憑證與 Bedrock model access ⭐
"""

import os
import logging
import re
import time
from typing import List, Dict, Optional

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


# ---------------------------------------------------------------------------
# 公開介面
# ---------------------------------------------------------------------------

def chat(system_prompt: str, messages: List[Dict[str, str]]) -> str:
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
        return _commanderize_answer(_chat_mock(system_prompt, messages))
    elif LLM_MODE == "anthropic":
        return _chat_anthropic(system_prompt, messages)
    elif LLM_MODE == "bedrock":
        return _chat_bedrock(system_prompt, messages)
    else:
        raise ValueError(f"未知的 LLM_MODE: {LLM_MODE}，請設為 mock / anthropic / bedrock")


def get_mode() -> str:
    return LLM_MODE


def _commanderize_answer(answer: str) -> str:
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
    return answer


# ---------------------------------------------------------------------------
# Mock 模式 — 罐頭答案對應驗收標準 T1–T7
# ---------------------------------------------------------------------------

def _chat_mock(system_prompt: str, messages: List[Dict]) -> str:
    last = next(
        (m["content"] for m in reversed(messages) if m["role"] == "user"), ""
    )
    normalized = last.replace(",", "").replace("，", "")

    if _is_sop_overview_request(last):
        return _answer_sop_overview()

    road_congestion = _extract_road_congestion(last)
    if road_congestion is not None:
        road_name, saturation = road_congestion
        return _answer_saturation(saturation, road_name)

    if _is_metro_split_request(last):
        return _answer_metro_split(40000)

    if _is_dome_dismissal_request(last):
        return _answer_dome_dismissal(-0.25)

    user_count = _extract_user_count(last)
    if user_count is not None:
        return _answer_metro_split(user_count)

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
        return _answer_metro_split(base + increment)

    if _is_signal_failure(last):
        return _answer_signal_failure(last)

    if _is_incident_response(last):
        return _answer_incident_response(last)

    ete_case = _extract_ete_case(last)
    if ete_case is not None:
        return _answer_ete(*ete_case)

    saturation = _extract_saturation(last)
    if saturation is not None:
        return _answer_saturation(saturation)

    growth_rate = _extract_growth_rate(last)
    if growth_rate is not None:
        return _answer_dome_dismissal(growth_rate)

    roaming_pct = _extract_roaming_pct(last)
    if roaming_pct is not None:
        return _answer_roaming(roaming_pct, cascade_from_metro=_has_previous_metro_split(messages[:-1]))

    station_roaming = _extract_station_roaming(last)
    if station_roaming is not None:
        station_name, roaming = station_roaming
        return _answer_roaming(
            roaming,
            station_name,
            cascade_from_metro=_has_previous_metro_split(messages[:-1]),
        )

    # Keep the original exact fallback cases for very terse demo input.
    if "40000" in normalized:
        return _answer_metro_split(40000)
    if "0.96" in last:
        return _answer_saturation(0.96)
    if "0.90" in last:
        return _answer_saturation(0.90)
    if "0.80" in last:
        return _answer_saturation(0.80)
    if "-0.25" in last:
        return _answer_dome_dismissal(-0.25)
    if "35%" in last or ("漫遊" in last and "35" in last):
        return _answer_roaming(35)

    missing = _answer_missing_conditions(last)
    if missing is not None:
        return missing

    # T7 variants where the user omits the comma.
    if "再加5000" in normalized:
        base = _find_previous_user_count(messages[:-1])
        if base is not None:
            return _answer_metro_split(base + 5000)

    return (
        "■ 判定：目前 SOP 內容不足以判定\n"
        "■ 依據：問題中沒有足夠的假設條件，尚無法對照 SOP 門檻\n"
        "■ 建議處置：請補充地點、事件類型、嚴重度或人流/壅塞數值，例如「光復南路發生嚴重車禍並封鎖」\n"
        "■ 後續確認：無"
    )


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


def _extract_road_congestion(text: str) -> Optional[tuple[str, float]]:
    if not any(keyword in text for keyword in ("壅塞", "交通", "門檻", "應變")):
        return None
    for road_name in ("忠孝東路四段", "光復南路"):
        if road_name not in text:
            continue
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


def _is_dome_dismissal_request(text: str) -> bool:
    return "大巨蛋" in text and any(keyword in text for keyword in ("散場", "退場", "離場"))


def _extract_station_roaming(text: str) -> Optional[tuple[str, int]]:
    if not any(keyword in text for keyword in ("多語", "通報", "外籍", "旅客")):
        return None
    station_names = (
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
    for station_name in station_names:
        if station_name not in text:
            continue
        match = re.search(r"(\d{1,3})\s*%", text)
        if match:
            return station_name, int(match.group(1))
        return station_name, 35
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


def _answer_sop_overview() -> str:
    return (
        "■ 判定：可判斷第 1 至第 7 條 SOP\n"
        "■ 依據：本顧問依使用者輸入的假設條件對照 SOP 門檻，不自動讀取即時快照\n"
        "■ 建議處置：可詢問壅塞 A/B 級、車禍與路障、捷運與接駁分流、大巨蛋散場、號誌故障、多語通報、預計恢復時間\n"
        "■ 後續確認：事故與號誌會附帶預計恢復時間；捷運分流若另有外籍旅客比例達 30% 以上，會連動多語通報"
    )


def _answer_missing_conditions(text: str) -> Optional[str]:
    if not any(keyword in text for keyword in ("怎麼", "如何", "處理", "應變", "啟動", "需要", "要不要", "判斷")):
        return None

    if "壅塞" in text or "塞車" in text or "擁塞" in text or "交通" in text:
        return (
            "■ 判定：目前 SOP 內容不足以判定\n"
            "■ 依據：第 1 條需要知道觸發路段（忠孝東路四段或光復南路）以及壅塞等級或壅塞程度\n"
            "■ 建議處置：請補充例如「假設忠孝東路四段已達 A 級壅塞」或「光復南路壅塞程度 0.90」\n"
            "■ 後續確認：無"
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
            "■ 判定：目前 SOP 內容不足以判定\n"
            "■ 依據：第 6 條需要知道指定站點或區域的外籍旅客比例是否達 30% 以上\n"
            "■ 建議處置：請補充例如「假設台北101廣場外籍旅客比例達 35%」\n"
            "■ 後續確認：無"
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


def _answer_metro_split(user_count: int) -> str:
    formatted = f"{user_count:,}"
    if user_count > 25000:
        return (
            "■ 判定：第 3 條（捷運與接駁分流）成立，應立即啟動國父紀念館站分流\n"
            f"■ 依據：假設捷運國父紀念館站人潮達 {formatted} 人，已超過 SOP 門檻 25,000 人\n"
            "■ 建議處置：請通知北捷評估過站不停，同步調度接駁專車，並引導人潮改往捷運市政府站分散進站\n"
            "■ 後續確認：若現場外籍旅客比例達 30% 以上，需同步啟動第 6 條多語數位通報；目前問題未提供該比例，先不自行判定"
        )
    gap = 25000 - user_count + 1
    return (
        "■ 判定：不觸發第 3 條捷運與接駁分流\n"
        f"■ 依據：假設捷運國父紀念館站人潮為 {formatted} 人，尚未超過 25,000 人門檻，距觸發約差 {gap:,} 人\n"
        "■ 建議處置：暫不啟動過站不停或接駁分流，持續觀察國父紀念館站進站人潮與成長速度\n"
        "■ 後續確認：若後續人潮升破 25,000 人，或現場出現快速湧入情形，需重新判定第 3 條"
    )


def _answer_saturation(saturation: float, road_name: str = "") -> str:
    value = f"{saturation:.2f}"
    subject = f"{road_name} " if road_name else ""
    if saturation >= 0.95:
        return (
            "■ 判定：第 1 條 A 級壅塞成立，該路段已達癱瘓等級\n"
            f"■ 依據：{subject}壅塞程度為 {value}，已達 SOP A 級門檻 0.95\n"
            "■ 建議處置：請啟動替代路徑引導，將替代路段綠燈配時延長 25%，並調度警力淨空關鍵路口\n"
            "■ 後續確認：持續確認替代路段是否也升至 B 級以上，避免分流後形成二次壅塞"
        )
    if saturation >= 0.85:
        gap = 0.95 - saturation
        return (
            "■ 判定：第 1 條 B 級壅塞成立，該路段已達壅擠等級\n"
            f"■ 依據：{subject}壅塞程度為 {value}，介於 B 級門檻 0.85 與 A 級門檻 0.95 之間\n"
            "■ 建議處置：請先延長替代路段綠燈配時 25%，並調派警力維持路口淨空\n"
            f"■ 後續確認：距 A 級門檻約差 {gap:.2f}；若升至 A 級，需加開替代路徑引導"
        )
    gap = 0.85 - saturation
    return (
        "■ 判定：不觸發第 1 條壅塞應變\n"
        f"■ 依據：{subject}壅塞程度為 {value}，低於 B 級門檻 0.85，距觸發約差 {gap:.2f}\n"
        "■ 建議處置：暫不啟動交通改道或長綠燈時制，維持監測即可\n"
        "■ 後續確認：若後續升至 0.85 以上，再啟動 B 級應變"
    )


def _answer_dome_dismissal(growth_rate: float) -> str:
    if growth_rate <= -0.20:
        return (
            "■ 判定：第 4 條（大巨蛋散場啟動）成立，應將現場狀態切換為散場應變\n"
            f"■ 依據：假設大巨蛋曾達 40,000 人，已高於 30,000 人門檻；目前人流開始下降，變化率為 {growth_rate:.2f}，也達到散場觸發條件\n"
            "■ 建議處置：請標記散場啟動，預先啟動接駁與捷運分流準備，並提醒現場人員引導人潮分批離場\n"
            "■ 後續確認：請同步確認捷運國父紀念館站人潮是否達 25,000 人以上；若達標，需立即連動第 3 條過站不停與接駁分流"
        )
    gap = growth_rate - (-0.20)
    return (
        "■ 判定：不觸發第 4 條大巨蛋散場啟動\n"
        f"■ 依據：目前人流下降幅度為 {growth_rate:.2f}，尚未達 SOP 散場門檻 -0.20，距觸發約差 {gap:.2f}\n"
        "■ 建議處置：暫不切換為散場應變，持續觀察場館出口與捷運站周邊人潮\n"
        "■ 後續確認：若人流下降幅度達 -0.20 以下，需重新判定並同步檢查第 3 條捷運分流"
    )


def _answer_roaming(roaming_pct: int, station_name: str = "", cascade_from_metro: bool = False) -> str:
    subject = f"{station_name} " if station_name else ""
    if roaming_pct >= 30:
        cascade = "承接上一輪第 3 條捷運分流，此外籍旅客比例已達第 6 條門檻，需同步啟動多語通報" if cascade_from_metro else "無"
        return (
            "■ 判定：第 6 條（數位通報與多語化）成立\n"
            f"■ 依據：{subject}外籍旅客比例達 {roaming_pct}%，已超過 SOP 門檻 30%\n"
            "■ 建議處置：請將該區域簡訊、資訊看板與現場廣播同步改為中英日韓多語版本\n"
            f"■ 後續確認：{cascade}"
        )
    gap = 30 - roaming_pct
    return (
        "■ 判定：不觸發第 6 條多語數位通報\n"
        f"■ 依據：{subject}外籍旅客比例為 {roaming_pct}%，低於 30% 門檻，距觸發約差 {gap}%\n"
        "■ 建議處置：暫不啟動多語通報，維持一般通報即可\n"
        "■ 後續確認：若外籍旅客比例升至 30% 以上，需立即切換為多語通報"
    )


def _answer_incident_response(text: str) -> str:
    road_name = _matched_road_name(text)
    if road_name == "光復南路":
        segment = "光復南路"
        route = "市民大道四段或仁愛路四段"
    elif road_name == "忠孝東路四段":
        segment = "忠孝東路四段"
        route = "市民大道四段、仁愛路四段或松高路"
    elif road_name == "市民大道四段":
        segment = "市民大道四段"
        route = "敦化南路一段或忠孝東路四段"
    else:
        segment = road_name or "受影響路段"
        route = "該路段 alternatives 中容量足夠且位於上游的替代道路"

    severity = "Critical" if "Critical" in text or "全線封鎖" in text else "High"
    saturation = 0.90 if severity == "Critical" else 0.80
    ete_minutes = _calculate_ete_minutes(severity, saturation)
    return (
        "■ 判定：第 2 條（車禍與路障應變）成立\n"
        f"■ 依據：{segment}出現封鎖或通行受阻情境，事故等級判為{severity}，符合 SOP 第 2 條觸發條件\n"
        f"■ 建議處置：請先將車流導往{route}，並發布資訊看板：「{segment}封閉，請改道{route}，預計延誤 {ete_minutes} 分鐘」\n"
        "■ 後續確認：已併入第 7 條預計恢復時間；若替代路段也達 B 級壅塞，需同步啟動第 1 條長綠燈時制"
    )


def _answer_signal_failure(text: str) -> str:
    segment = _matched_road_name(text) or "受影響路段"
    ete_minutes = _calculate_ete_minutes("Medium", 0.75)

    return (
        "■ 判定：第 5 條（號誌故障應變）成立\n"
        f"■ 依據：{segment}出現號誌故障或失效情境，符合 SOP 第 5 條觸發條件\n"
        "■ 建議處置：請啟動人工指揮派遣，受影響路口每路口配置 2 名警力；資訊看板發布：「"
        f"{segment}號誌故障，請依現場指揮通行」，預估持續 {ete_minutes} 分鐘\n"
        "■ 後續確認：已併入第 7 條預計恢復時間；若故障造成替代道路升至 B 級壅塞，需連動第 1 條壅塞級別判定"
    )


def _matched_road_name(text: str) -> Optional[str]:
    road_names = (
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
    return next((name for name in road_names if name in text), None)


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
