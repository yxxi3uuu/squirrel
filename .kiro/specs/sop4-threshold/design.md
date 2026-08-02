# SOP-4 大巨蛋散場門檻判斷 — 設計

## 後端
- 在 `warroom/module1/backend/thresholds.py` 新增常數與函式：
  - CLAUSE4_STATION_ID = "BS_TPE_DOME"
  - CLAUSE4_PEAK_THRESHOLD = 30000
  - CLAUSE4_GROWTH_RATE_THRESHOLD = -0.20
  - evaluate_clause4(snapshot) -> List[dict]
- evaluate_triggers() 加入 clause4 結果
- /api/dashboard 回傳的 triggers 自然包含 SOP-4

## 前端
- renderSop4Card(dashboard)：從 triggers 找第 4 條，顯示黃色卡片
- renderSop3Card(dashboard) 修改：
  - 額外檢查是否有 SOP-4 觸發且 cascade_checks 包含第 3 條
  - 若是，即使 SOP-3 自身未觸發也顯示「連動啟動」黃色卡片

## 資料流
```
get_snapshot(ts) -> evaluate_clause4() -> TriggerDecision
                                            |
                          /api/dashboard.triggers[] 包含 sop_clause="第 4 條"
                                            |
                          前端 renderSop4Card() + renderSop3Card() cascade 判斷
```
