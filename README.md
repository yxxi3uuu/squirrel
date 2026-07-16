# Squirrel Traffic Advisory

本系統為能隨時間監測交通與人流、即時偵測異常，並在突發事件發生時自動產生專業指揮建議的智慧交通決策中樞。

`main` 保留共用的官方資料來源、資料說明與整合文件；各功能模組在自己的 branch 開發。

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

主辦方官方資料在專案中分成兩類保存：

```text
data_source/   # 可被讀成 TrafficSnapshot 的時序、事件、路網資料
sop/           # 官方 SOP 規則文件
```

## 核心功能模組

| 模組 | 名稱 | 程式運算負責 | LLM 負責 |
|---|---|---|---|
| 1 | Dynamic Time-Series Dashboard | 依時間軸讀取並展示車流、人流資料；判斷 SOP 預警門檻；觸發自動彈窗 | 產生趨勢異常摘要與預警提示 |
| 2 | Live Incident Response | 注入 `live_incidents.json`；在 60 秒內完成路網重規劃；避開容量不足或飽和路段 | 產生導引建議文字 |
| 3 | Interactive Strategic Advisory | 提供 Dashboard 旁對話視窗與對話歷史；讀取 SOP、使用者假設與當前播放快照 | 使用者明講的值視為 what-if 假設，其餘現況由 `TrafficSnapshot` 補足，回答結論、建議處置與後續確認 |
| 4 | Reasoning & Explainability | 計算 SOP 分級、替代道路排除理由、ETE 公式 | 解釋判定依據、數據佐證與 ETE 結果 |
| 5 | Multilingual Notification | 自動偵測基地台漫遊率，判斷是否達 30% 門檻 | 產生多國語言告警文字 |

## 目前檔案結構

```text
.
├── data_source/                   # 主辦方官方時序/事件/路網資料
│   ├── city_traffic_flow.csv       # 車流時間序列
│   ├── signaling_crowd_density.csv # 人流 / 基地台資料
│   ├── road_network_geometry.json  # 路網、容量、替代道路
│   └── live_incidents.json         # 突發事件資料
├── data/
│   ├── __init__.py
│   └── snapshot.py                 # 讀 data_source，產生 TrafficSnapshot
├── shared/
│   ├── __init__.py
│   ├── schemas.py                  # 共用 schema
│   └── lookup.py                   # 路名、站名、場館別名查詢
├── docs/
│   ├── shared_data_contract.md     # 共用資料說明
│   └── module3_advisor_architecture.md
├── sop/
│   └── emergency_traffic_sop.txt   # 主辦方官方 SOP 七條應變規則
├── app.py                          # 模組 3 demo API
├── module3_advisor/                # 模組 3 實作
├── llm/                            # LLM 抽象層
├── static/                         # 模組 3 demo UI
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

## 環境變數

本機開發先複製範本：

```bash
cp .env.example .env
```

預設 `LLM_MODE=mock`，不需要 API key，適合離線 demo 與前後端測試。

若要接真 LLM：

```text
LLM_MODE=anthropic
ANTHROPIC_API_KEY=你的 Anthropic key
```

或：

```text
LLM_MODE=bedrock
BEDROCK_REGION=us-east-1
BEDROCK_MODEL_ID=anthropic.claude-3-5-sonnet-20241022-v2:0
```

`.env` 已被 `.gitignore` 排除，請不要提交任何真實 API key 或 AWS 憑證。

Bedrock 補充設定：

```text
# 若模型需要 inference profile，可填 us / global / eu / apac
BEDROCK_INFERENCE_PREFIX=

# 遇到 Bedrock throttling / quota error 時重試
BEDROCK_MAX_RETRIES=3
BEDROCK_RETRY_DELAY_SECONDS=2
```

例如正式環境要求 cross-region inference 時，可設定：

```text
BEDROCK_INFERENCE_PREFIX=us
```

系統會把 model id 組成 `us.anthropic...` 形式；若 `BEDROCK_MODEL_ID` 已經自己寫成 `global.xxx` 或 `us.xxx`，就不會重複加前綴。

目前程式直接讀系統環境變數；若使用 `.env`，啟動前可先執行：

```bash
set -a
source .env
set +a
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

## 模組 3 demo 啟動

在 `module-3-advisory` 分支可啟動模組 3 demo：

```bash
python3 -m uvicorn app:app --reload --port 8000
```

開啟：

```text
http://localhost:8000
```


## 常用指令

查看目前分支與檔案狀態：

```bash
git status
git branch
```

更新本機 main：

```bash
git switch main
git pull origin main
```

建立自己的功能分支：

```bash
git switch -c 分支名字
```

提交變更：

```bash
git status
git add <file-or-folder>
git commit -m "Describe the change"
```

推到 GitHub：

```bash
git push origin <branch-name>
```
