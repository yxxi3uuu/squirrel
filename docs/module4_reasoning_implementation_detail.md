# 模組 4 做法詳細介紹：AI 決策推理與解釋鏈

> 專案：Squirrel 城市應變分析 AI Agent  
> 模組：模組 4 - AI 決策推理與解釋鏈（Reasoning & Explainability）  
> 目前版本：本機 deterministic demo + FastAPI Dashboard  
> 核心檔案：`reasoning/builder.py`、`reasoning/rules.py`、`reasoning/explanation.py`、`reasoning/validator.py`

## 1. 模組 4 的定位

模組 4 的目標不是單純產生一段「AI 看起來很合理」的文字，而是把交通應變決策整理成一條可以被檢查、追溯、展示的決策證據鏈。

在交通事故或道路封閉情境中，指揮官不只需要知道系統建議哪條路，也需要知道：

- 為什麼判定事件是 A 級或 B 級。
- 系統引用了哪些 SOP 條款。
- 使用了哪些原始資料欄位與數值。
- 為什麼推薦某條替代道路。
- 為什麼排除其他候選道路。
- 預計恢復時間 ETE 是怎麼算出來的。
- 這次決策的信心分數是多少，限制在哪裡。

因此目前模組 4 採用的核心原則是：

```text
程式負責事實、規則、公式與計算。
解釋層只負責把已驗證的結構化結果轉成可讀文字。
```

目前版本沒有真正呼叫 LLM 或 Amazon Bedrock。中文解釋由 `reasoning/explanation.py` 用 deterministic template 產生，目的是先確保所有數字、規則、道路 ID、排除理由都能從 `DecisionRecord` 追溯回原始資料或程式計算。未來若接上 Bedrock，也會讓 LLM 只能根據這份已驗證的 JSON 進行摘要與改寫。

## 2. 整體架構

目前模組 4 的資料流如下：

```text
data_source/*.csv, *.json
        |
        v
data/snapshot.py
        |
        v
TrafficSnapshot
        |
        v
reasoning.builder.build_decision_record()
        |
        +--> 建立 evidence refs
        +--> SOP-1 交通分級
        +--> SOP-2 事故/路障觸發
        +--> SOP-7 ETE 計算
        +--> 候選道路比較與排除
        +--> 資料品質計算
        +--> 信心分數計算
        |
        v
DecisionRecord
        |
        +--> explanation.py 產生中文解釋
        +--> validator.py 驗證解釋與資料一致性
        |
        v
FastAPI API / Dashboard
```

使用者在 Dashboard 看到的每個結論，例如「A 級」、「建議改道某道路」、「ETE 90 分鐘」、「某道路容量不足」，都不是自然語言模型直接發明，而是由 `DecisionRecord` 內的結構化欄位產生。

## 3. 主要檔案與責任分工

| 檔案 | 責任 |
|---|---|
| `data/snapshot.py` | 讀取官方 CSV/JSON 資料，組成指定時間點的 `TrafficSnapshot` |
| `reasoning/models.py` | 定義 `DecisionRecord`、`RuleHit`、`RouteCandidate`、`ETEResult` 等 Pydantic schema |
| `reasoning/builder.py` | 模組 4 主流程，把 snapshot 和 event 組成完整決策紀錄 |
| `reasoning/rules.py` | 實作 SOP 分級、ETE 公式、候選道路評分、資料品質、信心分數 |
| `reasoning/explanation.py` | 根據 `DecisionRecord` 產生忠實的中文解釋與「為什麼」追問回答 |
| `reasoning/validator.py` | 檢查 SOP ID、道路 ID、ETE、自然語言數字是否可追溯 |
| `api/main.py` | FastAPI 入口，提供 Dashboard 與決策 JSON API |
| `frontend/app.js` | 前端讀取 API，顯示摘要、SOP、路線比較、ETE、信心與追問 |
| `tests/test_reasoning.py` | 測試分級邊界、ETE 公式、demo decision、排除理由 |

