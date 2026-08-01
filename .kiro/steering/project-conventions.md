---
inclusion: always
---

# Squirrel 戰情室 — 專案慣例

## 技術棧
- 後端：Python 3.10+ / FastAPI / Pydantic v2 / uvicorn
- 前端：原生 HTML + CSS + JS（無框架），透過 FastAPI 靜態檔伺服
- LLM：Ollama 本機推論（qwen2.5），模組三可切 Bedrock
- 測試：pytest
- 啟動指令：`uvicorn warroom.server:app --reload --port 8000`

## 資料架構約定
- 所有模組一律透過 `data/snapshot.py` 的 `get_snapshot(timestamp)` 取得資料，**禁止直接讀 `warroom/data_source/` 原始檔**
- ID 規則：道路路段 `RD_` 開頭、人流站點 `BS_` 開頭、事件用官方 `event_id`
- 共用型別定義在 `shared/schemas.py`（TrafficSnapshot, TriggerDecision, Station, RoadSegment, Incident）
- Roaming_User_Pct 正規化為 0-1 float；Timestamp 格式 "YYYY-MM-DD HH:MM"

## 模組職責邊界（嚴格遵守）
| 模組 | 職責 | 不做 |
|------|------|------|
| M1 Dashboard | 時序展示、SOP 1/3 門檻預警 | 不產出行動建議、不讀 live_incidents |
| M2 Incident | 事件注入、疏散路徑、SOP 2/5/7 | 不做趨勢展示 |
| M3 Advisor | 對話式 What-if 諮詢 | 不直接修改資料 |
| M5 Notify | 多語通報、SOP 6 漫遊門檻 | 不做判斷邏輯 |

## SOP 門檻判斷原則
- 門檻判斷一律由 Python 純函式計算，**禁止由 LLM 自行計算門檻數值**
- LLM 只負責把算好的結果轉寫成中文摘要/預警提示
- TriggerDecision 的 `actions` 欄位：M1 固定回傳空陣列，M2 才產出具體行動

## Router 掛載慣例
- API 路徑一律 `/api/` 開頭
- 新 router 要在 `warroom/server.py` 的 `include_router()` 區塊註冊
- 前端靜態資源走 `/style.css`、`/app.js`，不掛在 `/static/` 下（那是 M5 用的）

## 程式碼風格
- docstring 用中文
- Pydantic model 使用 `StrictBaseModel`（extra="forbid"）
- 新增的 schema 放 `shared/schemas.py`
- import 順序：stdlib → third-party → local（`from data.xxx` / `from shared.xxx` / `from warroom.xxx`）
