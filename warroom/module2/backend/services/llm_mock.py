"""
LLM 引導文字生成 + Prompt 模板

呼叫本機 Ollama（或 EC2 上的 Ollama）產生給指揮官看的引導文字
（guidance_text）。CMS 文字格式固定，由 sop_engine 直接組合，不經過 LLM。

若 Ollama 不可用或回傳格式錯誤，自動 fallback 到 mock 實作，
並在回傳結果中加入 _source 欄位標記資料來源。
"""

import json
import logging
import os
from typing import Dict

import httpx

from shared.schemas import TriggerDecision

logger = logging.getLogger(__name__)

# ── Ollama 設定 ────────────────────────────────────────────────────────────────
OLLAMA_BASE_URL: str = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL: str = os.getenv("OLLAMA_MODEL", "qwen2.5:1.5b")
OLLAMA_TIMEOUT: float = float(os.getenv("OLLAMA_TIMEOUT", "30"))

SYSTEM_PROMPT = """你是台北市交通應變指揮中心的AI幕僚。
以下所有數字與結論都已經由程式規則運算完成（見TriggerDecision物件），
你的工作只是把結構化資料轉換成給交通指揮官看的引導說明文字，
不要自己重新判斷或修改任何SOP條款或數字。

輸出一段文字（guidance_text）：給交通指揮官看的簡短引導說明，
可以引用SOP條款編號，說明觸發原因、建議行動與預計恢復時間，100字以內。

請只輸出 JSON，不要有其他文字：{"guidance_text": "..."}"""


def _call_ollama(decision: TriggerDecision) -> Dict[str, str]:
    """呼叫 Ollama REST API，成功時回傳 {"guidance_text": ..., "_source": "llm"}。"""
    payload = {
        "model": OLLAMA_MODEL,
        "stream": False,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": build_llm_user_prompt(decision)},
        ],
    }

    with httpx.Client(timeout=OLLAMA_TIMEOUT) as client:
        resp = client.post(f"{OLLAMA_BASE_URL}/api/chat", json=payload)
        resp.raise_for_status()

    raw_content: str = resp.json()["message"]["content"].strip()

    if raw_content.startswith("```"):
        raw_content = raw_content.split("```")[1]
        if raw_content.startswith("json"):
            raw_content = raw_content[4:]
        raw_content = raw_content.strip()

    result: Dict[str, str] = json.loads(raw_content)

    if "guidance_text" not in result:
        raise ValueError(f"LLM 回傳缺少 guidance_text 欄位：{result}")

    result["_source"] = "llm"
    return result


def _mock_generate(decision: TriggerDecision) -> Dict[str, str]:
    """Mock 實作，Ollama 不可用時使用。"""
    if not decision.triggered:
        return {
            "guidance_text": (
                f"[{decision.sop_clause or '無觸發'}] {decision.basis}"
            ),
            "_source": "mock",
        }

    clause = decision.sop_clause or "未知條款"
    parts = [f"【{clause}】{decision.clause_name}"]
    if decision.ete_minutes is not None:
        parts.append(f"預計 {decision.ete_minutes} 分鐘恢復")
    if decision.primary_route:
        parts.append(f"主疏散：{decision.primary_route}")
    parts.append(decision.basis)

    return {
        "guidance_text": " | ".join(parts),
        "_source": "mock",
    }


def generate_guidance(decision: TriggerDecision) -> Dict[str, str]:
    """
    嘗試呼叫 Ollama 產生指揮官引導文字；失敗時 fallback 到 mock。
    回傳結果一律包含 "guidance_text" 與 "_source"。
    """
    try:
        result = _call_ollama(decision)
        logger.info("LLM 引導文字生成成功（model=%s）", OLLAMA_MODEL)
        return result
    except httpx.ConnectError:
        logger.warning("Ollama 連線失敗（%s），fallback 到 mock", OLLAMA_BASE_URL)
    except httpx.TimeoutException:
        logger.warning("Ollama 逾時（%.0fs），fallback 到 mock", OLLAMA_TIMEOUT)
    except (json.JSONDecodeError, ValueError, KeyError) as exc:
        logger.warning("Ollama 回傳格式錯誤（%s），fallback 到 mock", exc)
    except httpx.HTTPStatusError as exc:
        logger.warning("Ollama HTTP 錯誤 %s，fallback 到 mock", exc.response.status_code)

    return _mock_generate(decision)


def build_llm_user_prompt(decision: TriggerDecision) -> str:
    """產生送給 LLM 的 User 部分 prompt。"""
    return f"TriggerDecision：{decision.model_dump_json(indent=2)}"
