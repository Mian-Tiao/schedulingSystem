# ASSUMPTIONS — 規格未明定時採用的預設值

依規格指示,資訊不足處採用合理預設並記錄於此,不停止工作等待回答。

## 時間與單位

1. 所有時間長度欄位(processingTime、setupMinutes、cleaningMinutes 等)單位為**分鐘**。
2. `Product.defaultProcessingTime` 為**每單位**加工分鐘數;訂單 processingTime 未填時 = `quantity × defaultProcessingTime`。
3. 時間儲存為 ISO 8601 字串(UTC 或含時區偏移);前端顯示一律轉 Asia/Taipei。
4. 排程起點(anchor):`max(now, 最早訂單 releaseTime)`,可由 API 參數覆寫,以便測試 deterministic。
5. 排程 horizon:自排程起點起 60 天;若訂單在 horizon 內無法完成,回報為錯誤(「所有機台都無法在規劃期間完成訂單」)。

## 機台與行事曆

6. `Machine.workingHours` 結構:`{ mon..sun: [{start:"08:00", end:"17:00"}] }`,空陣列 = 當日不工作。
7. 「休息時間」以工作時段切割表達(例:08:00-12:00 與 13:00-17:00 = 中午休息),不另設 break 實體;每週重複的休息(如週一午休)也可用 `plannedStop` downtime 表達。
8. `status = maintenance` 的機台仍可排程,但其 downtime 時段會被避開;`disabled` 機台完全排除。
9. production 總工時可跨午休、下班、維護與隔日分段續做,每一段必須落在機台可用時段內;setup/cleaning 不可中斷,須落在單一可用區段內,並在 production 前依 cleaning → setup → production 排列。
10. 機台「前一個產品」狀態:每個 scenario 排程開始時機台視為空機(無前產品),第一張訂單只需 setup(採規格 ChangeoverRule 之 fromProductId 可為 null 表「空機→產品」;若無規則,空機首單不加 setup)。

## 換模規則

11. ChangeoverRule 查找順序:精確(machineId+from+to)→ 機台通用(machineId+to, from=null)→ 全域(machineId=null, from+to)→ 機台預設(defaultSetupTime/defaultCleaningTime)。
12. 同產品連續生產不需 setup/cleaning。
13. setup/cleaning 分鐘為 0 時不產生對應 task。

## 排程演算法

14. FIFO 排序鍵:createdAt,tie-break orderNumber。
15. SPT/EDD tie-break:priority(小者優先)→ createdAt → orderNumber。
16. CR 之「目前模擬時間」= 尚未排程訂單決策當下,所有候選機台最早可用時間的最小值;CR 相同時依 priority → dueDate → orderNumber。
17. priority:1 最高、5 最低,預設 3。
18. 演算法比較時每個 algorithm 產生一個 scenario;「使用者自訂優先級」不是獨立演算法,而是所有演算法的 tie-break 依據。

## 手動調整

19. 拖曳調整只允許移動 production 任務;其 setup/cleaning 由系統自動跟隨重算。
20. 合法調整後,同機台後續任務依序往後推移(保持原順序),其他機台任務不動;全部重算績效。
21. 調整結果存回 scenario(isManuallyAdjusted = true),原始排程另存 baseline 供「回復原始排程」。

## 情境模擬

22. 急單插入「插入目前排程」策略:已排程訂單保持機台與順序,急單以最早完成原則插入空隙或隊尾;「重新計算全部排程」策略:全部訂單(含急單)重跑演算法。
23. 機台故障模擬不寫入正式資料,只回傳模擬結果;使用者可選擇套用(以 downtime 形式寫入後重排)。
24. 「重要訂單」定義:priority ≤ 2 的訂單;反向計算最晚修復時間以 30 分鐘為步長二分搜尋。

## AI

25. AI 供應商:Anthropic Claude API,金鑰放 `server/.env` 的 `ANTHROPIC_API_KEY`;未設定時 AI 頁顯示「AI 功能未啟用」,其他功能正常。
26. AI 僅收到結構化 JSON(指標、目標、延遲訂單、機台負載、換模次數、調整內容、情境),system prompt 明令不可捏造數據。

## 其他

27. 資料庫:SQLite + Prisma;陣列欄位(supportedProductIds、eligibleMachineIds)以 JSON 字串儲存,repository 層負責轉換,以便未來換 PostgreSQL。
28. CSV 匯入欄位:orderNumber,productCode,quantity,releaseTime,dueDate,processingTime,priority,eligibleMachineCodes(分號分隔),notes;processingTime/eligibleMachineCodes 可留空(套用預設)。
29. 訂單狀態流轉 MVP 只用 pending/scheduled;inProgress/completed/cancelled 保留欄位值供未來使用。
30. 認證/多使用者:MVP 不實作。
31. metrics 中 `machineUtilizationRate` 分母「機台可使用時間」= horizon 內(排程起點至最晚任務結束)各機台工作時段扣除 downtime 的總分鐘數;僅計入有被使用的機台。
