# SQUIRREL 交通指揮中心

大型活動交通應變 AI 戰情室 — 整合即時監控、事件處置、策略諮詢、決策解釋、多語通報五大模組。

---

## 快速啟動（本機開發）

```bash
# 1. 設定 AWS Bedrock 認證（需有 Bedrock 模型存取權限）
export AWS_ACCESS_KEY_ID=your-key
export AWS_SECRET_ACCESS_KEY=your-secret
export AWS_DEFAULT_REGION=us-west-2

# 2. 安裝 Python 依賴
pip install -r requirements.txt

# 3. 啟動戰情室
uvicorn warroom.server:app --reload --port 8000

# 4. 瀏覽器開啟
# http://localhost:8000
```

### 本機無 AWS 時的替代方案（Ollama）

```bash
# 安裝 Ollama 並拉模型
ollama serve
ollama pull qwen2.5:3b

# 設定環境變數切換到 Ollama 模式
export LLM_MODE=ollama

# 啟動
uvicorn warroom.server:app --reload --port 8000
```

---

## 專案架構

```
squirrel/
├── warroom/                         # 戰情室主體
│   ├── server.py                    # FastAPI 入口，掛載所有 Router
│   ├── index.html / app.js / style.css  # 前端 UI（原生 HTML+CSS+JS）
│   ├── routers/
│   │   ├── module1.py               # M1：動態時序儀表板 API
│   │   ├── traffic.py               # M1：車流/座標 API
│   │   ├── incidents.py             # M2：事件注入 + SOP 決策引擎
│   │   ├── advisor.py               # M3：策略諮詢（規則引擎 + LLM）
│   │   └── reasoning.py             # M4：決策解釋鏈 API
│   ├── module1/backend/
│   │   ├── thresholds.py            # SOP 1/3/4 門檻純函式判斷
│   │   └── llm_summary.py           # LLM 摘要（目前未啟用）
│   ├── module2/backend/
│   │   └── services/sop_engine.py   # SOP 2/5/7 完整規則引擎
│   ├── module5/backend/
│   │   ├── routers/notify.py        # M5：多語通報 API
│   │   └── services/llm.py          # M5：LLM 多語翻譯（Ollama/Bedrock）
│   └── data_source/                 # 官方資料源（CSV/JSON）
│
├── reasoning/                       # M4：推理與可解釋性模組
│   ├── builder.py                   # 決策記錄建構器
│   ├── rules.py                     # ETE/路線評分規則
│   ├── explanation.py               # 確定性解釋生成
│   ├── counterfactual.py            # 反事實分析
│   └── bedrock.py                   # Bedrock LLM 增強解釋
│
├── data/
│   └── snapshot.py                  # 資料快照抽象層（所有模組共用）
├── shared/
│   ├── schemas.py                   # 共用 Pydantic 模型（TrafficSnapshot 等）
│   └── lookup.py                    # 路名/站名別名查詢
├── sop/
│   └── emergency_traffic_sop.txt    # SOP 全文（7 條）
├── scripts/
│   └── fetch_road_coords.py         # OSM 座標抓取工具
├── docs/
│   ├── module1_design.md            # M1 設計文件
│   ├── module3_design.md            # M3 設計文件
│   └── shared_data_contract.md      # 跨模組資料契約
├── .kiro/                           # Kiro IDE 設定（Steering/Hooks/Specs）
├── .env.example                     # 環境變數範本
└── requirements.txt                 # Python 依賴
```

---

## 模組概覽

| 模組 | 功能 | 技術重點 |
|------|------|----------|
| **M1** 動態時序儀表板 | 時間軸播放、SOP 1/3/4 門檻預警、連續色階地圖、歷史趨勢圖 | 純函式門檻判斷，不依賴 LLM；race condition 防護；KPI 動畫 |
| **M2** 事件處置 | 事件注入、SOP 2/5/7 決策引擎、主/次疏散路徑、ETE 計算、CMS 產出 | 上下游路口判定、容量篩選、排除理由記錄 |
| **M3** 策略諮詢 | What-if 對話、SOP 全 7 條判斷、情境快捷 | 規則引擎為主、Ollama LLM 為輔潤飾 |
| **M4** 決策解釋 | 解釋鏈 Drawer、ETE 公式分解、排除理由、反事實分析 | 確定性解釋 + Bedrock 增強 |
| **M5** 多語通報 | SOP-6 漫遊門檻偵測、7 語告警生成、CMS 多語翻譯 | Ollama/Bedrock 翻譯，支援 mock fallback |

---

## SOP 門檻對照

| SOP 條 | 觸發條件 | 負責模組 |
|--------|----------|----------|
| 第 1 條 | Saturation_Score >= 0.85(B) / >= 0.95(A) | M1 |
| 第 2 條 | status in {Closed,Blocked,Restricted} + severity in {High,Critical} + RD_ 開頭 | M2 |
| 第 3 條 | BS_MRT_BL17: Growth_Rate > 0.30 或 User_Count > 25,000 | M1 |
| 第 4 條 | BS_TPE_DOME: 歷史峰值 >= 30,000 且 Growth_Rate <= -0.20 | M1 |
| 第 5 條 | type="Power_Failure" 或描述含「號誌失效/故障」 | M2 |
| 第 6 條 | 任一基地台 Roaming_User_Pct >= 0.30 | M5 |
| 第 7 條 | ETE = base_clearance + congestion_penalty | M2 |

---

## 前端特色功能

- **連續色階地圖**：路段顏色依飽和度 6 段漸變（深綠至暗紫紅），類似 Google Maps 路況
- **站點動態半徑**：圓點大小隨人流數即時縮放（5k=5px, 40k=14px）
- **SOP-4 連動 SOP-3**：散場觸發時自動顯示「連動接駁分流」提示
- **預警歷史紀錄**：可展開查看整場活動累積的所有 SOP 觸發紀錄
- **Race condition 防護**：時間軸快速操作時丟棄過期回應，畫面不閃爍
- **KPI countup 動畫**：數字切換有 350ms ease-out 過場
- **RWD 響應式**：支援桌機/平板/手機三種斷點自動適配

---

## 資料架構

所有模組一律透過 `data/snapshot.py` 的 `get_snapshot(timestamp)` 取得資料：

```json
{
  "timestamp": "2026-05-20 22:30",
  "source": "official_files",
  "road_segments": {"RD_TPE_001": {}},
  "stations": {"BS_MRT_BL17": {}},
  "incidents": []
}
```

ID 規則：道路路段 `RD_` 開頭、人流站點 `BS_` 開頭、事件用官方 `event_id`。

---

## 環境變數

| 變數 | 預設值 | 說明 |
|------|--------|------|
| `LLM_MODE` | `bedrock` | 切換：ollama / bedrock / mock |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama 位址 |
| `OLLAMA_MODEL` | `qwen2.5:3b` | 本機模型（M3 使用） |
| `BEDROCK_MODEL_ID` | `us.anthropic.claude-sonnet-4-5-20250929-v1:0` | Bedrock 模型（M4/M5 使用） |
| `BEDROCK_REGION` | `us-west-2` | AWS Region |

---

## 開發工具

本專案使用 [Kiro IDE](https://kiro.dev) 進行規範驅動開發：

- **Steering**（`.kiro/steering/`）：專案慣例、SOP 規則參考、資料契約規範
- **Hooks**（`.kiro/hooks/`）：存檔自動跑 pytest、schema 修改審查、新檔慣例提醒
- **Specs**（`.kiro/specs/`）：SOP-4 門檻、地圖增強等功能的完整 requirements -> design -> tasks 流程
