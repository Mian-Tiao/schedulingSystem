# web/ — 靜態頁面(分工開發用)

把系統拆成 4 個功能頁面,讓不同組員各自負責一頁。所有頁面共用同一套風格。

## 檔案結構

| 檔案 | 說明 | 誰改 |
|---|---|---|
| `base.css` | **共用樣式**(顏色、按鈕、表格、卡片…) | 大家共用,原則上不要改 |
| `common.js` | **共用工具**(API 呼叫、時間格式化) | 大家共用,原則上不要改 |
| `index.html` | 首頁 / 導覽 | — |
| `orders.html` | 訂單管理 | 負責人 A |
| `machines.html` | 機台管理 | 負責人 B |
| `scheduling.html` | 排程中心 | 負責人 C |
| `gantt.html` | 甘特圖(互動拖曳) | 負責人 D |
| `simulation.html` | 情境模擬 | 負責人 E |

## 怎麼跑

1. **先啟動後端**(頁面的資料都來自後端 API):
   ```bash
   cd server
   npm install      # 第一次才需要
   npm run db:push  # 第一次才需要,建立資料庫
   npm run db:seed  # 匯入示範資料(3 產品、3 機台、12 訂單)
   npm run dev      # 啟動 API:http://localhost:3001
   ```
2. **打開頁面**:直接用瀏覽器開 `web/index.html` 即可(雙擊或拖進瀏覽器)。
   - 每頁右上/頂端會顯示後端是否連上;若顯示未連線,代表後端沒開。

> 若後端不是跑在 `http://localhost:3001`,請改 `common.js` 最上面的 `API_BASE`。

## 分工規則(重要)

- **你只需要編輯自己那一頁的 `.html`**(包含頁面裡的 `<script>`)。
- 想要頁面好看又一致,**直接套用 `base.css` 的 class** 就好:
  - 按鈕:`<button class="btn btn-primary">`、`btn-secondary`、`btn-danger`、`btn-ghost`、`btn-sm`
  - 卡片:`<div class="card">`,標題 `<div class="card-title">`
  - 表格:`<div class="table-wrap"><table class="table">…`
  - 表單:`<label class="field"><span class="field-label">…</span><input class="input" /></label>`
  - 徽章:`<span class="badge badge-green">`(green/amber/red/blue/slate)
  - 提示:`<div class="banner banner-info">`(info/warn/error/success)
  - 版面:`grid grid-2 / grid-3 / grid-4`、`flex`、`between`
- **需要特殊樣式時,自己另外建立一個 css 檔**(例如 `orders.css`),在該頁 `<head>` 引入:
  ```html
  <link rel="stylesheet" href="orders.css" />
  ```
  **不要直接改 `base.css`**,否則會影響到別人的頁面。

## 呼叫後端

用 `common.js` 提供的 `api()`,它會自動處理錯誤訊息:

```js
const orders   = await api('/orders');                                  // GET
const created  = await api('/orders', { method: 'POST', body: {...} }); // POST
await api(`/orders/${id}`, { method: 'DELETE' });                       // DELETE
```

常用 API:`/products`、`/machines`、`/orders`、`/changeover-rules`、
`/schedules`、`/schedules/generate`、`/simulations/urgent-order`、
`/simulations/machine-breakdown`。完整清單見專案根目錄 `docs/IMPLEMENTATION_PLAN.md`。

> 這套靜態頁面與 `client/`(React 版)是兩套獨立前端,共用同一個後端。兩邊互不影響。
