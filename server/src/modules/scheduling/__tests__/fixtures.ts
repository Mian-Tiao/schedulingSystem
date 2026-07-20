/**
 * 測試用共用資料建構工具。
 */
import type {
  ChangeoverRule,
  Machine,
  MachineDowntime,
  Product,
  ProductionOrder,
  SchedulingInput,
  WorkingHours,
} from '../engine/types.js';

/** 解析台北時間字串,如 t('2026-08-10 08:00') */
export function t(s: string): number {
  return Date.parse(`${s.replace(' ', 'T')}:00+08:00`);
}

export const FULL_DAY: WorkingHours = {
  mon: [{ start: '08:00', end: '17:00' }],
  tue: [{ start: '08:00', end: '17:00' }],
  wed: [{ start: '08:00', end: '17:00' }],
  thu: [{ start: '08:00', end: '17:00' }],
  fri: [{ start: '08:00', end: '17:00' }],
  sat: [],
  sun: [],
};

/** 含午休(12:00-13:00)的工作時段 */
export const WITH_LUNCH: WorkingHours = {
  mon: [
    { start: '08:00', end: '12:00' },
    { start: '13:00', end: '17:00' },
  ],
  tue: [
    { start: '08:00', end: '12:00' },
    { start: '13:00', end: '17:00' },
  ],
  wed: [
    { start: '08:00', end: '12:00' },
    { start: '13:00', end: '17:00' },
  ],
  thu: [
    { start: '08:00', end: '12:00' },
    { start: '13:00', end: '17:00' },
  ],
  fri: [
    { start: '08:00', end: '12:00' },
    { start: '13:00', end: '17:00' },
  ],
  sat: [],
  sun: [],
};

let seq = 0;

export function product(overrides: Partial<Product> = {}): Product {
  seq += 1;
  return {
    id: overrides.id ?? `p${seq}`,
    productCode: overrides.productCode ?? `P-${seq}`,
    productName: overrides.productName ?? `產品${seq}`,
    defaultProcessingTime: overrides.defaultProcessingTime ?? 10,
    defaultCleaningTime: overrides.defaultCleaningTime ?? 0,
  };
}

export function machine(overrides: Partial<Machine> = {}): Machine {
  seq += 1;
  return {
    id: overrides.id ?? `m${seq}`,
    machineCode: overrides.machineCode ?? `M-${String(seq).padStart(2, '0')}`,
    machineName: overrides.machineName ?? `機台${seq}`,
    model: overrides.model ?? null,
    supportedProductIds: overrides.supportedProductIds ?? [],
    defaultSetupTime: overrides.defaultSetupTime ?? 0,
    defaultCleaningTime: overrides.defaultCleaningTime ?? 0,
    workingHours: overrides.workingHours ?? FULL_DAY,
    status: overrides.status ?? 'available',
  };
}

export function order(overrides: Partial<ProductionOrder> = {}): ProductionOrder {
  seq += 1;
  return {
    id: overrides.id ?? `o${seq}`,
    orderNumber: overrides.orderNumber ?? `PO-${String(seq).padStart(3, '0')}`,
    productId: overrides.productId ?? 'p1',
    quantity: overrides.quantity ?? 1,
    releaseTime: overrides.releaseTime ?? t('2026-08-10 00:00'),
    dueDate: overrides.dueDate ?? t('2026-08-20 17:00'),
    processingTime: overrides.processingTime ?? 60,
    priority: overrides.priority ?? 3,
    eligibleMachineIds: overrides.eligibleMachineIds ?? [],
    status: overrides.status ?? 'pending',
    createdAt: overrides.createdAt ?? t('2026-08-01 08:00') + seq * 1000,
  };
}

export function downtime(overrides: Partial<MachineDowntime> & { machineId: string }): MachineDowntime {
  seq += 1;
  return {
    id: overrides.id ?? `d${seq}`,
    machineId: overrides.machineId,
    type: overrides.type ?? 'maintenance',
    startTime: overrides.startTime ?? t('2026-08-10 09:00'),
    endTime: overrides.endTime ?? t('2026-08-10 12:00'),
    reason: overrides.reason ?? null,
  };
}

export function changeoverRule(
  overrides: Partial<ChangeoverRule> & { toProductId: string },
): ChangeoverRule {
  seq += 1;
  return {
    id: overrides.id ?? `c${seq}`,
    machineId: overrides.machineId ?? null,
    fromProductId: overrides.fromProductId ?? null,
    toProductId: overrides.toProductId,
    setupMinutes: overrides.setupMinutes ?? 30,
    cleaningMinutes: overrides.cleaningMinutes ?? 0,
  };
}

export function input(overrides: Partial<SchedulingInput> = {}): SchedulingInput {
  return {
    products: overrides.products ?? [],
    machines: overrides.machines ?? [],
    downtimes: overrides.downtimes ?? [],
    changeoverRules: overrides.changeoverRules ?? [],
    orders: overrides.orders ?? [],
    anchorTime: overrides.anchorTime ?? t('2026-08-10 00:00'),
    horizonDays: overrides.horizonDays ?? 60,
  };
}

export function resetSeq(): void {
  seq = 0;
}
