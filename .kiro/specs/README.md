# Specs 使用指南

在 Kiro 中開啟 Spec 模式的 session，即可進入「需求 → 設計 → 任務」的結構化開發流程。

## 已完成的項目

- SOP-4 門檻判斷（thresholds.py）+ 前端卡片 + SOP-3 連動
- Race condition 防護（request sequence number）
- 前端地圖優化（連續色階、站點動態半徑、hover 效果、比例尺）
- 預警歷史紀錄面板
- Module 4 Reasoning 解釋鏈（/api/reasoning）
- KPI countup 動畫
- RWD 響應式設計（900px / 680px / 480px 三斷點）

## 推薦使用 Spec 的場景

### 1. LLM 統一抽象層整合
M1 已移除 LLM 摘要呼叫，M3 用獨立的規則引擎+Ollama，M5 用 Bedrock/Ollama 做多語翻譯。
三套並行，切換 LLM 後端要改多處。用 Spec 統一規劃 `warroom/llm/client.py` 的 interface。

### 2. 資料源切換機制（比賽當天）
data/snapshot.py 支援 DATA_SOURCE_MODE=local/s3/api，但 s3/api 模式還沒實作。
適合用 Spec 拆解：S3 讀取實作 -> API 模式實作 -> 熱重載機制（取代 lru_cache）。

### 3. M5 多語翻譯品質修正
目前 CMS 多語翻譯在 LLM_MODE=bedrock 但無 AWS credentials 時 fallback 到 mock，
mock 只翻標題不翻內容。需要：改用 Ollama 作為 fallback、或改善 mock 品質。

### 4. SOP-4 接入模組四解釋鏈
目前 SOP-4 卡片只有「查看歷史趨勢」，沒有接到 Module 4 的 Drawer 解釋鏈。
需要在 /api/reasoning 加 SOP-4 的解釋步驟（峰值檢查 -> 散場判定 -> 連動觸發）。

## 如何使用
在 Kiro 聊天框中切換到 Spec session type，然後描述你要開發的功能，
Kiro 會引導你走過 requirements -> design -> tasks 的完整流程。
