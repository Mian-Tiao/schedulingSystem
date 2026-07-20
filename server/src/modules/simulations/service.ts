/**
 * 情境模擬:急單插入、機台故障。純計算,不寫入正式排程。
 */
import {
  chooseBestPlacement,
  computePlacement,
  eligibleMachines,
  runAlgorithm,
} from '../scheduling/engine/engine.js';
import type {
  AlgorithmId,
  MachineDowntime,
  MachineState,
  Placement,
  ProductionOrder,
  ScheduleMetrics,
  ScheduledTask,
  SchedulingInput,
} from '../scheduling/engine/types.js';
import { calculateMetrics } from '../scheduling/metrics/metrics.js';

export interface OrderImpact {
  orderId: string;
  orderNumber: string;
  oldCompletion: number | null;
  newCompletion: number | null;
  oldTardinessMinutes: number;
  newTardinessMinutes: number;
  becameLate: boolean;
}

function completionsOf(tasks: ScheduledTask[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const t of tasks) {
    if (t.taskType === 'production' && t.orderId) {
      map.set(t.orderId, Math.max(map.get(t.orderId) ?? 0, t.endTime));
    }
  }
  return map;
}

export function compareImpacts(
  baselineTasks: ScheduledTask[],
  newTasks: ScheduledTask[],
  orders: ProductionOrder[],
): OrderImpact[] {
  const before = completionsOf(baselineTasks);
  const after = completionsOf(newTasks);
  const impacts: OrderImpact[] = [];
  for (const o of orders) {
    const oldC = before.get(o.id) ?? null;
    const newC = after.get(o.id) ?? null;
    if (oldC === null && newC === null) continue;
    const oldT = oldC ? Math.max(0, (oldC - o.dueDate) / 60_000) : 0;
    const newT = newC ? Math.max(0, (newC - o.dueDate) / 60_000) : 0;
    if (oldC !== newC) {
      impacts.push({
        orderId: o.id,
        orderNumber: o.orderNumber,
        oldCompletion: oldC,
        newCompletion: newC,
        oldTardinessMinutes: Math.round(oldT),
        newTardinessMinutes: Math.round(newT),
        becameLate: oldT === 0 && newT > 0,
      });
    }
  }
  return impacts.sort((a, b) => b.newTardinessMinutes - a.newTardinessMinutes);
}

export function metricsOf(input: SchedulingInput, tasks: ScheduledTask[]): ScheduleMetrics {
  return calculateMetrics({
    tasks,
    orders: input.orders,
    machines: input.machines,
    downtimes: input.downtimes,
    anchorTime: input.anchorTime,
  });
}

/** 由既有任務重建機台狀態(急單「插入目前排程」用) */
export function statesFromTasks(input: SchedulingInput, tasks: ScheduledTask[]): Map<string, MachineState> {
  const orderById = new Map(input.orders.map((o) => [o.id, o]));
  const states = new Map<string, MachineState>();
  for (const m of input.machines) {
    if (m.status === 'disabled') continue;
    const machineTasks = tasks.filter((t) => t.machineId === m.id && t.taskType !== 'maintenance');
    const busy = machineTasks.map((t) => ({ start: t.startTime, end: t.endTime }));
    let lastEnd = input.anchorTime;
    let lastProductId: string | null = null;
    let loadMinutes = 0;
    for (const t of machineTasks) {
      if (t.taskType === 'production' && t.orderId) {
        loadMinutes += (t.endTime - t.startTime) / 60_000;
        if (t.endTime >= lastEnd) {
          lastEnd = t.endTime;
          lastProductId = orderById.get(t.orderId)?.productId ?? null;
        }
      }
      lastEnd = Math.max(lastEnd, t.endTime);
    }
    states.set(m.id, { machine: m, busy, lastProductId, lastEnd, loadMinutes });
  }
  return states;
}

export interface UrgentInsertResult {
  ok: boolean;
  reason?: string;
  placement?: Placement;
  tasks?: ScheduledTask[];
  metrics?: ScheduleMetrics;
}

