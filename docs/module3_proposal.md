# 模組三：對話式策略諮詢顧問
# Interactive Strategic Advisory

---

## 一、解題方向

大型活動期間，指揮官經常需要即時處理各種 What-if 情境，例如：

- 國父紀念館站若湧入 40,000 人，應採取哪些分流措施？
- 忠孝東路四段飽和度升至 0.96，應啟動哪一級應變？
- 當特定條件觸發時，是否會連動其他 SOP 條款？

傳統作業需由人員逐條翻閱 SOP 並比對即時數據，不僅反應速度較慢，也可能遺漏相關門檻或連鎖觸發條件。

因此，本系統於 Dashboard 中整合 AI 對話式策略顧問。指揮官可直接輸入假設條件或追問目前狀況，系統會結合 SOP 全文、即時數據快照及歷史對話，快速產出：

- SOP 觸發判定條款與數據依據
- 建議處置措施
- 相關條款連鎖檢查
- 後續需持續監控的指標

透過自然語言互動，將原本繁瑣的人工查詢流程轉化為即時、可追問且具備決策依據的策略諮詢服務。

---

## 二、AI 技術應用

系統正式環境使用 Amazon Bedrock Claude Sonnet 4.5，開發階段則使用 Ollama qwen2.5:7b，並透過統一的 LLM 抽象層（warroom/llm/client.py）管理模型呼叫。

### System Prompt 組成

每次對話時，後端會將以下資訊注入 System Prompt：

1. 城市交通指揮顧問角色設定
2. 約 1,000 字的 SOP 全文（7 條應變規則）
3. 即時交通與人潮數據快照
4. 回答格式與判斷規則
5. 前幾輪對話歷史

由於 SOP 文件篇幅固定且內容較短，因此直接將全文注入 Prompt，不需額外建置 RAG，可避免檢索遺漏條款。

### 回答格式

AI 回答固定採用三段式結構：

- 結論：說明是否觸發 SOP 及判斷結果
- ■ 建議處置：列出應執行的交通或人流應變措施
- ■ 後續確認：提醒需持續觀察的指標及可能連動條款

### Agent 能力

| 功能 | 說明 |
|------|------|
| SOP 條款判斷 | 比對即時數值與 SOP 門檻，引用對應條款 |
| What-if 分析 | 對假設性人潮、壅塞或事件條件進行推演 |
| 多輪對話 | 注入歷史對話，延續前一輪的地點、數值與情境 |
| 連鎖條款檢查 | 自動確認某項條款觸發後，是否需同步檢查其他條款 |
| 主動預警 | 持續掃描數據，接近門檻時主動推送提醒 |
| 模型切換 | 透過 LLM_MODE 切換 Bedrock、Ollama 或 Mock |
| Fallback 驗證 | LLM 無法回覆或判斷異常時，由規則引擎重新驗證 |

### 模型切換方式

```
LLM_MODE=bedrock    # 正式比賽（Claude Sonnet 4.5，品質最佳）
LLM_MODE=ollama     # 本機開發（qwen2.5:7b，免費離線）
LLM_MODE=mock       # 無網路備案（預錄回答）
```

其中，LLM 負責自然語言理解、情境分析與說明；規則引擎則負責重新計算數值與驗證門檻，以降低模型幻覺及錯誤判斷風險。

### LLM 呼叫流程

```
指揮官輸入問題
      │
      ▼
FastAPI /api/advisor/chat
      │
      ├─ ① 讀取 SOP 全文（emergency_traffic_sop.txt）
      ├─ ② 讀取即時快照（data/snapshot.py）
      ├─ ③ 規則引擎先行判斷（作為 fallback ground truth）
      ├─ ④ 組 System Prompt（角色 + SOP + 數據 + 規則 + 歷史）
      │
      ▼
LLM 抽象層（warroom/llm/client.py）
      │
      ├─ bedrock → AWS Bedrock Claude Sonnet 4.5
      ├─ ollama  → 本機 Ollama qwen2.5:7b
      └─ mock    → 預錄回答
      │
      ▼
回答 → 前端顯示（含對話歷史追蹤）
```

---

## 三、數據資料應用

系統整合交通流量、人群密度、路網結構及緊急應變 SOP 等資料。

### 資料來源

| 資料來源 | 主要欄位／內容 | 應用方式 |
|----------|---------------|---------|
| city_traffic_flow.csv | 路段編號、飽和度、平均車速 | 判斷壅塞分級及替代路段可用性 |
| signaling_crowd_density.csv | 站點人數、成長率、漫遊率 | 判斷車站分流、散場及多語通報條件 |
| road_network_geometry.json | 替代路線、相交路口、道路容量 | 分析主疏散路線與受影響路網 |
| emergency_traffic_sop.txt | 七條城市應變規則全文 | 提供 LLM 條款判斷與引用依據 |

### TrafficSnapshot 快照內容

原始 CSV 與 JSON 資料會先經由 data/snapshot.py 進行正規化，轉換為統一的 TrafficSnapshot。TrafficSnapshot 主要包含：

