---
inclusion: fileMatch
fileMatchPattern: "**/thresholds*,**/sop*,**/incidents*,**/advisor*,**/sop_engine*"
---

# SOP 規則參考（當編輯門檻/SOP 相關程式碼時自動載入）

修改 SOP 相關程式碼時，務必確認：

## 七條 SOP 快速參考
1. **擁塞分級**：B 級 0.85≤score<0.95（黃燈）、A 級 score≥0.95（紅燈）。觸發路段：RD_TPE_001、RD_TPE_002
2. **車禍路障**：三條件同時 — status∈{Closed,Blocked,Restricted} + severity∈{High,Critical} + affected_segment 以 RD_ 開頭
3. **捷運分流**：BS_MRT_BL17 的 Growth_Rate>0.30 或 User_Count>25000
4. **散場啟動**：BS_TPE_DOME 歷史峰值≥30000 且當前 Growth_Rate≤-0.20
5. **號誌故障**：type="Power_Failure" 或描述含「號誌失效/故障」
6. **多語通報**：任一基地台 Roaming_User_Pct≥0.30
7. **ETE 計算**：base_clearance(Critical=60/High=40/Medium=20) + max(0, (avg_saturation-0.5)*60)

## 門檻修改注意事項
- 改任一門檻數值後，必須同步更新 `warroom/tests/test_smoke.py` 的相關斷言
- 模組三 advisor 的規則引擎（`warroom/routers/advisor.py`）有獨立的門檻判斷邏輯，也需要同步更新
- `sop/emergency_traffic_sop.txt` 是業務端的正式文件，程式邏輯必須與其完全一致

#[[file:sop/emergency_traffic_sop.txt]]
