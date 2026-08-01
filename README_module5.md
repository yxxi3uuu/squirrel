# Squirrel Traffic Advisory

## 模組 5 — 多語化全通路通報（app.py）

### 前置需求

**1. 安裝 Ollama（本機 LLM 伺服器）**

Ollama 是獨立應用程式，需自行下載安裝，不包含在 git repo 內：

- Windows：https://ollama.com/download/windows
- macOS / Linux：`curl -fsSL https://ollama.com/install.sh | sh`

安裝完成後下載模型：
```bash
ollama pull qwen2.5:7b
```

**2. 安裝 Python 套件**

建議使用 Python 3.11 環境：
```bash
conda create -n llm311 python=3.11 -y
conda activate llm311
pip install streamlit pandas python-dotenv
```

### 啟動

確認 Ollama 已在背景執行後：
```bash
conda activate llm311
streamlit run omn.py
```

瀏覽器開啟 `http://localhost:8501`，Sidebar 顯示「✅ 已連線」即可使用。

### 環境變數（選填）

複製 `.env.example` 為 `.env` 並修改：
```
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5:7b
```
