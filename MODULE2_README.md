# 模組2：突發事件注入與處置 (Live Incident Response)

> Branch: `module-2-incident-response`  
> Version: v2.0（對齊 main 共用架構）

---

## 概覽

本模組負責注入突發事件後，在 **60 秒 SLA** 內透過 SOP 規則引擎完成路網重規劃，
輸出 `List[TriggerDecision]` 供模組1/3/4/5 消費。

### 負責的 SOP 條款

| 條款 | 內容 | 說明 |
|---|---|---|
| SOP-1 | 壅塞分級 | 僅在事件牽涉 RD_TPE_001/002 時順帶計算 |
| SOP-2 | 事故與路障應變 | 核心：路網重規劃、ETE、CMS 文字 |
| SOP-5 | 號誌故障應變 | 警力派遣計算 |
| SOP-7 | ETE 公式 | 內嵌於 SOP-2/SOP-5，不獨立成一筆 |

不負責：SOP-3/4（模組3）、SOP-6（模組5）

---

## 依賴的 main 分支共用元件

本模組**不自己讀取 CSV/JSON、不自己建路名對照表**，一律呼叫 `main` 分支的共用元件：

### `data/snapshot.py`

```python
from data.snapshot import get_snapshot, available_timestamps

# 取得某時間點的完整快照（會自動找 <= timestamp 的最新資料）
snapshot = get_snapshot("2026-05-20 22:10")

# 查詢可用時間軸
available_timestamps()  # ['2026-05-20 17:00', ..., '2026-05-20 23:30']
```

**注意**：`get_snapshot()` 的 timestamp 參數必須是 `available_timestamps()` 中存在的時間點。
事件的 timestamp 若為非整點（如 22:20），本模組會自動找 `<=` 該時間的最新可用快照。

### `shared/schemas.py`

```python
from shared.schemas import TriggerDecision, TrafficSnapshot

# 本模組的所有輸出都是 TriggerDecision 物件
```

**Schema 適配說明（v2 與原規格書的差異）**：

`shared/schemas.py` 的 `TriggerDecision` 欄位型別與規格書原設計有差異，
本模組統一做以下適配，**不修改 shared/schemas.py**：

| 欄位 | schemas.py 定義 | 規格書原設計 | 本模組處理方式 |
|---|---|---|---|
| `severity` | `Literal["info","yellow","red","critical"]` | "A"/"B"/"Critical" 等 | 映射轉換（A→critical, High→red 等） |
| `actions` | `List[str]` | `List[dict]` | 每個 action dict 序列化為易讀字串 |
| `primary_route` | `Optional[str]` | `Optional[dict]` | 只存 segment_id；詳細資訊寫進 `basis` |
| `secondary_routes` | `List[str]` | `List[dict]` | 只存 segment_id 清單 |

### `shared/lookup.py`

```python
from shared.lookup import find_entities_in_text

# 從自然語言找路段/站點 ID
matches = find_entities_in_text("忠孝東路口南側", snapshot)
```

本模組在上下游判定（`resolve_upstream_downstream`）中使用此工具，
實作了「段別後綴寬鬆比對」——「忠孝東路口」可匹配「忠孝東路四段」。

---

## 檔案架構

```
squirrel/
├── backend/
│   ├── main.py                      # FastAPI app 入口
│   ├── requirements.txt             # Backend 依賴
│   ├── routers/
│   │   └── incidents.py             # /api/incidents/* 端點
│   ├── services/
│   │   ├── sop_engine.py            # SOP 規則引擎核心（純函式）
│   │   └── llm_mock.py              # Mock LLM 文字生成 + Prompt 模板
│   ├── store/
│   │   └── incident_store.py        # 暫存事件清單（見待確認事項1）
│   └── tests/
│       └── test_sop_engine.py       # 三個測試案例驗證腳本
└── frontend/
    ├── package.json
    ├── vite.config.js               # Vite + /api proxy 設定
    └── src/
        ├── App.jsx                  # 主頁面
        ├── api/client.js            # API 客戶端
        └── components/
            ├── DecisionCard.jsx     # TriggerDecision 陣列渲染（核心）
            ├── IncidentInjectorPanel.jsx  # 注入面板（情境/自訂兩個Tab）
            ├── SegmentStatusTable.jsx     # 15路段狀態 + 事件角色標記
            └── SLATimer.jsx         # 60秒 SLA 計時器
```

---

## 快速啟動

### 1. 安裝依賴

```bash
# 從專案根目錄
pip install -r requirements.txt
pip install -r backend/requirements.txt

cd frontend
npm install
```

### 2. 啟動 Backend

```bash
# 從專案根目錄
uvicorn backend.main:app --reload --port 8002
```

