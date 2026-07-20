import { beforeEach, describe, expect, it } from 'vitest';
import { runAlgorithm } from '../engine/engine.js';
import { calculateMetrics } from '../metrics/metrics.js';
import { input, machine, order, product, resetSeq, t } from './fixtures.js';

beforeEach(resetSeq);

describe('calculateMetrics', () => {
  it('由真實排程結果計算 makespan、延遲與交貨率', () => {
    const pA = product({ id: 'pA' });
    const m1 = machine({ id: 'm1', supportedProductIds: ['pA'] });
    // o1:準時;o2:交期 09:30 但要排在 o1 之後 09:00-10:00 → 延遲 30 分鐘
    const o1 = order({
      id: 'o1',
      productId: 'pA',
      processingTime: 60,
      createdAt: 1,
      dueDate: t('2026-08-10 10:00'),
      releaseTime: t('2026-08-10 00:00'),
    });
    const o2 = order({
      id: 'o2',
      productId: 'pA',
      processingTime: 60,
      createdAt: 2,
      dueDate: t('2026-08-10 09:30'),
      releaseTime: t('2026-08-10 00:00'),
    });
    const inp = input({ products: [pA], machines: [m1], orders: [o1, o2], anchorTime: t('2026-08-10 08:00') });
    const r = runAlgorithm(inp, 'FIFO');
    const m = calculateMetrics({
      tasks: r.tasks,
      orders: inp.orders,
      machines: inp.machines,
      downtimes: [],
      anchorTime: inp.anchorTime,
    });

    expect(m.scheduledOrderCount).toBe(2);
    expect(m.makespanMinutes).toBe(120); // 08:00 → 10:00
    expect(m.maximumTardinessMinutes).toBe(30);
    expect(m.averageTardinessMinutes).toBe(15);
    expect(m.onTimeDeliveryRate).toBe(0.5);
    expect(m.lateOrderCount).toBe(1);
    // 08:00-10:00 兩小時全部生產 → 利用率 100%
    expect(m.machineUtilizationRate).toBe(1);
    expect(m.totalSetupMinutes).toBe(0);
    expect(m.totalCleaningMinutes).toBe(0);
    // flow: o1 = 10hr(00:00→09:00)... 以 releaseTime 起算
    expect(m.averageFlowTimeMinutes).toBeGreaterThan(0);
  });

  it('無訂單時回傳零值不噴錯', () => {
    const m = calculateMetrics({
      tasks: [],
      orders: [],
      machines: [],
      downtimes: [],
      anchorTime: t('2026-08-10 08:00'),
    });
    expect(m.makespanMinutes).toBe(0);
    expect(m.onTimeDeliveryRate).toBe(0);
    expect(m.scheduledOrderCount).toBe(0);
  });
});
