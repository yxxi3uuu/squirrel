# 🐿️ SQUIRREL 交通指揮中心

大型活動交通應變 AI 戰情室 — 整合即時監控、事件處置、策略諮詢、決策解釋、多語通報五大模組。

---

## 快速啟動

```bash
# 1. 確認 Ollama 在背景執行並拉好模型
ollama serve
ollama pull qwen2.5:3b

# 2. 安裝 Python 依賴
pip install fastapi "uvicorn[standard]" pandas python-dotenv pydantic

# 3. 啟動戰情室
python3 -m uvicorn warroom.server:app --reload --port 8000

# 4. 瀏覽器開啟
open http://localhost:8000
```

---

## 專案架構

```
squirrel/
├── warroom/                         # 戰情室主體（前端 + 後端一體化）
│   ├── server.py                    # FastAPI 入口，掛載所有 router
│   ├── index.html                   # 戰情室主頁 UI
│   ├── app.js                       # 前端互動邏輯
│   ├── style.css                    # 全站樣式
│   │
│   ├── routers/                     # 後端 API
│   │   ├── advisor.py               # 模組 3：策略諮詢顧問（規則引擎 + LLM）
│   │   ├── traffic.py               # 模組 1：車流即時監控 API
│   │   └── incidents.py             # 模組 2：事件注入 + SOP 決策引擎
│   │
│   ├── data_source/                 # 資料來源（官方 CSV / JSON）
│   │   ├── city_traffic_flow.csv    # 路段車速、飽和度時序
│   │   ├── signaling_crowd_density.csv  # 基地台人流、漫遊率
│   │   ├── road_network_geometry.json   # 路網拓撲、替代道路
│   │   └── live_incidents.json      # 可注入事件
│   │
│   └── module5/                     # 模組 5：多語通報
│       ├── backend/
│       │   ├── main.py              # 獨立 FastAPI app（可單獨啟動）
│       │   ├── routers/
│       │   │   ├── notify.py        # 多語告警生成 + 發布
│       │   │   └── signal.py        # 信令站點狀態
│       │   └── services/
│       │       └── llm.py           # Ollama 呼叫（多語文案生成）
│       └── frontend/
│           ├── index.html
│           ├── app.js
│           └── style.css
│
├── sop/
│   └── emergency_traffic_sop.txt    # SOP 全文（7 條應變規則）
│
├── data/
│   ├── __init__.py
│   └── snapshot.py                  # 資料快照抽象層（支援切換來源）
│
├── shared/
│   ├── __init__.py
│   ├── schemas.py                   # 共用 Pydantic 資料模型
│   └── lookup.py                    # 路名/站名別名查詢
│
├── docs/
│   ├── module3_design.md            # 模組 3 設計文件
│   └── shared_data_contract.md      # 跨模組資料契約
│
├── .env.example                     # 環境變數範本
├── requirements.txt                 # Python 依賴
└── omn.py                           # Streamlit 版模組 5（舊版備份）
```

---

## 模組概覽

| 模組 | 功能 | 入口 | 技術 |
|------|------|------|------|
| **1** 即時監控 | 路段飽和度分級、地圖標色、KPI | `/api/traffic/*` | Pandas + Leaflet |
| **2** 事件處置 | 注入事件 → SOP 決策 → 替代路線 + ETE | `/api/incidents/*` | 規則引擎 |
| **3** 策略諮詢 | What-if 對話、SOP 條款判斷 | `/api/advisor/*` | 規則引擎 + Ollama |
| **4** 決策解釋 | 判斷依據鏈、公式展示 | Drawer UI | 前端渲染 |
| **5** 多語通報 | 7 語告警生成 + 模擬發布 | `/api/notify/*` | Ollama qwen2.5:3b |

---

## SOP 條款速查

| 條 | 名稱 | 觸發條件 |
|----|------|----------|
| 1 | 壅塞分級 | 飽和度 ≥ 0.85 (B級) / ≥ 0.95 (A級)，觸發路段限忠孝東路/光復南路 |
| 2 | 車禍路障 | status∈{Closed,Blocked,Restricted} + severity∈{High,Critical} + RD_開頭 |
| 3 | 捷運分流 | BL17 人潮 > 25,000 或 Growth_Rate > 0.30 |
| 4 | 大巨蛋散場 | 歷史峰值 ≥ 30,000 且 Growth_Rate ≤ -0.20 |
| 5 | 號誌故障 | type=Power_Failure 或描述含號誌失效/故障 |
| 6 | 多語通報 | 任一基地台 Roaming_User_Pct ≥ 30% |
| 7 | ETE 計算 | base_clearance + max(0, (avg_saturation - 0.5) × 60) |

---

## 環境變數

| 變數 | 預設值 | 說明 |
|------|--------|------|
| `OLLAMA_URL` | `http://localhost:11434` | Ollama 服務位址 |
| `OLLAMA_MODEL` | `qwen2.5:3b` | 使用的模型名稱 |
| `DATA_SOURCE_DIR` | `warroom/data_source` | 資料來源路徑（可切換） |

---

## 比賽當天

- **換資料**：直接覆蓋 `warroom/data_source/` 下的檔案，欄位格式不變即可
- **換模型**：修改 `OLLAMA_MODEL` 環境變數
- **換路徑**：設 `DATA_SOURCE_DIR` 指向新目錄