Swagger UI：`http://localhost:8002/docs`

### 3. 啟動 Frontend

```bash
cd frontend
npm run dev
```

瀏覽器開啟：`http://localhost:5173`

### 4. 執行測試案例

```bash
# 從專案根目錄
python -m backend.tests.test_sop_engine
```

---

## 測試案例驗證結果（規格書第10節）

| 案例 | 事件 | 預期陣列長度 | 實際 | 關鍵數值 |
|---|---|---|---|---|
| A | TPE_2026_ACC_001 路面塌陷 | 2 | ✅ 2 | SOP-1(critical) + SOP-2(主疏散RD_TPE_004, ETE=83.4分) |
| B | TPE_2026_EVT_003 號誌故障 | 1 | ✅ 1 | SOP-5(警力6人, ETE=41.0分) |
| C | TPE_2026_EVT_002 捷運人群（模糊） | 1 | ✅ 1 | triggered=False, cascade含RD_TPE_001備註 |

---

## API 端點

| 方法 | 路徑 | 說明 |
|---|---|---|
| POST | `/api/incidents/inject` | 注入事件，回傳 `List[TriggerDecision]` + `processing_time_ms` |
| GET | `/api/incidents/samples` | 取得 live_incidents.json 內建清單 |
| GET | `/api/incidents/active` | 已注入未 resolve 的事件 |
| POST | `/api/incidents/{event_id}/resolve` | 清除事件（demo 用） |
| GET | `/health` | 健康檢查 |

---

## 與其他模組的整合介面

| 消費方 | 提供 | 說明 |
|---|---|---|
| 模組1 Dashboard | `POST /api/incidents/inject` 回傳的 `List[TriggerDecision]` | 畫決策卡片 |
| 模組3 對話顧問 | `sop_engine.py` 內的純函式 | `process_incident`, `plan_accident_response` 等都是純函式，可直接 import |
| 模組4 解釋鏈 | `TriggerDecision.basis` + `excluded_routes` + `ete_minutes` | 已含完整推理文字 |
| 模組5 多語通報 | `TriggerDecision.cms_text` | 直接翻譯 |

---

## 待確認事項（規格書第11節）

### 1. 【優先】`data/snapshot.py` 是否提供共用 `inject_incident()`？

**現狀**：`data/snapshot.py` 沒有事件注入/儲存函式。  
**暫時做法**：`backend/store/incident_store.py` 維護 in-memory 清單。  
**風險**：其他模組透過 `get_snapshot()` 查到的 incidents 與本模組 store 的事件**不同步**。  
**待確認**：由負責 `data/snapshot.py` 的隊友補上 `inject_incident()` 後，
本模組的 `incident_store.py` 可改為呼叫共用函式。

### 2. `get_snapshot()` 的時間邊界處理

**現狀**：v2 `get_snapshot()` 對「不存在的 timestamp」直接拋 `ValueError`。  
**本模組做法**：自動找 `<= 事件 timestamp` 的最新可用快照時間（`_nearest_snapshot_ts`）。  
**待確認**：是否需要在 `get_snapshot()` 本身支援此語意（接受任意 timestamp，內部自動退而求其次）？

### 3. `GET /api/network` 路網靜態資料

建議整支移到共用層（如 `data/snapshot.py` 額外開 `get_network_static()`），
不放在模組2 自己的 router 裡，避免模組1/2 各自維護重複 API。

### 4. 一個事件對應多筆 `TriggerDecision`

模組1/3/4/5 的前端/邏輯需確認已預期「一個事件可能回傳陣列長度 > 1」，
不假設一對一。

### 5. `shared/schemas.py` 欄位型別對齊

v2 採用「不修改共用 schema，模組2 自行適配」的策略。  
若全隊決定統一修改 `TriggerDecision` 欄位型別（`severity`、`actions`、`primary_route`），
建議在下次會議對齊，再更新 `shared/schemas.py` 與本模組的 `_map_severity()` 等轉換邏輯。

---

## LLM 接入說明

目前 `cms_text` 與 `commander_brief` 由 `backend/services/llm_mock.py` 的
Mock 函式產生（格式化字串，不呼叫任何外部 API），確保 demo 穩定。

接入 Claude/OpenAI 時：
1. 修改 `llm_mock.py` 的 `generate_text()` 函式
2. 使用 `build_llm_user_prompt(decision)` 取得 User prompt
3. System prompt 已定義在 `SYSTEM_PROMPT` 常數中（限制 LLM 只做措辭轉換，不重新判斷數字）
4. 因一個事件可能有多筆 `TriggerDecision`，需迴圈呼叫（不要一次把所有 decision 混入同一個 prompt）
