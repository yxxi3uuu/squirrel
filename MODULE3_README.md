# 模組 3：對話式策略諮詢顧問 (Interactive Strategic Advisory)

> Branch: `module-3-advisory`
> Version: v3（對齊 main 共用架構）

給組員的快速導覽：模組 3 在做什麼、檔案在哪裡、資料怎麼流、現在做到哪、要用什麼技術、怎麼啟動來玩。詳細設計決策與逐條 SOP 判斷細節見 [`docs/module3_advisor_architecture.md`](docs/module3_advisor_architecture.md)；要逐題驗收見 [`docs/module3_test_checklist.md`](docs/module3_test_checklist.md)。

<br>

## 概覽

指揮官在 Dashboard 旁的對話視窗打「假設性問題」，AI 依 SOP + 使用者假設 + 當前資料快照，回答會觸發哪一條、該做什麼、要不要連動其他條款。

```text
指揮官輸入 what-if 問題
     ↓
POST /chat
     ↓
module3_advisor.answer_advisory_question()
     ↓
組合：SOP 全文 + 使用者假設 + 當前 TrafficSnapshot
     ↓
llm.clients.chat()（mock / anthropic / bedrock 三選一）
     ↓
固定格式回答：結論 + 建議處置 + 後續確認
```

### 負責的 SOP 條款

| 條款 | 名稱 | 說明 |
|---|---|---|
| SOP-1 | 交通壅塞級別判定 | 全 15 路段分級顯示；只有忠孝東路四段／光復南路觸發長綠燈等應變動作 |
| SOP-2 | 車禍與路障應變 | 三條件（路段／通行狀態／嚴重度）同時成立才觸發；主疏散路段從路網資料篩選 |
| SOP-3 | 捷運與接駁分流 | 捷運國父紀念館站人潮 >25,000 或成長率 >30% |
| SOP-4 | 大巨蛋散場啟動 | 歷史峰值 ≥30,000 且目前成長率 ≤-0.20，連動 SOP-3 |
| SOP-5 | 號誌故障應變 | 人力派遣建議，連動 SOP-7 估算恢復時間 |
| SOP-6 | 數位通報與多語化 | 任一站點外籍旅客比例 ≥30%，從快照查詢，不需指揮官提供數字 |
| SOP-7 | 預計恢復時間 (ETE) | 內嵌在 SOP-2 / SOP-5 回答中，不是獨立問法 |

**不負責：** 事件真正注入與路網重規劃執行（模組 2）；完整多語文案產出（模組 5）。

<br>

## 檔案架構

```text
squirrel/
│
├── app.py                          ← FastAPI 入口：/chat、/health；本機跑，也可包 Lambda
├── static/
│   └── index.html                  ← 對話視窗 UI（無框架，純 HTML/CSS/JS）
│
├── module3_advisor/                ← 模組 3 主邏輯
│   ├── service.py                  ← 主流程：組 SOP + 快照 + 對話歷史 → 呼叫 LLM
│   ├── prompts.py                  ← system prompt 模板與回答規則（給 anthropic/bedrock 模式用）
│   ├── sop_loader.py               ← SOP 全文檢索（輕量 KB，非向量 RAG）
│   └── schemas.py                  ← AdvisoryResponse / SopSource 資料形狀
│
├── llm/
│   └── clients.py                  ← ★ LLM 抽象層；LLM_MODE 切換 mock/anthropic/bedrock，
│                                       mock 模式內含完整規則判斷邏輯（見下方「目前設計狀態」）
│
├── data/
│   ├── snapshot.py                 ← 讀 data_source，組出官方 TrafficSnapshot
│   └── module3_demo_snapshot.py    ← mock demo 疊加層，補足 SOP-2 選路徑用的假設資料
│
├── data_source/                    ← 官方原始資料（main 分支維護，模組 3 唯讀）
│   ├── city_traffic_flow.csv       ← 車流時間序列（飽和度等）
│   ├── signaling_crowd_density.csv ← 人流／基地台漫遊率時間序列
│   ├── road_network_geometry.json  ← 路段容量、替代道路、路口
│   ├── live_incidents.json         ← 突發事件範例
│   └── module3_demo_snapshot.json  ← 模組 3 demo 疊加資料（不改官方檔案）
│
├── shared/
│   ├── schemas.py                  ← 共用 TrafficSnapshot / TriggerDecision 等模型
│   └── lookup.py                   ← 路名／站名別名查詢
│
├── sop/
│   └── emergency_traffic_sop.txt   ← 官方 SOP 七條全文
│
├── docs/
│   ├── module3_advisor_architecture.md  ← 完整設計文件（判斷細節、驗收標準）
│   └── module3_test_checklist.md        ← 可勾選測試清單（~30 題，含邊界值）
│
├── requirements.txt                 ← 共用依賴（pydantic）
└── MODULE3_README.md                ← 本文件
```

<br>

## 資料流程