## 4. 資料輸入：TrafficSnapshot

模組 4 的輸入不是直接讀散落的 CSV 欄位，而是先由 `data/snapshot.py` 建立統一的 `TrafficSnapshot`。

資料來源包含：

- `city_traffic_flow.csv`：道路速度、車流量、飽和度、車道狀態。
- `signaling_crowd_density.csv`：基地台或站點人流資料。
- `road_network_geometry.json`：道路容量、替代道路、交會關係、附近站點。
- `live_incidents.json`：事故、封閉、管制等事件。

`get_snapshot(timestamp)` 會做三件事：

1. 找出指定時間點可用的道路與人流資料。
2. 對於沒有剛好同時間資料的道路，取該時間點之前最新的一筆資料。
3. 納入所有發生時間早於或等於該快照時間的事件。

這樣做的好處是，後續規則層不用知道 CSV/JSON 的讀取細節，只需要處理一份一致格式的 snapshot。

## 5. 核心輸出：DecisionRecord

`DecisionRecord` 是模組 4 最重要的資料契約，也是 Dashboard、未來 LLM、稽核紀錄都應該依賴的共同格式。

目前欄位包含：

| 欄位 | 說明 |
|---|---|
| `decision_id` | 由快照時間與事件 ID 組成的決策 ID |
| `created_at` | 決策紀錄建立時間 |
| `event` | 事件本身，例如嚴重度、狀態、地點、受影響路段 |
| `snapshot` | 快照摘要與受影響路段資料 |
| `evidence` | 每個來源欄位的證據編號，例如 `EV-001` |
| `rule_hits` | 命中的 SOP 條款、條件、觀測值、門檻、結果 |
| `classification` | 交通分級結果：A、B、NORMAL 或 UNKNOWN |
| `ete` | ETE 公式、基礎時間、壅塞修正與總分鐘數 |
| `route_candidates` | 所有候選道路的評分、排名、狀態與排除原因 |
| `data_quality` | 資料完整度、新鮮度、缺漏欄位、警告 |
| `confidence` | 信心分數與組成因子 |
| `evidence_chain` | 前端時間軸使用的推理步驟 |
| `explanation` | 中文摘要、分級解釋、路線解釋、ETE 解釋、信心解釋 |
| `validation_issues` | validator 找到的錯誤或警告 |
| `execution_time_ms` | 決策建立耗時 |
| `model_version` | 規則、路線評分、ETE 版本 |

這份資料結構讓整個系統具備可追溯性。比方說，若畫面顯示「因 Saturation_Score=1.0 判定為 A 級」，就能從 `classification`、`rule_hits`、`evidence` 追到 `city_traffic_flow.csv` 的原始欄位。

## 6. build_decision_record 的主流程

`reasoning/builder.py` 的 `build_decision_record(timestamp, event_id)` 是模組 4 的主入口。

它的處理步驟如下：

1. 呼叫 `get_snapshot(timestamp)` 取得交通快照。
2. 使用 `_select_event()` 選出指定事件，若未指定則選最新的 High/Critical 道路事件。
3. 找出事件的 `affected_segment`，也就是受影響道路。
4. 呼叫 `_build_evidence()` 建立 `EV-001`、`EV-002` 等證據編號。
5. 呼叫 `classify_traffic_level()` 依 SOP-1 做交通分級。
6. 呼叫 `build_rule_hit_for_incident()` 判斷是否命中 SOP-2。
7. 呼叫 `calculate_ete()` 依 SOP-7 公式計算預計恢復時間。
8. 呼叫 `compare_candidate_routes()` 比較所有替代道路。
9. 呼叫 `calculate_data_quality()` 估算資料完整度與新鮮度。
10. 呼叫 `calculate_confidence()` 計算決策信心分數。
11. 組成 `DecisionRecord`。
12. 呼叫 `generate_deterministic_explanation()` 產生中文解釋。
13. 呼叫 `validate_decision_record()` 檢查解釋與結構化資料是否一致。

