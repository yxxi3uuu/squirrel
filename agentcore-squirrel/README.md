# 🐿️ SQUIRREL AgentCore — 模組三：對話式策略諮詢顧問

基於 AWS Bedrock AgentCore 的城市應變 AI Agent。
比賽當天拿到 AWS 帳號後，照這份文件操作即可部署。

---

## 模組三功能

| Agent 能力 | 說明 |
|---|---|
| SOP 條款判斷 | 比對即時數值與 SOP 門檻，引用對應條款 |
| What-if 分析 | 針對假設性人潮、壅塞或突發事件進行情境推演 |
| 多輪對話 | 延續前一輪的地點、數值與情境 |
| 連鎖條款檢查 | 確認某項 SOP 觸發後是否需同步啟動其他條款 |
| 主動預警 | 持續掃描即時數據，接近門檻時主動提醒 |
| 規則引擎驗證 | LLM 判斷異常時，由規則引擎重新驗證門檻 |

---

## 前置需求

| 工具 | 版本 | 安裝方式 |
|------|------|---------|
| Node.js | ≥ 20 | 比賽機器通常已有 |
| AWS CLI | ≥ 2.x | `brew install awscli` 或官方安裝包 |
| AgentCore CLI | 最新版 | `npm install -g @aws/agentcore` |
| Python | ≥ 3.11 | 比賽機器通常已有 |

---

## 完整部署步驟（預估 10 分鐘）

### Step 1：AWS 登入

```bash
aws configure
# AWS Access Key ID: 比賽提供的 key
# AWS Secret Access Key: 比賽提供的 secret
# Default region name: us-west-2
# Default output format: json

# 驗證
aws sts get-caller-identity
```

### Step 2：安裝 AgentCore CLI

```bash
npm install -g @aws/agentcore
agentcore --version
```

### Step 3：一鍵部署

```bash
cd agentcore-squirrel
bash deploy.sh
```

deploy.sh 會自動：
1. 驗證 AWS 連線
2. 更新 aws-targets.json（自動填入 account ID）
3. 部署 Agent 到 AgentCore Runtime
4. 加入 Memory（SEMANTIC + SUMMARIZATION）
5. 加入 Online Evaluation（GoalSuccessRate + Correctness）
6. 顯示部署狀態

### Step 4：驗證

```bash
agentcore status
# 預期：SquirrelAdvisor: Deployed - Runtime: READY
```

### Step 5：測試

```bash
# 基本測試
agentcore invoke "如果忠孝東路四段飽和度達 0.96，依 SOP 要啟動哪些措施？" --stream

# 多輪對話
SESSION=$(python3 -c 'import uuid; print(uuid.uuid4())')
agentcore invoke "如果 BL17 人數增至 40,000 人？" --session-id $SESSION --stream
agentcore invoke "那漫遊率呢？需要多語通報嗎？" --session-id $SESSION --stream

# 散場判斷
agentcore invoke "大巨蛋人潮達 40,000 人且成長率 -0.25，要散場嗎？" --stream
```

---

## AWS 架構

```
使用者／指揮官
  ↓
CloudFront（Dashboard warroom/index.html）
  ↓
API Gateway
  ↓
AgentCore Runtime（SquirrelAdvisor）
  ├── Amazon Bedrock（Claude Sonnet 4.5）
  │     ├─ SOP 推理
  │     ├─ What-if 對話
  │     └─ 多輪記憶
  │
  ├── AgentCore Memory
  │     └─ 跨 Session 語意記憶（SEMANTIC + SUMMARIZATION）
  │
  ├── @tool get_sop()
  │     └─ 回傳 SOP 全文（7 條應變規則）
  │
  ├── @tool get_snapshot()
  │     └─ 回傳即時數據快照（路段飽和度 + 站點人潮 + 主動預警）
  │
  ├── @tool check_rule(scenario)
  │     └─ 規則引擎驗證（降低 LLM 幻覺）
  │
  ├── @tool proactive_scan()
  │     └─ 主動掃描接近門檻的站點/路段
  │
  └── Online Evaluation
        ├─ GoalSuccessRate（指揮官目標達成率）
        └─ Correctness（SOP 引用正確率）
```

