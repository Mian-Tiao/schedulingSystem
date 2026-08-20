import { beforeEach, describe, expect, it } from 'vitest';
import { runAlgorithm } from '../engine/engine.js';
import type { ScheduledTask } from '../engine/types.js';
import { runAllAlgorithms } from '../runScheduling.js';
import {
  changeoverRule,
  downtime,
  input,
  machine,
  order,
  product,
  resetSeq,
  t,
  WITH_LUNCH,
} from './fixtures.js';

beforeEach(resetSeq);

function productionOf(tasks: ScheduledTask[], orderId: string): ScheduledTask {
  const task = tasks.find((x) => x.orderId === orderId && x.taskType === 'production');
  if (!task) throw new Error(`no production task for ${orderId}`);
  return task;
}

describe('runAlgorithm — 排序邏輯', () => {
  const pA = product({ id: 'pA' });
  const m1 = machine({ id: 'm1', supportedProductIds: ['pA'] });

  const base = {
    products: [pA],
    machines: [m1],
    anchorTime: t('2026-08-10 00:00'),
  };

  it('FIFO 依建立時間排序', () => {
    const o1 = order({ id: 'o1', productId: 'pA', createdAt: t('2026-08-02 08:00'), processingTime: 60 });
    const o2 = order({ id: 'o2', productId: 'pA', createdAt: t('2026-08-01 08:00'), processingTime: 60 });
    const r = runAlgorithm(input({ ...base, orders: [o1, o2] }), 'FIFO');
    expect(productionOf(r.tasks, 'o2').startTime).toBeLessThan(productionOf(r.tasks, 'o1').startTime);
  });

  it('EDD 依交期排序', () => {
    const o1 = order({ id: 'o1', productId: 'pA', dueDate: t('2026-08-20 17:00'), createdAt: 1, processingTime: 60 });
    const o2 = order({ id: 'o2', productId: 'pA', dueDate: t('2026-08-11 17:00'), createdAt: 2, processingTime: 60 });
    const r = runAlgorithm(input({ ...base, orders: [o1, o2] }), 'EDD');
    expect(productionOf(r.tasks, 'o2').startTime).toBeLessThan(productionOf(r.tasks, 'o1').startTime);
  });

  it('SPT 依加工時間排序', () => {
    const o1 = order({ id: 'o1', productId: 'pA', processingTime: 120, createdAt: 1 });
    const o2 = order({ id: 'o2', productId: 'pA', processingTime: 30, createdAt: 2 });
    const r = runAlgorithm(input({ ...base, orders: [o1, o2] }), 'SPT');
    expect(productionOf(r.tasks, 'o2').startTime).toBeLessThan(productionOf(r.tasks, 'o1').startTime);
  });

  it('CR 依剩餘交期/剩餘加工比排序(比值小者優先)', () => {
    // o1:交期近但加工短;o2:交期較遠但加工很長 → o2 的 CR 較小
    const o1 = order({ id: 'o1', productId: 'pA', dueDate: t('2026-08-10 12:00'), processingTime: 30, createdAt: 1 });
    const o2 = order({ id: 'o2', productId: 'pA', dueDate: t('2026-08-11 17:00'), processingTime: 480, createdAt: 2 });
    const r = runAlgorithm(input({ ...base, orders: [o1, o2] }), 'CR');
    // CR(o1) = 720min/30min = 24;CR(o2) = 2460min/480min ≈ 5.1 → o2 先
    expect(productionOf(r.tasks, 'o2').startTime).toBeLessThan(productionOf(r.tasks, 'o1').startTime);
  });

  it('priority 作為 EDD 同交期 tie-break', () => {
    const due = t('2026-08-15 17:00');
    const o1 = order({ id: 'o1', productId: 'pA', dueDate: due, priority: 3, createdAt: 1, processingTime: 60 });
    const o2 = order({ id: 'o2', productId: 'pA', dueDate: due, priority: 1, createdAt: 2, processingTime: 60 });
    const r = runAlgorithm(input({ ...base, orders: [o1, o2] }), 'EDD');
    expect(productionOf(r.tasks, 'o2').startTime).toBeLessThan(productionOf(r.tasks, 'o1').startTime);
  });
});

