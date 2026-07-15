# Module 3: Interactive Strategic Advisory

This branch implements Module 3: a SOP-grounded conversational advisory
assistant for traffic command-center what-if questions.

The module is designed as a chatbot beside the dashboard. Commanders can ask
hypothetical questions such as:

> 若 BL17 人數增至 40,000 人，依 SOP 該啟動什麼措施？

The backend retrieves relevant SOP context, sends the question and conversation
history to the selected LLM backend, and returns a structured advisory answer.

## Current Architecture

```text
.
├── app.py                          # FastAPI backend: /chat, /health, static UI
├── static/
│   └── index.html                  # Chat UI demo
├── module3_advisor/
│   ├── __init__.py
│   ├── service.py                  # Main advisory flow
│   ├── sop_retriever.py            # Local SOP/docs retrieval
│   ├── prompts.py                  # Module 3 prompt templates
│   └── schemas.py                  # Response shapes
├── llm/
│   ├── __init__.py
│   └── clients.py                  # mock / anthropic / bedrock LLM adapter
├── sop/
│   └── emergency_traffic_sop.txt   # SOP rules
├── docs/
│   ├── module3_advisor_architecture.md
│   └── shared_data_contract.md
├── shared/
│   ├── __init__.py
│   ├── lookup.py                   # Optional shared entity lookup helpers
│   └── schemas.py                  # Shared cross-module contracts
└── requirements.txt
```

## Request Flow

```text
Dashboard chat UI
  -> POST /chat
  -> module3_advisor.answer_advisory_question()
  -> retrieve relevant SOP/docs context
  -> llm.clients.chat()
  -> structured answer
```

Module 3 no longer depends on a mock traffic snapshot as its primary data
source. It answers what-if questions from user-provided assumptions and SOP
context. Future dashboard state can be added later as optional context.

## Run Locally

```bash
pip install -r requirements.txt
python3 -m uvicorn app:app --reload --port 8000
```

Open:

```text
http://localhost:8000
```

## API

### `POST /chat`

Request:

```json
{
  "question": "若 BL17 人數增至 40,000 人？",
  "history": [
    { "role": "user", "content": "上一輪問題" },
    { "role": "assistant", "content": "上一輪回答" }
  ]
}
```

Response:

```json
{
  "ok": true,
  "answer": "■ 觸發條款：第 3 條...",
  "mode": "mock",
  "sources": [
    {
      "path": "sop/emergency_traffic_sop.txt",
      "score": 3,
      "excerpt": "..."
    }
  ],
  "error": null
}
```

### `GET /health`

```json
{ "status": "ok", "mode": "mock" }
```

## LLM Mode

Use `LLM_MODE` to switch backend. Default is `mock`.

| Mode | Use case | Required setup |
|---|---|---|
| `mock` | Offline demo and acceptance tests | None |
| `anthropic` | Local model-backed development | `ANTHROPIC_API_KEY` |
| `bedrock` | AWS deployment | AWS credentials and Bedrock model access |

Example:

```bash
export LLM_MODE=anthropic
export ANTHROPIC_API_KEY=...
```

## Answer Format

The assistant should answer with these fields:

```text
■ 觸發條款：第 N 條（條款名稱）
■ 判定依據：輸入數值 vs 門檻數值
■ 預期動作：引用 SOP 的具體處置
■ 連鎖檢查：是否連動其他條款
```

## Acceptance Questions

| # | Input | Expected |
|---|---|---|
| T1 | 若 BL17 人數增至 40,000 人？ | 第 3 條，連鎖檢查第 6 條 |
| T2 | 忠孝東路飽和度 0.96？ | 第 1 條 A 級 |
| T3 | 忠孝東路飽和度 0.90？ | 第 1 條 B 級，不可答成 A 級 |
| T4 | 大巨蛋 Growth_Rate 降至 -0.25？ | 第 4 條，連動第 3 條 |
| T5 | 台北101廣場漫遊率 35%？ | 第 6 條多語通報 |
| T6 | 飽和度 0.80 要處置嗎？ | 不觸發，說明距門檻差距 |
| T7 | 接續 T1：那如果再加 5,000 人？ | 接住上一輪脈絡，改以 45,000 人判斷 |
