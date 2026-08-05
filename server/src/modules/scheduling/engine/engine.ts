/**
 * 排程引擎核心:機台分派 + 四種演算法(FIFO / EDD / SPT / CR)。
 * Pure functions,deterministic:相同輸入產生相同輸出。
 */
import { crComparator } from '../algorithms/criticalRatio.js';
import { eddComparator } from '../algorithms/edd.js';
import { fifoComparator } from '../algorithms/fifo.js';
import { sptComparator } from '../algorithms/spt.js';
import type { OrderComparator } from '../algorithms/shared.js';
import { findSlot, machineAvailability } from './calendar.js';
import { resolveChangeover } from './changeover.js';
import {
  minutesToMs,
  type AlgorithmId,
  type Machine,
  type MachineState,
  type Placement,
  type Product,
  type ProductionOrder,
  type ScheduledTask,
  type SchedulingInput,
} from './types.js';

const DAY_MS = 24 * 3600_000;
export const DEFAULT_HORIZON_DAYS = 60;

export interface EngineResult {
  algorithm: AlgorithmId;
  tasks: ScheduledTask[];
  unscheduledOrders: { orderId: string; orderNumber: string; reason: string }[];
  /** orderId -> production 完成時間(epoch ms) */
  completionByOrder: Map<string, number>;
}

export function createMachineStates(
  machines: Machine[],
  anchorTime: number,
  inProgressTasks?: ScheduledTask[],
  inProgressOrders?: ProductionOrder[],
): Map<string, MachineState> {
  const map = new Map<string, MachineState>();
  const orderProductMap = new Map<string, string>(
    (inProgressOrders ?? []).map((o) => [o.id, o.productId])
  );

  for (const m of machines) {
    if (m.status === 'disabled') continue;

    const mTasks = (inProgressTasks ?? []).filter((t) => t.machineId === m.id);
    const busy = mTasks.map((t) => ({ start: t.startTime, end: t.endTime }));
    busy.sort((a, b) => a.start - b.start);

    const prodTasks = mTasks.filter((t) => t.taskType === 'production');
    let lastProductId: string | null = null;
    let lastEnd = anchorTime;
    let loadMinutes = 0;

    if (mTasks.length > 0) {
      const maxTaskEnd = Math.max(...mTasks.map((t) => t.endTime));
      lastEnd = Math.max(anchorTime, maxTaskEnd);
    }

    if (prodTasks.length > 0) {
      prodTasks.sort((a, b) => a.endTime - b.endTime);
      const lastTask = prodTasks[prodTasks.length - 1]!;
      if (lastTask.orderId) {
        lastProductId = orderProductMap.get(lastTask.orderId) ?? null;
      }
      loadMinutes = prodTasks.reduce((sum, t) => sum + (t.endTime - t.startTime) / 60_000, 0);
    }

    map.set(m.id, {
      machine: m,
      busy,
      lastProductId,
      lastEnd,
      loadMinutes,
    });
  }
  return map;
}

/** 找出訂單可用的機台(排除 disabled、不支援產品、不在指定清單內) */
export function eligibleMachines(order: ProductionOrder, machines: Machine[]): Machine[] {
  return machines.filter(
    (m) =>
      m.status !== 'disabled' &&
      m.supportedProductIds.includes(order.productId) &&
      (order.eligibleMachineIds.length === 0 || order.eligibleMachineIds.includes(m.id)),
  );
}

/**
 * 計算訂單在某機台上的最早安排(cleaning → setup → production 依序前向放置)。
 * 回傳 null 表示規劃期間內放不下。
 */
