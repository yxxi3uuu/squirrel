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
from typing import List, Dict, Optional

logger = logging.getLogger(__name__)

LLM_MODE = os.environ.get("LLM_MODE", "mock").lower()

# 可透過環境變數覆寫 model ID
BEDROCK_MODEL_ID = os.environ.get(
    "BEDROCK_MODEL_ID",
    "anthropic.claude-3-5-sonnet-20241022-v2:0",
)
ANTHROPIC_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-3-5-sonnet-20241022")


# ---------------------------------------------------------------------------
# 公開介面
# ---------------------------------------------------------------------------

def chat(system_prompt: str, messages: List[Dict[str, str]]) -> str:
    """
    統一 LLM 呼叫介面。

    Args:
        system_prompt: 角色設定 + SOP 全文 + 數據快照 + 回答規則
        messages: 對話歷史 + 新問題，格式 [{"role": "user"/"assistant", "content": "..."}]

    Returns:
        AI 回答字串
    """
    logger.info("LLM_MODE=%s, messages=%d", LLM_MODE, len(messages))

    if LLM_MODE == "mock":
        return _chat_mock(messages)
    elif LLM_MODE == "anthropic":
        return _chat_anthropic(system_prompt, messages)
    elif LLM_MODE == "bedrock":
        return _chat_bedrock(system_prompt, messages)
    else:
        raise ValueError(f"未知的 LLM_MODE: {LLM_MODE}，請設為 mock / anthropic / bedrock")


def get_mode() -> str:
    return LLM_MODE


# ---------------------------------------------------------------------------
# Mock 模式 — 罐頭答案對應驗收標準 T1–T7
# ---------------------------------------------------------------------------

def _chat_mock(messages: List[Dict]) -> str:
    last = next(
        (m["content"] for m in reversed(messages) if m["role"] == "user"), ""
    )
    normalized = last.replace(",", "").replace("，", "")

    user_count = _extract_user_count(last)
    if user_count is not None:
        return _answer_metro_split(user_count)

    increment = _extract_increment(last)
    if increment is not None:
        base = _find_previous_user_count(messages[:-1])
        if base is None:
            return (
                "■ 觸發條款：無法判定（Mock 模式）\n"
                "■ 判定依據：追問提到再加人數，但缺少上一輪 User_Count 基準\n"
                "■ 預期動作：請先輸入例如「若 BL17 人數增至 40,000 人？」\n"
                "■ 連鎖檢查：無"
            )
        return _answer_metro_split(base + increment)

    saturation = _extract_saturation(last)
    if saturation is not None:
        return _answer_saturation(saturation)

    growth_rate = _extract_growth_rate(last)
    if growth_rate is not None:
        return _answer_dome_dismissal(growth_rate)

    roaming_pct = _extract_roaming_pct(last)
    if roaming_pct is not None:
        return _answer_roaming(roaming_pct)

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

    # T7 variants where the user omits the comma.
    if "再加5000" in normalized:
        base = _find_previous_user_count(messages[:-1])
        if base is not None:
            return _answer_metro_split(base + 5000)

    return (
        "■ 觸發條款：無法判定（Mock 模式）\n"
        "■ 判定依據：請切換至 anthropic 或 bedrock 模式以取得完整 LLM 推理\n"
        "■ 預期動作：設定環境變數 LLM_MODE=anthropic 並提供 ANTHROPIC_API_KEY\n"
        "■ 連鎖檢查：無"
    )


def _extract_user_count(text: str) -> Optional[int]:
    if not any(keyword in text for keyword in ("人數", "User_Count", "user_count", "增至", "增加到")):
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


def _extract_saturation(text: str) -> Optional[float]:
    if "飽和" not in text and "Saturation" not in text:
        return None
    match = re.search(r"0\.\d+", text)
    return float(match.group(0)) if match else None


def _extract_growth_rate(text: str) -> Optional[float]:
    if "Growth_Rate" not in text and "growth_rate" not in text.lower() and "散場" not in text:
        return None
    match = re.search(r"-?0\.\d+", text)
    return float(match.group(0)) if match else None


def _extract_roaming_pct(text: str) -> Optional[int]:
    if "漫遊" not in text and "Roaming" not in text:
        return None
    match = re.search(r"(\d{1,3})\s*%", text)
    return int(match.group(1)) if match else None


