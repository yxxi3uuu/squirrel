#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# SQUIRREL 模組三 AgentCore 一鍵部署腳本
# 比賽當天：cd agentcore-squirrel && bash deploy.sh
# ═══════════════════════════════════════════════════════════════

set -e

echo "🐿️ SQUIRREL AgentCore 部署開始"
echo "  模組三：對話式策略諮詢顧問"
echo "  LLM: Bedrock Claude Sonnet 4.5"
echo "================================"

# ── 環境檢查 ──────────────────────────────────────────────────

# 確認 agentcore CLI
if ! command -v agentcore &> /dev/null; then
    echo "❌ agentcore CLI 未安裝，正在安裝..."
    npm install -g @aws/agentcore
fi

# 確認 AWS credentials
if ! aws sts get-caller-identity &> /dev/null; then
    echo "❌ AWS 未登入，請先執行 aws configure"
    exit 1
fi

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGION=${AWS_REGION:-us-west-2}
echo "✅ 環境檢查通過"
echo "  Account: $ACCOUNT_ID"
echo "  Region:  $REGION"

# 更新 aws-targets.json（AgentCore CLI 要求 array 格式）
cat > agentcore/aws-targets.json << EOF
[
  {
    "name": "default",
    "region": "$REGION",
    "account": "$ACCOUNT_ID"
  }
]
EOF

# ── 部署 Agent ────────────────────────────────────────────────
echo ""
echo "📦 部署 Agent..."
agentcore deploy -y -v

# ── 加入 Memory ──────────────────────────────────────────────
echo ""
echo "🧠 加入 Memory（跨 Session 語意記憶）..."
agentcore add memory \
  --name CommanderMemory \
  --strategies SEMANTIC,SUMMARIZATION \
  --expiry 30 2>/dev/null || echo "  (Memory 已存在，跳過)"

# ── 加入 Online Evaluation ───────────────────────────────────
echo ""
echo "📊 加入品質監控（Goal Success Rate + Correctness）..."
agentcore add online-eval \
  --name QualityMonitor \
  --runtime SquirrelAdvisor \
  --evaluator Builtin.GoalSuccessRate Builtin.Correctness \
  --sampling-rate 100 \
  --enable-on-create 2>/dev/null || echo "  (Eval 已存在，跳過)"

# ── 最終重新部署（含 Memory + Eval）─────────────────────────
echo ""
echo "🚀 最終部署..."
agentcore deploy -y -v

# ── 驗證 ──────────────────────────────────────────────────────
echo ""
echo "================================"
agentcore status
echo ""
echo "🐿️ 部署完成！"
echo ""
echo "測試指令："
echo '  agentcore invoke "如果捷運國父紀念館站有 40,000 人，應該怎麼分流？" --stream'
echo '  agentcore invoke "忠孝東路四段飽和度達 0.96，依 SOP 要啟動哪些措施？" --stream'
echo '  agentcore invoke "目前哪些站點需要啟動多語通報？" --stream'
echo ""
echo "多輪對話測試："
echo '  SESSION=$(python3 -c "import uuid; print(uuid.uuid4())")'
echo '  agentcore invoke "如果 BL17 人數增至 40,000 人？" --session-id $SESSION --stream'
echo '  agentcore invoke "那漫遊率呢？需要多語通報嗎？" --session-id $SESSION --stream'
