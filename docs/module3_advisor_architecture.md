# 模組 3：對話式策略諮詢顧問

模組 3 是 SOP 導向的 what-if 對話顧問，用來回答交通指揮中心的假設性問題，例如：

> 若 BL17 人數增至 40,000 人，應觸發哪些法條與動作？

## 責任範圍

模組 3 需要：

- 在 Dashboard 旁提供對話式問答介面。
- 接收指揮官輸入的模擬指令或假設性問題。
- 載入 `sop/` 中的 SOP 全文，並注入 LLM system prompt。
- 將目前 `TrafficSnapshot` 作為連鎖檢查與現況佐證。
- 由 LLM 根據 SOP 判斷觸發條款、判定依據與預期動作。
- 回傳穩定的 JSON 結構給前端。

模組 3 的主要推理來源是 SOP 與使用者假設條件。快照資料是輔助脈絡，不是主要判斷來源；當使用者提出「若、假設、增至、降至」等條件時，以使用者假設值優先。

## SOP 策略

本模組不使用 vector RAG。官方 SOP 只有少量條款，足以每次完整放入 prompt，因此採用「SOP 全文注入」：

```text
載入 SOP 全文
  -> 注入 system prompt
  -> LLM 根據 SOP 做條款判斷
```

這樣可以避免 RAG 沒檢索到正確條款而造成回答錯誤。


## 流程

```text
Dashboard 對話視窗
  -> app.py /chat
  -> module3_advisor.answer_advisory_question()
  -> 載入 SOP 全文
  -> 載入當前資料快照
  -> 組 system prompt
  -> llm.clients.chat()
  -> JSON response
```

## 檔案對應

| 檔案 | 職責 |
|---|---|
| `static/index.html` | 對話視窗、快捷提問、送出 `/chat` request、保存 history |
| `app.py` | FastAPI API 入口，提供 `/chat` 與 `/health` |
| `module3_advisor/service.py` | 模組 3 主流程，組合 SOP、snapshot、history 與 LLM 呼叫 |
| `module3_advisor/sop_loader.py` | 載入 SOP 全文 |
| `module3_advisor/prompts.py` | 建立 system prompt 與回答規則 |
| `module3_advisor/schemas.py` | 定義 Module 3 回傳資料格式 |
| `llm/clients.py` | LLM 抽象層，可切換 `mock`、`anthropic`、`bedrock` |
| `sop/emergency_traffic_sop.txt` | 官方 SOP 規則 |
| `data/snapshot.py` | 共用資料快照，供連鎖檢查與現況佐證 |