這個流程的重點是「先產生可驗證的事實，再產生自然語言」。如果順序反過來，LLM 很容易在沒有依據的情況下補出道路、門檻或數值。

## 7. Evidence 設計：每個結論都要有來源

`_build_evidence()` 會替重要來源欄位建立證據編號。

例如：

| Evidence | 來源 | 欄位 | 用途 |
|---|---|---|---|
| `EV-001` | `live_incidents.json` | `status` | 判斷事件是否封閉、阻塞或管制 |
| `EV-002` | `live_incidents.json` | `severity` | 判斷事故嚴重度與 ETE 基礎時間 |
| `EV-003` | `live_incidents.json` | `affected_segment` | 確認受影響道路 |
| `EV-004` | `city_traffic_flow.csv` | `Saturation_Score` | SOP-1 分級與 ETE 壅塞修正 |
| `EV-005` | `city_traffic_flow.csv` | `Lane_Status` | 判斷車道狀態 |
| `EV-006` | `city_traffic_flow.csv` | `Vehicle_Count` | 推估分流量 |
| `EV-007` | `road_network_geometry.json` | `capacity_vph` | 道路容量與候選道路比較 |

候選道路也會建立容量、飽和度、車道狀態的 evidence。這讓排除理由不是一句空泛的「不建議」，而是可以回到具體欄位，例如容量不足、預測過載、目前已封閉。

## 8. SOP-1：交通擁塞分級

目前 SOP-1 使用 `Saturation_Score` 作為主要分級依據。

規則如下：

| 條件 | 結果 |
|---|---|
| `Saturation_Score >= 0.95` | A 級 |
| `0.85 <= Saturation_Score < 0.95` | B 級 |
| `Saturation_Score < 0.85` | NORMAL |
| 缺少 `Saturation_Score` | UNKNOWN |

程式不只回傳分級結果，也會回傳 `RuleHit`：

- `sop_id`: `SOP-1`
- `clause`: `第 1 條`
- `condition`: 實際命中的判斷式
- `observed`: 觀測值
- `threshold`: 門檻值
- `result`: 分級結果
- `evidence_ids`: 使用到的 evidence

這樣前端可以直接顯示「依 SOP-1，觀測值為多少，門檻是多少，所以判定為 A 級」。

## 9. SOP-2：事故與路障觸發

SOP-2 用來判斷道路事件是否進入應變流程。

目前條件是：

```text
affected_segment startswith RD_
and status in {Closed, Blocked, Restricted}
and severity in {High, Critical}
```

也就是說，事件必須是道路事件，且狀態屬於封閉、阻塞或管制，同時嚴重度達 High 或 Critical，才會產生 SOP-2 的 `RuleHit`。

這個設計可以避免把非道路事件或低嚴重度事件錯誤升級成道路應變決策。

## 10. SOP-7：ETE 預計恢復時間

ETE 是 Estimated Time to Event clearance，也就是預計恢復或解除事件所需時間。

目前公式寫在 `calculate_ete()`：

```text
total_minutes = base_clearance + max(0, (average_saturation - 0.5) * 60)
```

基礎時間依事件嚴重度決定：

| 嚴重度 | 基礎時間 |
|---|---:|
| Medium | 20 分鐘 |
| High | 40 分鐘 |
| Critical | 60 分鐘 |

壅塞修正使用受影響路段的平均飽和度。若飽和度越高，恢復時間就會增加。若嚴重度不是已知值，會 fallback 成 Medium。

輸出會包含：

- `severity`
- `base_minutes`
- `average_saturation`
- `congestion_adjustment_minutes`
- `total_minutes`
- `formula`
- `calculation_version`
- `evidence_ids`

因此 Dashboard 可以把 ETE 展開成公式，而不是只顯示一個結果。

## 11. 候選道路比較與排除邏輯

候選道路由受影響道路的 `alternatives` 欄位提供。模組 4 會逐一檢查候選道路的容量、飽和度、連通性、上下游關係、人流衝突與預測分流後飽和度。

