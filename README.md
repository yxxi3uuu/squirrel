# 🐿️ SQUIRREL 交通指揮中心

大型活動交通應變 AI 戰情室 — 整合即時監控、事件處置、策略諮詢、決策解釋、多語通報五大模組。

---

## 快速啟動（本機開發）

```bash
# 1. 確認 Ollama 在背景執行並拉好模型
ollama serve
ollama pull qwen2.5:7b

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
├── warroom/                         # 戰情室主體（本機開發 + Demo 用）
│   ├── server.py                    # FastAPI 入口
│   ├── index.html / app.js / style.css  # 前端 UI
│   ├── routers/
│   │   ├── advisor.py               # 模組 3：策略諮詢（規則引擎 + LLM）
│   │   ├── traffic.py               # 模組 1：車流監控 API
│   │   └── incidents.py             # 模組 2：事件注入 + SOP 決策
│   ├── llm/
│   │   └── client.py                # LLM 抽象層（ollama/bedrock/mock）
│   ├── module5/                     # 模組 5：多語通報
│   └── data_source/                 # 資料源（CSV/JSON）
│
├── agentcore-squirrel/              # AWS AgentCore 版本（比賽部署用）
│   ├── app/SquirrelAdvisor/main.py  # Strands Agent（@tool + Bedrock）
│   ├── agentcore/agentcore.json     # AgentCore 設定
│   ├── data/                        # SOP + 資料（已複製）
│   ├── deploy.sh                    # 一鍵部署腳本
│   └── README.md                    # 完整部署說明
│
├── sop/
│   └── emergency_traffic_sop.txt    # SOP 全文（7 條）
├── data/
│   └── snapshot.py                  # 資料快照抽象層
├── shared/
│   ├── schemas.py                   # 共用 Pydantic 模型
│   └── lookup.py                    # 路名/站名查詢
├── docs/
│   ├── deployment_guide.md          # 比賽當天部署流程
│   └── shared_data_contract.md      # 跨模組資料契約
├── .env.example                     # 環境變數範本
└── requirements.txt                 # Python 依賴
```

---

## 模組概覽

| 模組 | 功能 | 入口 |
|------|------|------|
| **1** 即時監控 | 路段飽和度分級、地圖標色 | `/api/traffic/*` |
| **2** 事件處置 | 注入事件 → SOP 決策 → 替代路線 | `/api/incidents/*` |
| **3** 策略諮詢 | What-if 對話、SOP 條款判斷 | `/api/advisor/*` |
| **4** 決策解釋 | 判斷依據鏈、ETE 公式 | Drawer UI |
| **5** 多語通報 | 7 語告警生成 + 模擬發布 | `/api/notify/*` |

---

## 比賽當天部署

詳見 `docs/deployment_guide.md` 和 `agentcore-squirrel/README.md`。

| 路線 | 指令 | 適用情境 |
|------|------|---------|
| AgentCore（推薦） | `cd agentcore-squirrel && bash deploy.sh` | 有 AWS 帳號 |
| EC2 直接跑 | SSH → clone → uvicorn | AgentCore 不可用時 |
| 本機投影 | `python3 -m uvicorn warroom.server:app --port 8000` | 最後備案 |

---

## 環境變數

| 變數 | 預設值 | 說明 |
|------|--------|------|
| `LLM_MODE` | `ollama` | 切換：ollama / bedrock / mock |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama 位址 |
| `OLLAMA_MODEL` | `qwen2.5:7b` | 本機模型 |
| `BEDROCK_MODEL_ID` | `us.anthropic.claude-sonnet-4-5-20250929-v1:0` | Bedrock 模型 |
| `BEDROCK_REGION` | `us-west-2` | AWS Region |
