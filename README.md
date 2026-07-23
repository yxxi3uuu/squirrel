# 🐿️ SQUIRREL 交通指揮中心（War Room）

SQUIRREL 是一套即時交通事件應變指揮系統，整合交通監控、事件注入、SOP 規則引擎、AI 策略顧問與多語通報等功能模組，以戰情室（War Room）形式提供統一的決策介面。

## 系統架構

```
┌─────────────────────────────────────────────────────────┐
│             warroom/server.py (FastAPI, port 8000)       │
├─────────────────────────────────────────────────────────┤
│  前端：warroom/index.html + app.js + style.css          │
├─────────────────────────────────────────────────────────┤
│  API 路由：                                              │
│  ├─ /api/traffic   → 模組 1：即時車流與路網監控          │
│  ├─ /api/incidents → 模組 2：事件注入與 SOP 規則引擎     │
│  ├─ /api/advisor   → 模組 3：AI 策略諮詢顧問            │
│  ├─ /api/signal    → 模組 5：站點信號與漫遊率偵測        │
│  └─ /api/notify    → 模組 5：多語通報生成與發布          │
├─────────────────────────────────────────────────────────┤
│  後端服務：                                              │
│  ├─ warroom/module2/backend/services/sop_engine.py       │
│  ├─ warroom/module2/backend/services/llm_mock.py         │
│  ├─ warroom/module2/backend/store/incident_store.py      │
│  └─ warroom/module5/backend/services/llm.py              │
├─────────────────────────────────────────────────────────┤
│  共用層：                                                │
│  ├─ shared/schemas.py          Pydantic 資料模型         │
│  ├─ shared/lookup.py           路名/站名別名查詢         │
│  └─ data/snapshot.py           官方檔案 → TrafficSnapshot│
├─────────────────────────────────────────────────────────┤
│  資料源：warroom/data_source/ (= data_source/)           │
│  ├─ city_traffic_flow.csv           車流即時資料          │
│  ├─ signaling_crowd_density.csv     人流與漫遊率          │
│  ├─ road_network_geometry.json      路網拓撲與替代路線    │
│  └─ live_incidents.json             預設突發事件          │
└─────────────────────────────────────────────────────────┘
```

## 功能模組

| 模組 | 名稱 | 說明 |
|------|------|------|
| Module 1 | 即時儀表板 | Leaflet 地圖 + KPI + 壅塞警報卡片，即時顯示 15 路段飽和度分級 |
| Module 2 | 事件處置 | 注入突發事件（情境 / 自訂），SOP 規則引擎 60 秒內產出決策，含上下游判定、LLM 引導文字、ETE 公式計算 |
| Module 3 | AI 策略顧問 | 松鼠 AI（SQ）回答 what-if 假設性問題，基於即時快照與 SOP 規則 |
| Module 4 | 解釋鏈 | 右側 Drawer 展示判斷依據、ETE 公式計算與排除理由 |
| Module 5 | 多語通報 | 偵測外籍旅客比例 ≥ 30% 時觸發七語（中英日韓泰越法）告警生成，支援 Cell Broadcast 與 CMS 電子看板發布 |

## SOP 規則摘要

系統依據 `sop/emergency_traffic_sop.txt` 的七條標準程序運作：

1. **SOP-1** 壅塞分級：飽和度 ≥ 0.95 為 A 級、≥ 0.85 為 B 級
2. **SOP-2** 車禍與路障應變：路段封閉 + 高/重大嚴重度 → 主疏散路徑 + CMS（含上下游判定與替代路線篩選）
3. **SOP-3** 捷運與接駁分流：人潮 > 25,000 或成長率 > 30%
4. **SOP-4** 大巨蛋散場啟動：歷史峰值 ≥ 30,000 且成長率 ≤ -0.20
5. **SOP-5** 號誌故障應變：每路口 2 名警力 + CMS 發布
6. **SOP-6** 多語通報：漫遊率 ≥ 30% → 七語同步發布
7. **SOP-7** ETE 計算：base_clearance + congestion_penalty

## 環境需求

