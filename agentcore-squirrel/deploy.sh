#!/bin/bash
# SQUIRREL AgentCore 一鍵部署腳本
# 比賽當天：cd agentcore-squirrel && bash deploy.sh

set -e

echo "🐿️ SQUIRREL AgentCore 部署開始"
echo "================================"

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

echo "✅ 環境檢查通過"

# 部署 Agent
echo ""
echo "📦 部署 Agent..."
agentcore deploy -y -v

# 加入 Memory
echo ""
echo "🧠 加入 Memory..."
agentcore add memory \
  --name CommanderMemory \
  --strategies SEMANTIC,SUMMARIZATION \
  --expiry 30 2>/dev/null || echo "  (Memory 已存在，跳過)"

# 加入 Online Eval
echo ""
echo "📊 加入品質監控..."
agentcore add online-eval \
  --name QualityMonitor \
  --runtime SquirrelAdvisor \
  --evaluator Builtin.GoalSuccessRate Builtin.Correctness \
  --sampling-rate 100 \
  --enable-on-create 2>/dev/null || echo "  (Eval 已存在，跳過)"

# 重新部署（含 Memory + Eval）
echo ""
echo "🚀 最終部署..."
agentcore deploy -y -v

# 驗證
echo ""
echo "================================"
agentcore status
echo ""
echo "🐿️ 部署完成！可以開始測試："
echo '  agentcore invoke "如果捷運國父紀念館站有 40,000 人，應該怎麼分流？" --stream'
