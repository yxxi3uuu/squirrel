# Squirrel Traffic Advisory

大型活動交通指揮系統的共用架構與模組整合 repo。

這個 repo 先定義全隊共用的資料契約、SOP 條文來源、路名/站名查詢方式，以及一個可跑的模組 3 對話式策略諮詢 demo。後續各模組應該沿用同一份 `TrafficSnapshot` 與 `TriggerDecision`，避免整合時出現路名、ID、門檻邏輯不一致。

## 系統資料流

```text
模組 1 資料取得/清洗
  -> TrafficSnapshot
模組 2 規則判斷/事件偵測
  -> TriggerDecision[]
模組 3 對話式策略諮詢
  -> what-if 推演、SOP 解釋、指揮官問答
模組 4 Dashboard
  -> 顯示 snapshot 與 trigger 狀態
模組 5 通報/多語訊息
  -> 依 TriggerDecision 產生通知內容
```

## 模組分工

| 模組 | 主要責任 | 共用輸入/輸出 |
|---|---|---|
| 模組 1 | 接資料來源、清洗、轉成系統格式 | 輸出 `TrafficSnapshot` |
| 模組 2 | 根據 SOP 與門檻做規則判斷、事件偵測、連鎖觸發 | 讀 `TrafficSnapshot`，輸出 `TriggerDecision[]` |
| 模組 3 | 指揮官聊天視窗、what-if 問答、SOP 推理解釋 | 讀 `TrafficSnapshot`、SOP、可引用 `TriggerDecision[]` |
| 模組 4 | Dashboard 視覺化與紅黃燈狀態 | 讀 `TrafficSnapshot`、`TriggerDecision[]` |
| 模組 5 | 通報訊息、多語內容、CMS/簡訊文字 | 讀 `TriggerDecision[]` |

## 目前內容

```text
.
├── app.py                        # 目前可跑的模組 3 FastAPI demo
├── prompt.py                     # 模組 3 system prompt 組裝
├── requirements.txt
├── data/
│   └── snapshot.py               # mock TrafficSnapshot，之後由模組 1 替換真實資料
├── shared/
│   ├── schemas.py                # 全隊共用資料契約
│   └── lookup.py                 # 路名、站名、場館別名查詢
├── docs/
│   └── shared_data_contract.md   # 共用資料架構與 branch 建議
├── llm/
│   └── clients.py                # mock / anthropic / bedrock LLM 抽象層
├── sop/
│   └── emergency_traffic_sop.txt # SOP 七條應變規則
└── static/
    └── index.html                # 模組 3 聊天前端 demo
```

## 共用資料契約

核心契約放在 `shared/schemas.py`：

- `TrafficSnapshot`：現場狀態快照，包含道路、捷運站、場館、基地台、事件、號誌。
- `TriggerDecision`：模組 2 判斷後的觸發結果，供模組 3、4、5 共用。

路名/站名/場館名稱查詢放在 `shared/lookup.py`。例如：

- `忠孝東路四段` -> `RD_TPE_001`
- `BL17` -> `BS_MRT_BL17`
- `大巨蛋` -> `BS_TPE_DOME`
- `台北101` -> `BS_TPE_101`

完整說明請看 `docs/shared_data_contract.md`。

## 本機啟動模組 3 Demo

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

## LLM 模式

透過環境變數 `LLM_MODE` 切換，預設為 `mock`。

| 模式 | 用途 | 需要什麼 |
|---|---|---|
| `mock` | demo 與離線驗收 | 不需要 API key |
| `anthropic` | 本機開發調 prompt | `ANTHROPIC_API_KEY` |
| `bedrock` | 正式賽 AWS 環境 | AWS 憑證與 Bedrock model access |

## 模組 3 Demo 驗收題

| # | 輸入 | 預期觸發 |
|---|---|---|
| T1 | 若 BL17 人數增至 40,000 人？ | 第 3 條，連鎖檢查第 6 條 |
| T2 | 忠孝東路飽和度 0.96？ | 第 1 條 A 級 |
| T3 | 忠孝東路飽和度 0.90？ | 第 1 條 B 級 |
| T4 | 大巨蛋 Growth_Rate 降至 -0.25？ | 第 4 條，連動第 3 條 |
| T5 | 台北101廣場漫遊率 35%？ | 第 6 條多語通報 |
| T6 | 飽和度 0.80 要處置嗎？ | 不觸發 |
| T7 | 接續 T1：那如果再加 5,000 人？ | 多輪對話接住上一輪 |

## Branch 建議

- `main`：保持可 demo、契約穩定。
- `shared-data-contract`：共用資料契約調整。
- `module-1-data-ingestion`：資料來源與清洗。
- `module-2-rule-engine`：SOP 規則判斷與事件偵測。
- `module-3-advisory`：對話式策略諮詢。
- `module-4-dashboard`：Dashboard。
- `module-5-notification`：通報與多語訊息。

各模組開發時，請優先沿用 `shared/schemas.py` 和 `shared/lookup.py`。如果需要新增欄位，先更新共用契約，再讓各模組跟上。
