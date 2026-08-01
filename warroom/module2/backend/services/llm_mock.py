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

# ── LLM 模式設定 ──────────────────────────────────────────────────────────────
LLM_MODE: str = os.getenv("LLM_MODE", "bedrock")
OLLAMA_BASE_URL: str = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL: str = os.getenv("OLLAMA_MODEL", "qwen2.5:7b")
OLLAMA_TIMEOUT: float = float(os.getenv("OLLAMA_TIMEOUT", "30"))
BEDROCK_REGION: str = os.getenv("BEDROCK_REGION", "us-west-2")
BEDROCK_MODEL_ID: str = os.getenv("BEDROCK_MODEL_ID", "us.anthropic.claude-sonnet-4-5-20250929-v1:0")

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
    嘗試呼叫 LLM 產生指揮官引導文字；失敗時 fallback 到 mock。
    根據 LLM_MODE 決定使用 Bedrock、Ollama 或直接 Mock。
    回傳結果一律包含 "guidance_text" 與 "_source"。
    """
    if LLM_MODE == "mock":
        return _mock_generate(decision)

    if LLM_MODE == "bedrock":
        try:
            result = _call_bedrock(decision)
            logger.info("Bedrock 引導文字生成成功")
            return result
        except Exception as exc:
            logger.warning("Bedrock 呼叫失敗（%s），fallback 到 mock", exc)
            return _mock_generate(decision)

    # 預設 ollama
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


def _call_bedrock(decision: TriggerDecision) -> Dict[str, str]:
    """呼叫 AWS Bedrock Claude，回傳 {"guidance_text": ..., "_source": "bedrock"}。"""
    import boto3
    client = boto3.client("bedrock-runtime", region_name=BEDROCK_REGION)
    user_prompt = build_llm_user_prompt(decision)

    response = client.converse(
        modelId=BEDROCK_MODEL_ID,
        system=[{"text": SYSTEM_PROMPT}],
        messages=[{"role": "user", "content": [{"text": user_prompt}]}],
        inferenceConfig={"temperature": 0.2, "maxTokens": 300},
    )

    raw = response["output"]["message"]["content"][0]["text"].strip()
    # 嘗試解析 JSON
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()

    result = json.loads(raw)
    if "guidance_text" not in result:
        raise ValueError(f"Bedrock 回傳缺少 guidance_text：{result}")
    result["_source"] = "bedrock"
    return result


def build_llm_user_prompt(decision: TriggerDecision) -> str:
    """產生送給 LLM 的 User 部分 prompt。"""
    return f"TriggerDecision：{decision.model_dump_json(indent=2)}"


# ------------------------------------------------------------------
# 總結指揮官建議（將多筆 SOP 結果總結成一段話）
# ------------------------------------------------------------------

SUMMARY_SYSTEM_PROMPT = """你是台北市交通應變指揮中心的AI幕僚。
以下是同一事件觸發的多筆 SOP 規則引擎判斷結果（guidance_text），
請你把這些結果總結成一段給指揮官看的綜合建議文字，150字以內。
要求：
1. 合併重複或相關的行動建議
2. 按優先順序排列
3. 語氣簡潔明確，適合指揮官快速閱讀
4. 不要自己新增任何 SOP 條款或數字，只整合已有結論

請只輸出 JSON，不要有其他文字：{"commander_summary": "..."}"""


def generate_commander_summary(guidance_texts: list[dict[str, str]]) -> dict[str, str]:
    """
    將多筆 SOP 決策的 guidance_text 合併總結成一段指揮官綜合建議。
    guidance_texts 格式：[{"sop_clause": "SOP-2", "guidance_text": "..."}, ...]

    回傳 {"commander_summary": "...", "_source": "llm" | "mock"}
    """
    if not guidance_texts:
        return {"commander_summary": "", "_source": "mock"}

    # 只有一筆時不需要總結，直接回傳
    if len(guidance_texts) == 1:
        return {
            "commander_summary": guidance_texts[0]["guidance_text"],
            "_source": "mock",
        }

    # 嘗試呼叫 Ollama
    try:
        result = _call_ollama_summary(guidance_texts)
        logger.info("指揮官總結生成成功（model=%s）", OLLAMA_MODEL)
        return result
    except httpx.ConnectError:
        logger.warning("Ollama 連線失敗（%s），fallback 到 mock 總結", OLLAMA_BASE_URL)
    except httpx.TimeoutException:
        logger.warning("Ollama 逾時（%.0fs），fallback 到 mock 總結", OLLAMA_TIMEOUT)
    except (json.JSONDecodeError, ValueError, KeyError) as exc:
        logger.warning("Ollama 回傳格式錯誤（%s），fallback 到 mock 總結", exc)
    except httpx.HTTPStatusError as exc:
        logger.warning("Ollama HTTP 錯誤 %s，fallback 到 mock 總結", exc.response.status_code)

    return _mock_commander_summary(guidance_texts)


def _call_ollama_summary(guidance_texts: list[dict[str, str]]) -> dict[str, str]:
    """呼叫 Ollama 產生總結指揮官建議。"""
    user_content = "以下是同一事件觸發的多筆 SOP 判斷結果：\n\n"
    for item in guidance_texts:
        user_content += f"【{item['sop_clause']}】{item['guidance_text']}\n"

    payload = {
        "model": OLLAMA_MODEL,
        "stream": False,
        "messages": [
            {"role": "system", "content": SUMMARY_SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
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

    result: dict[str, str] = json.loads(raw_content)

    if "commander_summary" not in result:
        raise ValueError(f"LLM 回傳缺少 commander_summary 欄位：{result}")

    result["_source"] = "llm"
    return result


def _mock_commander_summary(guidance_texts: list[dict[str, str]]) -> dict[str, str]:
    """Mock 總結：將多筆 guidance_text 串接成一段簡潔文字。"""
    clauses = [item["sop_clause"] for item in guidance_texts]
    texts = [item["guidance_text"] for item in guidance_texts]

    summary = f"本事件同時觸發 {'、'.join(clauses)}。綜合建議：{'；'.join(texts)}"

    return {
        "commander_summary": summary,
        "_source": "mock",
    }
