# Module 1 — Dynamic Time-Series Dashboard SPEC

分支：`module-1-dynamicTS`
對照 README 模組表：**依時間軸讀取並展示車流、人流資料；判斷 SOP 預警門檻；觸發自動彈窗**（程式）／**產生趨勢異常摘要與預警提示**（LLM）

---

## 1. 資料依賴
原則：**一律透過 `data/snapshot.py` 的 `get_snapshot(timestamp)` / `available_timestamps()` 取得資料，不直接讀 `data_source/` 原始檔**，欄位正規化（`Roaming_User_Pct` → 0-1 float、timestamp 格式）已在該層處理完成，Module 1 不用重做一次。

| 官方原始檔 | 進入 `TrafficSnapshot` 的哪個欄位 | Module 1 用途 |
|---|---|---|
| `city_traffic_flow.csv` | `road_segments[*].saturation_score / avg_speed / vehicle_count / lane_status` | 15 路段即時車流輸出、SOP 第 1 條紅黃燈分級 |
| `signaling_crowd_density.csv` | `stations[*].user_count / growth_rate` | 9 站點即時人流輸出、SOP 第 3 條門檻判斷 |
| `road_network_geometry.json` | `road_segments[*].alternatives / name` | 僅用於 SOP 第 1 條觸發時列出替代道路名稱（做「長綠燈時制」提示），**不**做路網重規劃 |

不使用（暫緩或屬於其他模組）：
- `signaling_crowd_density.csv` 的 `roaming_user_pct / peak_user_count / stay_time_avg`（分別對應 SOP 第 6、4 條與無門檻用途，暫不列入 Module 1 範圍，見第 3 節）。
- `live_incidents.json` 全部欄位 — **事件接收與處置完全由 Module 2 負責**，Module 1 不讀取此檔案。
- `road_network_geometry.json` 的 `intersections` / `capacity_vph`（SOP 2 疏散路徑判定，Module 2 負責）。
- `TriggerDecision` 的 `primary_route / secondary_routes / excluded_routes / ete_minutes / cms_text`（Module 2/4 產出，Module 1 不涉及）。

## 2. 現有資料範圍（供開發時測資用）

- 路段：15 個，`RD_TPE_001`～`RD_TPE_015`（見 `road_network_geometry.json`）。
- 站點：9 個，`BS_BUS_TERM, BS_MRT_BL16, BS_MRT_BL17, BS_MRT_BL18, BS_SS_PARK, BS_TPE_101, BS_TPE_DOME, BS_XY_ATT, BS_XY_VIESHOW`。
- 時間軸**間隔不固定**：17:00～20:00 每 30～60 分一筆，21:00 起改為每 15 分一筆（事件密集時段）。UI 與彈窗判斷邏輯不可假設固定間隔，一律用 `available_timestamps()` 取得的實際清單來畫時間軸／找下一筆。

## 3. SOP 門檻對照（Module 1 需判斷的部分）

| SOP 條款 | 觸發條件 | Module 1 動作 |
|---|---|---|
| 第 1 條（擁塞分級，適用全 15 路段） | B 級：`0.85 <= Saturation_Score < 0.95`；A 級：`Saturation_Score >= 0.95` | 該路段卡片顯示黃/紅燈；若為 `RD_TPE_001`／`RD_TPE_002` 達 B 級以上，額外提示「啟動長綠燈時制」並列出 `alternatives` 路名，交由 LLM 產出預警提示文字 |
| 第 3 條（捷運分流） | `BS_MRT_BL17`：`Growth_Rate > 0.30` 或 `User_Count > 25000` | 附上目前數值 vs 門檻，交由 LLM 產出預警提示文字 |

不在 Module 1 目前範圍：
- 第 2 條（車禍路障疏散路徑）、第 5 條（號誌故障人工指揮派遣）、第 7 條（ETE 公式）— 依賴 `live_incidents.json`，**事件接收與處置完全由 Module 2 負責**，Module 1 不讀取此檔案、不顯示事件卡片。
- 第 4 條（大巨蛋散場，需要 `peak_user_count` 歷史峰值運算）、第 6 條（多語通報門檻，`roaming_user_pct`）— 先不做，後續若需要再併入。

## 4. 功能需求

1. **時間軸讀取**：以 `available_timestamps()` 建立可選時間點清單；`get_snapshot(ts)` 取得該時間點快照並渲染。
2. **車流／人流圖表**：對每個 `road_segments` / `stations` 呈現隨時間變化的關鍵指標（`saturation_score`、`user_count` 等），可切換單一路段/站點檢視。
3. **紅黃燈分級**：依第 3 節第 1 條規則，逐路段計算並標色；顏色計算為純函式（輸入 `saturation_score`，輸出 `info/yellow/red`），供 UI 與彈窗共用。
4. **門檻觸發判斷**：時間軸推進到新時間點時，比對上一快照與當前快照，第 3 節列出的門檻（第 1／3 條）「由未觸發變為觸發」時標記該路段／站點需要輸出預警。
5. **LLM 分析摘要與預警提示**：門檻觸發時呼叫 LLM，輸入為當下的 `TrafficSnapshot`（或 `format_snapshot_for_prompt()` 已格式化好的文字）與觸發的門檻描述，輸出「趨勢異常摘要＋預警提示」中文短文，不得由 LLM 自行計算門檻數值（門檻判斷一律由程式算好再喂給 LLM）。

