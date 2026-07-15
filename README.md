# Squirrel Traffic Advisory

大型活動交通指揮系統的共用資料架構 repo。

`main` 只保留全隊共用的資料契約、SOP 條文、mock snapshot 和整合文件。各功能模組請在自己的 branch 開發，避免把模組專屬 UI、API 或 LLM prompt 混進共用底座。

## 共用資料流

```text
模組 1 資料取得/清洗
  -> TrafficSnapshot
模組 2 規則判斷/事件偵測
  -> TriggerDecision[]
模組 3 對話式策略諮詢
  -> 讀 TrafficSnapshot、SOP、TriggerDecision[]
模組 4 Dashboard
  -> 讀 TrafficSnapshot、TriggerDecision[]
模組 5 通報/多語訊息
  -> 讀 TriggerDecision[]
```

## Main 目前保留

```text
.
├── data/
│   ├── __init__.py
│   └── snapshot.py               # mock TrafficSnapshot
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

## 共用契約

核心 schema 在 `shared/schemas.py`：

- `TrafficSnapshot`：現場資料快照，包含道路、捷運站、場館、基地台、事件、號誌。
- `TriggerDecision`：模組 2 規則判斷後的觸發結果，供模組 3、4、5 共用。

文字查詢工具在 `shared/lookup.py`：

- `忠孝東路四段` -> `RD_TPE_001`
- `BL17` -> `BS_MRT_BL17`
- `大巨蛋` -> `BS_TPE_DOME`
- `台北101` -> `BS_TPE_101`

完整欄位與格式請看 `docs/shared_data_contract.md`。

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

## Branch 分工

- `main`：只放共用資料契約、SOP、mock snapshot、文件。
- `module-1-data-ingestion`：資料來源與清洗。
- `module-2-rule-engine`：SOP 規則判斷與事件偵測。
- `module-3-advisory`：對話式策略諮詢。
- `module-4-dashboard`：Dashboard。
- `module-5-notification`：通報與多語訊息。

目前完整的模組 3 demo 已保留在 `module-3-advisory` 分支。
