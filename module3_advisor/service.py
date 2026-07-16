"""Module 3 advisory service."""

from typing import Any, Dict, List, Optional

from data.module3_demo_snapshot import get_module3_snapshot
from data.snapshot import format_snapshot_for_prompt
from llm.clients import chat, get_mode

from .prompts import build_system_prompt
from .schemas import AdvisoryResponse
from .sop_loader import format_sop_context, load_sop_context


def answer_advisory_question(
    message: str,
    history: Optional[List[Dict[str, str]]] = None,
    scenario: Optional[Dict[str, Any]] = None,
    snapshot_timestamp: Optional[str] = None,
) -> Dict[str, Any]:
    if not message or not message.strip():
        raise ValueError("question is required")

    # 1. 將前端傳入的假設條件併入問題文字，讓 LLM/Mock 使用同一個入口。
    user_message = _append_scenario(message.strip(), scenario)

    # 2. 從 SOP 知識庫取回相關條文；目前 SOP 篇幅短，所以會保留足夠上下文。
    sources = load_sop_context(user_message)
    sop_context = format_sop_context(sources)

    # 3. 取當前播放時間點快照。若前端尚未傳時間點，先使用官方資料最新時間。
    llm_mode = get_mode()
    snapshot = get_module3_snapshot(snapshot_timestamp, llm_mode=llm_mode)
    snapshot_context = format_snapshot_for_prompt(snapshot)
    system_prompt = build_system_prompt(sop_context, snapshot_context)

    # 4. 保留對話歷史，支援「那如果再增加 5,000 人呢？」這類追問。
    messages = list(history or [])
    messages.append({"role": "user", "content": user_message})
    answer = chat(system_prompt, messages, snapshot=snapshot)

    # 5. API 回傳答案、LLM 模式與引用 SOP 來源，方便前端或評審檢查。
    return AdvisoryResponse(
        answer=answer,
        llm_mode=llm_mode,
        sources=sources,
        scenario=scenario,
        snapshot_timestamp=snapshot["timestamp"],
    ).to_dict()


def _append_scenario(message: str, scenario: Optional[Dict[str, Any]]) -> str:
    if not scenario:
        return message
    scenario_text = "\n".join(f"- {key}: {value}" for key, value in scenario.items())
    return f"{message}\n\n補充假設條件：\n{scenario_text}"
