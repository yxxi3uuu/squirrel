# Requirements Document

## Introduction

將現有 `backend/` 模組（模組 2：即時事件處置與 SOP 規則引擎）整合至 `warroom/module2/` 目錄下，遵循 `warroom/module5/` 已建立的子模組目錄結構模式。整合後 module2 應可獨立啟動（開發用），也能由 `warroom/server.py` 統一掛載運行。

## Glossary

- **Module2_Backend**：位於 `warroom/module2/backend/` 的 FastAPI 應用程式，負責事件注入與 SOP 規則引擎 API
- **Warroom_Server**：位於 `warroom/server.py` 的整合 FastAPI 伺服器，統一掛載所有模組 API
- **Module5_Pattern**：`warroom/module5/` 的目錄結構模式，包含 `backend/`、`frontend/`、`requirements.txt` 與 `__init__.py`
- **SOP_Engine**：SOP 規則引擎（`sop_engine.py`），負責壅塞分級、事故應變與號誌故障應變邏輯
- **LLM_Service**：LLM 引導文字生成服務（`llm_mock.py`），可連接 Ollama 或 fallback 到 mock 實作
- **Incident_Store**：事件記憶體儲存模組（`incident_store.py`），管理注入與解除事件

## Requirements

### 需求 1：目錄結構建立

**使用者故事：** 作為開發者，我想要 module2 遵循 module5 的目錄結構模式，以維持專案一致性並降低新進成員上手難度。

#### 驗收條件

1. THE Module2_Backend SHALL 建立 `warroom/module2/` 目錄，包含 `backend/`、`__init__.py` 與 `requirements.txt` 三個直屬項目，且無其他非預期的直屬檔案或目錄（`tests/` 除外）
2. THE Module2_Backend SHALL 在 `warroom/module2/backend/` 下建立 `main.py`、`routers/`、`services/`、`store/` 與 `__init__.py`，且每個子目錄皆為非空目錄
3. THE Module2_Backend SHALL 在 `warroom/module2/backend/routers/` 下包含 `incidents.py` 與 `__init__.py`，且不包含其他檔案
4. THE Module2_Backend SHALL 在 `warroom/module2/backend/services/` 下包含 `sop_engine.py`、`llm_mock.py` 與 `__init__.py`，且不包含其他檔案
5. THE Module2_Backend SHALL 在 `warroom/module2/backend/store/` 下包含 `incident_store.py` 與 `__init__.py`，且不包含其他檔案
6. THE Module2_Backend SHALL 在 `warroom/module2/tests/` 下建立 `test_sop_engine.py` 與 `__init__.py`，且不包含其他檔案
7. WHEN 開發者於專案根目錄執行 `python -c "import warroom.module2"` 時，THE Module2_Backend SHALL 成功匯入而不產生 ImportError
8. THE Module2_Backend SHALL 確保 `warroom/module2/__init__.py` 為有效的 Python 檔案（可為空檔案），使 `warroom.module2` 可作為 Python package 被辨識

### 需求 2：Import 路徑遷移

**使用者故事：** 作為開發者，我想要遷移後的程式碼使用正確的 import 路徑，以確保模組可獨立執行也可被整合伺服器載入。

#### 驗收條件

1. WHEN Module2_Backend 內部子套件（routers、services、store、tests）互相引用時，THE Module2_Backend SHALL 使用相對 import 或以 `warroom.module2.backend` 為前綴的絕對 import
2. WHEN Module2_Backend 引用共用層時，THE Module2_Backend SHALL 維持 `shared.schemas` 與 `shared.lookup` 的 import 路徑不變
3. WHEN Module2_Backend 引用資料層時，THE Module2_Backend SHALL 維持 `data.snapshot` 的 import 路徑不變
4. IF import 路徑在遷移過程中失效，THEN THE Module2_Backend SHALL 在 Python 直譯器載入模組時拋出 ModuleNotFoundError，且錯誤訊息包含無法解析的模組完整路徑名稱
5. WHEN 以 `python -m warroom.module2.backend.main` 從專案根目錄啟動時，THE Module2_Backend SHALL 成功啟動且所有 import 皆正常解析，程序無 ImportError 或 ModuleNotFoundError
6. WHEN 整合伺服器（warroom/server.py）載入 Module2_Backend 的 router 時，THE Module2_Backend SHALL 成功被掛載且所有 import 皆正常解析，程序無 ImportError 或 ModuleNotFoundError

