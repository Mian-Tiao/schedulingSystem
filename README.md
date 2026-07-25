# Lean Scheduling Assistant 輕量化生產排程決策輔助工具

給沒有大型 ERP/MES/APS 的中小製造工廠使用的網頁版智慧排程系統。
輸入產品、機台與訂單資料,系統自動執行 **FIFO / EDD / SPT / CR** 四種排程演算法、
計算績效指標、推薦最適合的方案,並以**互動式甘特圖**呈現、支援拖曳微調、
急單與機台故障情境模擬,以及 AI 決策諮詢(選配)。

## 系統架構

```
schedulingSystem/
├─ docs/       規格(PRODUCT_SPEC)、假設(ASSUMPTIONS)、實作計畫(IMPLEMENTATION_PLAN)
├─ server/     Node.js + Express + TypeScript + Prisma(SQLite)
│  └─ src/modules/scheduling/   排程核心(pure functions,獨立於 API 層)
└─ client/     React + Vite + TypeScript + Tailwind CSS + TanStack Query + Zustand
```

## 安裝與啟動

需求:Node.js 20+(開發環境使用 22)。

```bash
# 1. 後端
cd server
npm install
copy .env.example .env        # macOS/Linux 用 cp
npm run db:push               # 建立 SQLite 資料庫
npm run db:seed               # 匯入示範資料(3 產品、3 機台、12 訂單)
npm run dev                   # 啟動 API:http://localhost:3001

# 2. 前端(另開終端機)
cd client
npm install
npm run dev                   # 啟動介面:http://localhost:5173
```

### 啟用 AI 諮詢(選配)

在 `server/.env` 設定:

```
ANTHROPIC_API_KEY=sk-ant-...
AI_MODEL=claude-opus-4-8
```

未設定時 AI 頁面會顯示「未啟用」,**排程等核心功能完全不受影響**。

## 測試與檢查

```bash
# 後端:66 個測試(排程引擎單元測試 + API 整合測試)
cd server
npm test
npm run typecheck
npm run lint

# 前端
cd client
npm test
npm run typecheck
npm run lint
npm run build
```

## 操作說明(建議順序)

1. **產品管理**:建立產品,設定每單位加工時間與清洗時間。
2. **機台管理**:建立機台、勾選可加工產品、設定每日工作時段(可多段,如 08:00-12:00、13:00-17:00 表達午休)、
   新增維護/停機時段、設定換模規則(從產品 A 切到 B 需要的換模與清洗分鐘數)。
3. **訂單管理**:新增訂單(產品、數量、可開始時間、交期、優先級 1-5、可用機台),
   加工時間留空會以「數量 × 產品單位時間」自動計算;支援 CSV 批次匯入、複製、篩選與搜尋。
4. **排程中心**:選擇排程目標(準時交貨/降低延遲/縮短完工時間/提高利用率/降低換模/綜合平衡)→
   執行排程 → 系統跑完四種演算法後顯示**推薦前三名**、每方案分數、推薦原因(與 FIFO 基準比較)與完整績效比較表。
5. **甘特圖**:
   - 上方切換方案、日/班次/小時檢視、縮放。
   - **拖曳藍色生產區塊**可改開始時間或拖到其他機台列(15 分鐘吸附、即時時間提示)。
   - 放開後由後端驗證:不合法(不支援產品、重疊、非工作時段、早於可開始時間…)會**彈回並顯示原因**;
     合法則自動重算換模/清洗、後續工作與所有績效,並顯示**調整前後差異**。
   - 支援 ↩ 復原 / ↪ 重做 / ⟲ 回復原始排程。
6. **情境模擬**:
   - **急單插入**: 比較「插入目前排程(既有訂單不動)」與「全部重排」兩種策略的交期影響。結果區塊下方提供「套用此策略」按鈕，可模擬套用結果並跳轉至甘特圖。
   - **機台故障**: 輸入故障機台與預估修復時間 → 顯示哪些訂單會延遲多久、
     反向計算「最晚幾點修好才不會讓重要訂單逾期」、轉移機台與處理順序建議。結果下方提供「套用故障調整」按鈕，可模擬套用結果並跳轉至甘特圖。
