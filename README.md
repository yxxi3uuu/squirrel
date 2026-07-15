# Module 3: Interactive Strategic Advisory

This branch implements Module 3: a SOP-grounded conversational advisory
assistant for traffic command-center what-if questions.

Commanders can ask questions such as:

> 若 BL17 人數增至 40,000 人，依 SOP 該啟動什麼措施？

The backend retrieves relevant SOP context, sends the question and conversation
history to the selected LLM backend, and returns a structured advisory answer.

## Architecture

```text
.
├── app.py                          # FastAPI backend: /chat, /health, static UI
├── static/
│   └── index.html                  # Chat UI demo
├── module3_advisor/
│   ├── service.py                  # Main advisory flow
│   ├── sop_retriever.py            # Local SOP/docs retrieval
│   ├── prompts.py                  # Module 3 prompt templates
│   └── schemas.py                  # Response shapes
├── llm/
│   └── clients.py                  # mock / anthropic / bedrock LLM adapter
├── data_source/                    # Shared official CSV / JSON source files
├── data/
│   └── snapshot.py                 # Shared TrafficSnapshot builder
├── shared/                         # Shared schemas and lookup helpers
├── sop/
│   └── emergency_traffic_sop.txt   # Official SOP rules
├── docs/
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

Module 3 does not use `data/snapshot.py` as its primary input. It answers
what-if questions from user-provided assumptions and SOP context.

`data_source/` and `data/snapshot.py` are kept from `main` as shared team
infrastructure for modules 1, 2, 4, 5 and future optional dashboard context.

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

## Shared Data Check

The shared data layer from `main` can still be validated:

```bash
python3 - <<'PY'
from data.snapshot import get_snapshot, available_timestamps
from shared.schemas import TrafficSnapshot

snapshot = get_snapshot("2026-05-20 22:30")
print("時間軸:", available_timestamps()[0], "~", available_timestamps()[-1])
TrafficSnapshot(**snapshot)
PY
```

## Acceptance Questions

| # | Input | Expected |
|---|---|---|
| T1 | 若 BL17 人數增至 40,000 人？ | 第 3 條，連鎖檢查第 6 條 |
| T2 | 忠孝東路飽和度 0.96？ | 第 1 條 A 級 |
| T3 | 忠孝東路飽和度 0.90？ | 第 1 條 B 級 |
| T4 | 大巨蛋 Growth_Rate 降至 -0.25？ | 第 4 條，連動第 3 條 |
| T5 | 台北101廣場漫遊率 35%？ | 第 6 條多語通報 |
| T6 | 飽和度 0.80 要處置嗎？ | 不觸發，說明距門檻差距 |
| T7 | 接續 T1：那如果再加 5,000 人？ | 接住上一輪脈絡 |