### 需求 3：獨立啟動能力

**使用者故事：** 作為開發者，我想要 module2 可透過 uvicorn 單獨啟動於獨立 port，以便在開發階段獨立偵錯而不影響其他模組。

#### 驗收條件

1. THE Module2_Backend SHALL 提供 `warroom/module2/backend/main.py`，其中包含名為 `app` 的 FastAPI 實例作為應用程式進入點
2. WHEN 開發者執行 `uvicorn warroom.module2.backend.main:app --port 8002` 時，THE Module2_Backend SHALL 於 10 秒內完成啟動，並於 `/health` 端點回應 HTTP 200，回應內容包含 `status` 欄位值為 `"ok"`
3. WHEN Module2_Backend 獨立啟動時，THE Module2_Backend SHALL 在 `POST /api/incidents/inject` 端點接受符合 IncidentIn schema 的事件注入請求，並回傳包含 `decisions`（List[TriggerDecision]）與 `processing_time_ms` 欄位的 JSON 回應
4. IF 開發者對 `POST /api/incidents/inject` 送出不符合 IncidentIn schema 的請求，THEN THE Module2_Backend SHALL 回傳 HTTP 422 並包含指出驗證失敗欄位的錯誤訊息
5. THE Module2_Backend SHALL 設定 CORS middleware 允許來源為 `http://localhost:5173`、`http://localhost:3000` 與 `http://localhost:8000` 的跨域請求，並允許所有 HTTP 方法與標頭

### 需求 4：整合伺服器掛載

**使用者故事：** 作為開發者，我想要 warroom/server.py 能從新位置正確掛載 module2 的 router，以維持整合環境正常運作。

#### 驗收條件

1. THE Warroom_Server SHALL 從 `warroom.module2.backend.routers` 匯入 incidents router，且匯入路徑在 `warroom/server.py` 頂層 import 區段中可見
2. WHEN Warroom_Server 啟動時，THE Warroom_Server SHALL 將 module2 的 incidents router 以 `app.include_router` 掛載於 `/api/incidents` 前綴路徑，且該路由在 FastAPI 自動產生的 `/docs` 頁面中可列出
3. WHEN 使用者透過 Warroom_Server 以 POST 方法呼叫 `/api/incidents/inject` 並傳入符合 InjectRequest schema 的 JSON body 時，THE Warroom_Server SHALL 於 5 秒內回傳 HTTP 200 回應，其 JSON body 包含 `decisions` 陣列（每筆元素包含 `triggered`、`sop_clause`、`actions` 欄位）與 `processing_time_ms` 數值欄位，格式與 module2 獨立啟動時的 `/api/incidents/inject` 回應結構一致
4. THE Warroom_Server SHALL 在 `/health` 端點回傳的 JSON 中包含 `modules` 陣列，且該陣列包含整數值 `2`
5. WHEN Warroom_Server 啟動且 `warroom.module2.backend.routers` 模組路徑不存在或匯入失敗時，IF 匯入過程發生 ImportError 或 ModuleNotFoundError，THEN THE Warroom_Server SHALL 於啟動階段立即終止並輸出包含失敗模組名稱的錯誤訊息至標準錯誤輸出

### 需求 5：warroom/routers/incidents.py 路由委派

**使用者故事：** 作為開發者，我想要 `warroom/routers/incidents.py` 改為委派至 module2 內部的 SOP 引擎，避免維護兩份重複邏輯。

#### 驗收條件