export function computePlacement(
  state: MachineState,
  order: ProductionOrder,
  input: SchedulingInput,
  horizonEnd: number,
): Placement | null {
  const { machine } = state;
  const changeover = resolveChangeover(machine, state.lastProductId, order.productId, input.changeoverRules);
  const availability = machineAvailability(
    machine,
    input.downtimes,
    state.busy,
    input.anchorTime,
    horizonEnd,
  );

  // append-only:從機台最後任務結束時間之後開始
  let cursor = Math.max(input.anchorTime, state.lastEnd);

  let cleaningStart: number | null = null;
  let cleaningEnd: number | null = null;
  if (changeover.cleaningMinutes > 0) {
    const slot = findSlot(availability, cursor, minutesToMs(changeover.cleaningMinutes));
    if (!slot) return null;
    cleaningStart = slot.start;
    cleaningEnd = slot.end;
    cursor = slot.end;
  }

  let setupStart: number | null = null;
  let setupEnd: number | null = null;
  if (changeover.setupMinutes > 0) {
    const slot = findSlot(availability, cursor, minutesToMs(changeover.setupMinutes));
    if (!slot) return null;
    setupStart = slot.start;
    setupEnd = slot.end;
    cursor = slot.end;
  }

  const prodEarliest = Math.max(cursor, order.releaseTime);
  const prodSlot = findSlot(availability, prodEarliest, minutesToMs(order.processingTime));
  if (!prodSlot) return null;

  return {
    machineId: machine.id,
    cleaningStart,
    cleaningEnd,
    setupStart,
    setupEnd,
    productionStart: prodSlot.start,
    productionEnd: prodSlot.end,
    setupMinutes: changeover.setupMinutes,
    cleaningMinutes: changeover.cleaningMinutes,
  };
}

/**
 * 在候選機台中選出最佳安排。
 * Tie-break:完成時間早 → 換模+清洗時間短 → 機台負載低 → machineCode 小。
 */
export function chooseBestPlacement(
  candidates: { state: MachineState; placement: Placement }[],
): { state: MachineState; placement: Placement } | null {
  if (candidates.length === 0) return null;
  return candidates.reduce((best, cur) => {
    const b = best.placement;
    const c = cur.placement;
    if (c.productionEnd !== b.productionEnd) return c.productionEnd < b.productionEnd ? cur : best;
    const cChange = c.setupMinutes + c.cleaningMinutes;
    const bChange = b.setupMinutes + b.cleaningMinutes;
    if (cChange !== bChange) return cChange < bChange ? cur : best;
    if (cur.state.loadMinutes !== best.state.loadMinutes)
      return cur.state.loadMinutes < best.state.loadMinutes ? cur : best;
    return cur.state.machine.machineCode < best.state.machine.machineCode ? cur : best;
  });
}

/** 將安排寫入機台狀態並產生任務 */
export function commitPlacement(
  state: MachineState,
  order: ProductionOrder,
  placement: Placement,
  tasks: ScheduledTask[],
  seqByMachine: Map<string, number>,
  idPrefix: string,
): void {
  const nextSeq = () => {
    const n = (seqByMachine.get(state.machine.id) ?? 0) + 1;
    seqByMachine.set(state.machine.id, n);
    return n;
  };
  if (placement.cleaningStart !== null && placement.cleaningEnd !== null) {
    tasks.push({
      id: `${idPrefix}-${order.orderNumber}-cleaning`,
      orderId: order.id,
      machineId: state.machine.id,
      taskType: 'cleaning',
      startTime: placement.cleaningStart,
      endTime: placement.cleaningEnd,
      sequence: nextSeq(),
      isManuallyAdjusted: false,
    });
    state.busy.push({ start: placement.cleaningStart, end: placement.cleaningEnd });
  }
  if (placement.setupStart !== null && placement.setupEnd !== null) {
    tasks.push({
      id: `${idPrefix}-${order.orderNumber}-setup`,
      orderId: order.id,
      machineId: state.machine.id,
      taskType: 'setup',
      startTime: placement.setupStart,
      endTime: placement.setupEnd,
      sequence: nextSeq(),
      isManuallyAdjusted: false,
    });
    state.busy.push({ start: placement.setupStart, end: placement.setupEnd });
  }
  tasks.push({
    id: `${idPrefix}-${order.orderNumber}-production`,
    orderId: order.id,
    machineId: state.machine.id,
    taskType: 'production',
    startTime: placement.productionStart,
    endTime: placement.productionEnd,
    sequence: nextSeq(),
    isManuallyAdjusted: false,
  });
  state.busy.push({ start: placement.productionStart, end: placement.productionEnd });
  state.busy.sort((a, b) => a.start - b.start);
  state.lastProductId = order.productId;
  state.lastEnd = placement.productionEnd;
  state.loadMinutes += order.processingTime;
}

