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
│  ├─ backend/services/sop_engine.py  SOP 規則引擎         │
│  ├─ backend/services/llm_mock.py    LLM fallback         │
│  └─ warroom/module5/backend/        多語化 LLM 接口      │
├─────────────────────────────────────────────────────────┤
│  資料源：warroom/data_source/                            │
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
| Module 2 | 事件處置 | 注入突發事件（情境 / 自訂），SOP 規則引擎 60 秒內產出決策 |
| Module 3 | AI 策略顧問 | 松鼠 AI（SQ）回答 what-if 假設性問題，基於即時快照與 SOP 規則 |
| Module 4 | 解釋鏈 | 右側 Drawer 展示判斷依據、ETE 公式計算與排除理由 |
| Module 5 | 多語通報 | 偵測外籍旅客比例 ≥ 30% 時觸發七語（中英日韓泰越法）告警生成 |

## SOP 規則摘要

系統依據 `sop/emergency_traffic_sop.txt` 的七條標準程序運作：

1. **SOP-1** 壅塞分級：飽和度 ≥ 0.95 為 A 級、≥ 0.85 為 B 級
2. **SOP-2** 車禍與路障應變：路段封閉 + 高/重大嚴重度 → 主疏散路徑 + CMS
3. **SOP-3** 捷運與接駁分流：人潮 > 25,000 或成長率 > 30%
4. **SOP-4** 大巨蛋散場啟動：歷史峰值 ≥ 30,000 且成長率 ≤ -0.20
5. **SOP-5** 號誌故障應變：每路口 2 名警力 + CMS 發布
6. **SOP-6** 多語通報：漫遊率 ≥ 30% → 七語同步發布
7. **SOP-7** ETE 計算：base_clearance + congestion_penalty

## 環境需求

- Python 3.10+
- [Ollama](https://ollama.com/)（選用，用於模組 5 多語生成，未安裝時 fallback 為模板文字）

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
uvicorn backend.main:app --reload --port 8002

# Module 5 — 多語通報（port 8005）
uvicorn warroom.module5.backend.main:app --reload --port 8005
```

### Ollama 本地 LLM（選用）

模組 5 多語生成使用 Ollama 本地推論。若未啟動 Ollama，系統會自動 fallback 為預設模板文字。

```bash
# 下載模型
ollama pull qwen2.5:3b

# 啟動 Ollama 服務（預設 port 11434）
ollama serve
```

## API 端點一覽

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | `/api/traffic/segments` | 取得所有路段最新車流快照 |
| GET | `/api/traffic/network` | 取得路網靜態資料（容量、替代路線） |
| GET | `/api/traffic/sop` | 取得 SOP 全文 |
| GET | `/api/incidents/list` | 列出所有事件 |
| GET | `/api/incidents/active` | 取得未解除事件 |
| POST | `/api/incidents/inject` | 注入事件並取得 SOP 決策 |
| POST | `/api/incidents/{id}/resolve` | 解除事件 |
| POST | `/api/advisor/chat` | AI 策略顧問對話 |
| GET | `/api/signal/stations` | 取得站點漫遊率資料 |
| GET | `/api/signal/triggered` | 取得已觸發 SOP-6 的站點 |
| POST | `/api/notify/generate` | 生成多語告警文字 |
| POST | `/api/notify/publish` | 發布通報至簡訊與看板 |
| GET | `/health` | 健康檢查 |

## 專案結構

```
squirrel/
├── warroom/                    # 戰情室（整合入口）
│   ├── server.py               # FastAPI 整合 server
│   ├── index.html              # 前端主頁
│   ├── app.js                  # 前端邏輯
│   ├── style.css               # 樣式
│   ├── routers/                # 整合版 API 路由
│   │   ├── traffic.py          # 模組 1
│   │   ├── incidents.py        # 模組 2
│   │   └── advisor.py          # 模組 3
│   ├── module5/                # 模組 5 多語通報
│   │   ├── backend/            # API + LLM 服務
│   │   └── frontend/           # 獨立前端
│   └── data_source/            # 資料檔案
├── backend/                    # 模組 2 獨立版
│   ├── main.py
│   ├── routers/
│   ├── services/
│   │   ├── sop_engine.py       # SOP 規則引擎核心
│   │   └── llm_mock.py         # LLM 失效時的 fallback
│   ├── store/
│   └── tests/
├── shared/                     # 共用資料模型
│   ├── schemas.py              # Pydantic schemas
│   └── lookup.py
├── data/                       # 資料快照工具
├── sop/                        # SOP 規則文件
│   └── emergency_traffic_sop.txt
├── docs/                       # 文件
├── requirements.txt
├── .env.example
└── README.md
```

## 技術棧

- **後端**：FastAPI + Uvicorn
- **前端**：原生 HTML/CSS/JS + Leaflet.js（地圖）
- **LLM**：Ollama（Qwen 2.5:3b）— 本地推論，可離線運作
- **資料格式**：CSV + JSON（模擬即時資料源）
- **資料驗證**：Pydantic v2

## 開發與測試

```bash
# 執行測試
pytest backend/tests/ -v

# 重新載入事件資料（不重啟 server）
curl http://localhost:8000/api/incidents/reload
```
