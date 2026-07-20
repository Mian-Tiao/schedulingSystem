# Lean Scheduling Assistant — 產品規格

輕量化生產排程決策輔助工具。目標使用者為沒有大型 ERP/MES/APS 預算的中小製造企業,
仍以 Excel、白板安排生產的工廠現場管理者。本系統不是 ERP,而是「生產排程決策輔助工具」。

## 核心流程

1. 建立產品資料(加工時間、清洗時間)。
2. 建立機台資料(可加工產品、工作時段、維護時間、換模/清洗時間)。
3. 輸入待生產訂單(產品、數量、release time、交期、優先級、可用機台)。
4. 選擇排程目標(準時交貨 / 降低延遲 / 縮短 Makespan / 提高利用率 / 降低換模清洗 / 綜合平衡)。
5. 系統執行 FIFO、EDD、SPT、CR 四種演算法,產生方案並計算績效指標。
6. 依目標權重正規化計分,推薦前三名方案並說明原因(相較 FIFO 基準的改善)。
7. 互動式甘特圖檢視,可拖曳微調(檢查衝突、重算換模與績效、undo/redo、還原)。
8. 情境模擬:急單插入、機台故障。
9. AI 以真實排程數據解釋方案優缺點(不取代排程引擎,失敗時不影響核心功能)。

## MVP 排程模型假設

- 一張訂單只含一道主要加工作業(資料結構保留多製程 Routing 擴充空間)。
- 一張訂單可指定一台或多台可加工機台;每台機台同一時間只能加工一張訂單。
- Non-preemptive:開始後不可拆分或暫停。
- 訂單必須在 release time 之後開始;必須完整安排在機台可用時段內。
- 機台在維護、停機、非工作時段不能安排工作。
- 切換不同產品需插入換模(setup)與清洗(cleaning)時段,佔用機台、不可重疊。

## 資料模型

| Entity | 欄位 |
|---|---|
| Product | id, productCode, productName, description, defaultProcessingTime(min/unit), defaultCleaningTime(min), createdAt, updatedAt |
| Machine | id, machineCode, machineName, model, description, supportedProductIds[], defaultSetupTime, defaultCleaningTime, workingHours(週時段表), status(available/maintenance/disabled), createdAt, updatedAt |
| MachineDowntime | id, machineId, type(maintenance/breakdown/plannedStop/other), startTime, endTime, reason |
| ChangeoverRule | id, machineId(可空=全機台), fromProductId, toProductId, setupMinutes, cleaningMinutes |
| ProductionOrder | id, orderNumber, productId, quantity, releaseTime, dueDate, processingTime(min), priority(1-5), eligibleMachineIds[], status(pending/scheduled/inProgress/completed/cancelled), notes, createdAt, updatedAt |
| ScheduleScenario | id, name, algorithm, objective, generatedAt, metrics(JSON), score, recommendationReason, isManuallyAdjusted |
| ScheduledTask | id, scenarioId, orderId, machineId, taskType(production/setup/cleaning/maintenance), startTime, endTime, sequence, isManuallyAdjusted |

## 排程演算法

- **FIFO**:依訂單 createdAt(進池順序)。
- **EDD**:dueDate 由早到晚。
- **SPT**:processingTime 由短到長。
- **CR**:CR = 剩餘交期時間 ÷ 剩餘加工時間,越小越緊急;於排程過程中依目前模擬時間重新計算(非一次性)。
- 使用者自訂 priority 作為 tie-break(數字小者優先)。

### 機台分派

每次安排訂單:找可用機台 → 排除 disabled → 計算各機台最早可開始時間(避開維護/停機/休息/非工作時段)
→ 檢查前一產品是否需換模/清洗並插入時段 → 選最早完成者。
同分 tie-break:完成時間早 → 換模時間短 → 機台負載低 → machineCode 小。
排程結果 deterministic:相同輸入產生相同輸出。

## 績效指標

Makespan、平均延遲、最大延遲、準時交貨率、機台利用率(純生產 + 含換模清洗)、
總換模時間、總清洗時間、平均流程時間(release→completion)、延遲訂單數。
全部由真實排程結果計算,禁止 hard-code。

## 方案推薦

指標正規化(min-max)後依目標權重加權計分(權重集中於 `ranking/weights.ts`),
顯示前三名、各方案分數、推薦原因、相較 FIFO 基準改善幅度。

## API

見 `docs/IMPLEMENTATION_PLAN.md` API 一節;所有 API 具輸入驗證(zod)與一致錯誤格式
`{ error: { code, message } }`,錯誤訊息為繁體中文。

## 前端頁面

Dashboard、訂單管理(CRUD/複製/CSV 匯入/篩選)、產品管理、機台管理(工作時段/維護/換模規則)、
排程中心(目標選擇/方案比較/推薦)、甘特圖排程頁(拖曳/衝突/undo/redo/還原)、
情境模擬(急單/故障)、AI 決策諮詢。

## 非功能需求

- 時間儲存 ISO 8601;顯示時區 Asia/Taipei。
- API key 使用 .env(附 .env.example),不寫死於程式碼。
- 基本 logging、loading/empty/error state、排程進度顯示。
- 100 張訂單 × 10 台機台需在合理時間完成。
- AI 停用時核心排程功能正常。

## MVP 不做

ERP 財務、採購、庫存最佳化、MRP、薪資、多工廠、IoT 串接、多製程 Job Shop 最佳化、
基因演算法/數學規劃求解器、自動改排程的 AI Agent。架構保留擴充空間。