### 11.1 預測分流量

目前假設受影響道路約 50% 車流會轉移到替代道路：

```text
predicted_inflow_vph = affected_vehicle_count * 0.50
```

如果受影響道路缺少 `vehicle_count`，會用 `capacity_vph` 作為 fallback。

### 11.2 預測飽和度

候選道路導入分流後的預測飽和度：

```text
predicted_saturation = current_saturation + predicted_inflow_vph / capacity_vph
```

如果候選道路缺少目前飽和度，或容量小於等於 0，就不計算 predicted saturation。

### 11.3 排除代碼

目前標準排除代碼包含：

| 代碼 | 意義 |
|---|---|
| `BLOCKED` | 道路目前封閉或完全壅塞 |
| `ACCIDENT_AFFECTED` | 道路仍位於事故影響範圍 |
| `INSUFFICIENT_CAPACITY` | 道路容量不足 1000 vph |
| `PREDICTED_OVERLOAD` | 預測分流後將超過容量 |
| `NOT_DIRECTLY_CONNECTED` | 不符合直接相交條件 |
| `NOT_UPSTREAM` | 不符合上游分流條件 |
| `CURRENTLY_CRITICAL` | 道路目前已達嚴重壅塞 |
| `PEDESTRIAN_CONFLICT` | 可能與主要疏散人流發生衝突 |
| `STALE_DATA` | 即時資料過期，暫不採用 |

這些代碼會轉成中文 `exclusion_reasons`，供 Dashboard 與 explanation 使用。

### 11.4 路線評分

路線分數越低越好。評分函式考慮：

- 分流後預測飽和度。
- 目前飽和度。
- 道路容量。
- 是否直接相交。
- 是否位於上游。
- 是否存在嚴重排除代碼。

目前計分概念如下：

```text
score =
  0.45 * predicted_saturation
+ 0.25 * current_saturation
+ 0.15 * capacity_score
+ connection_penalty
+ upstream_penalty
+ exclusion_penalty
```

其中 `capacity_score = 1 - min(capacity, 4000) / 4000`。容量越大，容量分數越低，也就是越有利。

### 11.5 主要方案與備援方案

排序後，系統會優先從「沒有嚴重排除代碼、直接相交、且為上游」的道路中選主要方案。

選擇順序是：

1. 嚴格方案：可接受、直接相交、上游。
2. 直接 fallback：可接受且直接相交。
3. 一般 fallback：可接受。
4. 若都沒有，才從未封閉且容量不至於不足的道路中選風險最低者。

若主要方案仍帶有風險代碼，例如 `NOT_UPSTREAM`，explanation 會明確標示這是 fallback，需人工確認。

## 12. 資料品質計算

`calculate_data_quality()` 目前檢查受影響道路的必要欄位：

- `capacity_vph`
- `avg_speed`
- `vehicle_count`
- `saturation_score`
- `lane_status`

完整度計算方式：

```text
completeness = 已存在欄位數 / 必要欄位總數
```

此外，也會計算事件時間與快照時間的差距：

```text
freshness_seconds = snapshot.timestamp - event.timestamp
```

若缺欄位，會產生警告。若事件與目前快照相差超過 10 分鐘，也會提示需要人工確認事件狀態是否仍有效。

## 13. 信心分數

信心分數由 `calculate_confidence()` 計算，範圍是 0 到 1。

目前權重如下：

| 因子 | 權重 | 說明 |
|---|---:|---|
| `completeness` | 30% | 受影響道路必要欄位是否完整 |
| `freshness` | 25% | 事件與快照時間是否接近 |
| `rule_clarity` | 25% | SOP 是否有清楚命中，且結果不是 UNKNOWN |
| `route_margin` | 20% | 第一名與第二名候選道路分數差距是否足夠 |

分數標籤：

