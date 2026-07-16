# 模組 3 設計文件：對話式策略諮詢顧問

更新日期：2026.07.16  
版本：v2

模組 3 是 SOP 導向的 what-if 對話顧問，用來回答交通指揮中心的假設性策略問題，例如：

> 若捷運國父紀念館站人潮增至 40,000 人，應觸發哪些法條與動作？

競賽命題要求：

```text
互動式問答介面：Dashboard 旁設有對話視窗，允許指揮官輸入模擬指令或假設性問題。
SOP 邏輯驗證：AI 必須根據輸入的假設條件，立即檢索 SOP 並回答應觸發的法條與預期動作。
此為 LLM 判斷。
```

新版核心任務補充：

| 任務 | 與模組 3 的關係 |
|---|---|
| 應變策略推理 + RAG | 模組 3 透過 SOP Knowledge Base 檢索，把相關條款交給 LLM 判斷；若使用者以文字詢問事故情境，可依第 2 條說明應變策略 |
| 自動化指令產出 | 模組 3 回答會產出指揮官可採用的 CMS / 資訊看板 / 人力派遣建議，但實際派送由其他模組執行 |
| 動態預測與互動問答 | 模組 3 負責 Dashboard 旁 What-if 問答，並在事故與號誌故障情境中引用第 7 條估算預計恢復時間 |
| 多語化通報加分 | 模組 3 可依第 6 條判斷是否需要中英日韓多語通報；真正產生完整多語文案可交由模組 5 |

責任邊界：

- 模組 3 不負責「事件注入」或即時事故資料流，那是模組 2 的職責。
- 模組 3 不負責真正執行路網重規劃；它只在指揮官提問或其他模組傳入情境時，根據 SOP 解釋應觸發條款與建議動作。
- 若未來 Dashboard 把模組 2 的事件結果傳給模組 3，模組 3 可以把它視為「已提供的假設條件」來回答，但不主動讀取 live incident。

## 使用情境

| 情境 | 使用者問題 | 預期回答重點 |
|---|---|---|
| 捷運分流 | 假設捷運國父紀念館站人潮增至 40,000 人 | 觸發第 3 條；40,000 > 25,000；過站不停、接駁、引導至 BL18 |
| 壅塞判定 | 假設忠孝東路四段已達 A 級壅塞 | 觸發第 1 條 A 級；替代路徑引導、長綠燈時制、警力淨空 |
| 事故應變詢問 | 假設光復南路發生嚴重車禍並封鎖 | 觸發第 2 條；說明主疏散邏輯、資訊看板內容、連動第 7 條預計恢復時間 |
| 號誌故障 | 假設信義路五段號誌故障 | 觸發第 5 條；每路口 2 名警力、CMS、估計持續時間 |
| 多語通報 | 假設台北101廣場外籍旅客比例達 35% | 觸發第 6 條；中英日韓多語簡訊與看板 |
| 條件不足 | 光復南路要不要處置？ | 說明缺少事故類型、嚴重度、封鎖狀態或壅塞等級，不自行引用現況 |

## SOP Knowledge Base / RAG 策略

本模組採用「輕量 KB/RAG」：官方 SOP 條文數量少，為避免向量切 chunk 時漏掉關鍵條款，每次會從 SOP Knowledge Base 取回完整 SOP 作為 LLM 的檢索內容。

```text
使用者假設問題
  -> 檢索 SOP Knowledge Base
  -> 取回 SOP 條文全文
  -> 注入 system prompt
  -> LLM 根據 SOP 條款做判斷、引用與建議
```

因此它符合「檢索 SOP 後回答」的要求；只是目前資料量小，所以先不用向量資料庫。若未來 SOP 擴充成大量文件，可把 `module3_advisor/sop_loader.py` 換成 embedding / vector search，外層 API 不必改。


## 流程

```text
Dashboard 對話視窗
  -> app.py /chat
  -> module3_advisor.answer_advisory_question()
  -> 檢索 SOP Knowledge Base
  -> 組 system prompt
  -> llm.clients.chat()
  -> JSON response
```

```mermaid
flowchart TB
    UI["Dashboard 旁聊天視窗<br/>static/index.html"]
    API["/chat API<br/>app.py"]
    SERVICE["策略顧問服務<br/>module3_advisor/service.py"]
    SOP["SOP Knowledge Base<br/>sop/emergency_traffic_sop.txt"]
    PROMPT["Prompt 組裝<br/>module3_advisor/prompts.py"]
    LLM["LLM 抽象層<br/>llm/clients.py"]

    UI -->|"question + history"| API
    API --> SERVICE
    SERVICE --> SOP
    SERVICE --> PROMPT
    PROMPT --> LLM
    LLM -->|"結構化回答"| API
    API --> UI
```

## 檔案對應

| 檔案 | 職責 |
|---|---|
| `static/index.html` | 對話視窗、快捷提問、送出 `/chat` request、保存 history |
| `app.py` | FastAPI API 入口，提供 `/chat` 與 `/health` |
| `module3_advisor/service.py` | 模組 3 主流程，組合 SOP、history、使用者假設與 LLM 呼叫 |
| `module3_advisor/sop_loader.py` | SOP Knowledge Base 檢索；目前採完整 SOP 取回，日後可替換為向量 RAG |
| `module3_advisor/prompts.py` | 建立 system prompt 與回答規則 |
| `module3_advisor/schemas.py` | 定義 Module 3 回傳資料格式 |
| `llm/clients.py` | LLM 抽象層，可切換 `mock`、`anthropic`、`bedrock`；Bedrock 模式支援 throttling retry 與 inference profile prefix |
| `sop/emergency_traffic_sop.txt` | 官方 SOP 規則 |

