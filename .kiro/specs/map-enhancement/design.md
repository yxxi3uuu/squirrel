# 地圖視覺化增強 — 設計

## 連續色階
saturationToColor(score) 函式，用 6 個 RGB 停靠點做線性插值：
- 0.00: (58,140,66) 深綠
- 0.50: (133,217,154) 亮綠
- 0.70: (234,206,80) 黃
- 0.85: (234,140,60) 橘
- 0.95: (220,50,50) 深紅
- 1.00: (140,20,60) 暗紫紅

## 站點動態半徑
dynamicRadius = max(5, min(14, 5 + (user_count / 40000) * 9))

## 互動設計
- 路段 hover：weight 5->9，stationPane opacity 降到 0.3
- 站點 hover：radius +4，其他站點 fillOpacity 降到 0.2
- 點擊定位：mapInstance.setView(center, 16) + 固定偏移 0.001 lat

## 圖例更新
四段漸變：暢通(<0.5) / 漸塞(0.5-0.85) / 壅塞(0.85-0.95) / 癱瘓(>=0.95)
