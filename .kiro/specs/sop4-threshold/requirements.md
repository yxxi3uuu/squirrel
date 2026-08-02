# SOP-4 大巨蛋散場門檻判斷 — 需求

## 背景
模組一原本只做 SOP 第 1/3 條的門檻判斷，但 SOP 第 4 條（大巨蛋散場啟動）
也屬於「可從時序資料自動判斷」的門檻型規則，適合納入模組一的職責範圍。

## 需求
1. 在 thresholds.py 新增 evaluate_clause4()，判斷 BS_TPE_DOME 是否同時滿足：
   - 歷史峰值 peak_user_count >= 30,000
   - 當前 Growth_Rate <= -0.20
2. 觸發時產出 TriggerDecision，severity 為 yellow
3. cascade_checks 標記「連動第 3 條接駁機制」
4. 前端即時警報欄新增 SOP-4 專屬卡片
5. SOP-4 觸發時，SOP-3 卡片即使未達自身門檻也要顯示「連動啟動」提示

## 驗收標準
- 時間軸拖到 22:00 時 SOP-4 卡片出現
- SOP-3 卡片同步顯示連動提示
- 22:00 之前的時間點 SOP-4 卡片顯示「未達散場啟動條件」
