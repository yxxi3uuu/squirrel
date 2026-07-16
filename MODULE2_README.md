# 模組2：突發事件注入與處置 (Live Incident Response)

> Branch: `module-2-incident-response`
> Version: v2.0（對齊 main 共用架構）




## 此文件應該要說明清楚的事情


- 模組2的每個檔案在哪裡、是做什麼的
- SOP 規則引擎（`sop_engine.py`）每個函式的邏輯
- 前端每個元件負責顯示什麼
- 整合時需要看哪些介面、注意哪些已知問題

<br><br>

## 目錄
1.  [概覽](#概覽)
2.  [模組2的檔案地圖](#模組2的檔案地圖)
3.  [快速啟動](#快速啟動)
4.  [API端點](#api-端點)
5.  [依賴的 main 分支共用元件](#依賴的-main-分支共用元件)
6.  [SOP 規則引擎詳解](#sop-規則引擎詳解backendservicessop_enginepy)
7.  [Ollama LLM 說明](#ollama-llm-說明backendservicesllm_mockpy)
8.  [In-memory 事件暫存](#in-memory-事件暫存backendstoreincident_storepy)
9.  [前端說明](#前端說明frontendsrc)
10. [三個驗收測試案例](#三個驗收測試案例backendteststest_sop_enginepy)
11. [與其他模組的整合介面](#與其他模組的整合介面)
12. [待確認事項](#待確認事項)
13. [其他補充](#其他補充)

> ⚠️ **v2.1 新增問題（待釐清）** — 詳見第12節「待確認事項」第4、5點

<br><br>

## 概覽

本模組負責「突發事件注入後的 SOP 規則判斷」。
流程如下：

```
前端注入一筆事件
     ↓
POST /api/incidents/inject
     ↓
sop_engine.process_incident(incident, snapshot)
     ↓
List[TriggerDecision]（0 到多筆）
     ↓
回傳給前端 / 供其他模組消費
```


### 負責的 SOP 條款

| 條款 | 名稱 | 說明 |
|---|---|---|
| SOP-1 | 壅塞分級 | 僅在事件牽涉 RD_TPE_001 或 RD_TPE_002 時順帶計算 |
| SOP-2 | 事故與路障應變 | 核心：路網重規劃、選出主/次疏散路徑、計算 ETE、產出 CMS 文字 |
| SOP-5 | 號誌故障應變 | 計算所需警力人數、計算 ETE、產出 CMS 文字 |
| SOP-7 | ETE 公式 | 內嵌在 SOP-2 / SOP-5 結果內，不獨立成一筆 TriggerDecision |

**不負責的條款：** SOP-3、SOP-4（屬模組3）；SOP-6（屬模組5）



<br><br>

## 模組2的檔案地圖

```
squirrel/
│
├── backend/                          ← Python / FastAPI 後端
│   ├── main.py                       ← FastAPI app 入口，設定 CORS、掛載 router
│   ├── requirements.txt              ← 後端專用依賴（fastapi、uvicorn、pydantic 等）
│   │
│   ├── routers/
│   │   └── incidents.py              ← /api/incidents/* 所有 HTTP 端點定義
│   │
│   ├── services/
│   │   ├── sop_engine.py             ← ★ SOP 規則引擎核心（純函式，無副作用）
│   │   └── llm_mock.py               ← Mock LLM 文字生成 + 供未來接真實 LLM 的 Prompt 模板
│   │
│   ├── store/
│   │   └── incident_store.py         ← In-memory 暫存已注入事件（process 生命週期內有效）
│   │
│   └── tests/
│       └── test_sop_engine.py        ← 規格書三個驗收測試案例（可直接執行）
│
├── frontend/                         ← React / Vite 前端
│   ├── vite.config.js                ← Vite 設定，含 /api proxy → localhost:8002
│   ├── package.json                  ← 前端依賴（react、leaflet 等）
│   ├── index.html                    ← HTML 進入點
│   │
│   └── src/
│       ├── main.jsx                  ← React 掛載進入點（ReactDOM.createRoot）
│       ├── App.jsx                   ← 主頁面佈局：Tab 切換、狀態管理、頁面組合
│       ├── index.css                 ← 全域樣式重設
│       │
│       ├── api/
│       │   └── client.js             ← 所有對後端 API 的 fetch 呼叫封裝
│       │
│       ├── components/
│       │   ├── DecisionCard.jsx      ← ★ 渲染 TriggerDecision 陣列（核心展示元件）
│       │   ├── IncidentInjectorPanel.jsx  ← 事件注入面板（情境/自訂 兩個 Tab）
│       │   ├── SegmentStatusTable.jsx     ← 所有路段狀態表格 + 本次事件角色標記
│       │   ├── SLATimer.jsx               ← 60 秒 SLA 計時器
│       │   ├── TrafficDashboard.jsx       ← 交通地圖頁整合元件（含統計卡片）
│       │   ├── TrafficMap.jsx             ← Leaflet 互動地圖（路段、站點、事件標記）
│       │   ├── CrowdPanel.jsx             ← 人流密度 + 事件卡片側欄
│       │   └── TimelineSlider.jsx         ← 時間軸播放控制器
│       │
│       └── data/
│           └── trafficData.js        ← 前端靜態資料（路段幾何、人流序列、事件清單）
│
├── data_source/                      ← 官方原始資料（main 分支維護，模組2 唯讀）
│   ├── city_traffic_flow.csv         ← 車流時間序列（速度、車數、飽和度）
│   ├── signaling_crowd_density.csv   ← 人流站點時間序列（人數、成長率、漫遊率）
│   ├── road_network_geometry.json    ← 路段靜態屬性（容量、替代路段、路口清單）
│   └── live_incidents.json           ← 內建情境事件（注入用範本）
│
├── data/
│   └── snapshot.py                   ← 讀取 data_source，產出 TrafficSnapshot dict
│
├── shared/
│   ├── schemas.py                    ← 共用資料模型（TrafficSnapshot、TriggerDecision 等）
│   └── lookup.py                     ← 路名/站名別名查詢工具
│
├── sop/
│   └── emergency_traffic_sop.txt     ← 官方 SOP 七條應變規則原文
│
├── docs/
│   └── shared_data_contract.md       ← 跨模組資料契約說明
│
├── requirements.txt                  ← 共用 Python 依賴
├── README.md                         ← 專案總覽（共用，所有模組都要看）
└── MODULE2_README.md                 ← 本文件
```



<br><br>

## 快速啟動


### 1. 安裝依賴

```bash
# 從專案根目錄執行
pip install -r requirements.txt
pip install -r backend/requirements.txt

cd frontend
npm install
```


### 2. 啟動 Backend

```bash
# 從專案根目錄執行
uvicorn backend.main:app --reload --port 8002
```

啟動後可在 `http://localhost:8002/docs` 看到 Swagger UI，直接在瀏覽器測試 API。


### 3. 啟動 Frontend

```bash
cd frontend
npm run dev
```

瀏覽器開啟 `http://localhost:5173`。
Vite 會把 `/api` 開頭的請求自動代理到 `localhost:8002`，不需要額外設定。


### 4. 執行驗收測試

```bash
# 從專案根目錄執行
python -m backend.tests.test_sop_engine
```


<br><br>

## API 端點

完整 Swagger 文件在 `http://localhost:8002/docs`，以下是快速對照：

| 方法 | 路徑 | 說明 | 回傳 |
|---|---|---|---|
| `POST` | `/api/incidents/inject` | 注入一筆事件，執行 SOP 規則引擎 | `{ decisions: TriggerDecision[], processing_time_ms: float }` |
| `GET` | `/api/incidents/samples` | 取得 live_incidents.json 內建事件清單 | `List[dict]` |
| `GET` | `/api/incidents/active` | 取得已注入、尚未 resolve 的事件 | `List[dict]` |
| `POST` | `/api/incidents/{event_id}/resolve` | 清除已處理事件（demo 用） | `{ status, event_id }` |
| `GET` | `/health` | 健康檢查 | `{ status: "ok", module: "..." }` |


### inject 端點的 Request Body 範例

```json
{
  "event_id": "TPE_2026_ACC_001",
  "type": "Road_Collapse_Accident",
  "location": "光復南路與忠孝東路口南側",
  "affected_segment": "RD_TPE_002",
  "affected_road": null,
  "status": "Closed",
  "severity": "Critical",
  "description": "地下管線爆裂導致路面塌陷",
  "timestamp": "2026-05-20 22:10"
}
```

`inject` 端點會自動找到 `<= timestamp` 的最新可用快照時間，不需要傳入整點時間。



<br><br>

## 依賴的 main 分支共用元件

**模組2 不自己讀取 CSV/JSON、不自己建路名對照表**，全部呼叫 main 分支的共用層：


### `data/snapshot.py`

```python
from data.snapshot import get_snapshot, available_timestamps

snapshot = get_snapshot("2026-05-20 22:00")  # 回傳 TrafficSnapshot dict
available_timestamps()  # ['2026-05-20 17:00', ..., '2026-05-20 23:30']
```

注意：`get_snapshot()` 需要傳入 `available_timestamps()` 中存在的時間點，
若傳入不存在的時間（如 22:10）會拋 `ValueError`。
**模組2 的 router 和測試腳本都有自動找 `<=` 最近可用時間的邏輯，不用自己處理。**


### `shared/schemas.py`

定義所有跨模組的資料結構，模組2 的輸出一律是 `TriggerDecision` 物件。
整合時最重要的欄位：

```python
class TriggerDecision:
    triggered: bool              # 是否觸發 SOP
    sop_clause: str | None       # "SOP-1" / "SOP-2" / "SOP-5" / None
    clause_name: str | None      # 條款名稱（中文）
    entity_id: str | None        # RD_ 或 BS_ ID
    entity_name: str | None      # 路段或站點中文名
    basis: str                   # 詳細判定依據（含數值、路徑選擇理由，供模組4引用）
    actions: List[str]           # 建議執行動作（字串清單）
    cascade_checks: List[str]    # 連動提示或非觸發說明
    severity: "info"|"yellow"|"red"|"critical" | None
    primary_route: str | None    # 主疏散路段 segment_id（SOP-2 才有）
    secondary_routes: List[str]  # 次要疏散路段 segment_id 清單（SOP-2 才有）
    excluded_routes: List[dict]  # [{"segment_id": ..., "reason": ...}]（SOP-2 才有）
    ete_minutes: float | None    # 預計恢復時間（SOP-2 / SOP-5 才有）
    cms_text: str | None         # CMS 電子看板文字（40 字以內）
    guidance_text: str | None    # ★ v2.1 新增：指揮官引導文字（由 Ollama 生成，失敗時 fallback 到 mock）
    guidance_source: str | None  # ★ v2.1 新增："llm" 或 "mock"，標記上方文字是否由 Ollama 成功產生
    timestamp: str | None        # 事件時間戳
```


### Schema 適配說明

`shared/schemas.py` 的欄位型別與規格書原設計有三處差異，
本模組統一做以下適配，**不修改 shared/schemas.py**：

| 欄位 | schemas.py 定義 | 本模組處理方式 |
|---|---|---|
| `severity` | `Literal["info","yellow","red","critical"]` | `_map_severity()` 負責轉換（A→critical, High→red 等） |
| `actions` | `List[str]` | 每個 action 序列化為易讀字串 |
| `primary_route` | `Optional[str]` | 只存 segment_id；詳細路段資訊（名稱、飽和度）寫進 `basis` |


### `shared/lookup.py`

```python
from shared.lookup import find_entities_in_text

matches = find_entities_in_text("光復南路北側", snapshot)
# 回傳 [{ "entity_type": "road_segment", "entity_id": "RD_TPE_002", ... }]
```

模組2 在 `resolve_upstream_downstream()` 中使用此工具把事故 location 文字
轉換成 segment_id，進而判斷上下游位置。



<br><br>

## SOP 規則引擎詳解（`backend/services/sop_engine.py`）

這是模組2的核心，也是最複雜的一個檔案。以下逐一說明每個函式在做什麼。


### 整體架構

```
process_incident(incident, snapshot)          ← 對外唯一入口
    ├── build_sop1_decision(...)              ← SOP-1 壅塞分級
    ├── is_sop2_triggered(...)
    │   └── build_sop2_decision(...)          ← SOP-2 事故應變
    │       └── plan_accident_response(...)   ← 選出主/次疏散路徑
    │           └── resolve_upstream_downstream(...)  ← 判斷上下游
    └── is_sop5_triggered(...)
        └── build_sop5_decision(...)          ← SOP-5 號誌故障應變

calculate_ete(...)                            ← ETE 公式（被 SOP-2/5 呼叫）
mock_generate_cms_text(...)                   ← CMS 文字（被 SOP-2/5 呼叫）
```

---


### `process_incident(incident, snapshot)`

**對外唯一入口。** 接收一筆事件 dict 和當前快照 dict，
依序跑 SOP-1 → SOP-2 → SOP-5 的判斷，收集所有觸發的 `TriggerDecision`。

若三條 SOP 都沒有觸發，回傳一筆 `triggered=False` 的說明物件（不回傳空陣列），
讓前端能區分「正常處理但不在本模組範圍」vs「API 錯誤」。

```python
decisions = process_incident(incident, snapshot)
# 回傳 List[TriggerDecision]，長度 1 到 3
```

---


### `build_sop1_decision(incident, snapshot)`

**SOP-1 壅塞分級判定。**

觸發條件：事件的 `affected_segment` 必須是 `RD_TPE_001` 或 `RD_TPE_002` 這兩條「城市應變觸發路段」。
這兩條是官方 SOP 定義的特殊路段，其他路段的壅塞不走這條邏輯。

判定門檻（`classify_congestion_level`）：
- 飽和度 `>= 0.95` → A 級（`critical`）
- 飽和度 `>= 0.85` → B 級（`yellow`）
- 其他 → Normal，**不產出 TriggerDecision**

A 級會在 `cascade_checks` 加一條「同時觸發 SOP-2」的提示。

---


### `is_sop2_triggered(incident)`

**SOP-2 觸發條件檢查（三個條件全部成立才回傳 True）：**

1. `status` 是 `Closed` / `Blocked` / `Restricted` 其中之一
2. `severity` 是 `High` 或 `Critical`
3. `affected_segment` 是 `RD_` 開頭（道路路段，不是 BS_ 人流站點）

只要有一條不符合就不觸發，一筆都不產出。

---


### `build_sop2_decision(incident, snapshot)`

**SOP-2 事故與路障應變的主要邏輯。**

流程：
1. 呼叫 `plan_accident_response()` 取得疏散規劃（主/次路徑、排除清單）
2. 呼叫 `calculate_ete()` 計算預計恢復時間
3. 呼叫 `mock_generate_cms_text()` 產出 CMS 文字
4. 把上述結果組裝成 `basis` 字串（詳細推理，供模組4解釋鏈引用）
5. 回傳 `TriggerDecision`

`primary_route` 和 `secondary_routes` 只存 segment_id 字串，
完整的路段名稱、飽和度、容量資訊都寫在 `basis` 欄位。

---


### `plan_accident_response(incident, snapshot)`

**從事故路段的替代路段清單中，依 SOP 規則選出最佳疏散路徑。**

篩選分三個階段（依序淘汰）：

| 階段 | 條件 | 不符合就 |
|---|---|---|
| 1 | `capacity_vph >= 1000` | 加進排除清單，附「容量不足」理由 |
| 2 | 與事故路段有直接路口相交 | 加進排除清單，附「不相交」理由 |
| 3 | 位於事故點上游（依 `resolve_upstream_downstream` 判定） | 只能當次要疏散，不能當主疏散 |

在通過前三關的上游候選中，取 `saturation_score` 最低的作為主疏散路徑。

若無法判定上下游（`resolve_upstream_downstream` 回傳 None），
進入「保守模式」：把路段 intersections 中所有路口都視為上游。

---


### `resolve_upstream_downstream(incident, segment, snapshot)`

**從事故 location 文字，判斷事故發生在路段的哪個路口附近，切出上游/下游路口集合。**

原理：每條路段的 `intersections` 欄位按照「上游→下游」排序（由 main 分支資料保證）。
這個函式用 `find_entities_in_text()` 逐一比對 location 文字提到了哪個路口，
找到最後一個命中的作為「錨點」。

方位詞判斷依路段的 `flow_direction` 動態決定：
- 南北向路段 → 看「北側/以北」（上游）vs「南側/以南」（下游）
- 東西向路段 → 看「西側/以西」（上游）vs「東側/以東」（下游）
- 無法辨識軸向 → 只看「上游/下游」通用詞

若 location 文字裡找不到任何路口名稱，回傳 `(None, None)`，
由上層的 `plan_accident_response()` 進入保守模式。

> 這個函式有「段別後綴寬鬆比對」的能力：「忠孝東路口」可以匹配「忠孝東路四段」路口，
> 因為中文地址常省略段別。

---


### `calculate_ete(incident, primary_seg_id, snapshot)`

**依 SOP 第7條公式計算預計恢復時間（ETE）。**

公式：`ETE = base_clearance(依 severity) + max(0, (平均飽和度 - 0.5) × 60)`

base_clearance 對照表：
- Critical → 60 分鐘
- High → 40 分鐘
- Medium → 20 分鐘
- Low → 10 分鐘

平均飽和度的計算範圍：事故路段 + 主疏散路段（若有）。
若飽和度低於 0.5，壅塞加罰為 0（不扣負分）。

回傳 dict 包含完整的計算明細（`base_clearance`、`avg_saturation`、`congestion_penalty`），
供 `basis` 欄位組裝說明文字用。

---


### `mock_generate_cms_text(incident, primary_route, ete_minutes)`

**產出 CMS 電子看板文字（40 字以內）。**

目前是純字串格式化，不呼叫外部 API。
有主疏散路徑時：`{地點}封閉，請改道{替代路段}，預計延誤{ETE}分鐘`
無主疏散路徑時：`{地點}事故，請注意行車安全，預計延誤{ETE}分鐘`

---


### `is_sop5_triggered(incident)`

**SOP-5 觸發條件（OR 關係，任一成立即觸發）：**

- `type == "Power_Failure"`，**或**
- `description` 含「號誌失效」，**或**
- `description` 含「號誌故障」

---


### `build_sop5_decision(incident, snapshot)`

**SOP-5 號誌故障應變。**

主要計算所需警力人數：每個受影響路口派遣 2 名警力。
路口數從事故路段的 `intersections` 清單長度取得。

ETE 同樣用 `calculate_ete()` 計算，使用相同的 SOP-7 公式。
沒有疏散路徑規劃（不選主/次疏散），只有警力派遣和 CMS 更新兩個 actions。

---


### `_map_severity(raw)`

**把原始 severity 字串映射到 schema 允許的值。**

| 輸入 | 輸出 |
|---|---|
| "Critical" | "critical" |
| "High" | "red" |
| "Medium" | "yellow" |
| "Low" | "info" |
| "A"（SOP-1 A 級） | "critical" |
| "B"（SOP-1 B 級） | "yellow" |


<br><br>

## Ollama LLM 說明（`backend/services/llm_mock.py`）

> ★ v2.1：已接入本機 Ollama，不再是純 mock。

### 目前狀態

本機使用 `qwen2.5:1.5b` 模型（因硬體限制選用輕量版本）。
每次 SOP-2 / SOP-5 觸發後，後端會呼叫本機 Ollama 產生 `guidance_text`（指揮官引導文字）。
Ollama 不可用時自動 fallback 到 mock 格式化字串，並以 `guidance_source` 欄位標記來源。

### 設定

```python
# backend/services/llm_mock.py
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")  # 本機預設
OLLAMA_MODEL    = os.getenv("OLLAMA_MODEL",    "qwen2.5:1.5b")
OLLAMA_TIMEOUT  = float(os.getenv("OLLAMA_TIMEOUT", "10"))  # 秒
```

EC2 部署時只需設定環境變數，程式邏輯不變：
```bash
export OLLAMA_BASE_URL=http://<ec2-private-ip>:11434
```

### 對外介面

```python
from backend.services.llm_mock import generate_guidance

result = generate_guidance(decision)
# 回傳 {"guidance_text": "...", "_source": "llm" | "mock"}
```

`_source` 的值由 `sop_engine` 存入 `TriggerDecision.guidance_source`，
前端 `DecisionCard` 讀取後顯示 **LLM** 或 **MOCK** badge。

### Prompt 設計

System prompt 要求 LLM 只做措辭轉換，不重新判斷 SOP 數字，
輸出一段 ≤100 字的指揮官引導說明。

```
輸出：{"guidance_text": "..."}
```

### Fallback 觸發條件

- Ollama 連線失敗（服務未啟動）→ `ConnectError`
- 呼叫超過 10 秒 → `TimeoutException`
- 回傳非合法 JSON → `JSONDecodeError`
- 缺少 `guidance_text` 欄位 → `ValueError`
- HTTP 錯誤（4xx/5xx）→ `HTTPStatusError`

### 哪些 SOP 條款會呼叫 LLM

| 條款 | 呼叫 LLM | 說明 |
|---|---|---|
| SOP-1 | ❌ | 壅塞分級只有規則數值，無需引導文字 |
| SOP-2 | ✅ | 事故應變，呼叫一次 `generate_guidance()` |
| SOP-5 | ✅ | 號誌故障，呼叫一次 `generate_guidance()` |

注意：一個事件若同時觸發 SOP-1 + SOP-2，只有 SOP-2 那筆會呼叫 LLM，
SOP-1 卡片不顯示 `guidance_text`，前端的 badge 區塊也不會出現。


<br><br>

## In-memory 事件暫存（`backend/store/incident_store.py`）

注入的事件存在 Python process 的記憶體中，**重啟 backend 就清空**。

| 函式 | 說明 |
|---|---|
| `inject(incident)` | 儲存一筆事件 |
| `get_active()` | 取得所有尚未 resolve 的事件 |
| `resolve(event_id)` | 移除一筆事件，回傳 bool（True=找到並移除） |
| `get(event_id)` | 查詢單筆事件 |
| `clear_all()` | 清空所有事件（測試用） |

> **已知風險**：此處儲存的事件與其他模組透過 `get_snapshot()` 查到的 incidents 不同步。
> 詳見本文件最後的「待確認事項」。


<br><br>

## 前端說明（`frontend/src/`）

前端用 React 18 + Vite 建置，完全用 inline style 不依賴 CSS 框架，深色主題。


### 頁面結構

App 有兩個 Tab：

| Tab | 說明 |
|---|---|
| 🚨 事件處置 | 主要操作頁。左欄注入面板 + SLA 計時器；右欄顯示 SOP 決策卡片 + 路段狀態表 |
| 🗺️ 交通地圖 | 靜態資料的時間軸回放地圖，不需要 backend 運行 |

---


### `App.jsx`

主頁面元件。管理全域狀態：

- `decisions`：最近一次注入回傳的 `TriggerDecision[]`
- `currentIncident`：當前注入的事件（用來在路段表格高亮事故路段）
- `loading` / `error`：注入過程的狀態
- `startTime` / `processingMs`：SLA 計時所需的時間戳

當 `IncidentInjectorPanel` 呼叫 `onInject(incident)` 時，
App 呼叫 `api/client.js` 的 `injectIncident()`，
拿到結果後更新 `decisions` 和 `processingMs`，
觸發 `DecisionCard` 和 `SegmentStatusTable` 重新渲染。

---


### `components/IncidentInjectorPanel.jsx`

**事件注入面板，分兩個 Tab：**

- **情境事件 Tab**：mount 時自動呼叫 `GET /api/incidents/samples` 載入內建事件清單。
  點擊卡片選取，按「注入選取事件」送出。
  每張卡片顯示 event_id、type、severity、affected_segment、location 描述。

- **自訂事件 Tab**：表單可填入所有欄位。
  預設值是 `RD_TPE_001`、`2026-05-20 22:10`，可直接修改測試。
  `affected_road` 欄位可選填，不填時後端會自動忽略。

---


### `components/DecisionCard.jsx`

**最核心的展示元件，把 `TriggerDecision[]` 渲染成卡片清單。**

每張卡片頂部有一個醒目區塊（`HighlightZone`），**只在 SOP-2 / SOP-5 觸發時顯示**：
- 🟡 **CMS 電子看板**：黃色大字，顯示 `cms_text`
- 🔵 **指揮官引導**：藍/灰色大字，顯示 `guidance_text`，右側有 **LLM** 或 **MOCK** badge
  - `LLM` badge（藍色閃電）：Ollama 成功生成
  - `MOCK` badge（灰色方塊）：Ollama 不可用，使用格式化字串 fallback

其餘區塊依序排在醒目區塊下方：

| `sop_clause` | 顯示的區塊 |
|---|---|
| `triggered=false` | 灰階卡片，只顯示 basis + cascade_checks，不顯示醒目區塊 |
| `SOP-1` | 判定依據 + 建議動作 + 連動提示（無 CMS / 指揮官引導） |
| `SOP-2` | **醒目區塊**（CMS + 指揮官引導）+ 判定依據 + 建議動作 + 疏散路徑規劃 + ETE + 連動提示 |
| `SOP-5` | **醒目區塊**（CMS + 指揮官引導）+ 判定依據 + 建議動作 + ETE |

條款顏色：SOP-1 紫色、SOP-2 粉紅色、SOP-5 金色。
Severity dot 顏色：critical 紅、red 粉紅、yellow 黃、info 藍。

`RouteInfo` 子元件負責渲染疏散路徑規劃區塊：
- 綠色框 = 主疏散路徑
- 藍色框 = 次要疏散路徑（下游）
- 灰色清單 = 排除候選（含排除理由）

---


### `components/SegmentStatusTable.jsx`

**顯示快照中所有路段的即時狀態，並標記本次事件的路段角色。**

注意：目前 `POST /api/incidents/inject` 回傳的 body 不包含快照資料，
所以此元件收到的 `segments` prop 通常為 null，表格會顯示「尚無快照資料」。
（整合時若要讓這個表格顯示資料，需要額外從後端取快照，或修改 inject API 一起回傳快照）

路段角色標記邏輯（`roleLabel` 函式）：
- `incidentSegmentId` 路段 → 標「事故路段」（紅色）
- `SOP-2.primary_route` 路段 → 標「主疏散」（綠色）
- `SOP-2.secondary_routes` 中的路段 → 標「次要疏散」（藍色）
- `SOP-2.excluded_routes` 中的路段 → 標「已排除」（灰色）

飽和度欄位有視覺進度條，顏色依飽和度高低變化（綠→黃→紅）。

---


### `components/SLATimer.jsx`

**SLA 60 秒計時器，注入後開始計時，API 回應後顯示後端實際運算時間。**

- 注入中：每 100ms 更新顯示「已耗時 X.X 秒」
- 回應後：改顯示「後端運算 X.X ms」，並顯示「✓ SLA 達標」或「⚠ 超過 60 秒 SLA」

顯示的後端時間來自 API 回傳的 `processing_time_ms` 欄位（純後端 SOP 規則運算時間，不含網路往返）。

---


### `components/TrafficDashboard.jsx`

**「交通地圖」Tab 的整合元件。** 把 TrafficMap、TimelineSlider、CrowdPanel 組裝在一起。

從 `trafficData.js` 讀取靜態資料，不需要後端。
上方有四個統計卡片：嚴重壅塞路段數、壅塞路段數、平均車速、最高飽和度。
支援中/英文切換（右上角按鈕）。

---


### `components/TrafficMap.jsx`

**Leaflet 互動地圖，以信義區為中心（zoom 15）。**

地圖上有三種元素：
1. **路段 polyline**：顏色和線條粗細依飽和度更新，點擊顯示詳細 popup
2. **站點 marker**：捷運站（青色圓點）、場館/地標（粉色方點）、公車轉運站（金色圓點）
3. **事件 marker**：紅色閃爍圓點，點擊顯示事件詳情

支援底圖切換：「示意圖」（CartoDB 深色）vs「衛星圖」（Esri World Imagery）。

所有路段和站點在 mount 時一次性建立 Leaflet layer，
之後只透過 `setStyle()`、`setPopupContent()` 更新內容，不重建 DOM（效能考量）。

---


### `components/TimelineSlider.jsx`

**時間軸播放控制器。**

從 `trafficData.js` 的 `TIME_STEPS`（17:00 ~ 23:30，共 22 個時間點）驅動整個地圖頁。

功能：播放/暫停、逐步前進/後退、拖拉 slider、重置到開始。
播放速度：每 800ms 前進一步。
已知有事件的時間點（22:10、22:20、22:30）旁邊會顯示紅點提示。

---


### `components/CrowdPanel.jsx`

**人流密度卡片 + 事件清單側欄。**

上半部依 `trafficData.js` 的 `CROWD_DENSITY` 資料，顯示每個有資料的站點的人數和成長率：
- 成長率 > 30% → 紅色（警示）
- 成長率 > 0% → 橙色
- 成長率 <= 0% → 綠色

下半部列出當前時間點之前發生的所有事件（`getActiveIncidents(currentTs)`）。

---


### `api/client.js`

所有對後端 `/api/incidents/*` 的 fetch 封裝。
請求走 Vite proxy（`/api` → `localhost:8002`），不用寫完整 URL。

| 函式 | 對應端點 |
|---|---|
| `injectIncident(incident)` | `POST /api/incidents/inject` |
| `getSamples()` | `GET /api/incidents/samples` |
| `getActiveIncidents()` | `GET /api/incidents/active` |
| `resolveIncident(eventId)` | `POST /api/incidents/{eventId}/resolve` |

---


### `data/trafficData.js`

前端地圖頁用的靜態資料，包含：
- `ROAD_SEGMENTS`：15 條路段的幾何座標、容量、替代路段清單
- `STATIONS`：9 個捷運站/地標的座標和類型
- `INCIDENTS`：3 個內建情境事件（含地圖座標）
- `TRAFFIC_FLOW`：各時間點的路段速度/車數/飽和度/狀態
- `CROWD_DENSITY`：各時間點的站點人數和成長率
- `TIME_STEPS`：去重排序後的所有時間點
- `getSegmentStateAt(ts)`：取得 `<= ts` 的最新路段狀態 map
- `getCrowdStateAt(ts)`：取得 `<= ts` 的最新人流狀態 map
- `getActiveIncidents(ts)`：取得 `<= ts` 已發生的事件清單

> 這份靜態資料與 backend 的 `data_source/*.csv` 是**不同的**兩份資料。
> 前者是為了讓地圖頁在不需要 backend 的情況下也能運作；
> 後者才是 SOP 規則引擎實際使用的官方資料來源。


<br><br>

## 三個驗收測試案例（`backend/tests/test_sop_engine.py`）

| 案例 | 事件 | 說明 | 預期 decisions 數量 |
|---|---|---|---|
| A | `TPE_2026_ACC_001` 路面塌陷 | RD_TPE_002 封閉（Critical），同時觸發 SOP-1 和 SOP-2 | 2 |
| B | `TPE_2026_EVT_003` 號誌故障 | Power_Failure type，觸發 SOP-5（警力 6 人） | 1 |
| C | `TPE_2026_EVT_002` 捷運人群推擠 | affected_segment 是 BS_ 開頭，不符合 SOP-2 條件，triggered=False | 1 |

**案例A 關鍵數值：**
- SOP-1 entity_id = `RD_TPE_002`，severity = `critical`
- SOP-2 primary_route = `RD_TPE_004`（市民大道四段，飽和度最低的上游路段）
- ETE ≈ 83.4 分鐘（base=60 + 壅塞加罰=23.4）

**案例B 關鍵數值：**
- SOP-5 entity_id = `RD_TPE_007`（松高路，3 個路口 × 2 人 = 6 名警力）
- ETE ≈ 41 分鐘（base=20 + 壅塞加罰）

**案例C 關鍵數值：**
- `triggered = False`，`sop_clause = None`
- `cascade_checks` 含 `RD_TPE_001` 間接影響備註


<br><br>

## 與其他模組的整合介面


### 其他模組「消費」模組2 結果

| 消費方 | 需要什麼 | 去哪裡找 |
|---|---|---|
| 模組1（Dashboard） | `List[TriggerDecision]` 用來顯示決策卡片 | 呼叫 `POST /api/incidents/inject`，或直接 import `sop_engine.process_incident` |
| 模組3（對話顧問） | `process_incident()` 等純函式 | 直接 `from backend.services.sop_engine import process_incident` |
| 模組4（解釋鏈） | `TriggerDecision.basis`（詳細推理文字） + `excluded_routes` + `ete_minutes` | `basis` 欄位已含完整數值和判斷理由 |
| 模組5（多語通報） | `TriggerDecision.cms_text` | 直接翻譯 `cms_text` 欄位即可 |


### 整合時必須知道的事

1. **一個事件可能回傳多筆 TriggerDecision**（陣列長度 1~3），請勿假設一對一。
2. `triggered=False` 的那筆不算錯誤，是正常的「超出本模組範圍」說明物件。
3. `primary_route` / `secondary_routes` 只存 segment_id 字串，完整路段資訊要去 `TriggerDecision.basis` 或快照查。
4. `processing_time_ms` 是後端純規則運算時間（通常 < 5ms），不含網路延遲。


<br><br>

## 待確認事項


### 1. `data/snapshot.py` 事件注入同步問題

**現狀：** `data/snapshot.py` 沒有提供 `inject_incident()` 共用函式。
`incident_store.py` 是本模組自己維護的 in-memory 清單。

**風險：** 若其他模組透過 `get_snapshot()` 查到的 `incidents` 清單，
不會包含透過本模組 API 注入的事件，兩邊會不同步。

**解法(若需要)：**  `data/snapshot.py` 補上 `inject_incident()` 共用函式後，
本模組的 `incident_store.py` 可改為呼叫共用函式，`incident_store.py` 就可以刪掉。


### 2. `shared/schemas.py` 欄位型別對齊

目前採「本模組自行適配，不改共用 schema」策略（見 Schema 適配說明）。
若要統一改 `TriggerDecision` 的欄位型別，需更新：
- `shared/schemas.py`（`severity`、`actions`、`primary_route` 型別）
- `backend/services/sop_engine.py` 中的 `_map_severity()` 等轉換邏輯


### 3. LLM 接入（已完成本機 Ollama，待 EC2 驗證）

本機已接入 Ollama（`qwen2.5:1.5b`，因硬體限制選用輕量版本）。
EC2 環境尚未開放，部署時設定 `OLLAMA_BASE_URL` 環境變數即可，不需改程式碼。


### 4. ⚠️ `guidance_text` 內容與 CMS 重複問題（待釐清）

**現象：** `guidance_text`（指揮官引導文字）和 `cms_text`（CMS 電子看板文字）的內容目前非常接近，
mock fallback 的版本幾乎就是把 SOP 條款 + 數值串在一起，跟 CMS 格式差不多。

**問題：**
- `cms_text` 是給**電子看板/簡訊**用的，格式固定（地點 + 改道建議 + 延誤分鐘），面向一般用路人
- `guidance_text` 應該是給**交通指揮官**看的，理論上應包含更多決策脈絡
  （例如：為什麼選這條疏散路徑、壅塞加罰怎麼算、連動哪條 SOP）

**待確認方向（二擇一）：**
1. **保留 `guidance_text` 並改善 Prompt**：調整 System prompt，要求 LLM 產出更偏「決策說明」而非「公告文字」的內容，強調引用 basis 裡的推理邏輯
2. **移除 `guidance_text`，只保留 `cms_text`**：若其他模組（模組3/4/5）不需要這個欄位，可直接刪掉以減少複雜度


### 5. `qwen2.5:1.5b` 模型輸出品質限制

目前本機使用的 `qwen2.5:1.5b` 是為了配合硬體規格選用的輕量版本。
但之後就可以改好棒棒的模型


<br><br>

## 其他補充


### 啟動 backend 但不跑前端時如何測試

Swagger UI 在 `http://localhost:8002/docs` 可以直接 POST 測試 inject 端點。
或用 curl：

```bash
curl -X POST http://localhost:8002/api/incidents/inject \
  -H "Content-Type: application/json" \
  -d "{\"event_id\":\"TEST_001\",\"type\":\"Road_Collapse_Accident\",\"location\":\"光復南路與忠孝東路口南側\",\"affected_segment\":\"RD_TPE_002\",\"status\":\"Closed\",\"severity\":\"Critical\",\"description\":\"測試事件\",\"timestamp\":\"2026-05-20 22:10\"}"
```


### 前端在沒有 backend 時也能運行

「交通地圖」Tab 的所有資料都來自 `frontend/src/data/trafficData.js` 靜態檔，
不需要 backend 運行。
只有「事件處置」Tab 注入事件時才需要 backend。