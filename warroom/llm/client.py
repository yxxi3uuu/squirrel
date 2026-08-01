"""
LLM 抽象層 — 統一呼叫介面，支援三種後端切換。

環境變數：
  LLM_MODE=ollama | bedrock | mock（預設 ollama）
  OLLAMA_URL=http://localhost:11434
  OLLAMA_MODEL=qwen2.5:7b
  BEDROCK_MODEL_ID=us.anthropic.claude-sonnet-4-5-20250929-v1:0
  BEDROCK_REGION=us-west-2
"""

import json
import os
import urllib.request
from typing import List, Optional

LLM_MODE = os.environ.get("LLM_MODE", "bedrock")
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "qwen2.5:7b")
BEDROCK_MODEL_ID = os.environ.get("BEDROCK_MODEL_ID", "us.anthropic.claude-sonnet-4-5-20250929-v1:0")
BEDROCK_REGION = os.environ.get("BEDROCK_REGION", "us-west-2")


def chat(system_prompt: str, messages: List[dict], temperature: float = 0.2) -> Optional[str]:
    """
    統一 LLM 呼叫介面。

    Args:
        system_prompt: 系統角色設定（含 SOP + 數據 + 規則）
        messages: 對話歷史 [{"role": "user"/"assistant", "content": "..."}]
        temperature: 生成溫度

    Returns:
        LLM 回答文字，或 None（失敗時）
    """
    mode = LLM_MODE.lower()
    if mode == "bedrock":
        return _chat_bedrock(system_prompt, messages, temperature)
    elif mode == "ollama":
        return _chat_ollama(system_prompt, messages, temperature)
    elif mode == "mock":
        return _chat_mock(system_prompt, messages)
    else:
        return _chat_ollama(system_prompt, messages, temperature)


def check_status() -> dict:
    """檢查 LLM 後端連線狀態。"""
    mode = LLM_MODE.lower()
    if mode == "bedrock":
        try:
            import boto3  # noqa: F401
            return {"mode": "bedrock", "model": BEDROCK_MODEL_ID, "ok": True,
                    "message": f"Bedrock 模式 · {BEDROCK_MODEL_ID}"}
        except Exception as exc:
            return {"mode": "bedrock", "model": BEDROCK_MODEL_ID, "ok": False,
                    "message": f"Bedrock 模式設定中 · 缺少 boto3 或 AWS 環境：{exc}"}
    elif mode == "mock":
        return {"mode": "mock", "model": "mock", "ok": True,
                "message": "Mock 模式 · 預錄回答"}
    else:
        try:
            res = urllib.request.urlopen(f"{OLLAMA_URL}/api/tags", timeout=3)
            data = json.loads(res.read())
            base = OLLAMA_MODEL.split(":")[0]
            models = [m["name"] for m in data.get("models", [])]
            ok = any(n.startswith(base) for n in models)
            return {"mode": "ollama", "model": OLLAMA_MODEL, "ok": ok,
                    "message": f"Ollama · {OLLAMA_MODEL} 就緒" if ok else f"找不到 {OLLAMA_MODEL}"}
        except Exception:
            return {"mode": "ollama", "model": OLLAMA_MODEL, "ok": False,
                    "message": "Ollama 未連線"}


def _chat_ollama(system_prompt: str, messages: List[dict], temperature: float) -> Optional[str]:
    """Ollama 本地 LLM 呼叫。"""
    # 組 Qwen chat template
    prompt = f"<|im_start|>system\n{system_prompt}\n<|im_end|>\n"
    for msg in messages:
        role = msg["role"]
        prompt += f"<|im_start|>{role}\n{msg['content']}\n<|im_end|>\n"
    prompt += "<|im_start|>assistant\n"

    payload = json.dumps({
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": temperature, "top_p": 0.9, "num_predict": 800},
    }).encode()

    try:
        req = urllib.request.Request(
            f"{OLLAMA_URL}/api/generate",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=90) as resp:
            raw = json.loads(resp.read())["response"].strip()
        return raw if raw and len(raw) > 10 else None
    except Exception:
        return None


def _chat_bedrock(system_prompt: str, messages: List[dict], temperature: float) -> Optional[str]:
    """AWS Bedrock (Claude) 呼叫。需要 boto3 + AWS credentials。"""
    try:
        import boto3
        client = boto3.client("bedrock-runtime", region_name=BEDROCK_REGION)

        # Bedrock Converse API format
        bedrock_messages = []
        for msg in messages:
            bedrock_messages.append({
                "role": msg["role"],
                "content": [{"text": msg["content"]}],
            })

        response = client.converse(
            modelId=BEDROCK_MODEL_ID,
            system=[{"text": system_prompt}],
            messages=bedrock_messages,
            inferenceConfig={"temperature": temperature, "maxTokens": 800},
        )
        return response["output"]["message"]["content"][0]["text"]
    except Exception as e:
        print(f"[Bedrock error] {e}")
        return None


def _chat_mock(system_prompt: str, messages: List[dict]) -> Optional[str]:
    """Mock 模式 — 回傳預設回答，用於無網路環境。"""
    last_msg = messages[-1]["content"] if messages else ""
    if "40,000" in last_msg or "40000" in last_msg:
        return (
            "捷運國父紀念館站人潮達 40,000 人，已超過 SOP 第 3 條捷運與接駁分流門檻 25,000 人，應立即啟動分流\n"
            "■ 建議處置：請建議北捷過站不停、通知公車處調度接駁專車，並引導群眾步行至捷運市政府站分散進站\n"
            "■ 後續確認：若當前快照顯示外籍旅客比例達 30% 以上，需同步啟動 SOP 第 6 條多語通報"
        )
    if "0.96" in last_msg or "A 級" in last_msg:
        return (
            "忠孝東路四段壅塞程度達 0.96，依 SOP 第 1 條屬於 A 級癱瘓／紅燈，應啟動 A 級交通應變\n"
            "■ 建議處置：請通報交控中心啟動長綠燈時制，替代道路綠燈配時 +25%，並調度警力淨空路口；同時啟動替代路徑引導\n"
            "■ 後續確認：需持續監測替代道路是否形成二次壅塞"
        )
    return (
        "已收到您的問題，正在依據 SOP 進行判斷。\n"
        "■ 建議處置：請提供具體路段名稱或站點與數值條件，以便精確判定觸發條款。\n"
        "■ 後續確認：可搭配快捷鍵直接輸入常見情境。"
    )