7. **AI 諮詢**: 以真實排程數據回答「為什麼這個方案第一?」「哪台機台是瓶頸?」等問題。

## 排程模型(MVP 假設)

- 一張訂單一道工序;non-preemptive(開始後不可中斷,須完整落在單一連續工作時段內)。
- 訂單須在 release time 後開始;避開維護、停機、非工作時段。
- 不同產品切換自動插入換模(setup)與清洗(cleaning)時段,查找順序:
  機台+產品對規則 → 全域規則 → 機台預設值;同產品連續生產免換模。
- 機台分派:取「最早完成」者,同分依換模時間短 → 負載低 → 機台編號小。
- 排程結果 deterministic:相同輸入必得相同輸出。
- CR 於排程過程中依目前模擬時間動態重算。

完整假設清單見 [docs/ASSUMPTIONS.md](docs/ASSUMPTIONS.md)。

## API 摘要

`/api/products`、`/api/machines`(含 `/downtimes`)、`/api/changeover-rules`、
`/api/orders`(含 `/import`、`/:id/duplicate`)、
`/api/schedules/generate|:id|:id/validate-adjustment|:id/adjust|:id/reset|:id/recalculate`、
`/api/simulations/urgent-order|machine-breakdown`、`/api/ai/analyze|chat|status`、`/api/dashboard`。

### 預留之情境模擬套用 API 規格 (未來整合用)
為了將來能正式將模擬結果寫入排程與資料庫，後端需實作以下兩個 API：

1. **套用急單模擬結果**
   * **路徑**: `POST /api/simulations/urgent-order/apply`
   * **請求內容**:
     ```json
     {
       "scenarioId": "string (基準排程 ID)",
       "strategy": "insert | rebuild",
       "order": {
         "orderNumber": "string",
         "productId": "string",
         "quantity": "number",
         "releaseTime": "ISO-8601 string",
         "dueDate": "ISO-8601 string",
         "priority": "number",
         "processingTime": "number (optional)"
       }
     }
     ```
   * **預期行為**:
     1. **【重要】** 將該急單正式新增至 `ProductionOrder` 資料庫表中，使其進入「訂單管理」系統（狀態設為 `SCHEDULED`），在訂單列表中可被查詢。
     2. 若 `strategy === 'insert'`，分別在現有的 4 個排程方案中執行直接插入，更新任務與 `baselineTasks`；若有方案無法插入，回傳錯誤（回滾資料庫）。
     3. 若 `strategy === 'rebuild'`，將急單加入後以原 objective 重新跑排程引擎，覆蓋資料庫中的方案任務。

2. **套用機台故障結果**
   * **路徑**: `POST /api/simulations/machine-breakdown/apply`
   * **請求內容**:
     ```json
     {
       "scenarioId": "string (基準排程 ID)",
       "machineId": "string",
       "startTime": "ISO-8601 string",
       "estimatedRepairTime": "ISO-8601 string"
     }
     ```
   * **預期行為**:
     1. 將故障時段寫入 `MachineDowntime` 表，類型為 `breakdown`。
     2. 以原排程目標重新執行排程引擎，避開該機台故障時段，覆蓋資料庫中的方案任務。

錯誤格式統一為 `{ "error": { "code", "message" } }`,訊息皆為繁體中文。
時間儲存 ISO 8601,顯示時區 Asia/Taipei。

## 示範資料說明

`npm run db:seed` 建立的資料刻意設計成:

- 交期寬鬆的大單建立在前、急件建立在後 → **FIFO 下會有多張訂單逾期**;
- EDD / CR 可將準時交貨率由 67% 拉到 83%,四種演算法結果明顯不同;
- 含 2 個維護時段、4 組換模規則、1 張高優先級急單(PO-URGENT-001)。

日期以「執行 seed 當天」為基準展開,隨時執行都能直接展示。
