# Squirrel Traffic Advisory

大型活動交通指揮系統的共用資料架構 repo。

`main` 只保留全隊共用的官方資料來源、資料契約與整合文件。各功能模組請在自己的 branch 開發，避免把模組專屬 UI、API、LLM prompt 或演算法混進共用底座。

## Main 的角色

`main` 是全隊共用底座，不是任一功能模組的實作分支。

它負責：

- 保存主辦方官方資料檔，包括時序/事件/路網資料與 SOP 規則文件
- 將官方時序/事件/路網資料整理成同一份 `TrafficSnapshot`
- 定義跨模組共用的 `TrafficSnapshot` / `TriggerDecision` schema
- 提供路名、站名、場館別名查詢工具
- 保存共用資料契約文件

它不負責：

- Dashboard UI
- 事故注入介面
- 路網重規劃演算法
- 對話式策略諮詢 API
- LLM prompt
- 多語通報發布流程

## 資料流

```text
data_source 官方時序/事件/路網資料
        ↓
data/snapshot.py
        ↓
TrafficSnapshot
        ↓
各功能模組共用
```

## 官方資料來源分類

主辦方官方資料在 `main` 分成兩類保存：

```text
data_source/   # 可被讀成 TrafficSnapshot 的時序、事件、路網資料
sop/           # 官方 SOP 規則文件
```

`sop/emergency_traffic_sop.txt` 不放進 `data_source/`，因為它不是現場狀態資料，而是各模組判斷與解釋時要引用的官方規則來源。

## 核心功能模組

| 模組 | 名稱 | 程式運算負責 | LLM 負責 |
|---|---|---|---|
| 模組 1 | Dynamic Time-Series Dashboard | 依時間軸讀取並展示車流、人流資料；判斷 SOP 預警門檻；觸發自動彈窗 | 產生趨勢異常摘要與預警提示 |
| 模組 2 | Live Incident Response | 注入 `live_incidents.json`；在 60 秒內完成路網重規劃；避開容量不足或飽和路段 | 產生導引建議文字 |
| 模組 3 | Interactive Strategic Advisory | 提供 Dashboard 旁對話視窗與對話歷史 | 根據假設條件檢索 SOP，回答觸發條款與預期動作 |
| 模組 4 | Reasoning & Explainability | 計算 SOP 分級、替代道路排除理由、ETE 公式 | 解釋判定依據、數據佐證與 ETE 結果 |
| 模組 5 | Multilingual Notification | 自動偵測基地台漫遊率，判斷是否達 30% 門檻 | 產生多國語言告警文字 |

## 目前檔案結構

```text
.
├── data_source/                  # 主辦方官方時序/事件/路網資料
│   ├── city_traffic_flow.csv      # 車流時間序列
│   ├── signaling_crowd_density.csv# 人流 / 基地台資料
│   ├── road_network_geometry.json # 路網、容量、替代道路
│   └── live_incidents.json        # 突發事件資料
├── data/
│   ├── __init__.py
│   └── snapshot.py                # 讀 data_source，產生 TrafficSnapshot
├── shared/
│   ├── __init__.py
│   ├── schemas.py                 # 共用 schema
│   └── lookup.py                  # 路名、站名、場館別名查詢
├── docs/
│   └── shared_data_contract.md    # 共用資料契約說明
├── sop/
│   └── emergency_traffic_sop.txt  # 主辦方官方 SOP 七條應變規則
├── requirements.txt
└── README.md
```

## 共用資料契約

核心 schema 在 `shared/schemas.py`。

`TrafficSnapshot` 代表某一時間點的現場狀態：

```text
TrafficSnapshot
├── timestamp
├── source
├── road_segments
│   └── RD_TPE_xxx
│       ├── name
│       ├── capacity_vph
│       ├── alternatives
│       ├── intersections
│       ├── avg_speed
│       ├── vehicle_count
│       ├── saturation_score
│       └── lane_status
├── stations
│   └── BS_xxx
│       ├── name
│       ├── user_count
│       ├── stay_time_avg
│       ├── growth_rate
│       ├── roaming_user_pct
│       └── peak_user_count
└── incidents
    └── 已注入且 timestamp <= 快照時間的事件
```

`TriggerDecision` 代表程式運算後的判定結果，可供 Dashboard、解釋鏈、通報與策略顧問引用：

```text
TriggerDecision
├── triggered
├── sop_clause
├── clause_name
├── entity_id / entity_name
├── basis
├── actions
├── cascade_checks
├── severity
├── primary_route / secondary_routes / excluded_routes
├── ete_minutes
└── cms_text
```

## 查詢工具

`shared/lookup.py` 可將自然語言中的名稱轉成系統 ID，例如：

- `忠孝東路四段` -> `RD_TPE_001`
- `BL17` -> `BS_MRT_BL17`
- `大巨蛋` -> `BS_TPE_DOME`
- `台北101` -> `BS_TPE_101`

## 安裝共用依賴

```bash
pip install -r requirements.txt
```

## 快速驗證

```bash
python3 - <<'PY'
from data.snapshot import get_snapshot, available_timestamps
from shared.lookup import find_entities_in_text
from shared.schemas import TrafficSnapshot

snapshot = get_snapshot("2026-05-20 22:30")
print("時間軸:", available_timestamps()[0], "~", available_timestamps()[-1])
TrafficSnapshot(**snapshot)

for text in ["忠孝東路四段", "BL17", "大巨蛋", "台北101"]:
    found = [(r["entity_type"], r["entity_id"], r["name"]) for r in find_entities_in_text(text, snapshot)]
    print(text, "=>", found)
PY
```

預期會看到：

```text
時間軸: 2026-05-20 17:00 ~ 2026-05-20 23:30
忠孝東路四段 => [('road_segment', 'RD_TPE_001', '忠孝東路四段')]
BL17 => [('station', 'BS_MRT_BL17', '捷運國父紀念館站')]
大巨蛋 => [('station', 'BS_TPE_DOME', '大巨蛋場館內')]
台北101 => [('station', 'BS_TPE_101', '台北101廣場')]
```

## Branch 分工

- `main`：共用官方資料來源、schema、lookup、文件。
- `module-1-dashboard`：動態時序監測儀表板。
- `module-2-incident-response`：突發事件注入與路網重規劃。
- `module-3-advisory`：對話式策略諮詢顧問。
- `module-4-explainability`：AI 決策推理與解釋鏈。
- `module-5-notification`：多語化全通路通報。

目前完整的模組 3 demo 保留在 `module-3-advisory` 分支。不要將整個模組分支直接 merge 回 `main`；若需要更新共用資料契約，請開小分支只修改 `data_source/`、`data/`、`shared/`、`sop/` 或 `docs/`。