| 分數 | 標籤 |
|---|---|
| `>= 0.8` | high |
| `>= 0.6` | medium |
| `< 0.6` | low |

這個信心不是模型機率，而是「此次決策資料與規則條件是否可靠」的工程評估。

## 14. 中文解釋產生方式

`reasoning/explanation.py` 目前用 deterministic template 產生 `DecisionExplanation`。

輸出包含：

- `summary`：一句話摘要。
- `classification_explanation`：交通分級理由。
- `sop_citations`：引用 SOP ID。
- `recommended_route_explanation`：主要路線推薦原因。
- `excluded_route_explanations`：被排除道路與原因。
- `ete_explanation`：ETE 公式展開。
- `confidence_explanation`：信心分數組成。
- `warnings`：資料品質與 fallback 風險提醒。

這樣做的好處是：

1. 解釋內容穩定，相同輸入會得到相同結果。
2. 不會新增不存在的道路、SOP 或數字。
3. 可以由 validator 檢查自然語言中的數字是否存在於結構化欄位。
4. 未來若接 LLM，可把目前 template 當成 baseline 或 fallback。

檔案中也保留了 `SYSTEM_PROMPT`，未來接 Bedrock 時可以要求模型：

```text
只能根據 verified_decision JSON 解釋已完成的程式計算，
不得新增道路、SOP、數值或事件。
```

## 15. 「為什麼？」追問設計

Dashboard 支援簡單追問，例如：

- 為什麼判 A 級？
- 為什麼選這條路？
- 為什麼不用其他道路？
- ETE 怎麼算？
- 信心分數可靠嗎？

目前 `answer_followup(record, question)` 使用關鍵字判斷問題類型，並回傳 `DecisionRecord.explanation` 中對應的片段。

這不是完整 QA 系統，但很適合 demo，因為它可以保證回答仍然來自已驗證的結構化決策，不會跳出資料範圍。

## 16. Validator：避免解釋失真

`reasoning/validator.py` 是模組 4 的安全檢查層。

目前檢查項目包含：

1. `rule_hits` 中引用的 SOP ID 必須在 `SOP-1` 到 `SOP-7` 範圍內。
2. 每個候選道路 ID 必須存在於 road network。
3. 建議主要方案的數量應該是 1。
4. explanation 引用的 SOP ID 必須合法。
5. explanation 提到的排除道路必須存在於候選道路。
6. ETE 解釋必須包含程式計算出的總分鐘數。
7. 自然語言中出現的數字必須能在 `DecisionRecord` 找到來源。

最後一點很重要。它可以避免解釋層講出未經計算的數字。例如如果 explanation 裡突然出現「約 75 分鐘」，但 `record.ete.total_minutes` 是 90，validator 就會產生警告或錯誤。

## 17. API 設計

目前 FastAPI 提供以下 endpoint：

| Endpoint | 方法 | 用途 |
|---|---|---|
| `/` | GET | 顯示模組 4 Dashboard |
| `/health` | GET | 健康檢查 |
| `/api/decisions/demo` | GET | 取得 demo decision |
| `/api/decisions/explain` | POST | 依 timestamp/event_id 建立決策說明 |
| `/api/decisions/ask` | POST | 對某次決策提出「為什麼」追問 |

`/api/decisions/demo` 預設使用：

```text
timestamp = 2026-05-20 22:15
event_id = TPE_2026_ACC_001
```

這個 endpoint 適合展示 Dashboard，也方便其他模組快速串接。

## 18. Dashboard 呈現方式

前端位於 `frontend/`，目前是純 HTML/CSS/JavaScript，沒有使用 React 或 build step。

Dashboard 主要呈現：

- 事件摘要與分級 badge。
- 建議主要道路。
- ETE 指標。
- 信心分數。
- validation 狀態。
- 決策時間軸。
- 候選道路比較表。
- SOP 命中卡片。
- ETE 公式拆解。
- 信心分數與 warnings。
- 原始關鍵 facts。
- 「為什麼？」追問區。

