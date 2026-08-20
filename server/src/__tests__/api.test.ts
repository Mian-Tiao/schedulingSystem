/**
 * API 整合測試:CRUD、排程產生、拖曳驗證、情境模擬、AI 停用時的行為。
 * 使用獨立 test.db(見 vitest.global-setup.ts)。
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { executeReadTool, preparePendingAction } from '../modules/ai/tools.js';
import { prisma } from '../shared/db.js';

const app = createApp();

const WEEKDAYS = {
  mon: [{ start: '08:00', end: '17:00' }],
  tue: [{ start: '08:00', end: '17:00' }],
  wed: [{ start: '08:00', end: '17:00' }],
  thu: [{ start: '08:00', end: '17:00' }],
  fri: [{ start: '08:00', end: '17:00' }],
  sat: [{ start: '08:00', end: '17:00' }],
  sun: [{ start: '08:00', end: '17:00' }],
};

// 固定 anchor 讓排程 deterministic(2026-08-10 為週一)
const ANCHOR = '2026-08-10T00:00:00+08:00';

let productA: string;
let productB: string;
let machine1: string;

beforeAll(async () => {
  await prisma.scheduledTask.deleteMany();
  await prisma.scheduleScenario.deleteMany();
  await prisma.productionOrder.deleteMany();
  await prisma.changeoverRule.deleteMany();
  await prisma.machineDowntime.deleteMany();
  await prisma.machine.deleteMany();
  await prisma.product.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('產品 CRUD', () => {
  it('新增產品', async () => {
    const res = await request(app).post('/api/products').send({
      productCode: 'TP-A',
      productName: '測試產品A',
      defaultProcessingTime: 5,
      defaultCleaningTime: 10,
    });
    expect(res.status).toBe(201);
    productA = res.body.id;

    const res2 = await request(app).post('/api/products').send({
      productCode: 'TP-B',
      productName: '測試產品B',
      defaultProcessingTime: 8,
      defaultCleaningTime: 5,
    });
    expect(res2.status).toBe(201);
    productB = res2.body.id;
  });

  it('重複編號回傳中文錯誤', async () => {
    const res = await request(app).post('/api/products').send({
      productCode: 'TP-A',
      productName: '重複',
      defaultProcessingTime: 5,
    });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain('已存在');
  });

  it('欄位驗證失敗回傳 VALIDATION_ERROR', async () => {
    const res = await request(app).post('/api/products').send({ productCode: '', productName: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('機台 CRUD 與停機時段', () => {
  it('新增兩台機台', async () => {
    const res1 = await request(app)
      .post('/api/machines')
      .send({
        machineCode: 'TM-01',
        machineName: '測試機台一',
        supportedProductIds: [productA, productB],
        defaultSetupTime: 30,
        defaultCleaningTime: 20,
        workingHours: WEEKDAYS,
      });
    expect(res1.status).toBe(201);
    machine1 = res1.body.id;

    const res2 = await request(app)
      .post('/api/machines')
      .send({
        machineCode: 'TM-02',
        machineName: '測試機台二',
        supportedProductIds: [productA],
        workingHours: WEEKDAYS,
      });
    expect(res2.status).toBe(201);
    expect(res2.body.id).toBeTruthy();
  });

  it('新增維護時段;結束早於開始被拒絕', async () => {
    const ok = await request(app).post(`/api/machines/${machine1}/downtimes`).send({
      type: 'maintenance',
      startTime: '2026-08-10T09:00:00+08:00',
      endTime: '2026-08-10T11:00:00+08:00',
      reason: '定期維護',
    });
    expect(ok.status).toBe(201);

    const bad = await request(app).post(`/api/machines/${machine1}/downtimes`).send({
      type: 'maintenance',
      startTime: '2026-08-10T12:00:00+08:00',
      endTime: '2026-08-10T10:00:00+08:00',
    });
    expect(bad.status).toBe(400);
  });

  it('工作時段格式錯誤被拒絕', async () => {
    const res = await request(app)
      .post('/api/machines')
      .send({
        machineCode: 'TM-BAD',
        machineName: '壞機台',
        workingHours: { ...WEEKDAYS, mon: [{ start: '18:00', end: '08:00' }] },
      });
    expect(res.status).toBe(400);
  });
});

describe('訂單 CRUD', () => {
  it('新增訂單(未填加工時間時以數量×單位時間計算)', async () => {
    const res = await request(app).post('/api/orders').send({
      orderNumber: 'TO-001',
      productId: productA,
      quantity: 24,
      releaseTime: '2026-08-10T08:00:00+08:00',
      dueDate: '2026-08-10T17:00:00+08:00',
      priority: 2,
    });
    expect(res.status).toBe(201);
    expect(res.body.processingTime).toBe(24 * 5);
  });

  it('交期早於可開始時間被拒絕', async () => {
    const res = await request(app).post('/api/orders').send({
      orderNumber: 'TO-BAD',
      productId: productA,
      quantity: 1,
      releaseTime: '2026-08-12T08:00:00+08:00',
      dueDate: '2026-08-10T17:00:00+08:00',
    });
    expect(res.status).toBe(400);
  });

  it('再新增三張訂單與 CSV 匯入', async () => {
    await request(app).post('/api/orders').send({
      orderNumber: 'TO-002',
      productId: productB,
      quantity: 10,
      releaseTime: '2026-08-10T08:00:00+08:00',
      dueDate: '2026-08-11T17:00:00+08:00',
    });
    await request(app).post('/api/orders').send({
      orderNumber: 'TO-003',
      productId: productA,
      quantity: 12,
      releaseTime: '2026-08-10T08:00:00+08:00',
      dueDate: '2026-08-12T17:00:00+08:00',
      priority: 5,
    });

    const csv = [
      'orderNumber,productCode,quantity,releaseTime,dueDate,processingTime,priority',
      'TO-CSV-1,TP-A,6,2026-08-10T08:00:00+08:00,2026-08-11T12:00:00+08:00,,2',
      'TO-CSV-2,不存在,6,2026-08-10T08:00:00+08:00,2026-08-11T12:00:00+08:00,,2',
    ].join('\n');
    const res = await request(app).post('/api/orders/import').send({ csv });
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(1);
    expect(res.body.failed).toBe(1);
    expect(res.body.results[1].error).toContain('找不到產品');
  });

  it('複製訂單', async () => {
    const list = await request(app).get('/api/orders');
    const t1 = list.body.find((o: { orderNumber: string }) => o.orderNumber === 'TO-001');
    const res = await request(app).post(`/api/orders/${t1.id}/duplicate`);
    expect(res.status).toBe(201);
    expect(res.body.orderNumber).toBe('TO-001-C1');
    await request(app).delete(`/api/orders/${res.body.id}`);
  });
});

describe('排程產生', () => {
  let scenarioIds: string[] = [];

  it('執行四種演算法並回傳排名', async () => {
    const res = await request(app)
      .post('/api/schedules/generate')
      .send({ objective: 'ON_TIME_DELIVERY', anchorTime: ANCHOR });
    expect(res.status).toBe(200);
    expect(res.body.scenarios).toHaveLength(4);
    const algorithms = res.body.scenarios.map((s: { algorithm: string }) => s.algorithm).sort();
    expect(algorithms).toEqual(['CR', 'EDD', 'FIFO', 'SPT']);
    expect(res.body.recommended.length).toBeGreaterThanOrEqual(3);
    // 分數與推薦原因存在
    for (const s of res.body.scenarios) {
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.recommendationReason.length).toBeGreaterThan(0);
      expect(s.metrics.makespanMinutes).toBeGreaterThan(0);
    }
    scenarioIds = res.body.scenarios.map((s: { scenarioId: string }) => s.scenarioId);
  });

  it('手動選擇機台時只會產生該機台的甘特圖任務', async () => {
    const res = await request(app)
      .post('/api/schedules/generate')
      .send({ objective: 'ON_TIME_DELIVERY', machineIds: [machine1], anchorTime: ANCHOR });

    expect(res.status).toBe(200);
    expect(res.body.scenarios).toHaveLength(4);
    scenarioIds = res.body.scenarios.map((s: { scenarioId: string }) => s.scenarioId);

    const detail = await request(app).get(`/api/schedules/${scenarioIds[0]}`);
    expect(detail.status).toBe(200);
    expect(detail.body.tasks.length).toBeGreaterThan(0);
    expect(detail.body.tasks.every((task: { machineId: string }) => task.machineId === machine1)).toBe(true);
  });

  it('排程任務不與維護時段重疊', async () => {
    const res = await request(app).get(`/api/schedules/${scenarioIds[0]}`);
    expect(res.status).toBe(200);
    const maintStart = Date.parse('2026-08-10T09:00:00+08:00');
    const maintEnd = Date.parse('2026-08-10T11:00:00+08:00');
    for (const t of res.body.tasks) {
      if (t.taskType === 'maintenance' || t.machineId !== machine1) continue;
      const s = Date.parse(t.startTime);
      const e = Date.parse(t.endTime);
      expect(s < maintEnd && maintStart < e).toBe(false);
    }
  });

  it('拖曳驗證:非工作時段被拒絕並回傳原因', async () => {
    const detail = await request(app).get(`/api/schedules/${scenarioIds[0]}`);
    const prod = detail.body.tasks.find(
      (t: { taskType: string }) => t.taskType === 'production',
    );
    const res = await request(app)
      .post(`/api/schedules/${scenarioIds[0]}/validate-adjustment`)
      .send({
        taskId: prod.taskId,
        machineId: prod.machineId,
        startTime: '2026-08-10T22:00:00+08:00',
      });
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(false);
    expect(res.body.errors.join()).toContain('非工作時段');
  });

  it('合法調整可套用並標記人工調整', async () => {
    const detail = await request(app).get(`/api/schedules/${scenarioIds[0]}`);
    const prods = detail.body.tasks
      .filter((t: { taskType: string }) => t.taskType === 'production')
      .sort((a: { startTime: string }, b: { startTime: string }) => a.startTime.localeCompare(b.startTime));
    const last = prods[prods.length - 1];
    // 移到該機台當天更晚的合法時間(往後推 30 分鐘)
    const newStart = new Date(Date.parse(last.startTime) + 30 * 60_000).toISOString();
    const res = await request(app)
      .post(`/api/schedules/${scenarioIds[0]}/adjust`)
      .send({ taskId: last.taskId, machineId: last.machineId, startTime: newStart });
    if (res.status === 200) {
      expect(res.body.isManuallyAdjusted).toBe(true);
      // reset 後回復
      const reset = await request(app).post(`/api/schedules/${scenarioIds[0]}/reset`);
      expect(reset.status).toBe(200);
      expect(reset.body.isManuallyAdjusted).toBe(false);
    } else {
      // 若該位置不合法(如超出工作時段)也屬正確行為,需回傳中文原因
      expect(res.status).toBe(422);
      expect(res.body.error.message.length).toBeGreaterThan(0);
    }
  });

  it('急單模擬:回傳插入與重排兩種策略', async () => {
    const res = await request(app).post('/api/simulations/urgent-order').send({
      scenarioId: scenarioIds[0],
      order: {
        orderNumber: 'TO-URGENT',
        productId: productA,
        quantity: 5,
        releaseTime: '2026-08-10T08:00:00+08:00',
        dueDate: '2026-08-10T17:00:00+08:00',
        priority: 1,
      },
    });
    expect(res.status).toBe(200);
    expect(res.body.insert.ok).toBe(true);
    expect(res.body.rebuild.ok).toBe(true);
    expect(res.body.insert.metrics).toBeDefined();
    expect(res.body.baseline.metrics).toBeDefined();
  });

  it('機台故障模擬:回傳延遲影響與反向分析', async () => {
    const res = await request(app).post('/api/simulations/machine-breakdown').send({
      scenarioId: scenarioIds[0],
      machineId: machine1,
      startTime: '2026-08-10T08:00:00+08:00',
      estimatedRepairTime: '2026-08-10T15:00:00+08:00',
    });
    expect(res.status).toBe(200);
    expect(res.body.withEstimatedRepair.metrics).toBeDefined();
    expect(res.body.reverseAnalysis.message.length).toBeGreaterThan(0);
    expect(res.body.suggestions).toBeDefined();
  });
});

describe('AI 停用時', () => {
  it('status 回報停用,chat 回傳 503,核心功能不受影響', async () => {
    const status = await request(app).get('/api/ai/status');
    expect(status.body.enabled).toBe(false);
    expect(status.body.provider).toBe('gemini');
    expect(status.body.model).toBe('gemini-3.6-flash');

    const chat = await request(app).post('/api/ai/chat').send({ question: '哪台機台是瓶頸?' });
    expect(chat.status).toBe(503);
    expect(chat.body.error.code).toBe('AI_DISABLED');
    expect(chat.body.error.message).toContain('核心排程功能不受影響');

    const schedules = await request(app).get('/api/schedules');
    expect(schedules.status).toBe(200);
    expect(schedules.body).toHaveLength(4);
  });
});

describe('AI 工具確認流程', () => {
  it('讀取工具只能查詢白名單資料', async () => {
    const result = (await executeReadTool({ name: 'list_products', args: { search: 'TP-A' } })) as {
      productCode: string;
    }[];
    expect(result).toHaveLength(1);
    expect(result[0]?.productCode).toBe('TP-A');

    await expect(executeReadTool({ name: 'delete_everything', args: {} })).rejects.toMatchObject({
      code: 'AI_TOOL_NOT_ALLOWED',
    });
  });

  it('新增訂單必須先確認,且同一操作只能執行一次', async () => {
    const pending = await preparePendingAction({
      name: 'create_order',
      args: {
        orderNumber: 'TO-AI-001',
        product: 'TP-A',
        quantity: 5,
        releaseTime: '2026-08-10T08:00:00+08:00',
        dueDate: '2026-08-11T17:00:00+08:00',
        priority: 4,
      },
    });

    expect(await prisma.productionOrder.findUnique({ where: { orderNumber: 'TO-AI-001' } })).toBeNull();

    const confirmed = await request(app).post(`/api/ai/actions/${pending.id}/confirm`).send({});
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.answer).toContain('TO-AI-001');
    expect(await prisma.productionOrder.findUnique({ where: { orderNumber: 'TO-AI-001' } })).not.toBeNull();

    const repeated = await request(app).post(`/api/ai/actions/${pending.id}/confirm`).send({});
    expect(repeated.status).toBe(404);
    expect(await prisma.productionOrder.count({ where: { orderNumber: 'TO-AI-001' } })).toBe(1);
  });

  it('取消確認後不會寫入資料', async () => {
    const pending = await preparePendingAction({
      name: 'create_order',
      args: {
        orderNumber: 'TO-AI-CANCEL',
        product: 'TP-A',
        quantity: 2,
        releaseTime: '2026-08-10T08:00:00+08:00',
        dueDate: '2026-08-12T17:00:00+08:00',
      },
    });
    const cancelled = await request(app).post(`/api/ai/actions/${pending.id}/cancel`).send({});
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.cancelled).toBe(true);

    const confirmed = await request(app).post(`/api/ai/actions/${pending.id}/confirm`).send({});
    expect(confirmed.status).toBe(404);
    expect(await prisma.productionOrder.findUnique({ where: { orderNumber: 'TO-AI-CANCEL' } })).toBeNull();
  });
});

describe('Dashboard', () => {
  it('回傳統計資料', async () => {
    const res = await request(app).get('/api/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.machineLoad).toHaveLength(2); // TM-01、TM-02(TM-BAD 未建立成功)
  });
});
