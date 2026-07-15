# Squirrel Traffic Advisory

大型活動交通指揮系統的共用資料架構 repo。

`main` 只保留全隊共用的資料契約、SOP 條文、mock 資料格式和整合文件。各功能模組請在自己的 branch 開發，避免把模組專屬 UI、API、LLM prompt 或演算法混進共用底座。

## 核心功能模組

| 模組 | 名稱 | 程式運算負責 | LLM 負責 |
|---|---|---|---|
| 模組 1 | Dynamic Time-Series Dashboard | 依時間軸讀取並展示車流、人流資料；判斷 SOP 預警門檻；觸發自動彈窗 | 產生趨勢異常摘要與預警提示 |
| 模組 2 | Live Incident Response | 注入 `live_incidents.json`；在 60 秒內完成路網重規劃；避開容量不足或飽和路段 | 產生導引建議文字 |
| 模組 3 | Interactive Strategic Advisory | 提供 Dashboard 旁對話視窗與對話歷史 | 根據假設條件檢索 SOP，回答觸發條款與預期動作 |
| 模組 4 | Reasoning & Explainability | 計算 SOP 分級、替代道路排除理由、ETE 公式 | 解釋判定依據、數據佐證與 ETE 結果 |
| 模組 5 | Multilingual Notification | 自動偵測基地台漫遊率，判斷是否達 30% 門檻 | 產生多國語言告警文字 |

## 共用資料定位

`main` 的共用資料不是單獨服務某一個模組，而是提供全系統一致的資料格式與命名方式：

- `TrafficSnapshot`：時間序列 Dashboard、事件重規劃、what-if 諮詢、解釋鏈與多語通報都可讀取的現場狀態格式。
- `TriggerDecision`：程式運算後的門檻判定、SOP 條款、原因、建議動作與嚴重度格式。
- `shared.lookup`：將路名、站名、場館名稱、別名統一映射到系統 ID。
- `sop/`：主辦方 SOP 條文來源。

模組 3 不應假設「只讀 snapshot 就完成回答」；它的 what-if 回答需要結合使用者假設、SOP、對話歷史，以及必要時引用共用資料中的當前狀態。

## Main 目前保留

```text
.
├── data/
│   ├── __init__.py
│   └── snapshot.py               # mock TrafficSnapshot 格式
├── shared/
│   ├── __init__.py
│   ├── schemas.py                # TrafficSnapshot / TriggerDecision 共用 schema
│   └── lookup.py                 # 路名、站名、場館別名查詢
├── docs/
│   └── shared_data_contract.md   # 共用資料契約說明
├── sop/
│   └── emergency_traffic_sop.txt # SOP 七條應變規則
├── requirements.txt              # 共用層最小依賴
└── README.md
```

## Branch 分工

- `main`：只放共用資料契約、SOP、mock 資料格式、文件。
- `module-1-dashboard`：動態時序監測儀表板。
- `module-2-incident-response`：突發事件注入與路網重規劃。
- `module-3-advisory`：對話式策略諮詢顧問。
- `module-4-explainability`：AI 決策推理與解釋鏈。
- `module-5-notification`：多語化全通路通報。

目前完整的模組 3 demo 已保留在 `module-3-advisory` 分支。

## 安裝共用依賴

```bash
pip install -r requirements.txt
```

## 快速驗證

```bash
python3 - <<'PY'
from data.snapshot import get_snapshot
from shared.lookup import find_entities_in_text
from shared.schemas import TrafficSnapshot

snapshot = get_snapshot()
TrafficSnapshot(**snapshot)

for text in ["忠孝東路四段", "BL17", "大巨蛋", "台北101"]:
    print(text, "=>", find_entities_in_text(text, snapshot))
PY
```