前端的設計重點是讓指揮官能快速回答三個問題：

1. 現在發生什麼事？
2. 系統建議我做什麼？
3. 這個建議的證據與限制是什麼？

## 19. 測試目前涵蓋範圍

`tests/test_reasoning.py` 目前測試：

- `Saturation_Score = 0.95` 時判定 A 級。
- `Saturation_Score = 0.85` 時判定 B 級。
- High 嚴重度與 0.9 飽和度時，ETE 應為 64 分鐘。
- demo decision 可以成功建立 evidence chain。
- demo decision 的 classification 是 A。
- demo decision 的 ETE 是 90 分鐘。
- demo decision 沒有 validation error。
- 低容量道路會被加上 `INSUFFICIENT_CAPACITY` 並排除。

這些測試確保最核心的規則、公式與 demo 情境不會被後續修改破壞。

## 20. 目前做法的優點

### 20.1 可追溯

每個重要結論都有 evidence ID，可以一路追到來源檔案、欄位與值。

### 20.2 可驗證

規則、公式、路線評分與信心分數都在 Python 中明確實作，validator 也會檢查輸出是否一致。

### 20.3 適合 hackathon demo

目前資料來自官方檔案與 demo 情境，不需要 live API 就能穩定展示端到端流程。

### 20.4 可以平滑接上 LLM

未來接 Bedrock 時，不需要讓 LLM 直接做判斷。LLM 只需要讀 `DecisionRecord`，產生更自然、更像指揮中心用語的說明。

### 20.5 對評審容易說明

這個模組可以明確展示「AI 為什麼這樣建議」，符合 explainability、traceability、faithfulness 的要求。

## 21. 目前限制

目前版本仍有一些限制：

- 尚未接 live API，資料仍是官方檔案與 demo 情境。
- 尚未真正接 Amazon Bedrock。
- 路線評分權重目前是 rule-based heuristic，還不是經大量歷史資料校準的模型。
- 分流比例目前固定為 50%，未來可由交通模擬或歷史 OD pattern 動態估計。
- 追問功能目前是關鍵字分類，不是完整自然語言 QA。
- SOP 條文目前只實作模組 4 demo 所需的 SOP-1、SOP-2、SOP-7。
- `STALE_DATA` 代碼已有定義，但目前主要資料過期檢查放在 `data_quality.warnings`。

這些限制不影響目前 demo 的可信決策鏈，但若要進入更完整的 production prototype，會是下一階段強化方向。

## 22. 後續可以擴充的方向

建議後續分三個方向擴充。

### 22.1 接上 Bedrock 但保留 guardrail

流程可以改成：

```text
DecisionRecord
    |
    v
validator pre-check
    |
    v
Bedrock 產生 DecisionExplanation JSON
    |
    v
validator post-check
    |
    v
若失敗則 fallback deterministic explanation
```

LLM 只能改寫與組織語言，不負責新增數字、道路或判斷。

### 22.2 強化路線評分

可以加入：

- 路段長度。
- 轉向限制。
- 號誌週期。
- 公車或救災車道優先權。
- 人流疏散路徑衝突。
- 歷史壅塞恢復曲線。

### 22.3 強化稽核與 replay

可以把每次 `DecisionRecord` 存入資料庫或 JSONL，使系統可以：

- 回放當時決策。
- 比較不同版本規則的結果差異。
- 提供賽後或事後檢討。
- 支援 dashboard 的 raw evidence 展開。

## 23. 一句話總結

模組 4 目前的做法是建立一個 deterministic、可追溯、可驗證的交通決策證據鏈。它先用程式把事件、SOP、道路資料、候選方案、ETE、信心分數全部整理成 `DecisionRecord`，再由解釋層產生中文說明，最後透過 validator 與 Dashboard 讓使用者看見「AI 為什麼這樣判斷」。

這樣的設計讓系統不是只會給答案，而是能把答案背後的依據完整攤開，適合作為黑客松 demo 中的可信 AI 決策核心。
