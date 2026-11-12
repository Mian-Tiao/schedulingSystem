# 射出排程 — 已完成內容(feat/factory-mvp)

> 本分支目前完成的部分與交接說明。資料全用假資料開發,真實製令/客戶資料不進 repo。

## 📦 資料庫 schema(`server/prisma/schema.prisma`)

| 資料表 | 新增欄位 |
|--------|----------|
| **Machine 機台** | `tonnage` 噸數、`machineType` 類型、`manufacturer` 製造商、`dailyHours` 每日可用時數(預設 22)、`suggestedOperators` 顧機人數、`shotCapacityG` 射出容量、`allowedMaterials` 可做料 |
| **Mold 模具(全新表)** | `copies` 副數、`requiredTonnage` 需求噸數、`allowedMachines` 可上機台;系統自動建、`name` 帶品名 |
| **Product 產品** | `customer` 客戶、`cavityCount` 穴數、`cycleSeconds` 秒數、`material` 材質、`moldId` 指向模具 |
| **ProductionOrder 製令** | `customer`、`plant` 廠別、`urgent` 急、`orderType` 廠內外、`cavityCount`、`cycleSeconds`、`requiredTonnage` |

> 全部可空值/預設值,不影響學校版。

## ⚙️ 後端(`server/src/modules/products/router.ts`)

- 產品 API 加 **穴數 / 秒數 / 客戶 / 材質**(`defaultProcessingTime` 改選填)
- **新增產品 → 自動建一副模具**(transaction,預設副數 1)並連結
- 產品可連帶編輯模具欄位(副數 / 需求噸數 / 可上機台)
- GET 帶出模具、`allowedMachines` 還原成陣列
- **刪產品連帶刪模具**;共模(多產品指同一模)時保留

## 🖥️ 前端

- **`client/src/types.ts`**:新增 `Mold` 型別,`Product` 擴充射出欄位
- **`client/src/pages/ProductsPage.tsx`**
  - 表單加「射出成型區」(客戶 / 材質 / 穴數 / 秒數 + 加工時間即時預估)
  - 「模具區」(副數 / 需求噸數 / 可上機台勾選)
  - 列表顯示「10穴·40秒·客戶」
  - **「可加工機台」欄改讀模具的可上機台**(修正顯示「尚無機台可加工」的問題)
- **`client/src/components/ui.tsx`**:Modal **點背景不再關閉**(避免表單填一半誤關;✕ / Esc 仍可關)

## 🔑 重要約定(給接手機台頁的人)

- **能力(哪台機能做哪個產品)的單一來源 = 模具的 `allowedMachines`**,在產品/模具頁設一次即可。
- 機台頁**不要**再做一套「可加工產品」的雙向維護;要顯示就做**唯讀反查**(本機可生產產品)。
- 機台的噸數 / 類型 / 每日時數等欄位 **schema 已經有了**,機台頁只需做 API + 畫面。

## ⏳ 尚未做(邊界)

機台頁 UI、seed 真實機台 / 假產品、製令匯入、**按日排程引擎(M4)** —— 穴數 / 秒數目前只存,還沒接進排程。

## 進度對應里程碑

完整 MVP 計畫見 `docs/factory-mvp-plan.md`(§7 里程碑)。本分支已完成 M1 的 schema 部分與 M2 的產品/模具部分。

commit:`ed47022 → e761a65 → 3034a47 → cb6d81a → aa6dcd2 → 52b65e7`