```text
data_source/*.csv, *.json（官方原始資料）
        ↓  data/snapshot.py 解析成統一格式
TrafficSnapshot（某一時間點的路段飽和度、站點人潮/漫遊率、已注入事件）
        ↓  data/module3_demo_snapshot.py 疊加 demo 補充資料（僅 mock 模式）
        ↓
module3_advisor/service.py
  ├─ 讀 sop/emergency_traffic_sop.txt 全文（sop_loader.py）
  ├─ 讀當前 TrafficSnapshot
  └─ 合併「使用者問題中明講的假設」與「快照裡未明講的現況」
        ↓
llm/clients.py chat()
        ↓
固定格式回答：第一行結論 → ■ 建議處置 → ■ 後續確認
        ↓
/chat 回傳 JSON → static/index.html 顯示
```

**判斷原則**：使用者問題裡「明講」的數字/狀態＝what-if 假設，優先採用；沒明講的現況（例如替代道路目前飽和度、某站漫遊率）一律從當前 `TrafficSnapshot` 補，不可以自己編。

<br>

## 目前設計狀態

- ✅ SOP 1–7 全部條款在 `mock` 模式下已實作並逐題驗證（見 [`docs/module3_test_checklist.md`](docs/module3_test_checklist.md)，約 30 題含邊界值全數通過）。
- ✅ 三態判斷：SOP-2 的通行狀態／嚴重度會區分「成立」「使用者明確表示不成立」「使用者根本沒提」三種，不會把「沒有封閉」誤判成「封閉」。
- ✅ SOP-3／SOP-4 不套用固定示範數字，會即時解析使用者實際輸入的人潮數字或成長率。
- ✅ SOP-6 站名比對忽略空白差異（「ATT4FUN 周邊」＝「ATT4FUN周邊」）。
- ⚠️ `anthropic` / `bedrock` 模式的 prompt（`module3_advisor/prompts.py`）已寫好回答規則，但主要驗收都是在 `mock` 模式下跑的；換成真的 LLM 前建議先用同一份測試清單再測一輪，確認 LLM 有照規則回答。
- 📌 待與模組 1 對齊：目前播放時間點的傳遞方式（`?snapshot_timestamp=`），正式串接 Dashboard 時要確認參數名稱一致。

<br>

## 技術棧

| 分類 | 選用 | 說明 |
|---|---|---|
| 後端框架 | FastAPI 0.115 + Uvicorn | `app.py` 單一入口，`/chat`、`/health` 兩支 API |
| 資料驗證 | Pydantic 2.10 | `shared/schemas.py`、`app.py` 的 request/response model |
| LLM 抽象層 | 自製三模式切換（`llm/clients.py`） | `mock`（規則模擬，免 API key）／`anthropic`（SDK 0.40）／`bedrock`（boto3 1.35，含 throttling retry） |
| 前端 | 純 HTML/CSS/JavaScript（`static/index.html`） | 無框架、無 build step，FastAPI 直接用 `StaticFiles` 掛載 |
| 部署相容 | Mangum | `app.py` 的 `lambda_handler`，同一份程式碼可包成 Lambda + API Gateway |
| 資料來源 | CSV / JSON | `data_source/` 官方時序與事件資料，`data/snapshot.py` 純函式解析，無資料庫 |

<br>

## 快速啟動

### 1. 安裝依賴

```bash
pip install -r requirements.txt
pip install fastapi uvicorn anthropic boto3 mangum   # 依實際要用的 LLM_MODE 安裝對應套件
```

### 2. 設定環境變數

```bash
cp .env.example .env
# 預設 LLM_MODE=mock，不需要任何 API key，適合離線 demo
```

### 3. 啟動

```bash
python3 -m uvicorn app:app --reload --port 8000
```

瀏覽器開啟：

```text
http://localhost:8000
```

要模擬 Dashboard 播放軸停在特定時間點，可加參數：

```text
http://localhost:8000?snapshot_timestamp=2026-05-20%2022:00
```

<br>

## 怎麼玩 chatbot

畫面上半部是「選情境與地點」快捷區：

1. 先選一個分類——**車禍與路障應變 / 號誌故障應變 / 數位通報**
2. 下拉選單選地點（路段或站點）
3. 按「套用情境」直接送出組好的問題

下方還有幾個固定假設快捷鍵可以一鍵測：壅塞級別判定、忠孝東路四段 A 級壅塞、光復南路 B 級壅塞、國父紀念館站分流、大巨蛋散場啟動。

也可以直接在最下面的輸入框打自由問題，例如：

```text
如果忠孝東路四段發生嚴重車禍並造成路段封鎖，依 SOP 應該怎麼改道、通報，預計多久恢復？
光復南路目前封閉，事故嚴重度輕微
目前哪些站點需要啟動多語通報？
假設大巨蛋人潮曾達 40,000 人且目前人流成長率為-0.25，依 SOP 要啟動哪些措施並連動什麼檢查？
```

想系統性地測完整覆蓋率（含「不觸發」「資訊不足」等邊界情況），照 [`docs/module3_test_checklist.md`](docs/module3_test_checklist.md) 的清單逐題貼進去對答案即可，也可以不開瀏覽器、直接用 Python 跑：

```bash
LLM_MODE=mock python3 -c "
from module3_advisor import answer_advisory_question
print(answer_advisory_question('光復南路目前封閉，事故嚴重度輕微')['answer'])
"
```