## 5. `TriggerDecision` 產出範圍

Module 1 可自行產出「純門檻型」的 `TriggerDecision`（第 1/3 條，見第 3 節），欄位對照：

```json
{
  "triggered": true,
  "sop_clause": "第 3 條",
  "clause_name": "捷運與接駁分流",
  "entity_id": "BS_MRT_BL17",
  "entity_name": "捷運國父紀念館站",
  "basis": "User_Count 40,000 > 門檻 25,000",
  "actions": [],
  "severity": "yellow",
  "timestamp": "2026-05-20 22:30"
}
```

`actions` 固定回傳空陣列：調度/引導等行動建議不是 Module 1 的職責（那是 Module 2 事件處置的範圍），Module 1 只做門檻判斷與預警提示。

第 2/4/5/6/7 條**不**由 Module 1 產出 `TriggerDecision`；`live_incidents.json` 相關（第 2/5/7 條）完全交給 Module 2，Module 1 不讀取、不顯示事件。

## 6. 非目標

- 事件接收與處置（`live_incidents.json`、事件卡片顯示）— Module 2 負責，Module 1 完全不讀取此檔案。
- 大巨蛋散場判斷（SOP 第 4 條）、多語通報門檻標記（SOP 第 6 條）— 先不做，後續視需要再併入。
- 路網重規劃、疏散路徑計算（Module 2）。
- 對話式問答、what-if 推演（Module 3）。
- SOP 分級的完整解釋鏈、排除理由展示（Module 4）。
- 多語文案產生與實際發送（Module 5）。
- 直接解析 `data_source/` 原始檔（一律走 `data/snapshot.py`）。

## 7. 開放問題

- 門檻「由未觸發變為觸發」比對，需要 Module 1 自行保存上一次快照狀態（非 shared 層職責），實作時另建本地 state。

## 8. 資料量變動的應變措施

比賽現場資料筆數/複雜度可能比目前測資（15 路段、9 站點、19 個時間點）更大，以下是各層目前對「資料變多」的耐受度，已經沒問題的不用改，真正的風險點列在後面：

**已經沒問題，不用改：**
- `data/snapshot.py`：`road_segments` / `stations` 都是照 `road_network_geometry.json` / CSV 裡實際有幾筆就處理幾筆，新增路段/站點只要加進原始資料檔即可，這層程式碼完全不用改。
- `thresholds.py` 的 `evaluate_clause1`（SOP 第 1 條）：對 `road_segments` 逐一 for-loop 判斷，天然支援任意數量的路段。
- 時間軸：`available_timestamps()` 動態讀取實際存在的時間點，UI 沒有假設固定間隔（見第 2 節），時間點變多/間隔變密都不用改。

**風險點與應變：**

1. **地圖座標是手動維護清單，新路段/站點不會自動出現在地圖上。**
   `warroom/data_source/road_coords.json` 是獨立於官方資料的手動座標檔（官方的 `road_network_geometry.json` 本身沒有經緯度）。新增路段時：
   - 先把新路段加進 `road_network_geometry.json`
   - 執行 `python scripts/fetch_road_coords.py`，會自動用路名去查 OpenStreetMap 補座標（只補缺的，不動已有的）
   - 新站點沒辦法自動查（不是 OSM 上有名字的地標），腳本會列出缺座標的站點 ID，需手動補概略經緯度
   - 前端現在如果缺座標，會在 console 印警告（不會像之前一樣直接無聲消失不顯示）

2. **SOP 第 3 條目前寫死只檢查單一站點 `BS_MRT_BL17`。**
   `thresholds.py` 的 `evaluate_clause3` 是針對這一個站寫的，如果比賽資料之後新增其他捷運站也要套用同一條門檻規則，需要先決定規則範圍（例如所有 `BS_MRT_` 開頭的站都套用同一組門檻，還是維持白名單逐一列出），**這是業務邏輯決定，不是純技術問題**，建議賽前先跟隊友確認清楚再改，避免自己猜錯範圍。

3. **`data/snapshot.py` 用 `@lru_cache(maxsize=1)` 快取整份原始檔，資料檔案被替換後不會自動重讀。**
   如果比賽現場需要在不重啟 server 的情況下換資料檔，目前的作法是重啟 server（cache 會清空重讀）。現階段資料量小、比賽用固定測資，這樣已經夠用，先不做熱重載機制，真的需要再加。

4. **前端不該再出現寫死的筆數/單位文字。**
   已檢查過 KPI 卡片，目前只有「重點壅塞路段」的分母（原本寫死 `/ 15`）已經改成從 API 回傳的 `summary.total` 動態帶入；其餘 KPI 數值本來就是動態算的，沒有類似問題。之後新增 UI 元件時，同樣要避免把目前的筆數（15 條路段、9 個站點）當常數寫死。
