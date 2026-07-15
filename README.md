# Module 3: Interactive Strategic Advisory

這個分支實作核心功能模組 3：對話式策略諮詢顧問。

模組 3 的目標是在 Dashboard 旁提供對話視窗，讓指揮官輸入模擬指令或 what-if questions。AI 需根據使用者假設、SOP 條文、對話歷史，以及必要的當前狀態資料，回答會觸發的 SOP 條款、判定依據與預期動作。

## 模組定位

| 項目 | 說明 |
|---|---|
| 使用者 | 交通指揮官 |
| 入口 | Dashboard 旁的聊天視窗 |
| 核心問題 | 「若 BL17 人數增至 40,000 人，依 SOP 該做什麼？」 |
| 判斷方式 | LLM 根據 SOP 與假設條件判斷 |
| 輸出格式 | 觸發條款、判定依據、預期動作、連鎖檢查 |

模組 3 和其他模組的責任邊界：

- 不負責 Dashboard 時序視覺化，那是模組 1。
- 不負責事故注入後的路網重規劃，那是模組 2。
- 不負責 ETE 公式的正式程式運算，那是模組 4。
- 不負責多語通報發布流程，那是模組 5。
- 可以引用 `data/`、`shared/`、`sop/` 的共用資料，但 what-if 條件以使用者輸入為優先。

## 檔案結構

```text
.
├── app.py                        # FastAPI 後端，提供 /chat 與 /health
├── prompt.py                     # 組 system prompt：角色、SOP、資料快照、回答規則
├── static/
│   └── index.html                # 聊天視窗 demo
├── llm/
│   └── clients.py                # mock / anthropic / bedrock LLM 抽象層
├── data/
│   └── snapshot.py               # mock TrafficSnapshot
├── shared/
│   ├── schemas.py                # 共用 schema
│   └── lookup.py                 # 路名、站名、場館別名查詢
├── sop/
│   └── emergency_traffic_sop.txt # SOP 七條應變規則
└── requirements.txt
```

## 啟動方式

### 1. 安裝套件

```bash
pip install -r requirements.txt
```

### 2. 啟動服務

```bash
python3 -m uvicorn app:app --reload --port 8000
```

### 3. 開啟頁面

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
  "error": null
}
```

### `GET /health`

```json
{ "status": "ok", "mode": "mock" }
```

## LLM 模式

透過環境變數 `LLM_MODE` 切換，預設為 `mock`。

| 模式 | 用途 | 需要什麼 |
|---|---|---|
| `mock` | 離線 demo 與 T1-T7 驗收 | 不需要 API key |
| `anthropic` | 本機開發調 prompt | `ANTHROPIC_API_KEY` |
| `bedrock` | 正式賽 AWS 環境 | AWS 憑證與 Bedrock model access |

## 回答格式

每次回答固定包含四欄：

```text
■ 觸發條款：第 N 條（條款名稱）
■ 判定依據：輸入數值 vs 門檻數值
■ 預期動作：引用 SOP 的具體處置
■ 連鎖檢查：是否連動其他條款
```

## 驗收題

| # | 輸入 | 預期 |
|---|---|---|
| T1 | 若 BL17 人數增至 40,000 人？ | 第 3 條，連鎖檢查第 6 條 |
| T2 | 忠孝東路飽和度 0.96？ | 第 1 條 A 級 |
| T3 | 忠孝東路飽和度 0.90？ | 第 1 條 B 級，不可答成 A 級 |
| T4 | 大巨蛋 Growth_Rate 降至 -0.25？ | 第 4 條，連動第 3 條 |
| T5 | 台北101廣場漫遊率 35%？ | 第 6 條多語通報 |
| T6 | 飽和度 0.80 要處置嗎？ | 不觸發，說明距門檻差距 |
| T7 | 接續 T1：那如果再加 5,000 人？ | 接住上一輪脈絡，改以 45,000 人判斷 |

## 與 main 的關係

`main` 只保留共用資料契約、SOP、mock 資料格式和整合文件。這個分支包含模組 3 的專屬 API、前端與 LLM prompt。

不要把整個 `module-3-advisory` 直接 merge 回 `main`，否則會把 `app.py`、`prompt.py`、`static/`、`llm/` 等模組 3 專屬檔案加回共用底座。

若模組 3 需要修改共用契約，請開獨立小分支，只改 `shared/`、`data/`、`sop/` 或 `docs/shared_data_contract.md`，再合回 `main`。
