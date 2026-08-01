---
inclusion: fileMatch
fileMatchPattern: "**/snapshot*,**/schemas*,**/data_source*"
---

# 資料契約規範（當編輯資料層相關程式碼時自動載入）

## 快照 shape（不可任意增刪 top-level key）
```json
{
  "timestamp": "YYYY-MM-DD HH:MM",
  "source": "official_files",
  "road_segments": {"RD_XXX": {...}},
  "stations": {"BS_XXX": {...}},
  "incidents": [...]
}
```

## 修改資料層的注意事項
- `data/snapshot.py` 的輸出格式被 M1/M2/M3/M5 全部依賴，改動前先跑 `pytest warroom/tests/`
- 新增欄位必須同步更新 `shared/schemas.py` 的 Pydantic model
- 新增路段/站點的座標需執行 `python scripts/fetch_road_coords.py` 補入 `warroom/data_source/road_coords.json`
- `@lru_cache` 快取在開發階段可能導致資料不刷新，restart server 或在 snapshot.py 暫時移除 cache 裝飾器

#[[file:shared/schemas.py]]
#[[file:docs/shared_data_contract.md]]