def _answer_metro_split(user_count: int) -> str:
    formatted = f"{user_count:,}"
    if user_count > 25000:
        return (
            "■ 觸發條款：第 3 條（捷運與接駁分流）\n"
            f"■ 判定依據：假設 User_Count = {formatted} > 門檻 25,000\n"
            "■ 預期動作：建議北捷過站不停、調度接駁專車、引導群眾步行至 BS_MRT_BL18\n"
            "■ 連鎖檢查：BL17 當前漫遊率 8% < 30%，不觸發第 6 條多語通報"
        )
    gap = 25000 - user_count + 1
    return (
        "■ 觸發條款：不觸發任何條款\n"
        f"■ 判定依據：假設 User_Count = {formatted} ≤ 門檻 25,000，距觸發尚差 {gap:,} 人\n"
        "■ 預期動作：無須啟動過站不停或接駁分流，建議持續監測 BL17 人流成長率\n"
        "■ 連鎖檢查：無"
    )


def _answer_saturation(saturation: float) -> str:
    value = f"{saturation:.2f}"
    if saturation >= 0.95:
        return (
            "■ 觸發條款：第 1 條 A 級（癱瘓 / 紅燈）\n"
            f"■ 判定依據：Saturation_Score {value} ≥ 門檻 0.95\n"
            "■ 預期動作：替代路徑綠燈配時 +25%、啟動替代路徑引導、調度警力淨空路口\n"
            "■ 連鎖檢查：無"
        )
    if saturation >= 0.85:
        gap = 0.95 - saturation
        return (
            "■ 觸發條款：第 1 條 B 級（壅擠 / 黃燈）\n"
            f"■ 判定依據：0.85 ≤ Saturation_Score {value} < 0.95\n"
            "■ 預期動作：替代路段綠燈配時 +25%、調度警力淨空路口\n"
            "■ 連鎖檢查：無\n"
            f"■ 備註：再升 {gap:.2f} 將升為 A 級，屆時須啟動替代路徑引導"
        )
    gap = 0.85 - saturation
    return (
        "■ 觸發條款：不觸發任何條款\n"
        f"■ 判定依據：Saturation_Score {value} < 門檻 0.85（B 級），距門檻差 {gap:.2f}\n"
        "■ 預期動作：無須處置，建議持續監測\n"
        "■ 連鎖檢查：無"
    )


def _answer_dome_dismissal(growth_rate: float) -> str:
    if growth_rate <= -0.20:
        return (
            "■ 觸發條款：第 4 條（大巨蛋散場啟動）\n"
            f"■ 判定依據：Growth_Rate = {growth_rate:.2f} ≤ 門檻 -0.20，且歷史峰值 40,000 ≥ 30,000\n"
            "■ 預期動作：標記散場啟動、預先連動第 3 條接駁機制\n"
            "■ 連鎖檢查：連動第 3 條（捷運分流），請確認 BS_MRT_BL17 User_Count 是否 ≥ 25,000"
        )
    gap = growth_rate - (-0.20)
    return (
        "■ 觸發條款：不觸發任何條款\n"
        f"■ 判定依據：Growth_Rate = {growth_rate:.2f} > 門檻 -0.20，距散場觸發尚差 {gap:.2f}\n"
        "■ 預期動作：尚不標記散場啟動，建議持續監測大巨蛋人流變化\n"
        "■ 連鎖檢查：無"
    )


def _answer_roaming(roaming_pct: int) -> str:
    if roaming_pct >= 30:
        return (
            "■ 觸發條款：第 6 條（數位通報與多語化）\n"
            f"■ 判定依據：Roaming_User_Pct {roaming_pct}% ≥ 門檻 30%\n"
            "■ 預期動作：該區域簡訊與看板須同時含多國語言（中英日韓）\n"
            "■ 連鎖檢查：無"
        )
    gap = 30 - roaming_pct
    return (
        "■ 觸發條款：不觸發任何條款\n"
        f"■ 判定依據：Roaming_User_Pct {roaming_pct}% < 門檻 30%，距門檻差 {gap}%\n"
        "■ 預期動作：暫不啟動多語通報，建議持續監測外籍漫遊旅客比例\n"
        "■ 連鎖檢查：無"
    )


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
    except ImportError:
        raise ImportError("請先安裝：pip install boto3")

    region = os.environ.get("AWS_REGION", "us-east-1")
    client = boto3.client("bedrock-runtime", region_name=region)

    response = client.converse(
        modelId=BEDROCK_MODEL_ID,
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
    return response["output"]["message"]["content"][0]["text"]
