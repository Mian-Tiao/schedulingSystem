/**
 * Prisma record ⇄ 排程引擎 domain model 轉換。
 * JSON 欄位(陣列、workingHours)與 Date ⇄ epoch ms 的邊界都在這裡處理。
 */
import type {
  ChangeoverRule as DbChangeoverRule,
  Machine as DbMachine,
  MachineDowntime as DbDowntime,
  Product as DbProduct,
  ProductionOrder as DbOrder,
  ScheduledTask as DbTask,
} from '@prisma/client';
import type {
  ChangeoverRule,
  Machine,
  MachineDowntime,
  MachineStatus,
  DowntimeType,
  OrderStatus,
  Product,
  ProductionOrder,
  ScheduledTask,
  SchedulingInput,
  TaskType,
  WorkingHours,
} from '../modules/scheduling/engine/types.js';
import { prisma } from './db.js';
import { syncOrderStatuses } from './orderSync.js';

export const EMPTY_WORKING_HOURS: WorkingHours = {
  mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [],
};

function parseJson<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

export function toProduct(p: DbProduct): Product {
  return {
    id: p.id,
    productCode: p.productCode,
    productName: p.productName,
    defaultProcessingTime: p.defaultProcessingTime,
    defaultCleaningTime: p.defaultCleaningTime,
  };
}

export function toMachine(m: DbMachine): Machine {
  return {
    id: m.id,
    machineCode: m.machineCode,
    machineName: m.machineName,
    model: m.model,
    supportedProductIds: parseJson<string[]>(m.supportedProductIds, []),
    defaultSetupTime: m.defaultSetupTime,
    defaultCleaningTime: m.defaultCleaningTime,
    workingHours: { ...EMPTY_WORKING_HOURS, ...parseJson<Partial<WorkingHours>>(m.workingHours, {}) },
    status: m.status as MachineStatus,
  };
}

export function toDowntime(d: DbDowntime): MachineDowntime {
  return {
    id: d.id,
    machineId: d.machineId,
    type: d.type as DowntimeType,
    startTime: d.startTime.getTime(),
    endTime: d.endTime.getTime(),
    reason: d.reason,
  };
}

export function toChangeoverRule(c: DbChangeoverRule): ChangeoverRule {
  return {
    id: c.id,
    machineId: c.machineId,
    fromProductId: c.fromProductId,
    toProductId: c.toProductId,
    setupMinutes: c.setupMinutes,
    cleaningMinutes: c.cleaningMinutes,
  };
}

export function toOrder(o: DbOrder): ProductionOrder {
  return {
    id: o.id,
    orderNumber: o.orderNumber,
    productId: o.productId,
    quantity: o.quantity,
    releaseTime: o.releaseTime.getTime(),
    dueDate: o.dueDate.getTime(),
    processingTime: o.processingTime,
    priority: o.priority,
    eligibleMachineIds: parseJson<string[]>(o.eligibleMachineIds, []),
    status: o.status as OrderStatus,
    createdAt: o.createdAt.getTime(),
  };
}

export function toTask(t: DbTask): ScheduledTask {
  return {
    id: t.id,
    orderId: t.orderId,
    machineId: t.machineId,
    taskType: t.taskType as TaskType,
    startTime: t.startTime.getTime(),
    endTime: t.endTime.getTime(),
    sequence: t.sequence,
    isManuallyAdjusted: t.isManuallyAdjusted,
  };
}

/** task → API 輸出(ISO 8601) */
export function taskToJson(t: ScheduledTask) {
  return {
    taskId: t.id,
    orderId: t.orderId,
    machineId: t.machineId,
    taskType: t.taskType,
    startTime: new Date(t.startTime).toISOString(),
    endTime: new Date(t.endTime).toISOString(),
    sequence: t.sequence,
    isManuallyAdjusted: t.isManuallyAdjusted,
  };
}

/**
 * 從資料庫載入排程引擎輸入(pending/scheduled 的訂單)。
 */
export async function loadSchedulingInput(
  anchorTime: number,
  /**
   * 額外要載入的訂單 id(不論狀態)。
   * 調整 / 模擬「既有排程」時,方案裡的訂單可能已被自動同步成 completed / inProgress,
   * 需要連同這些狀態的訂單一起載入,否則會找不到訂單資料。
   * 產生新排程時不傳,維持只排 pending / scheduled。
   */
  includeOrderIds: string[] = [],
): Promise<SchedulingInput> {
  // 1. 自動把「超時已完成」與「時間內進行中」的訂單狀態同步更新
  await syncOrderStatuses(new Date(anchorTime));

  // 找出目前排行第一的方案
  const topScenario = await prisma.scheduleScenario.findFirst({
    where: { rank: 1 },
  });

  let inProgressTasks: DbTask[] = [];

  if (topScenario) {
    // 2. 獲取所有目前狀態為 inProgress 的訂單
    const dbInProgressOrders = await prisma.productionOrder.findMany({
      where: { status: 'inProgress' },
    });
    const inProgressOrderIds = dbInProgressOrders.map((o) => o.id);

    if (inProgressOrderIds.length > 0) {
      // 找出這些進行中訂單在 topScenario 中的所有任務
      inProgressTasks = await prisma.scheduledTask.findMany({
        where: {
          scenarioId: topScenario.id,
          orderId: { in: inProgressOrderIds },
        },
      });
    }
    
    // 將 dbInProgressOrders 傳遞給後續使用
    return runLoad(dbInProgressOrders);
  }

  return runLoad([]);

  async function runLoad(dbInProgressOrders: DbOrder[]) {
    const [products, machines, downtimes, rules, orders] = await Promise.all([
      prisma.product.findMany(),
      prisma.machine.findMany(),
      prisma.machineDowntime.findMany(),
      prisma.changeoverRule.findMany(),
      prisma.productionOrder.findMany({
        where: includeOrderIds.length
          ? { OR: [{ status: { in: ['pending', 'scheduled'] } }, { id: { in: includeOrderIds } }] }
          : { status: { in: ['pending', 'scheduled'] } },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    return {
      products: products.map(toProduct),
      machines: machines.map(toMachine),
      downtimes: downtimes.map(toDowntime),
      changeoverRules: rules.map(toChangeoverRule),
      orders: orders.map(toOrder),
      anchorTime,
      inProgressTasks: inProgressTasks.map(toTask),
      inProgressOrders: dbInProgressOrders.map(toOrder),
    };
  }
}
