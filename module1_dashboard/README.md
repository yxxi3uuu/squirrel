# Module 1 Prototype — Dynamic Time-Series Dashboard

範圍見 [SPEC.md](SPEC.md)。這是 FastAPI（後端 + API）＋純 HTML/JS（前端，無需 build）的 prototype。

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
./.venv/Scripts/python.exe -m uvicorn module1_dashboard.backend.main:app --reload
# macOS / Linux
.venv/bin/python -m uvicorn module1_dashboard.backend.main:app --reload
```

開瀏覽器到 <http://127.0.0.1:8000>。

## 目錄結構

```text
module1_dashboard/
├── SPEC.md
├── README.md
├── requirements.txt
├── backend/
│   ├── main.py          # FastAPI app：/api/* + 掛載 frontend/ 靜態檔
│   ├── thresholds.py     # SOP 第 1/3 條門檻判斷（純函式，回傳 TriggerDecision）
│   └── llm_summary.py    # 門檻觸發後產生中文摘要；有 ANTHROPIC_API_KEY 才會真的呼叫 LLM，否則走規則式 fallback
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
./.venv/Scripts/python.exe -m uvicorn module1_dashboard.backend.main:app &
curl "http://127.0.0.1:8000/api/dashboard?timestamp=2026-05-20%2022:30"
```

`2026-05-20 22:30` 這個時間點 `RD_TPE_002`（光復南路）因事故已經飽和，會看到第 1 條觸發；可以換到 `22:45`／`23:00` 觀察 `BS_MRT_BL17` 的第 3 條是否觸發。

## 已知限制（prototype 階段）

- LLM 摘要預設沒有 API key，走規則式樣板文字，不是真正 LLM 產出的品質。
- 時間軸圖表用等間距（ordinal）x 軸，不是依實際時間比例繪製 —— 因為官方資料時間間隔不固定（17:00–20:00 每 30–60 分，21:00 起每 15 分），先用等間距簡化。
- 沒有自動化測試，僅手動驗證 API 與畫面。
