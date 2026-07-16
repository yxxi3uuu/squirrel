"""Module 3 advisory service."""

from typing import Any, Dict, List, Optional

from llm.clients import chat, get_mode

from .prompts import build_system_prompt
from .schemas import AdvisoryResponse
from .sop_loader import format_sop_context, load_sop_context


def answer_advisory_question(
    message: str,
    history: Optional[List[Dict[str, str]]] = None,
    scenario: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    if not message or not message.strip():
        raise ValueError("question is required")

    user_message = _append_scenario(message.strip(), scenario)
    sources = load_sop_context(user_message)
    sop_context = format_sop_context(sources)
    system_prompt = build_system_prompt(sop_context)

    messages = list(history or [])
    messages.append({"role": "user", "content": user_message})
    answer = chat(system_prompt, messages)

    return AdvisoryResponse(
        answer=answer,
        llm_mode=get_mode(),
        sources=sources,
        scenario=scenario,
    ).to_dict()


def _append_scenario(message: str, scenario: Optional[Dict[str, Any]]) -> str:
    if not scenario:
        return message
    scenario_text = "\n".join(f"- {key}: {value}" for key, value in scenario.items())
    return f"{message}\n\n補充假設條件：\n{scenario_text}"
