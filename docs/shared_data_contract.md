# 共用資料架構

這份契約讓各功能模組使用同一套 ID、欄位和觸發結果格式。

## 分層

```text
data_source/            # 主辦方官方時序/事件/路網資料
data/
  snapshot.py           # 讀官方資料產生 TrafficSnapshot
shared/
  schemas.py            # 共用資料模型
  lookup.py             # 路名、站名、場館別名查詢
sop/                    # 主辦方官方 SOP 規則文件
module3_advisor/        # 模組 3：SOP 導向 what-if 顧問
app.py                  # 模組 3 demo API
static/                 # 模組 3 demo UI
```

## ID 規則

| 類型 | Prefix | 範例 | 說明 |
|---|---|---|---|
| 道路路段 | `RD_` | `RD_TPE_001` | 路段與替代道路 |
| 人流站點 | `BS_` | `BS_MRT_BL17` | 捷運站、場館、商圈、轉運站、漫遊比例 |
| 事件 | 官方 event_id | `TPE_2026_ACC_001` | 事故、路障、號誌故障、人流事件 |

## Snapshot 格式

`data/snapshot.py` 的 `get_snapshot(timestamp)` 會回傳同一份資料形狀：

```json
{
  "timestamp": "2026-05-20 22:30",
  "source": "official_files",
  "road_segments": {},
  "stations": {},
  "incidents": []
}
```

資料來源對應：

| source file | 用途 |
|---|---|
| `city_traffic_flow.csv` | 各時間點車速、車流量、飽和度、車道狀態 |
| `signaling_crowd_density.csv` | 各時間點 BS_ 站點人流、停留時間、增幅、漫遊率 |
| `road_network_geometry.json` | 路段容量、替代路段、相交路口、鄰近站點 |
| `live_incidents.json` | 可注入事件與事故狀態 |
| `sop/emergency_traffic_sop.txt` | 官方 SOP 七條應變規則 |

## 各模組責任

| 模組 | 責任 | 使用共用資料 |
|---|---|---|
| 模組 1：動態時間序列 Dashboard | 時間軸資料展示、SOP 預警門檻判斷、異常彈窗 | 讀 `TrafficSnapshot`，可輸出 Dashboard 用 `TriggerDecision[]` |
| 模組 2：即時事件應變 | 注入 `live_incidents.json`、路網重規劃、避開容量不足或飽和路段 | 讀 `TrafficSnapshot` 與 incidents，輸出重規劃結果與 `TriggerDecision[]` |
| 模組 3：對話式策略諮詢顧問 | Dashboard 旁對話視窗、what-if 推演、SOP 觸發條款回答 | 主要讀 SOP 與使用者假設；snapshot 僅作為連鎖檢查與現況佐證 |
| 模組 4：推理與可解釋性 | 展示 SOP 分級依據、替代道路排除理由、ETE 公式運算 | 讀 `TrafficSnapshot`、事故資料與 `TriggerDecision[]` |
| 模組 5：多語通報 | 偵測漫遊率門檻、產生多語通報候選文字 | 讀基地台資料、`TriggerDecision[]`、entity ID、地點名稱 |

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
  "cascade_checks": ["Roaming_User_Pct 5% < 30%，不觸發第 6 條"],
  "severity": "yellow"
}
```
