# 共用資料架構草案

這份契約先讓各功能模組用同一套 ID、欄位和觸發結果格式。模組可以各自開發，但資料來源與輸出不要各自發明。

## 分層

```text
app.py                  # 目前可跑的模組 3 API demo
data_source/            # 主辦方官方時序/事件/路網資料（CSV / JSON）
data/
  snapshot.py           # 讀 official files 產生 TrafficSnapshot
module3_advisor/        # 模組 3：SOP-grounded what-if advisor
shared/
  schemas.py            # 全隊共用資料模型
  lookup.py             # 路名、站名、場館別名查詢
sop/                    # SOP 條文來源
llm/                    # LLM/Bedrock/Anthropic 抽象層
static/                 # 模組 3 前端
```

## ID 規則

| 類型 | Prefix | 範例 | 說明 |
|---|---|---|---|
| 道路路段 | `RD_` | `RD_TPE_001` | 路段與替代道路 |
| 捷運/公車站點 | `BS_` | `BS_MRT_BL17` | 人流、接駁、過站不停 |
| 場館 | `BS_` | `BS_TPE_DOME` | 大巨蛋、101 廣場 |
| 基地台/區域 | `CT_` | `CT_BL17_AREA` | 漫遊比例、多語通報 |
| 路口/號誌 | `INT_` | `INT_001` | 號誌狀態與路口警力 |
| 事件 | `INC_` | `INC_20260715_001` | 事故、路障、號誌故障 |

## Snapshot 格式

模組 1 / 2 / 4 若需要傳遞即時狀態，建議使用同一份 shape：

```json
{
  "timestamp": "2026-07-15T20:00:00+08:00",
  "source": "mock",
  "road_segments": {},
  "metro_stations": {},
  "venues": {},
  "cell_towers": {},
  "incidents": [],
  "signals": {}
}
```

## 各模組責任

| 模組 | 責任 | 使用共用資料 |
|---|---|---|
| 模組 1 | 取得真實資料，轉成 snapshot | 寫入 `TrafficSnapshot` 格式 |
| 模組 2 | SOP 規則判斷、事件偵測、連鎖觸發 | 讀 `TrafficSnapshot`，輸出 `TriggerDecision[]` |
| 模組 3 | 對話式策略諮詢與 what-if 推演 | 主要讀 SOP 與使用者假設；snapshot 僅作為未來 optional context |
| 模組 4 | Dashboard | 讀 snapshot、`TriggerDecision[]` |
| 模組 5 | 通報/多語訊息 | 讀 `TriggerDecision[]`、entity ID、地點名稱 |

## 觸發結果格式

模組 2、3、4、5 之間建議共用 `TriggerDecision`：

```json
{
  "triggered": true,
  "sop_clause": "第 3 條",
  "clause_name": "捷運與接駁分流",
  "entity_id": "BS_MRT_BL17",
  "entity_name": "國父紀念館",
  "basis": "User_Count 40,000 > 門檻 25,000",
  "actions": ["過站不停", "調度接駁專車", "引導至 BS_MRT_BL18"],
  "cascade_checks": ["Roaming_User_Pct 8% < 30%，不觸發第 6 條"],
  "severity": "yellow"
}
```

## Branch 建議

- `main`：永遠保持可 demo。
- `shared-data-contract`：先做共用資料架構與文件。
- `module-1-data-ingestion`：資料來源。
- `module-2-rule-engine`：SOP 規則判斷與事件偵測。
- `module-3-advisor`：你的對話顧問。
- `module-4-dashboard`：儀表板。
- `module-5-notification`：通報與多語訊息。

先讓大家從 `shared-data-contract` 開發，確認契約後再 merge 回 `main`。
