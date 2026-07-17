# Module 1 Prototype — Dynamic Time-Series Dashboard

> Branch: `module-1-dynamicTS`
> Version: v1（全都 main 共用架構）

範圍見 [SPEC.md](module1_dashboard/SPEC.md)。這是 FastAPI（後端 + API）＋純 HTML/JS（前端，無需 build）的 prototype。

## 負責的 SOP 條款

| 條款 | 名稱 | 說明 |
|---|---|---|
| 第 1 條 | 交通擁塞級別判定 | 全 15 路段依 `saturation_score` 分級（B 級 ≥0.85 黃燈、A 級 ≥0.95 紅燈）；`RD_TPE_001`／`RD_TPE_002` 額外觸發長綠燈時制建議 |
| 第 3 條 | 捷運與接駁分流 | `BS_MRT_BL17` 人流成長率 >30% 或人數 >25,000 時觸發，建議北捷過站不停、通知公車處調度接駁專車 |


## 安裝

於 repo 根目錄，用**獨立 venv**（不要裝到全域 Python／anaconda base，避免版本衝突影響到你機器上其他工具）：

```bash
python -m venv .venv
# Windows (Git Bash)
./.venv/Scripts/python.exe -m pip install -r requirements.txt -r module1_dashboard/requirements.txt
# macOS / Linux
.venv/bin/pip install -r requirements.txt -r module1_dashboard/requirements.txt
```

`.venv/` 已經在 `.gitignore` 裡，不會被 commit。

## 啟動

於 repo 根目錄（一定要在根目錄，才能正確 import 到 `data/` 與 `shared/`）：

```bash
# Windows (Git Bash)
./.venv/Scripts/python.exe -m uvicorn module1_dashboard.backend.main:app --reload --port 8004
# macOS / Linux
.venv/bin/python -m uvicorn module1_dashboard.backend.main:app --reload --port 8004
```

開瀏覽器到 <http://127.0.0.1:8004>。

## LLM 設定（門檻觸發後的中文摘要）

呼叫本機 [Ollama](https://ollama.com/)（預設模型 `qwen2.5:1.5b`），免 API key、可離線；呼叫失敗、逾時或 Ollama 沒開時會自動退回規則式樣板文字（`_fallback_summary`），不會讓 API 掛掉。

使用前先確認本機已經拉好模型並啟動 Ollama：

```bash
ollama pull qwen2.5:1.5b
ollama serve   # 通常安裝完會自動常駐，這行多半不用手動下
```

CPU 推論較慢（實測約 10+ 秒/次，冷啟動更久），可用環境變數調整：

```bash
OLLAMA_BASE_URL=http://localhost:11434  # 選填
OLLAMA_MODEL=qwen2.5:1.5b               # 選填
OLLAMA_TIMEOUT=10                       # 選填，秒數
```

## 目錄結構

```text
module1_dashboard/
├── SPEC.md
├── requirements.txt
├── backend/
│   ├── main.py          # FastAPI app：/api/* + 掛載 frontend/ 靜態檔
│   ├── thresholds.py     # SOP 第 1/3 條門檻判斷（純函式，回傳 TriggerDecision）
│   └── llm_summary.py    # 門檻觸發後產生中文摘要；呼叫本機 Ollama，見上方「LLM 設定」
└── frontend/
    ├── index.html
    ├── style.css
    └── app.js            # 時間軸控制、卡片格線、SVG 時間序列圖表（含 hover/tooltip、表格檢視）
```

## API

| 端點 | 說明 |
|---|---|
| `GET /api/timestamps` | 可用時間點清單 |
| `GET /api/snapshot?timestamp=` | 單一時間點的 `TrafficSnapshot`（省略則取最新） |
| `GET /api/history?entity_id=` | 單一路段/站點跨全部時間點的主要指標（路段：`saturation_score`；站點：`user_count`） |
| `GET /api/dashboard?timestamp=` | 整合端點：快照 + 門檻判斷（第 1/3 條）+ 本次新觸發 + LLM 摘要，前端只打這支 |

`newly_triggered` 的計算方式：拿目前時間點與時間軸上「前一個可用時間點」各自算一次 `evaluate_triggers()`，取差集。這是無狀態的作法（不需要伺服器保留 session），對應 `SPEC.md` 第 7 節的開放問題。

## 快速驗證（不開瀏覽器）

```bash
./.venv/Scripts/python.exe -m uvicorn module1_dashboard.backend.main:app --port 8004 &
curl "http://127.0.0.1:8004/api/dashboard?timestamp=2026-05-20%2022:30"
```

`2026-05-20 22:30` 這個時間點 `RD_TPE_002`（光復南路）因事故已經飽和，會看到第 1 條觸發；可以換到 `22:45`／`23:00` 觀察 `BS_MRT_BL17` 的第 3 條是否觸發。

## 已知限制（prototype 階段）

- LLM 摘要呼叫本機 Ollama，CPU 推論較慢；設定與環境變數見上方「LLM 設定」章節，Ollama 沒開時會退回規則式樣板文字。
- 時間軸圖表用等間距（ordinal）x 軸，不是依實際時間比例繪製 —— 因為官方資料時間間隔不固定（17:00–20:00 每 30–60 分，21:00 起每 15 分），先用等間距簡化。