describe('runAllAlgorithms — 空方案防護', () => {
  it('規劃期間總工時不足時不產生空白方案', () => {
    const pA = product({ id: 'pA' });
    const m1 = machine({ id: 'm1', supportedProductIds: ['pA'] });
    const longOrder = order({ id: 'long', productId: 'pA', processingTime: 600 });
    const result = runAllAlgorithms(
      input({ products: [pA], machines: [m1], orders: [longOrder], horizonDays: 1 }),
      'ON_TIME_DELIVERY',
      'empty-guard',
    );

    expect(result.scenarios).toHaveLength(0);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ level: 'error', code: 'NO_SCHEDULED_TASKS' }),
    );
  });
});

describe('runAlgorithm — 機台分派與行事曆', () => {
  it('選擇最早完成的機台;負載會分散到多台機台', () => {
    const pA = product({ id: 'pA' });
    const m1 = machine({ id: 'm1', machineCode: 'M-01', supportedProductIds: ['pA'] });
    const m2 = machine({ id: 'm2', machineCode: 'M-02', supportedProductIds: ['pA'] });
    const o1 = order({ id: 'o1', productId: 'pA', processingTime: 120, createdAt: 1 });
    const o2 = order({ id: 'o2', productId: 'pA', processingTime: 120, createdAt: 2 });
    const r = runAlgorithm(
      input({ products: [pA], machines: [m1, m2], orders: [o1, o2], anchorTime: t('2026-08-10 00:00') }),
      'FIFO',
    );
    const t1 = productionOf(r.tasks, 'o1');
    const t2 = productionOf(r.tasks, 'o2');
    expect(t1.machineId).not.toBe(t2.machineId);
    // 兩張都應從 08:00 開始(各自機台)
    expect(t1.startTime).toBe(t('2026-08-10 08:00'));
    expect(t2.startTime).toBe(t('2026-08-10 08:00'));
  });

  it('disabled 機台不參與排程', () => {
    const pA = product({ id: 'pA' });
    const m1 = machine({ id: 'm1', supportedProductIds: ['pA'], status: 'disabled' });
    const o1 = order({ id: 'o1', productId: 'pA' });
    const r = runAlgorithm(input({ products: [pA], machines: [m1], orders: [o1] }), 'FIFO');
    expect(r.unscheduledOrders).toHaveLength(1);
    expect(r.unscheduledOrders[0]?.reason).toContain('沒有可加工');
  });

  it('避開維護時段', () => {
    const pA = product({ id: 'pA' });
    const m1 = machine({ id: 'm1', supportedProductIds: ['pA'] });
    const d = downtime({
      machineId: 'm1',
      startTime: t('2026-08-10 08:00'),
      endTime: t('2026-08-10 10:00'),
    });
    const o1 = order({ id: 'o1', productId: 'pA', processingTime: 60 });
    const r = runAlgorithm(
      input({ products: [pA], machines: [m1], downtimes: [d], orders: [o1], anchorTime: t('2026-08-10 00:00') }),
      'FIFO',
    );
    expect(productionOf(r.tasks, 'o1').startTime).toBe(t('2026-08-10 10:00'));
  });

  it('production 可跨越午休分段續做', () => {
    const pA = product({ id: 'pA' });
    const m1 = machine({ id: 'm1', supportedProductIds: ['pA'], workingHours: WITH_LUNCH });
    // 3 小時工作,08:00 開始只剩 4 小時的 08:00-12:00 可容納
    const o1 = order({ id: 'o1', productId: 'pA', processingTime: 180, createdAt: 1 });
    // 第二張先做 11:00-12:00,午休後再做 13:00-15:00
    const o2 = order({ id: 'o2', productId: 'pA', processingTime: 180, createdAt: 2 });
    const r = runAlgorithm(
      input({ products: [pA], machines: [m1], orders: [o1, o2], anchorTime: t('2026-08-10 00:00') }),
      'FIFO',
    );
    expect(productionOf(r.tasks, 'o1').startTime).toBe(t('2026-08-10 08:00'));
    const segments = r.tasks.filter((task) => task.orderId === 'o2' && task.taskType === 'production');
    expect(segments).toMatchObject([
      { startTime: t('2026-08-10 11:00'), endTime: t('2026-08-10 12:00') },
      { startTime: t('2026-08-10 13:00'), endTime: t('2026-08-10 15:00') },
    ]);
    expect(segments.reduce((minutes, task) => minutes + (task.endTime - task.startTime) / 60_000, 0)).toBe(180);
  });

  it('長工單可跨下班與隔日分段完成', () => {
    const pA = product({ id: 'pA' });
    const m1 = machine({ id: 'm1', supportedProductIds: ['pA'] });
    const longOrder = order({ id: 'long', productId: 'pA', processingTime: 600 });
    const r = runAlgorithm(
      input({ products: [pA], machines: [m1], orders: [longOrder], anchorTime: t('2026-08-10 00:00') }),
      'FIFO',
    );
    const segments = r.tasks.filter((task) => task.orderId === 'long' && task.taskType === 'production');
    expect(segments).toMatchObject([
      { startTime: t('2026-08-10 08:00'), endTime: t('2026-08-10 17:00') },
      { startTime: t('2026-08-11 08:00'), endTime: t('2026-08-11 09:00') },
    ]);
    expect(r.unscheduledOrders).toHaveLength(0);
  });

  it('release time 之前不開始', () => {
    const pA = product({ id: 'pA' });
    const m1 = machine({ id: 'm1', supportedProductIds: ['pA'] });
    const o1 = order({ id: 'o1', productId: 'pA', releaseTime: t('2026-08-10 14:00'), processingTime: 60 });
    const r = runAlgorithm(
      input({ products: [pA], machines: [m1], orders: [o1], anchorTime: t('2026-08-10 00:00') }),
      'FIFO',
    );
    expect(productionOf(r.tasks, 'o1').startTime).toBe(t('2026-08-10 14:00'));
  });

  it('不同產品切換時插入換模與清洗任務,且不重疊', () => {
    const pA = product({ id: 'pA' });
    const pB = product({ id: 'pB' });
    const m1 = machine({ id: 'm1', supportedProductIds: ['pA', 'pB'] });
    const rule = changeoverRule({
      machineId: 'm1',
      fromProductId: 'pA',
      toProductId: 'pB',
      setupMinutes: 30,
      cleaningMinutes: 20,
    });
    const o1 = order({ id: 'o1', productId: 'pA', processingTime: 60, createdAt: 1 });
    const o2 = order({ id: 'o2', productId: 'pB', processingTime: 60, createdAt: 2 });
    const r = runAlgorithm(
      input({
        products: [pA, pB],
        machines: [m1],
        changeoverRules: [rule],
        orders: [o1, o2],
        anchorTime: t('2026-08-10 00:00'),
      }),
      'FIFO',
    );
    const cleaning = r.tasks.find((x) => x.orderId === 'o2' && x.taskType === 'cleaning');
    const setup = r.tasks.find((x) => x.orderId === 'o2' && x.taskType === 'setup');
    const prod2 = productionOf(r.tasks, 'o2');
    expect(cleaning).toBeDefined();
    expect(setup).toBeDefined();
    // o1 08:00-09:00 → 清洗 09:00-09:20 → 換模 09:20-09:50 → o2 09:50-10:50
    expect(cleaning?.startTime).toBe(t('2026-08-10 09:00'));
    expect(cleaning?.endTime).toBe(t('2026-08-10 09:20'));
    expect(setup?.startTime).toBe(t('2026-08-10 09:20'));
    expect(setup?.endTime).toBe(t('2026-08-10 09:50'));
    expect(prod2.startTime).toBe(t('2026-08-10 09:50'));
  });

  it('同產品連續生產不插入換模', () => {
    const pA = product({ id: 'pA' });
    const m1 = machine({ id: 'm1', supportedProductIds: ['pA'], defaultSetupTime: 30 });
    const o1 = order({ id: 'o1', productId: 'pA', processingTime: 60, createdAt: 1 });
    const o2 = order({ id: 'o2', productId: 'pA', processingTime: 60, createdAt: 2 });
    const r = runAlgorithm(
      input({ products: [pA], machines: [m1], orders: [o1, o2], anchorTime: t('2026-08-10 00:00') }),
      'FIFO',
    );
    expect(r.tasks.filter((x) => x.taskType === 'setup')).toHaveLength(0);
    expect(productionOf(r.tasks, 'o2').startTime).toBe(t('2026-08-10 09:00'));
  });

  it('任務彼此不重疊(同機台)', () => {
    const pA = product({ id: 'pA' });
    const pB = product({ id: 'pB' });
    const m1 = machine({ id: 'm1', supportedProductIds: ['pA', 'pB'], defaultSetupTime: 15, defaultCleaningTime: 10 });
    const orders = Array.from({ length: 6 }, (_, i) =>
      order({ id: `o${i}`, productId: i % 2 === 0 ? 'pA' : 'pB', processingTime: 45, createdAt: i }),
    );
    const r = runAlgorithm(
      input({ products: [pA, pB], machines: [m1], orders, anchorTime: t('2026-08-10 00:00') }),
      'FIFO',
    );
    const busy = r.tasks
      .filter((x) => x.taskType !== 'maintenance')
      .sort((a, b) => a.startTime - b.startTime);
    for (let i = 1; i < busy.length; i++) {
      expect(busy[i]!.startTime).toBeGreaterThanOrEqual(busy[i - 1]!.endTime);
    }
  });

  it('deterministic:相同輸入產生相同輸出', () => {
    const pA = product({ id: 'pA' });
    const pB = product({ id: 'pB' });
    const m1 = machine({ id: 'm1', supportedProductIds: ['pA', 'pB'] });
    const m2 = machine({ id: 'm2', supportedProductIds: ['pA', 'pB'] });
    const orders = Array.from({ length: 10 }, (_, i) =>
      order({ id: `o${i}`, productId: i % 2 === 0 ? 'pA' : 'pB', processingTime: 30 + i * 7, createdAt: i }),
    );
    const in1 = input({ products: [pA, pB], machines: [m1, m2], orders, anchorTime: t('2026-08-10 00:00') });
    const r1 = runAlgorithm(in1, 'EDD');
    const r2 = runAlgorithm(in1, 'EDD');
    expect(JSON.stringify(r1.tasks)).toBe(JSON.stringify(r2.tasks));
  });
});

describe('runAlgorithm — 效能', () => {
  it('100 張訂單 × 10 台機台在合理時間內完成', () => {
    const products = Array.from({ length: 5 }, (_, i) => product({ id: `pp${i}` }));
    const machines = Array.from({ length: 10 }, (_, i) =>
      machine({
        id: `mm${i}`,
        machineCode: `M-${String(i).padStart(2, '0')}`,
        supportedProductIds: products.map((p) => p.id),
        defaultSetupTime: 15,
        defaultCleaningTime: 10,
      }),
    );
    const orders = Array.from({ length: 100 }, (_, i) =>
      order({
        id: `oo${i}`,
        productId: `pp${i % 5}`,
        processingTime: 30 + (i % 7) * 20,
        createdAt: i,
        dueDate: t('2026-08-14 17:00'),
      }),
    );
    const start = Date.now();
    const r = runAlgorithm(
      input({ products, machines, orders, anchorTime: t('2026-08-10 00:00') }),
      'CR',
    );
    const elapsed = Date.now() - start;
    expect(r.unscheduledOrders).toHaveLength(0);
    expect(elapsed).toBeLessThan(5000);
  });
});
