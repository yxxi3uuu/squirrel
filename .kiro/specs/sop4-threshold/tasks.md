# SOP-4 大巨蛋散場門檻判斷 — 實作任務

## 任務清單

- [x] 1. 在 thresholds.py 新增 CLAUSE4 常數和 evaluate_clause4() 函式
- [x] 2. 更新 evaluate_triggers() 加入第 4 條
- [x] 3. 跑 pytest 確認後端不壞
- [x] 4. 前端 app.js 新增 renderSop4Card() 函式
- [x] 5. 在 renderTrafficAlerts() 中呼叫 renderSop4Card()
- [x] 6. style.css 新增 .alert-card.sop4 樣式
- [x] 7. 修改 renderSop3Card() 加入 cascade 連動判斷
- [x] 8. style.css 新增 .cascade-active 和 .cascade-hint 樣式
- [x] 9. 手動驗證：時間軸 22:00 前後 SOP-4 卡片狀態正確
- [x] 10. 手動驗證：SOP-4 觸發時 SOP-3 顯示連動提示
