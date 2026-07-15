"""
app.py
FastAPI 後端 — 收問題、叫齊材料、呼叫 AI、回傳。

本機執行：
  uvicorn app:app --reload --port 8000

上雲（Lambda）：
  同一份程式碼，透過 Mangum 轉接 API Gateway 事件。
"""

import logging
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from prompt import build_system_prompt
from data.snapshot import get_snapshot, format_snapshot_for_prompt
from llm.clients import chat, get_mode

# ---------------------------------------------------------------------------
# 初始化
# ---------------------------------------------------------------------------

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="模組 3：對話式策略諮詢顧問", version="1.0.0")

STATIC_DIR = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

class Message(BaseModel):
    role: str     # "user" 或 "assistant"
    content: str


class ChatRequest(BaseModel):
    question: str
    history: Optional[List[Message]] = Field(default_factory=list)


class ChatResponse(BaseModel):
    ok: bool
    answer: str
    mode: str
    error: Optional[str] = None


# ---------------------------------------------------------------------------
# 路由
# ---------------------------------------------------------------------------

@app.get("/")
async def index():
    """回傳前端聊天頁面。"""
    return FileResponse(str(STATIC_DIR / "index.html"))


@app.get("/health")
async def health():
    """健康檢查。"""
    return {"status": "ok", "mode": get_mode()}


@app.post("/chat", response_model=ChatResponse)
async def chat_endpoint(req: ChatRequest):
    """
    核心對話端點。資料流：
    1. 讀取當前數據快照
    2. 組裝 system prompt（角色 + SOP + 數據 + 規則）
    3. 對話歷史 + 新問題 → LLM
    4. 回傳結構化回答，前端存入 history
    """
    try:
        logger.info("問題：%s", req.question[:100])

        # 1. 快照
        snapshot = get_snapshot()
        snapshot_text = format_snapshot_for_prompt(snapshot)

        # 2. System prompt
        system_prompt = build_system_prompt(snapshot_text)

        # 3. 組合 messages
        messages = [{"role": m.role, "content": m.content} for m in (req.history or [])]
        messages.append({"role": "user", "content": req.question})

        # 4. 呼叫 LLM
        answer = chat(system_prompt, messages)

        logger.info("回答完成，mode=%s", get_mode())
        return ChatResponse(ok=True, answer=answer, mode=get_mode())

    except FileNotFoundError as e:
        logger.error("找不到必要檔案：%s", e)
        raise HTTPException(status_code=500, detail=f"系統設定錯誤：{e}")
    except ValueError as e:
        logger.error("設定錯誤：%s", e)
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        logger.error("LLM 呼叫失敗：%s", e, exc_info=True)
        return ChatResponse(
            ok=False,
            answer="",
            mode=get_mode(),
            error=f"AI 服務暫時無法使用：{e}",
        )


# ---------------------------------------------------------------------------
# Lambda 相容層（正式賽上雲用）
# ---------------------------------------------------------------------------

def lambda_handler(event, context):
    """AWS Lambda + API Gateway 入口，透過 Mangum 轉接 ASGI。"""
    try:
        from mangum import Mangum
        return Mangum(app)(event, context)
    except ImportError:
        raise RuntimeError("Lambda 模式需要安裝 mangum：pip install mangum")


# ---------------------------------------------------------------------------
# 本機直接執行
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