/** 急單「插入目前排程」:既有任務不動,急單以最早完成原則附加 */
export function insertUrgentOrder(
  input: SchedulingInput,
  currentTasks: ScheduledTask[],
  urgent: ProductionOrder,
): UrgentInsertResult {
  const inputWithUrgent: SchedulingInput = { ...input, orders: [...input.orders, urgent] };
  const machines = eligibleMachines(urgent, input.machines);
  if (machines.length === 0) return { ok: false, reason: '急單沒有可加工的機台' };
  const states = statesFromTasks(inputWithUrgent, currentTasks);
  const horizonEnd = input.anchorTime + (input.horizonDays ?? 60) * 24 * 3600_000;
  const candidates: { state: MachineState; placement: Placement }[] = [];
  for (const m of machines) {
    const state = states.get(m.id);
    if (!state) continue;
    const placement = computePlacement(state, urgent, inputWithUrgent, horizonEnd);
    if (placement) candidates.push({ state, placement });
  }
  const best = chooseBestPlacement(candidates);
  if (!best) return { ok: false, reason: '所有機台都無法在規劃期間內完成急單' };

  const newTasks: ScheduledTask[] = [...currentTasks];
  let seq = currentTasks.filter((t) => t.machineId === best.state.machine.id).length;
  const push = (taskType: ScheduledTask['taskType'], start: number | null, end: number | null) => {
    if (start === null || end === null) return;
    seq += 1;
    newTasks.push({
      id: `urgent-${urgent.orderNumber}-${taskType}`,
      orderId: urgent.id,
      machineId: best.state.machine.id,
      taskType,
      startTime: start,
      endTime: end,
      sequence: seq,
      isManuallyAdjusted: false,
    });
  };
  push('cleaning', best.placement.cleaningStart, best.placement.cleaningEnd);
  push('setup', best.placement.setupStart, best.placement.setupEnd);
  push('production', best.placement.productionStart, best.placement.productionEnd);

  return {
    ok: true,
    placement: best.placement,
    tasks: newTasks,
    metrics: metricsOf(inputWithUrgent, newTasks),
  };
}

/** 重新計算全部排程(含急單) */
export function rebuildWithUrgent(
  input: SchedulingInput,
  algorithm: AlgorithmId,
  urgent: ProductionOrder,
): { tasks: ScheduledTask[]; metrics: ScheduleMetrics; unscheduled: { orderNumber: string; reason: string }[] } {
  const inputWithUrgent: SchedulingInput = { ...input, orders: [...input.orders, urgent] };
  const r = runAlgorithm(inputWithUrgent, algorithm);
  return {
    tasks: r.tasks,
    metrics: metricsOf(inputWithUrgent, r.tasks),
    unscheduled: r.unscheduledOrders.map((u) => ({ orderNumber: u.orderNumber, reason: u.reason })),
  };
}

export interface BreakdownSimulation {
  tasks: ScheduledTask[];
  metrics: ScheduleMetrics;
  impacts: OrderImpact[];
  lateOrders: { orderId: string; orderNumber: string; tardinessMinutes: number; priority: number }[];
}

/** 以指定故障時段重跑排程 */
export function simulateBreakdown(
  input: SchedulingInput,
  algorithm: AlgorithmId,
  baselineTasks: ScheduledTask[],
  machineId: string,
  startTime: number,
  repairEndTime: number,
): BreakdownSimulation {
  const breakdownDowntime: MachineDowntime = {
    id: 'sim-breakdown',
    machineId,
    type: 'breakdown',
    startTime,
    endTime: repairEndTime,
    reason: '故障模擬',
  };
  const simInput: SchedulingInput = { ...input, downtimes: [...input.downtimes, breakdownDowntime] };
  const r = runAlgorithm(simInput, algorithm);
  const metrics = metricsOf(simInput, r.tasks);
  const impacts = compareImpacts(baselineTasks, r.tasks, input.orders);
  const completions = completionsOf(r.tasks);
  const lateOrders = input.orders
    .map((o) => {
      const c = completions.get(o.id);
      const tardiness = c ? Math.max(0, Math.round((c - o.dueDate) / 60_000)) : 0;
      return { orderId: o.id, orderNumber: o.orderNumber, tardinessMinutes: tardiness, priority: o.priority };
    })
    .filter((o) => o.tardinessMinutes > 0)
    .sort((a, b) => b.tardinessMinutes - a.tardinessMinutes);
  return { tasks: r.tasks, metrics, impacts, lateOrders };
}

/** 重要訂單:priority ≤ 2(ASSUMPTIONS #24) */
const IMPORTANT_PRIORITY = 2;
const STEP_MS = 30 * 60_000;

/**
 * 反向計算:最晚必須在何時修復,重要訂單才不會逾期。
 * 以 30 分鐘為步長在 [startTime, repairEndTime] 內二分搜尋。
 * 回傳 null 表示即使立即修復也無法避免重要訂單逾期。
 */
export function latestSafeRepairTime(
  input: SchedulingInput,
  algorithm: AlgorithmId,
  machineId: string,
  startTime: number,
  repairEndTime: number,
): number | null {
  const isSafe = (steps: number): boolean => {
    const sim = simulateBreakdown(input, algorithm, [], machineId, startTime, startTime + steps * STEP_MS);
    return sim.lateOrders.filter((o) => o.priority <= IMPORTANT_PRIORITY).length === 0;
  };

  const maxSteps = Math.max(1, Math.ceil((repairEndTime - startTime) / STEP_MS));
  if (!isSafe(1)) return null;

  // 二分搜尋最大的安全步數(假設停機越久影響越大,單調)
  let lo = 1;
  let hi = maxSteps;
  let best = 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (isSafe(mid)) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return startTime + best * STEP_MS;
}

function completionsOfPublic(tasks: ScheduledTask[]): Map<string, number> {
  return completionsOf(tasks);
}
export { completionsOfPublic as completionsOf };
