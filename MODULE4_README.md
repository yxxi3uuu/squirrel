# 模組 4：AI 決策推理與解釋鏈 (Reasoning & Explainability)

> Branch: `module-4-reasoning`
> Version: v1（本機 deterministic demo + FastAPI Dashboard）

<br>

## 概覽

模組 4 負責把交通決策變成一條可以被檢查、追溯、展示的**決策證據鏈**。  
它不是只產生一段「看起來合理」的 AI 文字，而是把事件、即時資料、SOP 命中、程式計算、候選道路比較、排除理由、ETE、信心分數全部整理成結構化 `DecisionRecord`，再給 Dashboard 顯示。

```text
官方資料檔 / TrafficSnapshot
     ↓
reasoning.builder.build_decision_record()
     ↓
收集 evidence：事件、路段車流、容量、候選道路狀態
     ↓
deterministic rules：
  SOP-1 交通分級
  SOP-2 事故 / 路障觸發
  SOP-7 ETE 公式
  候選道路排除與評分
  資料品質與信心分數
     ↓
validator.py 驗證 SOP、道路 ID、ETE、解釋數值
     ↓
DecisionRecord JSON
     ↓
FastAPI API + 前端 Dashboard
```

目前版本**沒有呼叫 LLM**。中文說明是由 `reasoning/explanation.py` 根據已驗證的 `DecisionRecord` 用模板產生。  
想說先確保「事實、規則、公式、數值」全部由程式決定，避免 LLM 幻覺


## 檔案架構

```text
squirrel/
│
├── api/
│   ├── __init__.py
│   └── main.py                     ← FastAPI 入口：/、/health、/api/decisions/*
│
├── frontend/
│   ├── index.html                  ← 模組 4 Dashboard（純 HTML）
│   ├── styles.css                  ← 指揮中心風格儀表板樣式
│   └── app.js                      ← 呼叫 FastAPI，渲染 DecisionRecord 與「為什麼？」追問
│
├── reasoning/
│   ├── __init__.py
│   ├── models.py                   ← DecisionRecord / RuleHit / ETE / RouteCandidate 等 Pydantic schema
│   ├── builder.py                  ← 主流程：TrafficSnapshot → DecisionRecord
│   ├── rules.py                    ← SOP-1、SOP-2、SOP-7、路線評分、信心分數
│   ├── explanation.py              ← deterministic 中文解釋與追問回答
│   └── validator.py                ← 驗證 SOP、道路 ID、ETE、解釋中數字是否可追溯
│
├── data/
│   └── snapshot.py                 
│
├── data_source/                    
│   ├── city_traffic_flow.csv
│   ├── signaling_crowd_density.csv
│   ├── road_network_geometry.json
│   └── live_incidents.json
│
├── shared/
│   ├── schemas.py                  
│   └── lookup.py                  
│
├── sop/
│   └── emergency_traffic_sop.txt  
│
├── docs/
│   └── shared_data_contract.md
│
├── tests/
│   └── test_reasoning.py           ← 單元測試：分級、ETE、demo decision、排除理由
│
├── requirements.txt
└── MODULE4_README.md               ← 本文件
```

<br>

## 資料流程

```text
data_source/*.csv, *.json（官方資料檔 / demo 情境）
        ↓ data/snapshot.py
TrafficSnapshot
  ├─ timestamp
  ├─ road_segments
  ├─ stations
  └─ incidents
        ↓
reasoning.builder.build_decision_record(timestamp, event_id)
        ↓
_select_event()
  取指定 event_id，或自動選最新 High / Critical 道路事件
        ↓
_build_evidence()
  建立 EV-001, EV-002...，每個結論都能追到來源欄位
        ↓
rules.py
  ├─ classify_traffic_level()
  ├─ build_rule_hit_for_incident()
  ├─ calculate_ete()
  ├─ compare_candidate_routes()
  ├─ calculate_data_quality()
  └─ calculate_confidence()
        ↓
DecisionRecord
        ↓
explanation.py
  產生 summary、分級說明、推薦道路說明、排除道路說明、ETE 說明、信心說明
        ↓
validator.py
  檢查道路 ID、SOP ID、ETE 數值、自然語言數字是否可追溯
        ↓
FastAPI response / Dashboard 顯示
```

**判斷原則**：LLM 或模板都不能發明資料。所有顯示在畫面上的數字都必須已經存在於 `DecisionRecord`，例如 `Saturation_Score=1.0`、`ETE=90`、`capacity_vph=4000`。

<br>

## 核心 DecisionRecord

`DecisionRecord` 是模組 4 對外的主要資料契約。Dashboard、後續 LLM、稽核紀錄都應該讀這份 JSON。

```text
DecisionRecord
├── decision_id
├── created_at
├── event
├── snapshot
├── evidence
├── rule_hits
├── classification
├── ete
├── route_candidates
├── data_quality
├── confidence
├── evidence_chain
├── explanation
├── validation_issues
├── execution_time_ms
└── model_version
```

