# 共用資料架構草案

這份契約先讓各功能模組用同一套 ID、欄位和觸發結果格式。模組可以各自開發，但資料來源與輸出不要各自發明。

## 分層

```text
data/                   # 當前資料快照，之後由模組 1 接真實資料
shared/
  schemas.py            # 全隊共用資料模型
  lookup.py             # 路名、站名、場館別名查詢
sop/                    # SOP 條文來源
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

## 快照格式

`data/snapshot.py` 的 `get_snapshot()` 應回傳同一份 shape：

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
| 模組 1 Dynamic Time-Series Dashboard | 時間軸資料展示、SOP 預警門檻判斷、異常彈窗 | 讀 `TrafficSnapshot`，可輸出 Dashboard 用 `TriggerDecision[]` |
| 模組 2 Live Incident Response | 注入 `live_incidents.json`、60 秒內路網重規劃、避開容量不足或飽和路段 | 讀 `TrafficSnapshot` 與 incidents，輸出重規劃結果與 `TriggerDecision[]` |
| 模組 3 Interactive Strategic Advisory | Dashboard 旁對話視窗、what-if 推演、SOP 觸發條款回答 | 讀 SOP、對話歷史，必要時引用 `TrafficSnapshot` 當前狀態 |
| 模組 4 Reasoning & Explainability | 展示 SOP 分級依據、替代道路排除理由、ETE 公式運算 | 讀 `TrafficSnapshot`、事故資料與 `TriggerDecision[]` |
| 模組 5 Multilingual Notification | 偵測漫遊率門檻、產生多語通報候選文字 | 讀基地台資料、`TriggerDecision[]`、entity ID、地點名稱 |

## 觸發結果格式

跨模組狀態與判定結果建議共用 `TriggerDecision`：

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

- `main`：只放共用資料契約、SOP、mock 資料格式、文件。
- `shared-data-contract`：先做共用資料架構與文件。
- `module-1-dashboard`：動態時序監測儀表板。
- `module-2-incident-response`：突發事件注入與路網重規劃。
- `module-3-advisory`：對話式策略諮詢顧問。
- `module-4-explainability`：AI 決策推理與解釋鏈。
- `module-5-notification`：通報與多語訊息。

先讓大家從 `shared-data-contract` 開發，確認契約後再 merge 回 `main`。
