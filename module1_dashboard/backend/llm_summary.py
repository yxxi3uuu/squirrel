"""
LLM 摘要生成（Module 1 的 LLM 職責：產生趨勢異常摘要與預警提示）。

門檻判斷已經由 thresholds.py 用程式算完，這裡只把 TriggerDecision 轉成
中文提示文字，不重新計算任何門檻數值。

Prototype 階段沒有預設 API key，預設走 `_fallback_summary`（規則式樣板文字，
明確標示為佔位輸出）。若環境變數設了 ANTHROPIC_API_KEY 且已安裝
`anthropic` 套件，會改用真正的 LLM 生成摘要。
"""

import os
from typing import List

from data.snapshot import format_snapshot_for_prompt

SYSTEM_PROMPT = (
    "你是智慧交通指揮中樞的預警助理。使用者會提供目前的交通/人流快照，"
    "以及程式已經判斷觸發的 SOP 門檻項目。請針對每個觸發項目，用一到兩句中文"
    "說明發生了什麼異常趨勢、需要留意什麼，語氣簡潔、給第一線人員看。"
    "不要重新計算或質疑門檻數值，只根據提供的數據做摘要與提示。"
)


def generate_summary(snapshot: dict, triggers: List[dict]) -> str:
    """為「新觸發」的 TriggerDecision 產生預警提示文字。"""
    if not triggers:
        return ""

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if api_key:
        try:
            return _call_llm(snapshot, triggers, api_key)
        except Exception:
            # Prototype 階段：LLM 呼叫失敗時退回規則式摘要，不讓 API 整個掛掉。
            return _fallback_summary(triggers)
    return _fallback_summary(triggers)


def _call_llm(snapshot: dict, triggers: List[dict], api_key: str) -> str:
    import anthropic

    client = anthropic.Anthropic(api_key=api_key)
    trigger_lines = "\n".join(
        f"- [{t['sop_clause']} {t['clause_name']}] {t['entity_name']}：{t['basis']}"
        for t in triggers
    )
    user_prompt = (
        f"{format_snapshot_for_prompt(snapshot)}\n\n"
        f"■ 本次新觸發門檻：\n{trigger_lines}"
    )
    message = client.messages.create(
        model="claude-sonnet-5",
        max_tokens=400,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_prompt}],
    )
    return "".join(block.text for block in message.content if block.type == "text")


def _fallback_summary(triggers: List[dict]) -> str:
    """未設定 ANTHROPIC_API_KEY 時的規則式佔位摘要（非最終 LLM 輸出品質）。"""
    lines = []
    for t in triggers:
        lines.append(f"【{t['sop_clause']} {t['clause_name']}】{t['entity_name']}：{t['basis']}。")
        if t.get("actions"):
            lines.append(f"　建議動作：{'；'.join(t['actions'])}")
    return "\n".join(lines)