1. THE Warroom_Server SHALL 將 `warroom/routers/incidents.py` 中的 SOP 引擎 import 改為引用 `warroom.module2.backend.services.sop_engine` 的 `process_incident` 函式，且該函式的呼叫簽章（接受 incident dict 與 snapshot dict，回傳 List[TriggerDecision]）維持不變
2. THE Warroom_Server SHALL 將 `warroom/routers/incidents.py` 中任何對 LLM 服務的引用改為 `warroom.module2.backend.services.llm_mock`，若該檔案未直接引用 LLM 服務則無需變更
3. WHEN 遷移完成後，THE Warroom_Server SHALL 不再於 `warroom/routers/incidents.py` 中包含任何以 `backend.services.sop_engine` 或 `backend.services.llm_mock` 為來源的 import 語句
4. WHEN `/api/incidents/inject` 端點收到與遷移前相同的 InjectRequest 時，THE Warroom_Server SHALL 回傳與遷移前結構一致的 JSON 回應（包含 success、event、total、decisions、snapshot、processing_time_ms 欄位），且 decisions 內容由 `warroom.module2.backend.services.sop_engine.process_incident` 產生
5. IF `warroom.module2.backend.services.sop_engine` 模組不存在或無法匯入，THEN THE Warroom_Server SHALL 於啟動時拋出 ImportError，而非靜默回退至舊路徑

### 需求 6：測試遷移與可執行性

**使用者故事：** 作為開發者，我想要現有測試案例遷移至新位置後仍可正常執行並通過，以確保遷移未破壞任何邏輯。

#### 驗收條件

1. THE Module2_Backend SHALL 在 `warroom/module2/tests/test_sop_engine.py` 包含與原 `backend/tests/test_sop_engine.py` 功能等價的三個測試案例（案例 A、B、C），其中 import 路徑已更新為對應 `warroom.module2` 套件結構，且 `warroom/module2/tests/__init__.py` 檔案存在以支援模組探索
2. WHEN 開發者在專案根目錄執行 `python -m warroom.module2.tests.test_sop_engine` 時，THE Module2_Backend SHALL 於 60 秒內完成執行，三個測試案例全部斷言通過，且程序以結束代碼 0 退出
3. IF 任一測試案例的斷言失敗或拋出未預期例外，THEN THE Module2_Backend SHALL 將失敗案例的函式名稱（run_case_a、run_case_b 或 run_case_c）與對應的錯誤訊息輸出至標準輸出，並以非零結束代碼退出
4. WHEN 遷移後的測試檔案執行時，THE Module2_Backend SHALL 正確解析資料來源路徑（`data_source/live_incidents.json` 及 `data/snapshot` 模組），不因檔案搬移而產生 ModuleNotFoundError 或 FileNotFoundError

### 需求 7：requirements.txt 獨立依賴宣告

**使用者故事：** 作為開發者，我想要 module2 有自己的 requirements.txt，以明確記錄該模組的直接依賴。

#### 驗收條件

1. THE Module2_Backend SHALL 在 `warroom/module2/requirements.txt` 中僅宣告以下 4 個直接依賴：fastapi、uvicorn[standard]、httpx 與 pydantic，且檔案中不得包含其他套件宣告
2. THE Module2_Backend SHALL 在 `warroom/module2/requirements.txt` 中為每個依賴使用 `>=` 語法指定版本下界，其版本值不低於專案層級 `requirements.txt` 中對應套件的已知版本（fastapi>=0.115.6、uvicorn[standard]>=0.32.1、httpx>=0.27.2、pydantic>=2.10.3）
3. THE Module2_Backend SHALL 確保 `warroom/module2/requirements.txt` 為合法的 pip requirements 格式，可被 `pip install -r` 指令無錯誤解析

### 需求 8：舊模組路徑向後相容

**使用者故事：** 作為開發者，我想要舊的 `backend/` 目錄在過渡期間仍可正常運作，避免其他可能依賴該路徑的程式碼立刻壞掉。

#### 驗收條件

1. WHILE 遷移過渡期間（定義為：新路徑模組已部署，但舊路徑尚未被正式公告移除），THE Module2_Backend SHALL 保留原 `backend/` 目錄下的所有檔案不做刪除，且透過 `backend.main` 進行 Python import 仍可正常解析而不產生 ImportError
2. WHILE 遷移過渡期間，WHEN 開發者透過舊路徑 `backend/` 啟動服務時，THE Module2_Backend SHALL 成功啟動並回應 `/health` 端點，回傳與新路徑啟動時相同結構的回應
3. WHEN 遷移完成且專案內所有 Python import 語句與啟動腳本中不再包含 `backend.` 前綴引用後，THE Module2_Backend SHALL 在 `backend/main.py` 檔案頂端加入棄用提示註解，內容須包含：棄用聲明、新模組路徑位置、以及建議遷移的目標 import 路徑
