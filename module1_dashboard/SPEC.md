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
  "actions": ["過站不停", "調度接駁專車", "引導至 BS_MRT_BL18"],
  "severity": "yellow",
  "timestamp": "2026-05-20 22:30"
}
```

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
