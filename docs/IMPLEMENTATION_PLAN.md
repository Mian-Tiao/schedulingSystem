# IMPLEMENTATION PLAN

## 專案結構

```
schedulingSystem/
├─ docs/                      # 規格、假設、計畫
├─ server/                    # Node.js + Express + TypeScript
│  ├─ prisma/                 # schema.prisma、migrations、seed.ts
│  └─ src/
│     ├─ modules/
│     │  ├─ orders/           # controller + repository + validation
│     │  ├─ products/
│     │  ├─ machines/         # 含 downtimes、changeover rules
│     │  ├─ scheduling/
│     │  │  ├─ algorithms/    # fifo.ts edd.ts spt.ts criticalRatio.ts
│     │  │  ├─ engine/        # 排程引擎(pure functions)
│     │  │  │  ├─ types.ts            # domain model
│     │  │  │  ├─ calendar.ts         # 機台可用時間計算
│     │  │  │  ├─ changeover.ts       # setup/cleaning 查找
│     │  │  │  ├─ engine.ts           # 分派邏輯
│     │  │  │  └─ adjust.ts           # 手動調整驗證與重排
│     │  │  ├─ metrics/       # metrics calculator
│     │  │  ├─ ranking/       # 正規化、權重(weights.ts)、推薦
│     │  │  └─ validators/    # 資料合法性檢查
│     │  ├─ scenarios/        # scenario 儲存/查詢
│     │  ├─ simulations/      # 急單、機台故障
│     │  └─ ai/               # prompt builder + Claude client
│     ├─ shared/              # errors、logger、zod helpers
│     └─ app.ts / index.ts
└─ client/                    # React + Vite + TS + Tailwind
   └─ src/
      ├─ api/                 # TanStack Query hooks
      ├─ components/          # 共用元件、Gantt
      ├─ pages/               # 8 個頁面
      ├─ stores/              # Zustand(甘特圖 undo/redo)
      └─ utils/               # 時間格式化(Asia/Taipei)
```

## 技術選型

- 後端:Node 22、Express 4、TypeScript、Prisma + SQLite、zod、pino(logging)、tsx(dev)
- 排程核心:pure functions,不依賴 Express/Prisma,可獨立測試
- 測試:Vitest(引擎單元測試 + API 整合測試 supertest)
- 前端:Vite、React 18、TypeScript、Tailwind CSS、Zustand、TanStack Query
- 甘特圖:自製(絕對定位 + pointer events 拖曳),不用靜態圖表庫
- AI:@anthropic-ai/sdk,結構化 JSON 輸入 + 防捏造 system prompt

## API 一覽

| Method | Path | 說明 |
|---|---|---|
| GET/POST | /api/orders | 列表(篩選)/新增 |
| PUT/DELETE | /api/orders/:id | 修改/刪除 |
| POST | /api/orders/import | CSV 批次匯入 |
| GET/POST | /api/products | 列表/新增 |
| PUT/DELETE | /api/products/:id | 修改/刪除 |
| GET/POST | /api/machines | 列表/新增 |
| PUT/DELETE | /api/machines/:id | 修改/刪除 |
| GET/POST | /api/machines/:id/downtimes | 停機時段 |
| DELETE | /api/machines/:id/downtimes/:downtimeId | 刪除停機時段 |
| GET/POST | /api/changeover-rules, DELETE /:id | 換模規則 |
| POST | /api/schedules/generate | 執行全部演算法、產生方案、排名 |
| GET | /api/schedules | 方案列表 |
| GET | /api/schedules/:scenarioId | 方案內容(tasks+metrics) |
| POST | /api/schedules/:scenarioId/validate-adjustment | 拖曳前驗證 |
| POST | /api/schedules/:scenarioId/adjust | 套用調整並重算 |
| POST | /api/schedules/:scenarioId/recalculate | 重算績效 |
| POST | /api/schedules/:scenarioId/reset | 回復原始排程 |
| POST | /api/simulations/urgent-order | 急單模擬 |
| POST | /api/simulations/machine-breakdown | 故障模擬 |
| POST | /api/ai/analyze | 排程結果分析 |
| POST | /api/ai/chat | 對話 |
| GET | /api/dashboard | Dashboard 統計 |

錯誤格式統一:`{ "error": { "code": "NO_ELIGIBLE_MACHINE", "message": "訂單 PO-001 沒有可加工的機台" } }`

## 開發順序(依規格 Phase)

1. **Phase 1** 文件與骨架(本文件)
2. **Phase 2** 排程核心 + 單元測試(calendar → changeover → algorithms → engine → metrics → ranking)
3. **Phase 3** Prisma schema、CRUD、排程/調整/模擬 API、seed data
4. **Phase 4** 前端 Layout → 管理頁 → 排程中心 → 甘特圖 → Dashboard → 模擬頁
5. **Phase 5** AI prompt builder、analyze/chat API、對話視窗、降級處理

每階段完成後執行 lint、type check、測試。

## 技術風險

1. **甘特圖拖曳互動複雜度**:自製元件需處理縮放、吸附、跨機台拖曳;以「候選位置驗證 API」把合法性判斷放後端,前端只做樂觀預覽。
2. **CR 動態重算**:模擬時間推進定義需一致,否則不 deterministic;以引擎內單一時鐘來源解決。
3. **跨工作時段的長訂單**:production 依可用時段切成多段,setup/cleaning 仍維持單一連續區段;績效以最後一段完成時間計算。
4. **SQLite 併發**:MVP 單人使用,可接受;repository 層隔離方便換 PostgreSQL。
5. **AI 幻覺**:只餵結構化 JSON、system prompt 禁止捏造、回答須引用數據;AI 掛掉不影響核心。
6. **100 訂單 × 10 機台效能**:greedy 演算法 O(n·m·windows),遠低於秒級;seed 加壓力測試驗證。
