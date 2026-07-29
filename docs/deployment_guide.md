# 比賽當天部署流程

---

## 前一天準備（確認清單）

- [ ] GitHub 程式碼已推上最新版（`feature/module-3-advisory` branch）
- [ ] 本機測試 `python3 -m uvicorn warroom.server:app --port 8000` 可正常運行
- [ ] 比賽帳號可以登入 AWS Console
- [ ] 確認比賽指定 Region（預設 us-west-2）

---

## 當天流程（預估 15~20 分鐘）

### Step 1（2 分鐘）— 登入 AWS

- 開瀏覽器 → AWS Console
- 用比賽帳號登入
- 右上角選 Region（比賽指定的，通常 us-west-2）

### Step 2（3 分鐘）— 建 EC2

EC2 → Launch Instance：
- Name: `squirrel`
- AMI: Ubuntu 22.04 LTS
- Type: `t3.xlarge`（或 `g4dn.xlarge` 如果有 GPU 需求）
- Key pair: Create new → 取名 `squirrel-key` → 下載 .pem
- Security Group: 新增兩條 Inbound：
  - SSH 22 → My IP
  - Custom TCP 8000 → 0.0.0.0/0
- Storage: 30 GB
- Launch

### Step 3（1 分鐘）— 等 EC2 啟動

EC2 列表 → 等 Instance State 變成 Running → 複製 Public IPv4 address

### Step 4（1 分鐘）— SSH 連進去

```bash
cd ~/Downloads
chmod 400 squirrel-key.pem
ssh -i squirrel-key.pem ubuntu@你的EC2公開IP
```

### Step 5（8 分鐘）— 安裝全部

進到 EC2 後，一段一段貼：

```bash
# 1. 系統更新（1 分鐘）
sudo apt update && sudo apt install python3.11 python3.11-venv python3-pip git -y

# 2. 安裝 Ollama + 拉模型（3~5 分鐘）
curl -fsSL https://ollama.com/install.sh | sh
ollama pull qwen2.5:7b

# 3. 拉程式碼（30 秒）
git clone https://github.com/yxxi3uuu/squirrel.git
cd squirrel
git checkout feature/module-3-advisory

# 4. 建 Python 環境 + 裝套件（1 分鐘）
python3.11 -m venv .venv
source .venv/bin/activate
pip install fastapi "uvicorn[standard]" pandas python-dotenv pydantic

# 5. 建 .env
cat > .env << 'EOF'
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5:7b
LLM_MODE=ollama
EOF
```

### Step 6（10 秒）— 啟動

```bash
source .venv/bin/activate
uvicorn warroom.server:app --host 0.0.0.0 --port 8000
```

### Step 7 — 開啟瀏覽器確認

```
http://你的EC2公開IP:8000
```

看到戰情室 Dashboard → 成功！

---

## 如果比賽給 Bedrock 權限（推薦路線）

不需要裝 Ollama，直接用 Bedrock：

```bash
# Step 5 改成：
pip install fastapi "uvicorn[standard]" pandas python-dotenv pydantic boto3

# .env 改成：
cat > .env << 'EOF'
LLM_MODE=bedrock
BEDROCK_MODEL_ID=us.anthropic.claude-sonnet-4-5-20250929-v1:0
BEDROCK_REGION=us-west-2
EOF

# AWS credentials（如果比賽有提供 IAM role 就不用）
aws configure
```

Bedrock 優點：不用等 Ollama 下載模型、回答品質更好、推理更快。

---

## 備案速查表

| 問題 | 30 秒解法 |
|------|----------|
| SSH 連不上 | 確認 Security Group 有開 port 22 |
| 網站連不上 | 確認 Security Group 有開 port 8000 |
| git clone 慢 | 用 scp 直接傳（見下方） |
| Ollama 下載慢 | 改用 `LLM_MODE=bedrock` 或 `LLM_MODE=mock` |
| uvicorn 報錯 | `source .venv/bin/activate` 然後重跑 |
| EC2 建不了 | 用本機跑 `localhost:8000`，投影給評審 |
| Bedrock 403 | 確認 IAM 有 `bedrock:InvokeModel` 權限 |

### 備案 1：git clone 失敗 → 用 scp 上傳

```bash
# 本機 Terminal
tar -czf squirrel.tar.gz --exclude=".git" --exclude=".venv" --exclude="node_modules" squirrel
scp -i squirrel-key.pem squirrel.tar.gz ubuntu@EC2IP:/home/ubuntu/

# EC2 裡
cd /home/ubuntu
tar -xzf squirrel.tar.gz
cd squirrel
```

### 備案 2：port 8000 連不上

AWS Console → EC2 → 點 instance → Security tab → Security Group → Edit inbound rules → Add rule：
- Type: Custom TCP
- Port: 8000
- Source: 0.0.0.0/0
- Save

### 備案 3：完全無法部署

用本機跑：
```bash
python3 -m uvicorn warroom.server:app --port 8000
```
投影 `http://localhost:8000` 給評審看。

---

## 環境變數速查

| 變數 | Ollama 模式 | Bedrock 模式 | Mock 模式 |
|------|------------|-------------|----------|
| `LLM_MODE` | ollama | bedrock | mock |
| `OLLAMA_URL` | http://localhost:11434 | (不需要) | (不需要) |
| `OLLAMA_MODEL` | qwen2.5:7b | (不需要) | (不需要) |
| `BEDROCK_MODEL_ID` | (不需要) | us.anthropic.claude-sonnet-4-5-20250929-v1:0 | (不需要) |
| `BEDROCK_REGION` | (不需要) | us-west-2 | (不需要) |
