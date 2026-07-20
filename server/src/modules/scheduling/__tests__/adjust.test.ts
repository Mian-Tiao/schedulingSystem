import { beforeEach, describe, expect, it } from 'vitest';
import { applyAdjustment } from '../engine/adjust.js';
import { runAlgorithm } from '../engine/engine.js';
import {
  downtime,
  input,
  machine,
  order,
  product,
  resetSeq,
  t,
} from './fixtures.js';

beforeEach(resetSeq);

function setup() {
  const pA = product({ id: 'pA', productName: '產品A' });
  const pB = product({ id: 'pB', productName: '產品B' });
  const m1 = machine({ id: 'm1', machineCode: 'M-01', machineName: '機台一', supportedProductIds: ['pA', 'pB'] });
  const m2 = machine({ id: 'm2', machineCode: 'M-02', machineName: '機台二', supportedProductIds: ['pA'] });
  const o1 = order({ id: 'o1', orderNumber: 'PO-001', productId: 'pA', processingTime: 60, createdAt: 1, eligibleMachineIds: ['m1'] });
  const o2 = order({ id: 'o2', orderNumber: 'PO-002', productId: 'pB', processingTime: 60, createdAt: 2, eligibleMachineIds: ['m1'] });
  const inp = input({
    products: [pA, pB],
    machines: [m1, m2],
    orders: [o1, o2],
    anchorTime: t('2026-08-10 00:00'),
  });
  const result = runAlgorithm(inp, 'FIFO');
  return { inp, result };
}

describe('applyAdjustment — 不合法拖曳', () => {
  it('拖到不支援產品的機台被拒絕並說明原因', () => {
    const { inp, result } = setup();
    const prodTask = result.tasks.find((x) => x.orderId === 'o2' && x.taskType === 'production')!;
    const r = applyAdjustment(result.tasks, { taskId: prodTask.id, machineId: 'm2', startTime: prodTask.startTime }, inp);
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toContain('不支援');
  });

  it('拖到非工作時段被拒絕', () => {
    const { inp, result } = setup();
    const prodTask = result.tasks.find((x) => x.orderId === 'o1' && x.taskType === 'production')!;
    const r = applyAdjustment(
      result.tasks,
      { taskId: prodTask.id, machineId: 'm1', startTime: t('2026-08-10 20:00') },
      inp,
    );
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toContain('非工作時段');
  });

  it('拖到與維護重疊的位置被拒絕', () => {
    const pA = product({ id: 'pA' });
    const m1 = machine({ id: 'm1', supportedProductIds: ['pA'] });
    const d = downtime({ machineId: 'm1', startTime: t('2026-08-10 13:00'), endTime: t('2026-08-10 15:00') });
    const o1 = order({ id: 'o1', productId: 'pA', processingTime: 60, createdAt: 1 });
    const inp = input({ products: [pA], machines: [m1], downtimes: [d], orders: [o1], anchorTime: t('2026-08-10 00:00') });
    const result = runAlgorithm(inp, 'FIFO');
    const prodTask = result.tasks.find((x) => x.orderId === 'o1' && x.taskType === 'production')!;
    const r = applyAdjustment(
      result.tasks,
      { taskId: prodTask.id, machineId: 'm1', startTime: t('2026-08-10 13:30') },
      inp,
    );
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toContain('維護');
  });

  it('早於 release time 被拒絕', () => {
    const pA = product({ id: 'pA' });
    const m1 = machine({ id: 'm1', supportedProductIds: ['pA'] });
    const o1 = order({
      id: 'o1',
      productId: 'pA',
      processingTime: 60,
      releaseTime: t('2026-08-10 10:00'),
      createdAt: 1,
    });
    const inp = input({ products: [pA], machines: [m1], orders: [o1], anchorTime: t('2026-08-10 00:00') });
    const result = runAlgorithm(inp, 'FIFO');
    const prodTask = result.tasks.find((x) => x.orderId === 'o1' && x.taskType === 'production')!;
    const r = applyAdjustment(
      result.tasks,
      { taskId: prodTask.id, machineId: 'm1', startTime: t('2026-08-10 08:00') },
      inp,
    );
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toContain('release time');
  });
});

describe('applyAdjustment — 合法拖曳', () => {
  it('延後開始時間:順序重排、被移動任務標記人工調整並回報差異', () => {
    const { inp, result } = setup();
    const p1 = result.tasks.find((x) => x.orderId === 'o1' && x.taskType === 'production')!;
    // o1 從 08:00 移到 10:00 → 排到 o2(09:00-10:00)之後
    const r = applyAdjustment(result.tasks, { taskId: p1.id, machineId: 'm1', startTime: t('2026-08-10 10:00') }, inp);
    expect(r.valid).toBe(true);
    const newTasks = r.tasks!;
    const newP1 = newTasks.find((x) => x.orderId === 'o1' && x.taskType === 'production')!;
    expect(newP1.startTime).toBe(t('2026-08-10 10:00'));
    expect(newP1.isManuallyAdjusted).toBe(true);
    // o2 保持原時段(09:00 開始),不受影響
    const newP2 = newTasks.find((x) => x.orderId === 'o2' && x.taskType === 'production')!;
    expect(newP2.startTime).toBe(t('2026-08-10 09:00'));
    // o1 完成時間 09:00 → 11:00,應回報差異
    const diff = r.delayDiffs.find((d) => d.orderId === 'o1');
    expect(diff).toBeDefined();
    expect(diff?.newCompletion).toBe(t('2026-08-10 11:00'));
  });

  it('跨機台拖曳:換模依新機台前一產品重新計算', () => {
    const pA = product({ id: 'pA' });
    const m1 = machine({ id: 'm1', supportedProductIds: ['pA'], defaultSetupTime: 0 });
    const m2 = machine({ id: 'm2', supportedProductIds: ['pA'], defaultSetupTime: 0 });
    const o1 = order({ id: 'o1', productId: 'pA', processingTime: 60, createdAt: 1, eligibleMachineIds: ['m1'] });
    const inp = input({ products: [pA], machines: [m1, m2], orders: [o1], anchorTime: t('2026-08-10 00:00') });
    const result = runAlgorithm(inp, 'FIFO');
    const p1 = result.tasks.find((x) => x.orderId === 'o1' && x.taskType === 'production')!;
    // o1 限定 m1 → 拖到 m2 應被拒
    const r = applyAdjustment(result.tasks, { taskId: p1.id, machineId: 'm2', startTime: p1.startTime }, inp);
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toContain('限定');
  });

  it('移動後與其他訂單重疊的位置被拒絕', () => {
    const { inp, result } = setup();
    const p2 = result.tasks.find((x) => x.orderId === 'o2' && x.taskType === 'production')!;
    // o2 想搬到 08:30(o1 08:00-09:00 佔用中)→ 因換模擠壓無法於指定時間開始
    const r = applyAdjustment(result.tasks, { taskId: p2.id, machineId: 'm1', startTime: t('2026-08-10 08:30') }, inp);
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });
});