重要欄位說明：

| 欄位 | 用途 |
|---|---|
| `evidence` | 每個 EV 編號對應來源檔案、欄位、值與中文描述 |
| `rule_hits` | 命中的 SOP 條款、條件、觀測值、門檻、結果 |
| `classification` | 交通等級 A / B / NORMAL / UNKNOWN |
| `ete` | SOP-7 的程式計算結果，不由 LLM 生成 |
| `route_candidates` | 每條候選道路的容量、飽和度、預測分流後飽和度、分數、排除代碼 |
| `data_quality` | 欄位完整度、資料新鮮度、缺漏與警告 |
| `confidence` | 程式計算的信心分數與組成因子 |
| `evidence_chain` | Dashboard 上的時間軸：偵測事件 → 讀數據 → 命中 SOP → 比較候選 → 算 ETE → 產生解釋 |
| `validation_issues` | 若解釋或資料有不一致，會列出 error / warning |

<br>

## 目前設計狀態

- 已完成 `DecisionRecord` Pydantic schema。
- 已完成 SOP-1：`Saturation_Score >= 0.95` 判 A，`0.85 <= score < 0.95` 判 B。
- 已完成 SOP-2：`status in {Closed, Blocked, Restricted}` + `severity in {High, Critical}` + `affected_segment` 是道路事件。
- 已完成 SOP-7：依嚴重度基礎時間與平均飽和度計算 ETE。
- 已完成候選道路比較：容量、直接相交、上游/下游、目前壅塞、分流後過載、行人衝突。
- 已完成標準排除代碼：`BLOCKED`、`INSUFFICIENT_CAPACITY`、`PREDICTED_OVERLOAD`、`NOT_DIRECTLY_CONNECTED`、`NOT_UPSTREAM` 等。
- 已完成 fallback 標記：若上游方案分流後會過載，仍可推薦風險較低的下游方案，但會在 warnings 中標記需人工確認。
- 已完成資料品質與信心分數：完整度、新鮮度、規則清晰度、第一名/第二名分數差距。
- 已完成 deterministic 中文解釋與「為什麼？」追問。
- 已完成 FastAPI + Dashboard，開 `http://127.0.0.1:8000/` 可看效果。
- 已完成 validator：檢查 SOP ID、道路 ID、ETE 是否一致，並避免自然語言出現無來源數字。
- 目前沒有真正呼叫 LLM / Bedrock。
- 目前資料不是 live API，而是主辦方官方資料檔 / demo 情境資料。

<br>

## 技術棧

| 分類 | 選用 | 說明 |
|---|---|---|
| 後端框架 | FastAPI + Uvicorn | `api/main.py` 提供 Dashboard 與 JSON API |
| 資料驗證 | Pydantic 2.10 | `reasoning/models.py` 定義 `DecisionRecord` 與各種子模型 |
| 規則引擎 | Python deterministic functions | SOP、ETE、路線排除、信心分數都用程式計算 |
| 前端 | 純 HTML/CSS/JavaScript | `frontend/` 無框架、無 build step，適合 hackathon demo |
| 資料來源 | CSV / JSON | `data_source/` 官方資料檔，經 `data/snapshot.py` 轉為 `TrafficSnapshot` |
| 測試 | unittest | `tests/test_reasoning.py` |
| LLM 狀態 | 尚未接 | 已保留 `SYSTEM_PROMPT` 與 validator，未來可接 Bedrock |

<br>

## 快速啟動

### 1. 切到 branch

```bash
git switch module-4-reasoning
```

### 2. 安裝依賴

```bash
pip install -r requirements.txt
```

### 3. 啟動 FastAPI

```bash
python3 -m uvicorn api.main:app --reload --port 8000
```

瀏覽器開啟：

```text
http://127.0.0.1:8000/
```

如果 8000 被占用，可以改：

```bash
python3 -m uvicorn api.main:app --reload --port 8001
```

<br>

## API

### `GET /`

模組 4 Dashboard 前端。

### `GET /health`

健康檢查。

```json
{
  "ok": true,
  "module": "reasoning-explainability"
}
```

### `GET /api/decisions/demo`

用 query string 指定 demo 時間點與事件。

```text
GET /api/decisions/demo?timestamp=2026-05-20%2022:15&event_id=TPE_2026_ACC_001
```

### `POST /api/decisions/explain`

回傳完整 `DecisionRecord`。

```json
{
  "timestamp": "2026-05-20 22:15",
  "event_id": "TPE_2026_ACC_001"
}
```

### `POST /api/decisions/ask`

Dashboard 的「為什麼？」追問。

```json
{
  "timestamp": "2026-05-20 22:15",
  "event_id": "TPE_2026_ACC_001",
  "question": "為什麼推薦仁愛路？"
}
```

目前支援的追問類型：

- 為什麼是 A 級？
- 為什麼推薦仁愛路？
- 為什麼排除延吉街？
- ETE 怎麼計算？
- 信心分數可靠嗎？

