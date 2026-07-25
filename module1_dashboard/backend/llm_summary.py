"""
LLM 摘要生成（Module 1 的 LLM 職責：產生趨勢異常摘要與預警提示）。

門檻判斷已經由 thresholds.py 用程式算完，這裡只把 TriggerDecision 轉成
中文提示文字，不重新計算任何門檻數值。

呼叫本機 Ollama（預設模型 qwen2.5:1.5b）生成摘要；Ollama 不可用或逾時時，
自動退回 `_fallback_summary`（規則式樣板文字，明確標示為佔位輸出），
不讓 API 整個掛掉。
"""

import json
import os
import urllib.error
import urllib.request
from typing import List

from data.snapshot import format_snapshot_for_prompt

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:1.5b")
OLLAMA_TIMEOUT = float(os.getenv("OLLAMA_TIMEOUT", "10"))

SYSTEM_PROMPT = (
    "你是智慧交通指揮中樞的預警助理。使用者會提供目前的交通/人流快照，"
    "以及程式已經判斷觸發的 SOP 門檻項目。請針對每個觸發項目，用一到兩句中文"
    "說明發生了什麼異常趨勢、需要留意什麼，語氣簡潔、給第一線人員看。"
    "不要重新計算或質疑門檻數值，只根據提供的數據做摘要與提示。"
    "不要給出調度、派遣、引導路線或分流等行動建議，那是其他模組的職責，"
    "這裡只做狀態說明與預警提示。"
)


def generate_summary(snapshot: dict, triggers: List[dict]) -> str:
    """為「新觸發」的 TriggerDecision 產生預警提示文字。"""
    if not triggers:
        return ""

    try:
        return _call_ollama(snapshot, triggers)
    except Exception:
        # Prototype 階段：LLM 呼叫失敗時退回規則式摘要，不讓 API 整個掛掉。
        return _fallback_summary(triggers)


def _build_user_prompt(snapshot: dict, triggers: List[dict]) -> str:
    trigger_lines = "\n".join(
        f"- [{t['sop_clause']} {t['clause_name']}] {t['entity_name']}：{t['basis']}"
        for t in triggers
    )
    return (
        f"{format_snapshot_for_prompt(snapshot)}\n\n"
        f"■ 本次新觸發門檻：\n{trigger_lines}"
    )


def _call_ollama(snapshot: dict, triggers: List[dict]) -> str:
    user_prompt = _build_user_prompt(snapshot, triggers)
    payload = {
        "model": OLLAMA_MODEL,
        "system": SYSTEM_PROMPT,
        "prompt": user_prompt,
        "stream": False,
    }
    request = urllib.request.Request(
        f"{OLLAMA_BASE_URL}/api/generate",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=OLLAMA_TIMEOUT) as response:
        body = json.loads(response.read())

    text = body.get("response", "").strip()
    if not text:
        raise ValueError("Ollama 回傳空白內容")
    return text


def _fallback_summary(triggers: List[dict]) -> str:
    """LLM 呼叫失敗/未設定時的規則式佔位摘要（非最終 LLM 輸出品質）。
    只做狀態說明，不含行動建議——那是其他模組的職責。"""
    return "\n".join(
        f"【{t['sop_clause']} {t['clause_name']}】{t['entity_name']}：{t['basis']}。"
        for t in triggers
    )