## API 契約

`POST /chat`

Request:

```json
{
  "question": "假設捷運國父紀念館站人潮增至 40,000 人，依 SOP 要啟動哪些捷運與接駁措施？",
  "history": [
    {"role": "user", "content": "上一輪問題"},
    {"role": "assistant", "content": "上一輪回答"}
  ]
}
```

Response:

```json
{
  "ok": true,
  "answer": "■ 判定：第 3 條...",
  "mode": "mock",
  "sources": [
    {
      "path": "sop/emergency_traffic_sop.txt",
      "score": 1,
      "excerpt": "交通應變標準程序..."
    }
  ]
}
```

## UI 快捷提問設計

自由輸入框放在聊天視窗最下方，評審可直接輸入假設性問題。快捷區只是輔助 demo，不取代自由輸入。

快捷區依 SOP 適用範圍分成兩種：

| 類型 | 設計 |
|---|---|
| 固定對象 | 第 1 條只放忠孝東路四段、光復南路；第 3 條固定捷運國父紀念館站；第 4 條固定大巨蛋 |
| 需指定地點 | 第 2 條與第 5 條展開 15 路段中文名稱；第 6 條展開 9 個基地台／站點中文名稱 |

第 7 條 ETE 不是獨立快捷分類，而是在第 2 條事故或第 5 條號誌故障回答中自動附帶。

## 回答格式

每次回答固定四段：

```text
■ 判定：
■ 依據：
■ 建議處置：
■ 後續確認：
```

「判定」必須是一句完整決策句，例如：「假設捷運國父紀念館站人潮達 40,000 人，已超過 SOP 門檻 25,000 人，觸發第 3 條（捷運與接駁分流），應立即啟動過站不停與接駁分流。」後續再用「依據」、「建議處置」、「後續確認」補充細節。

回答文字應以指揮官可直接理解的中文呈現，避免顯示 `BS_`、`RD_`、`User_Count`、`Growth_Rate`、`Saturation_Score` 等內部欄位或 ID。

## 驗收標準

| # | 輸入問題 | 預期輸出 | 驗證重點 |
|---|---|---|---|
| T1 | 假設捷運國父紀念館站人潮增至 40,000 人 | 第 3 條；40,000 > 25,000；過站不停、接駁、引導至捷運市政府站 | 命題方標準題 |
| T2 | 假設忠孝東路四段已達 A 級壅塞 | 第 1 條 A 級；長綠燈、替代路徑、警力淨空 | A 級處置 |
| T3 | 假設光復南路已達 B 級壅塞 | 第 1 條 B 級；長綠燈與警力淨空 | B 級不可答成 A 級 |
| T4 | 假設大巨蛋人潮曾達 40,000 人且開始散場 | 第 4 條；連動第 3 條接駁機制 | 連鎖檢查 |
| T5 | 假設台北101廣場外籍旅客比例達 35% | 第 6 條；多語通報 | 多語門檻 |
| T6 | 假設某路段壅塞指標只有 0.80 | 不觸發；距 B 級 0.05 | 誠實不觸發 |
| T7 | 連續追問「那如果再加 5,000 人？」 | 能沿用上一輪人數情境 | 多輪 history |
| T8 | 如果光復南路發生嚴重事故並封鎖 | 第 2 條；主疏散邏輯、資訊看板、第 7 條預計恢復時間 | RAG + 事故應變說明 + ETE |
| T9 | 如果信義路五段號誌故障 | 第 5 條；人工指揮、資訊看板、第 7 條預計恢復時間 | 自動化指令建議 |

## 與其他模組介接

| 對象 | 協調事項 |
|---|---|
| 模組 1 | Module 3 可放在 Dashboard 旁，但不直接讀 Dashboard 快照；若未來要支援「目前狀況」查詢，應另開 API 明確傳入現況資料 |
| 模組 2 | 事件注入、live incidents 與路網重規劃由模組 2 負責；Module 3 只可針對模組 2 傳入的情境做 SOP 問答與條款解釋 |
| 模組 4 | 回答格式對齊：條款編號、依據、建議處置、後續確認 |
| 模組 5 | 第 6 條多語通報門檻一致：外籍漫遊旅客比例 ≥ 30% |
| 全隊 | `LLM_MODE` 可切換 `mock`、`anthropic`、`bedrock`；正式接 AWS 時確認 `BEDROCK_REGION`、`BEDROCK_MODEL_ID`、必要時設定 `BEDROCK_INFERENCE_PREFIX` |

## 風險與備案

| 風險 | 備案 |
|---|---|
| LLM 判斷不穩 | 固定回答格式、低 temperature、用驗收題反覆測 |
| 使用者問題條件不足 | Prompt 要求列出缺少條件，不自行補現況 |
| Bedrock 尚未開通 | 保留 `mock` 與 `anthropic` 模式 |
| SOP 條文更新 | `sop/emergency_traffic_sop.txt` 獨立維護，prompt 每次全文注入 |