- Python 3.10+
- [Ollama](https://ollama.com/)（選用，用於模組 2 引導文字與模組 5 多語生成，未安裝時自動 fallback 為模板文字）

## 安裝

```bash
# 1. 複製專案
git clone <repo-url> squirrel
cd squirrel

# 2. 建立虛擬環境（建議）
python -m venv .venv
.venv\Scripts\activate        # Windows
# source .venv/bin/activate   # macOS / Linux

# 3. 安裝依賴
pip install -r requirements.txt

# 4. 環境變數設定
copy .env.example .env
# 編輯 .env，填入 Ollama URL 與模型名稱（預設值通常即可）
```

## 啟動方式

### 戰情室整合啟動（推薦）

一次啟動所有模組，前端 + 所有 API 統一在 port 8000：

```bash
cd squirrel
uvicorn warroom.server:app --reload --port 8000
```

啟動後開啟瀏覽器：

- **戰情室主頁**：http://localhost:8000
- **API 文件（Swagger UI）**：http://localhost:8000/docs
- **Module 5 獨立頁面**：http://localhost:8000/m5/

### 模組獨立啟動（開發用）

如果只需開發單一模組：

```bash
# Module 2 — Live Incident Response（port 8002）
uvicorn warroom.module2.backend.main:app --reload --port 8002

# Module 5 — 多語通報（port 8005）
uvicorn warroom.module5.backend.main:app --reload --port 8005

# Module 5 — Streamlit 獨立版（port 8501）
streamlit run omn.py
```

### Ollama 本地 LLM（選用）

模組 2 的指揮官引導文字與模組 5 多語生成皆使用 Ollama 本地推論。若未啟動 Ollama，系統會自動 fallback 為預設模板文字，並在回傳中標註 `_source: "mock"`。

```bash
# 下載模型（模組 2 使用 1.5b，模組 5 使用 3b）
ollama pull qwen2.5:1.5b
ollama pull qwen2.5:3b

# 啟動 Ollama 服務（預設 port 11434）
ollama serve
```

## 環境變數

| 變數 | 預設值 | 說明 |
|------|--------|------|
| `OLLAMA_URL` | `http://localhost:11434` | Ollama 服務位址 |
| `OLLAMA_MODEL` | `qwen2.5:3b` | 模組 5 使用的模型 |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | 模組 2 LLM 服務位址 |
| `OLLAMA_TIMEOUT` | `30` | 模組 2 LLM 請求逾時秒數 |

## API 端點一覽

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | `/api/traffic/segments` | 取得所有路段最新車流快照 |
| GET | `/api/traffic/network` | 取得路網靜態資料（容量、替代路線） |
| GET | `/api/traffic/sop` | 取得 SOP 全文 |
| GET | `/api/incidents/list` | 列出所有事件 |
| GET | `/api/incidents/active` | 取得未解除事件 |
| GET | `/api/incidents/samples` | 取得內建情境事件清單（一鍵注入用） |
| POST | `/api/incidents/inject` | 注入事件並取得 SOP 決策（含 processing_time_ms） |
| POST | `/api/incidents/{id}/resolve` | 解除事件 |
| GET | `/api/incidents/reload` | 重新載入 live_incidents.json |
| POST | `/api/advisor/chat` | AI 策略顧問對話 |
| GET | `/api/signal/stations` | 取得站點漫遊率資料 |
| GET | `/api/signal/triggered` | 取得已觸發 SOP-6 的站點 |
| GET | `/api/notify/ollama-status` | 檢查 Ollama 連線狀態 |
| POST | `/api/notify/generate` | 生成多語告警文字 |
| POST | `/api/notify/publish` | 發布通報至簡訊與看板 |
| GET | `/api/notify/publish-log` | 取得發布歷史日誌 |
| GET | `/api/notify/lang-meta` | 取得支援語言元資料 |
| GET | `/health` | 健康檢查（回傳已掛載模組列表） |

## 專案結構

```
squirrel/
├── warroom/                    # 戰情室（整合入口）
│   ├── server.py               # FastAPI 整合 server（port 8000）
│   ├── index.html              # 前端主頁（儀表板 + 事件處置雙分頁）
│   ├── app.js                  # 前端邏輯（Leaflet 地圖、事件注入、AI 顧問）
│   ├── style.css               # 樣式
│   ├── routers/                # 整合版 API 路由
│   │   ├── traffic.py          # 模組 1（車流 + 路網 + SOP 全文）
│   │   ├── incidents.py        # 模組 2（整合 sop_engine，含站點事件處理）
│   │   └── advisor.py          # 模組 3（策略諮詢，rules+snapshot 推論）
│   ├── module2/                # 模組 2 獨立版
│   │   ├── backend/
│   │   │   ├── main.py         # 獨立 FastAPI app（port 8002）
│   │   │   ├── routers/
│   │   │   │   └── incidents.py # 完整事件 API（inject/samples/active/resolve）
│   │   │   ├── services/
│   │   │   │   ├── sop_engine.py # SOP 規則引擎核心（SOP-1/2/5/7）
│   │   │   │   └── llm_mock.py  # Ollama LLM + fallback mock
│   │   │   └── store/
│   │   │       └── incident_store.py # In-memory 事件儲存
│   │   ├── tests/
│   │   │   └── test_sop_engine.py
│   │   └── requirements.txt
│   ├── module5/                # 模組 5 多語通報
│   │   ├── backend/
│   │   │   ├── main.py         # 獨立 FastAPI app（port 8005）
│   │   │   ├── routers/
│   │   │   │   ├── signal.py   # 信令資料（站點漫遊率偵測）
│   │   │   │   └── notify.py   # 多語告警生成 / 發布 / 日誌
│   │   │   └── services/
│   │   │       └── llm.py      # Ollama 七語生成 + mock fallback
│   │   ├── frontend/
│   │   │   ├── index.html      # Module 5 獨立前端
│   │   │   ├── app.js
│   │   │   └── style.css
│   │   └── requirements.txt
│   └── data_source/            # 資料檔案（warroom 本地副本）
├── shared/                     # 共用資料模型
│   ├── schemas.py              # Pydantic v2 schemas（TrafficSnapshot, TriggerDecision 等）
│   └── lookup.py               # 路名/站名別名正規化與查詢
├── data/                       # 資料快照工具
│   └── snapshot.py             # 官方檔案 → TrafficSnapshot 組裝
├── data_source/                # 主辦方官方資料（根目錄版）
│   ├── city_traffic_flow.csv
│   ├── signaling_crowd_density.csv
│   ├── road_network_geometry.json
│   └── live_incidents.json
├── sop/                        # SOP 規則文件
│   └── emergency_traffic_sop.txt
├── docs/                       # 文件
│   └── shared_data_contract.md # 共用資料架構規範
├── omn.py                      # 模組 5 Streamlit 獨立版
├── requirements.txt            # 主依賴清單
├── .env.example                # 環境變數範本
├── README.md
└── README_module5.md           # 模組 5 獨立說明文件
```

## 技術棧

- **後端**：FastAPI + Uvicorn
- **前端**：原生 HTML/CSS/JS + Leaflet.js（地圖）
- **LLM**：Ollama（Qwen 2.5 系列）— 本地推論，可離線運作
  - 模組 2：`qwen2.5:1.5b`（指揮官引導文字，透過 httpx 呼叫）
  - 模組 5：`qwen2.5:3b`（七語告警生成，透過 urllib）
- **資料格式**：CSV + JSON（模擬即時資料源）
- **資料驗證**：Pydantic v2（strict mode, extra=forbid）
- **HTTP 客戶端**：httpx（模組 2 LLM 呼叫）

## 開發與測試

```bash
# 執行模組 2 測試
pytest warroom/module2/tests/ -v

# 重新載入事件資料（不重啟 server）
curl http://localhost:8000/api/incidents/reload

# 檢查 Ollama 狀態
curl http://localhost:8000/api/notify/ollama-status
```

## 資料契約

各模組共用的 ID 規則與快照格式定義於 `docs/shared_data_contract.md`：

| 類型 | Prefix | 範例 | 說明 |
|------|--------|------|------|
| 道路路段 | `RD_` | `RD_TPE_001` | 路段與替代道路 |
| 人流站點 | `BS_` | `BS_MRT_BL17` | 捷運站、場館、商圈、轉運站 |
| 事件 | 官方 event_id | `TPE_2026_ACC_001` | 事故、路障、號誌故障 |