<br>

## Demo 使用指南

開啟 `http://127.0.0.1:8000/` 後會看到：

1. 最上方摘要：A 級事件、主要改道、ETE、信心、驗證狀態
2. 左側決策時間軸：偵測事件 → 讀取資料 → 命中 SOP → 比較候選道路 → 計算 ETE → 產生解釋
3. 候選道路比較表：容量、目前飽和度、分流後飽和度、狀態、排除理由
4. 右側 SOP 命中卡片：SOP-1、SOP-2 的條件、觀測值、結果
5. ETE 公式展開：基礎清除時間 + 壅塞修正 = 預計恢復時間
6. 信心與限制：信心百分比、資料品質、warning
7. 「為什麼？」追問：按快捷鍵或手動輸入問題

建議 demo 時間點：

```text
2026-05-20 22:15
```

這個時間點的光復南路事故會得到：

- 光復南路 `Saturation_Score=1.0`
- 依 SOP-1 判定 A 級
- 事故 `severity=Critical`
- SOP-7：60 分鐘基礎清除 + 30 分鐘壅塞修正 = ETE 90 分鐘
- 市民大道四段是上游候選，但分流後 `predicted_saturation=1.19`，因此排除
- 仁愛路四段分流後 `predicted_saturation=0.9325`，作為 fallback 主要方案
- 延吉街因 Gridlock、容量 600 vph、非直接相交、預測過載而排除

<br>

## 路線比較規則

候選道路來自受影響路段的 `alternatives`。

每條候選道路會計算：

| 項目 | 說明 |
|---|---|
| `capacity_vph` | 路網資料中的道路容量 |
| `current_saturation` | 當前飽和度 |
| `predicted_inflow_vph` | 目前先用受影響路段車流量的 50% 估算分流量 |
| `predicted_saturation` | `current_saturation + predicted_inflow_vph / capacity_vph` |
| `directly_connected` | 是否與事故道路直接相交 |
| `upstream_status` | upstream / downstream / unknown / not_connected |
| `exclusion_codes` | 排除原因代碼 |
| `score` | 排序用分數，越低越好 |

排除代碼：

| 代碼 | 中文說明 |
|---|---|
| `BLOCKED` | 道路目前封閉或完全壅塞 |
| `ACCIDENT_AFFECTED` | 道路仍位於事故影響範圍 |
| `INSUFFICIENT_CAPACITY` | 道路容量不足 1000 vph |
| `PREDICTED_OVERLOAD` | 預測分流後將超過容量 |
| `NOT_DIRECTLY_CONNECTED` | 不符合直接相交條件 |
| `NOT_UPSTREAM` | 不符合上游分流條件 |
| `CURRENTLY_CRITICAL` | 道路目前已達嚴重壅塞 |
| `PEDESTRIAN_CONFLICT` | 可能與主要疏散人流發生衝突 |

<br>

## 信心分數

目前的信心分數不是 LLM 自由產生，而是程式計算。

```text
Confidence = 0.30 * completeness
           + 0.25 * freshness
           + 0.25 * rule_clarity
           + 0.20 * route_margin
```

| 因子 | 說明 |
|---|---|
| `completeness` | 受影響路段必要欄位是否完整 |
| `freshness` | 事故時間與快照時間的差距 |
| `rule_clarity` | SOP 是否明確命中 |
| `route_margin` | 第一名與第二名候選方案分數差距 |

Dashboard 不只顯示百分比，也會顯示組成理由，例如：

```text
資料完整度 100%
資料新鮮度分數 35%
SOP 規則匹配清晰度 100%
候選方案分數差距分數 82%
```

<br>

## 驗證器設計

`reasoning/validator.py` 目前檢查：

- `rule_hits` 的 SOP ID 必須是 `SOP-1` 到 `SOP-7`
- `route_candidates` 的道路 ID 必須存在於 `road_segments`
- 原則上應有一條 `recommended` route
- `explanation` 引用的 SOP ID 必須合法
- `excluded_route_explanations` 引用的道路必須存在於候選道路
- ETE 解釋必須包含程式算出的 `total_minutes`
- 自然語言中出現的數字必須能在 `DecisionRecord` 追溯

這是未來接 Bedrock 的安全邊界：  
LLM 可以把文字講得比較自然，但輸出後仍要被 validator 擋掉幻覺、錯誤 SOP、錯誤道路或錯誤 ETE。

<br>

## 測試方式

跑單元測試：

```bash
python3 -m unittest discover -s tests
```

手動產生完整 JSON：

```bash
python3 - <<'PY'
from reasoning.builder import build_decision_record

record = build_decision_record("2026-05-20 22:15", "TPE_2026_ACC_001")
print(record.model_dump_json(indent=2))
PY
```

啟動後測 API：

```bash
curl http://127.0.0.1:8000/health
curl "http://127.0.0.1:8000/api/decisions/demo?timestamp=2026-05-20%2022:15&event_id=TPE_2026_ACC_001"
```
