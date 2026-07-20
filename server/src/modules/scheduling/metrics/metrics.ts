/**
 * 績效指標計算。全部由真實排程結果計算,禁止 hard-code。
 */
import { machineCapacityMinutes } from '../engine/calendar.js';
import {
  msToMinutes,
  type Machine,
  type MachineDowntime,
  type ProductionOrder,
  type ScheduleMetrics,
  type ScheduledTask,
} from '../engine/types.js';

export function calculateMetrics(params: {
  tasks: ScheduledTask[];
  orders: ProductionOrder[];
  machines: Machine[];
  downtimes: MachineDowntime[];
  anchorTime: number;
}): ScheduleMetrics {
  const { tasks, orders, machines, downtimes, anchorTime } = params;
  const orderById = new Map(orders.map((o) => [o.id, o]));

  const productionTasks = tasks.filter((t) => t.taskType === 'production' && t.orderId);
  const setupTasks = tasks.filter((t) => t.taskType === 'setup');
  const cleaningTasks = tasks.filter((t) => t.taskType === 'cleaning');

  // 每張訂單完成時間 = 其 production 任務結束時間
  const completionByOrder = new Map<string, number>();
  for (const t of productionTasks) {
    if (!t.orderId) continue;
    completionByOrder.set(t.orderId, Math.max(completionByOrder.get(t.orderId) ?? 0, t.endTime));
  }

  const scheduledOrders = [...completionByOrder.keys()]
    .map((id) => orderById.get(id))
    .filter((o): o is ProductionOrder => Boolean(o));

  // Makespan:排程起點到最後一個任務(production/setup/cleaning)結束
  const workTasks = tasks.filter((t) => t.taskType !== 'maintenance');
  const lastEnd = workTasks.reduce((max, t) => Math.max(max, t.endTime), anchorTime);
  const makespanMinutes = round1(msToMinutes(lastEnd - anchorTime));

  // 延遲(tardiness = max(0, completionTime - dueDate))
  let totalTardiness = 0;
  let maxTardiness = 0;
  let onTime = 0;
  let lateCount = 0;
  let totalFlow = 0;
  for (const o of scheduledOrders) {
    const completion = completionByOrder.get(o.id) ?? 0;
    const tardiness = Math.max(0, msToMinutes(completion - o.dueDate));
    totalTardiness += tardiness;
    maxTardiness = Math.max(maxTardiness, tardiness);
    if (tardiness > 0) lateCount += 1;
    else onTime += 1;
    totalFlow += msToMinutes(completion - o.releaseTime);
  }
  const n = scheduledOrders.length;

  // 機台利用率:僅計入有任務的機台,分母 = 排程起點至最後任務結束的可用時間
  const usedMachineIds = new Set(workTasks.map((t) => t.machineId));
  let capacityMinutes = 0;
  for (const m of machines) {
    if (!usedMachineIds.has(m.id)) continue;
    capacityMinutes += machineCapacityMinutes(m, downtimes, anchorTime, lastEnd);
  }
  const productionMinutes = sumMinutes(productionTasks);
  const setupMinutes = sumMinutes(setupTasks);
  const cleaningMinutes = sumMinutes(cleaningTasks);

  return {
    makespanMinutes,
    averageTardinessMinutes: n > 0 ? round1(totalTardiness / n) : 0,
    maximumTardinessMinutes: round1(maxTardiness),
    onTimeDeliveryRate: n > 0 ? round3(onTime / n) : 0,
    machineUtilizationRate: capacityMinutes > 0 ? round3(productionMinutes / capacityMinutes) : 0,
    machineOccupancyRate:
      capacityMinutes > 0 ? round3((productionMinutes + setupMinutes + cleaningMinutes) / capacityMinutes) : 0,
    totalSetupMinutes: round1(setupMinutes),
    totalCleaningMinutes: round1(cleaningMinutes),
    averageFlowTimeMinutes: n > 0 ? round1(totalFlow / n) : 0,
    lateOrderCount: lateCount,
    scheduledOrderCount: n,
  };
}

function sumMinutes(tasks: ScheduledTask[]): number {
  return tasks.reduce((sum, t) => sum + msToMinutes(t.endTime - t.startTime), 0);
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
