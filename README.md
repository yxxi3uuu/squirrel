# 模組 3：對話式策略諮詢顧問

交通指揮中心的 AI 諮詢側欄。指揮官輸入假設性問題（What-if），系統即時檢索 SOP 並回答應觸發的條款、判定依據、預期動作與連鎖檢查。

---

## 專案結構

```
.
├── app.py                        # FastAPI 後端，POST /chat 端點
├── prompt.py                     # system prompt 組裝（角色 + SOP + 數據 + 規則）
├── requirements.txt
├── data/
│   └── snapshot.py               # 當前數據快照（mock，7/17 定案後換真實來源）
├── shared/
│   ├── schemas.py                # 全隊共用資料契約（snapshot / trigger result）
│   └── lookup.py                 # 路名、站名、場館別名查詢
├── docs/
│   └── shared_data_contract.md   # 共用資料架構說明，給各模組對齊
├── llm/
│   └── clients.py                # LLM 抽象層（mock / anthropic / bedrock 三種模式）
├── sop/
│   └── emergency_traffic_sop.txt # SOP 全文（7 條應變規則）
└── static/
    └── index.html                # 前端聊天視窗
```

---

## 環境需求

- Python 3.10 以上
- pip

---

## 快速啟動

### 1. 安裝相依套件

```bash
pip install -r requirements.txt
```

### 2. 啟動伺服器

```bash
uvicorn app:app --reload --port 8000
```

### 3. 開啟瀏覽器

```
http://localhost:8000
```

---

## LLM 模式切換

透過環境變數 `LLM_MODE` 切換，預設為 `mock`。

| 模式 | 用途 | 需要什麼 |
|------|------|----------|
| `mock` | 第一天接通前後端，罐頭答案 | 什麼都不用 |
| `anthropic` | 本機開發調 prompt | `ANTHROPIC_API_KEY` |
| `bedrock` | 正式賽上 AWS | 主辦方提供的 AWS 帳號 |

### mock 模式（預設）

```bash
uvicorn app:app --reload --port 8000
```

### anthropic 模式

```bash
ANTHROPIC_API_KEY=sk-ant-xxxx LLM_MODE=anthropic uvicorn app:app --port 8000
```

### bedrock 模式（正式賽）

```bash
LLM_MODE=bedrock AWS_REGION=us-east-1 uvicorn app:app --port 8000
```

> Bedrock 需要主辦方開通 model access 與 IAM 權限。預設 model：`anthropic.claude-3-5-sonnet-20241022-v2:0`，可透過環境變數 `BEDROCK_MODEL_ID` 覆寫。

---

## 驗收標準（T1–T7）

啟動後可用以下問題驗收，或直接點前端的快捷按鈕：

| # | 輸入 | 預期觸發 |
|---|------|----------|
| T1 | 若 BL17 人數增至 40,000 人？ | 第 3 條，連鎖檢查第 6 條（漫遊率 8% < 30%，不觸發） |
| T2 | 忠孝東路飽和度 0.96？ | 第 1 條 A 級 |
| T3 | 忠孝東路飽和度 0.90？ | 第 1 條 B 級（不可答成 A 級） |
| T4 | 大巨蛋 Growth_Rate 降至 -0.25？ | 第 4 條，連動第 3 條 |
| T5 | 台北101廣場漫遊率 35%？ | 第 6 條多語通報 |
| T6 | 飽和度 0.80 要處置嗎？ | 不觸發，距門檻 0.85 差 0.05 |
| T7 | （接續 T1）那如果再加 5,000 人？ | 多輪對話，接住上一輪脈絡 |

---

## API 規格

### `POST /chat`

**Request**

```json
{
  "question": "若 BL17 人數增至 40,000 人？",
  "history": [
    { "role": "user",      "content": "之前問過的問題" },
    { "role": "assistant", "content": "之前 AI 的回答" }
  ]
}
```

**Response**

```json
{
  "ok": true,
  "answer": "■ 觸發條款：第 3 條（捷運與接駁分流）\n■ 判定依據：...",
  "mode": "anthropic"
}
```

### `GET /health`

```json
{ "status": "ok", "mode": "mock" }
```

---

## 對接其他模組

| 對象 | 事項 |
|------|------|
| 模組 1（孟蓉） | `data/snapshot.py` 的 `get_snapshot()` 換成呼叫真實 API 或 DynamoDB，並輸出 `shared.schemas.TrafficSnapshot` 格式 |
| 模組 4（詠晴） | Dashboard 讀同一份 snapshot 與 `TriggerDecision`，避免路名/ID 不一致 |
| 模組 5（怡臻） | 通報模組讀 `TriggerDecision`，第 6 條多語觸發口徑：`Roaming_User_Pct ≥ 30%` |
| 全隊 | Bedrock model access、IAM 權限統一開通 |

完整共用資料契約請看：`docs/shared_data_contract.md`。

---

## 風險備案

| 風險 | 備案 |
|------|------|
| 無法用 Bedrock 開發 | 抽象層已隔離，用 `anthropic` 模式替代 |
| LLM 回答不穩定 | 用 T1–T7 題庫反覆測試，答錯則優化 prompt；temperature 已設為 0.1 |
| 網路不穩、LLM 超時 | 保留 `mock` 模式當保底；賽前錄好備用影片 |
