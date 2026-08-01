# Specs 使用指南

在 Kiro 中開啟 Spec 模式的 session，即可進入「需求 → 設計 → 任務」的結構化開發流程。

## 推薦使用 Spec 的場景

### 1. 新模組開發（例：Module 4 推理與可解釋性）
目前 M4 還沒有實作，但 shared/schemas.py 的 TriggerDecision 已經有 
excluded_routes、ete_minutes、basis 等欄位專門為 M4 設計。
用 Spec 可以：
- Requirements：定義 M4 要展示哪些解釋鏈（SOP 分級依據、替代道路排除理由、ETE 公式分解）
- Design：API endpoint 設計、前端 UI 卡片結構
- Tasks：逐步實作，每完成一個 task 自動跑 smoke test

### 2. LLM 統一抽象層整合
目前 M1 用獨立的 Ollama-only 實作，M3 有自己的規則引擎，M5 另有一套。
用 Spec 統一規劃：`warroom/llm/client.py` 的 interface 設計、各模組遷移順序。

### 3. 資料源切換機制（比賽當天）
data/snapshot.py 支援 DATA_SOURCE_MODE=local/s3/api，但 s3/api 模式還沒實作。
適合用 Spec 拆解：S3 讀取實作 → API 模式實作 → 熱重載機制（取代 lru_cache）。

### 4. 前端效能優化（時間軸快轉 race condition）
已知問題：快轉時 API 回應可能亂序。用 Spec 定義 abort controller 機制、
請求序號方案、以及對應的回歸測試。

## 如何使用
在 Kiro 聊天框中切換到 Spec session type，然後描述你要開發的功能，
Kiro 會引導你走過 requirements → design → tasks 的完整流程。