/** 產生規劃期間內的 maintenance 顯示任務(供甘特圖) */
export function maintenanceTasks(input: SchedulingInput, horizonEnd: number, idPrefix: string): ScheduledTask[] {
  const tasks: ScheduledTask[] = [];
  let i = 0;
  for (const d of input.downtimes) {
    if (d.endTime <= input.anchorTime || d.startTime >= horizonEnd) continue;
    i += 1;
    tasks.push({
      id: `${idPrefix}-maint-${i}`,
      orderId: null,
      machineId: d.machineId,
      taskType: 'maintenance',
      startTime: d.startTime,
      endTime: d.endTime,
      sequence: 0,
      isManuallyAdjusted: false,
    });
  }
  return tasks;
}

const comparators: Record<Exclude<AlgorithmId, 'CR'>, OrderComparator> = {
  FIFO: fifoComparator,
  EDD: eddComparator,
  SPT: sptComparator,
};

/**
 * 執行單一演算法,回傳任務清單與未排入訂單。
 */
export function runAlgorithm(input: SchedulingInput, algorithm: AlgorithmId): EngineResult {
  const horizonEnd = input.anchorTime + (input.horizonDays ?? DEFAULT_HORIZON_DAYS) * DAY_MS;
  const states = createMachineStates(input.machines, input.anchorTime, input.inProgressTasks, input.inProgressOrders);
  const productById = new Map<string, Product>(input.products.map((p) => [p.id, p]));

  const tasks: ScheduledTask[] = [];
  const unscheduled: EngineResult['unscheduledOrders'] = [];
  const completionByOrder = new Map<string, number>();
  const seqByMachine = new Map<string, number>();

  const pending = input.orders.filter((o) => {
    if (!productById.has(o.productId)) {
      unscheduled.push({ orderId: o.id, orderNumber: o.orderNumber, reason: '找不到訂單對應的產品資料' });
      return false;
    }
    if (o.processingTime <= 0) {
      unscheduled.push({ orderId: o.id, orderNumber: o.orderNumber, reason: '加工時間必須大於零' });
      return false;
    }
    if (eligibleMachines(o, input.machines).length === 0) {
      unscheduled.push({ orderId: o.id, orderNumber: o.orderNumber, reason: '沒有可加工此產品的機台' });
      return false;
    }
    return true;
  });

  const scheduleOne = (order: ProductionOrder): boolean => {
    const machines = eligibleMachines(order, input.machines);
    const candidates: { state: MachineState; placement: Placement }[] = [];
    for (const m of machines) {
      const state = states.get(m.id);
      if (!state) continue;
      const placement = computePlacement(state, order, input, horizonEnd);
      if (placement) candidates.push({ state, placement });
    }
    const best = chooseBestPlacement(candidates);
    if (!best) {
      unscheduled.push({
        orderId: order.id,
        orderNumber: order.orderNumber,
        reason: '所有機台都無法在規劃期間內完成此訂單',
      });
      return false;
    }
    commitPlacement(best.state, order, best.placement, tasks, seqByMachine, algorithm);
    completionByOrder.set(order.id, best.placement.productionEnd);
    return true;
  };

  if (algorithm === 'CR') {
    // CR 動態:每一步依目前模擬時間重算 Critical Ratio
    const remaining = [...pending];
    while (remaining.length > 0) {
      const now = currentSimTime(states, input.anchorTime);
      remaining.sort(crComparator(now));
      const order = remaining.shift();
      if (!order) break;
      scheduleOne(order);
    }
  } else {
    const sorted = [...pending].sort(comparators[algorithm]);
    // 使用者自訂 priority 為同分 tie-break(已含於 comparator)
    for (const order of sorted) scheduleOne(order);
  }

  tasks.push(...maintenanceTasks(input, horizonEnd, algorithm));

  if (input.inProgressTasks) {
    // 複製進行中任務，並更新其 ID 加上演算法前綴，避免多演算法間 ID 衝突
    tasks.push(...input.inProgressTasks.map((t) => ({
      ...t,
      id: `${algorithm}-inProgress-${t.id.includes('-') ? t.id.split('-').slice(1).join('-') : t.id}`,
    })));
  }

  return { algorithm, tasks, unscheduledOrders: unscheduled, completionByOrder };
}

/** 目前模擬時間 = 所有機台最早可用時間的最小值 */
export function currentSimTime(states: Map<string, MachineState>, anchorTime: number): number {
  let min = Infinity;
  for (const s of states.values()) min = Math.min(min, Math.max(anchorTime, s.lastEnd));
  return min === Infinity ? anchorTime : min;
}