---

## LLM 呼叫流程

```
指揮官輸入問題
  ↓
AgentCore Runtime 接收 payload
  ↓
Agent 自動呼叫 get_sop() → 取得 SOP 全文
  ↓
Agent 自動呼叫 get_snapshot() → 取得即時數據 + 預警
  ↓
Agent 呼叫 check_rule(scenario) → 規則引擎交叉驗證
  ↓
Bedrock Claude Sonnet 4.5 推理
  ↓
產出結論 + 建議處置 + 後續確認
  ↓
Memory 保存對話歷史
  ↓
Online Eval 持續品質監控
```

---

## 檔案結構

```
agentcore-squirrel/
├── agentcore/
│   ├── agentcore.json      ← AgentCore 設定（Agent 名稱、model、framework）
│   └── aws-targets.json    ← 部署目標（Region + Account）
├── app/
│   └── SquirrelAdvisor/
│       ├── __init__.py
│       └── main.py         ← Agent 核心程式碼
│                              - SYSTEM_PROMPT
│                              - @tool get_sop()
│                              - @tool get_snapshot()
│                              - @tool check_rule()
│                              - @tool proactive_scan()
│                              - 規則引擎（確定性 SOP 判定）
│                              - invoke() entrypoint
├── data/
│   ├── emergency_traffic_sop.txt    ← SOP 全文（7 條）
│   ├── city_traffic_flow.csv        ← 路段車流
│   ├── signaling_crowd_density.csv  ← 站點人潮
│   └── road_network_geometry.json   ← 路網拓撲
├── deploy.sh               ← 一鍵部署腳本
└── README.md               ← 本文件
```

---

## 與 warroom/ 的關係

| | warroom/（本機） | agentcore-squirrel/（AWS） |
|---|----------|---------------------|
| 用途 | 本機開發 + Demo | 正式部署 + 評審 |
| LLM | LLM_MODE=bedrock（備案 Ollama qwen2.5:7b） | Bedrock Claude Sonnet 4.5 |
| 框架 | FastAPI | AgentCore Strands |
| 規則引擎 | 完整版（770 行） | 精簡版（門檻判定核心） |
| 部署 | `uvicorn warroom.server:app` | `agentcore deploy` |
| 前端 | 有（index.html AI 浮球） | 無（CLI 或接 API） |
| Memory | 無 | AgentCore Memory（跨 Session） |
| 品質監控 | 無 | Online Evaluation |

比賽當天策略：
1. 先用 warroom/ 在 EC2 跑起來確保 Demo 可用
2. 再花 5~10 分鐘部署 agentcore-squirrel/（加分用）
3. 如果 AgentCore 有問題 → fallback 回 warroom/

---

## 手動部署（如果 deploy.sh 失敗）

```bash
cd agentcore-squirrel
agentcore deploy -y -v
agentcore add memory --name CommanderMemory --strategies SEMANTIC,SUMMARIZATION --expiry 30
agentcore add online-eval --name QualityMonitor --runtime SquirrelAdvisor \
  --evaluator Builtin.GoalSuccessRate Builtin.Correctness \
  --sampling-rate 100 --enable-on-create
agentcore deploy -y -v
```

---

## 清理資源（比賽結束後）

```bash
agentcore remove all
agentcore deploy
```

---

## 常見問題

| 問題 | 解法 |
|------|------|
| `agentcore: command not found` | `npm install -g @aws/agentcore` |
| `ExpiredTokenException` | 重新 `aws configure` |
| Deploy 卡住超過 5 分鐘 | Ctrl+C 然後 `agentcore status` |
| invoke 沒輸出 | 加 `--stream` |
| Bedrock 403 | IAM 需要 `bedrock:InvokeModel` 權限 |