- 各路段最新飽和度與平均車速
- 各站點最新人數、成長率及漫遊率
- 各地點歷史最高人數（大巨蛋峰值判斷用）
- 可用替代路線及道路容量
- 目前接近或已超過 SOP 門檻的項目

### 處理流程

```
原始 CSV／JSON
      │
      ▼
data/snapshot.py 資料正規化
      │
      ▼
TrafficSnapshot 即時快照
      │
      ▼
轉換為結構化文字
      │
      ▼
注入 LLM System Prompt
      │
      ▼
產生 SOP 判斷與策略建議
```

透過統一快照，可確保 Dashboard、規則引擎與 AI 顧問使用同一份資料，避免不同模組之間產生數值不一致。

---

## 四、使用者流程

指揮官進入 Dashboard 後，系統會自動載入即時交通與人潮資料，並掃描是否存在接近 SOP 門檻的情況。

### 完整操作流程

```
1. 指揮官開啟 Dashboard
      │
      ▼
2. 系統掃描即時數據並顯示主動預警
      │
      ▼
3. 指揮官點擊 🐿️ 浮球
      │
      ▼
4. 展開 AI 對話式策略顧問
      │
      ├─ 選擇常用情境快捷鍵
      └─ 自行輸入 What-if 問題
      │
      ▼
5. 後端讀取 SOP、即時快照及歷史對話
      │
      ▼
6. LLM 完成條款判斷與情境分析
      │
      ▼
7. 規則引擎驗證數值及門檻
      │
      ▼
8. 回傳結論、建議處置與後續確認
      │
      ▼
9. 指揮官持續追問或調整假設條件
```

### 常用快捷情境

| 快捷鍵 | 對應問題 |
|--------|---------|
| 忠孝東路四段 A 級壅塞 | 飽和度 0.96，依 SOP 要啟動哪些措施？ |
| 光復南路 B 級壅塞 | 飽和度 0.90，是否觸發應變？ |
| 國父紀念館站人潮分流 | 目前有 40,000 人，應該怎麼分流？ |
| 大巨蛋散場條件判斷 | 人潮達 40,000 且成長率 -0.25，要散場嗎？ |
| 多語通報門檻掃描 | 目前哪些站點需要啟動多語通報？ |
| 目前壅塞級別判定 | 交通壅塞級別如何判定？ |

### 對話範例

指揮官輸入：
> 若國父紀念館站人數增加至 40,000 人，應啟動哪些措施？

AI 回答：
> 捷運國父紀念館站人潮達 40,000 人，已超過 SOP 第 3 條捷運與接駁分流門檻 25,000 人，應立即啟動分流
> ■ 建議處置：請建議北捷過站不停、通知公車處調度接駁專車，並引導群眾步行至捷運市政府站分散進站
> ■ 後續確認：若當前快照顯示外籍旅客比例達 30% 以上，需同步啟動 SOP 第 6 條多語通報

指揮官追問：
> 那目前漫遊率是否需要多語通報？

系統會延續前一輪情境，直接讀取相同地點的漫遊率並完成判斷，不需重新輸入完整背景。

---

## 五、AWS 架構

前端 Dashboard 透過 Amazon CloudFront 提供服務，使用者的查詢經由 Amazon API Gateway 傳送至部署於 AgentCore Runtime 的 FastAPI Agent。

FastAPI Agent 負責整合 SOP、即時快照、歷史對話與工具呼叫，再透過 Amazon Bedrock 使用 Claude Sonnet 4.5 完成 SOP 推理及多輪對話。

系統同時整合：

- **AgentCore Memory**：保存跨 Session 的語意記憶與指揮官偏好
- **AgentCore Gateway**：將 SOP 查詢及數據快照封裝為 MCP Tool
- **Online Evaluation**：持續評估 Goal Success Rate 與 Correctness
- **Amazon S3**：儲存需動態更新的 SOP、CSV 及 JSON 資料

### 架構圖

```
使用者／指揮官
      │
      ▼
CloudFront（Dashboard 前端）
      │
      ▼
API Gateway（REST API）
      │
      ▼
AgentCore Runtime（FastAPI Agent）
      │
      ├─── Amazon Bedrock
      │       └─ Claude Sonnet 4.5
      │           ├─ SOP 推理（What-if 判斷）
      │           └─ 多輪對話
      │
      ├─── AgentCore Memory
      │       └─ SEMANTIC + SUMMARIZATION
      │           跨 Session 記住指揮官偏好
      │
      ├─── AgentCore Gateway（MCP Tool）
      │       ├─ @tool get_sop()
      │       │     回傳 SOP 全文
      │       └─ @tool get_snapshot()
      │             回傳即時數據快照
      │
      ├─── Online Evaluation
      │       ├─ GoalSuccessRate
      │       └─ Correctness
      │
      └─── Amazon S3
              └─ SOP / CSV / JSON 資料儲存
                  （支援比賽當天動態更新）
```
