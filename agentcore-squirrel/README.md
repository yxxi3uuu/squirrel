# 🐿️ SQUIRREL AgentCore — 策略諮詢顧問

基於 AWS Bedrock AgentCore 的城市應變 AI Agent。
比賽當天拿到 AWS 帳號後，照這份文件操作即可部署。

---

## 前置需求

| 工具 | 版本 | 安裝方式 |
|------|------|---------|
| Node.js | ≥ 20 | 比賽機器通常已有 |
| AWS CLI | ≥ 2.x | `curl "https://awscli.amazonaws.com/AWSCLIV2.pkg" -o "AWSCLIV2.pkg" && sudo installer -pkg AWSCLIV2.pkg -target /` |
| AgentCore CLI | 最新版 | `npm install -g @aws/agentcore` |
| Python | ≥ 3.11 | 比賽機器通常已有 |

---

## 完整部署步驟（預估 10 分鐘）

### Step 1：AWS 登入（1 分鐘）

```bash
aws configure
# AWS Access Key ID: 比賽提供的 key
# AWS Secret Access Key: 比賽提供的 secret
# Default region name: us-west-2
# Default output format: json
```

驗證：
```bash
aws sts get-caller-identity
# 看到 Account 和 Arn 就是成功
```

### Step 2：安裝 AgentCore CLI（30 秒）

```bash
npm install -g @aws/agentcore
agentcore --version
```

### Step 3：進入專案目錄（10 秒）

```bash
cd agentcore-squirrel
```

### Step 4：一鍵部署（5 分鐘）

```bash
bash deploy.sh
```

這個腳本會自動：
1. 驗證 AWS 連線
2. 部署 Agent 到 AgentCore Runtime
3. 加入 Memory（SEMANTIC + SUMMARIZATION）
4. 加入 Online Evaluation（品質監控）
5. 顯示部署狀態

### Step 5：驗證部署成功

```bash
agentcore status
```

預期輸出：
```
Agents
  SquirrelAdvisor: Deployed - Runtime: READY
```

### Step 6：測試

```bash
# 基本測試
agentcore invoke "如果忠孝東路四段飽和度達 0.96，依 SOP 要啟動哪些措施？" --stream

# 多輪對話測試
SESSION=$(python3 -c 'import uuid; print(uuid.uuid4())')
agentcore invoke "如果 BL17 人數增至 40,000 人？" --session-id $SESSION --stream
agentcore invoke "那漫遊率呢？需要多語通報嗎？" --session-id $SESSION --stream

# 散場測試
agentcore invoke "大巨蛋人潮達 40,000 人且成長率 -0.25，要散場嗎？" --stream
```

---

## 如果 deploy.sh 失敗，手動部署

```bash
cd agentcore-squirrel

# 手動部署 Agent
agentcore deploy -y -v

# 手動加 Memory
agentcore add memory \
  --name CommanderMemory \
  --strategies SEMANTIC,SUMMARIZATION \
  --expiry 30

# 手動加 Online Eval
agentcore add online-eval \
  --name QualityMonitor \
  --runtime SquirrelAdvisor \
  --evaluator Builtin.GoalSuccessRate Builtin.Correctness \
  --sampling-rate 100 \
  --enable-on-create

# 重新部署
agentcore deploy -y -v
```

---

## 架構

```
AgentCore Runtime（SquirrelAdvisor）
│
├── Amazon Bedrock（Claude Sonnet 4.5）
│     └─ SOP 推理 + What-if 對話 + 多語生成
│
├── AgentCore Memory（SEMANTIC + SUMMARIZATION）
│     └─ 跨 session 記住指揮官偏好
│
├── @tool get_sop()
│     └─ 回傳 SOP 全文（7 條應變規則）
│
├── @tool get_snapshot()
│     └─ 回傳即時數據快照（路段飽和度 + 站點人潮）
│
└── Online Evaluation
      ├─ GoalSuccessRate（指揮官目標達成率）
      └─ Correctness（SOP 引用正確率）
```

---

## 檔案結構

```
agentcore-squirrel/
├── agentcore/
│   ├── agentcore.json      ← AgentCore 主設定（Agent 名稱、model、framework）
│   └── aws-targets.json    ← 部署目標（Region: us-west-2）
├── app/
│   └── SquirrelAdvisor/
│       ├── __init__.py
│       └── main.py         ← Agent 核心程式碼
│                              - SYSTEM_PROMPT（SOP 回答規則）
│                              - @tool get_sop()
│                              - @tool get_snapshot()
│                              - invoke() entrypoint
├── data/
│   ├── emergency_traffic_sop.txt    ← SOP 全文
│   ├── city_traffic_flow.csv        ← 路段車流
│   ├── signaling_crowd_density.csv  ← 站點人潮
│   └── road_network_geometry.json   ← 路網拓撲
├── deploy.sh               ← 一鍵部署腳本
└── README.md               ← 本文件
```

---

## 與 warroom/ 的關係

| | warroom/ | agentcore-squirrel/ |
|---|----------|---------------------|
| 用途 | 本機開發 + Demo fallback | AWS 正式部署 |
| LLM | Ollama qwen2.5:7b | Bedrock Claude Sonnet 4.5 |
| 框架 | FastAPI | AgentCore Strands |
| 部署 | `uvicorn warroom.server:app` | `agentcore deploy` |
| 前端 | 有（index.html） | 無（CLI 或接 API） |

比賽當天策略：
1. 先用 warroom/ 在 EC2 跑起來確保 Demo 可用
2. 再花 5 分鐘部署 agentcore-squirrel/（加分用）
3. 如果 AgentCore 有問題 → fallback 回 warroom/

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
| `ExpiredTokenException` | 重新 `aws configure` 或 export 新 credentials |
| Deploy 卡住超過 5 分鐘 | Ctrl+C 然後 `agentcore status` 看是否已成功 |
| invoke 沒輸出 | 加 `--runtime SquirrelAdvisor --stream` |
| Bedrock 403 | IAM 需要 `bedrock:InvokeModel` 權限 |
