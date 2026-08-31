import { Router } from 'express';
import { z } from 'zod';
import { AppError, notFound, wrap } from '../../shared/errors.js';
import { prisma } from '../../shared/db.js';
import { loadSchedulingInput, taskToJson } from '../../shared/mappers.js';
import type { ProductionOrder, ScheduleMetrics, ScheduledTask } from '../scheduling/engine/types.js';
import { createProductionOrder } from '../orders/service.js';
import { loadScenario, replaceScenarioTasks } from '../scenarios/service.js';
import {
  compareImpacts,
  insertUrgentOrder,
  latestSafeRepairTime,
  localRepairBreakdown,
  rebuildWithUrgent,
  simulateBreakdown,
  type BreakdownSimulation,
  type OrderImpact,
} from './service.js';

export const simulationsRouter = Router();

function impactToJson(i: OrderImpact) {
  return {
    ...i,
    oldCompletion: i.oldCompletion ? new Date(i.oldCompletion).toISOString() : null,
    newCompletion: i.newCompletion ? new Date(i.newCompletion).toISOString() : null,
  };
}

/** 收集方案任務涉及的訂單 id(去重) */
function scenarioOrderIds(tasks: { orderId: string | null }[]): string[] {
  return [...new Set(tasks.map((t) => t.orderId).filter((x): x is string => Boolean(x)))];
}

const urgentOrderInputSchema = z
  .object({
    orderNumber: z.string().min(1, '訂單編號為必填'),
    productId: z.string().min(1, '請選擇產品'),
    quantity: z.number().positive('數量必須大於零'),
    releaseTime: z.string().datetime({ offset: true }),
    dueDate: z.string().datetime({ offset: true }),
    processingTime: z.number().positive().nullish(),
    priority: z.number().int().min(1).max(5).default(1),
    eligibleMachineIds: z.array(z.string()).default([]),
  })
  .refine((o) => new Date(o.dueDate) >= new Date(o.releaseTime), {
    message: '交期不可早於可開始生產時間',
  });

const urgentSchema = z.object({
  scenarioId: z.string().min(1, '請先產生排程方案'),
  order: urgentOrderInputSchema,
});

simulationsRouter.post(
  '/urgent-order',
  wrap(async (req, res) => {
    const body = urgentSchema.parse(req.body);
    const { scenario, anchorTime } = await loadScenario(body.scenarioId);
    const input = await loadSchedulingInput(
      anchorTime,
      scenarioOrderIds(scenario.tasks),
    );

    const product = await prisma.product.findUnique({ where: { id: body.order.productId } });
    if (!product) throw notFound('產品');

    const urgent: ProductionOrder = {
      id: `sim-urgent-${body.order.orderNumber}`,
      orderNumber: body.order.orderNumber,
      productId: body.order.productId,
      quantity: body.order.quantity,
      releaseTime: Date.parse(body.order.releaseTime),
      dueDate: Date.parse(body.order.dueDate),
      processingTime: body.order.processingTime ?? body.order.quantity * product.defaultProcessingTime,
      priority: body.order.priority,
      eligibleMachineIds: body.order.eligibleMachineIds,
      status: 'pending',
      createdAt: anchorTime,
    };

    // 策略一:插入目前排程(既有訂單不動)
    const insert = insertUrgentOrder(input, scenario.tasks, urgent);
    // 策略二:全部重排(含急單)
    const rebuild = rebuildWithUrgent(input, scenario.algorithm, urgent);
    const rebuildImpacts = compareImpacts(scenario.tasks, rebuild.tasks, input.orders);

    const urgentTardiness = (tasks: ScheduledTask[] | undefined): number | null => {
      if (!tasks) return null;
      const prod = tasks.find((t) => t.orderId === urgent.id && t.taskType === 'production');
      if (!prod) return null;
      return Math.max(0, Math.round((prod.endTime - urgent.dueDate) / 60_000));
    };

    res.json({
      baseline: { metrics: scenario.metrics },
      urgentOrder: { ...body.order, processingTime: urgent.processingTime },
      insert: insert.ok
        ? {
            ok: true,
            tasks: insert.tasks!.map(taskToJson),
            metrics: insert.metrics,
            urgentTardinessMinutes: urgentTardiness(insert.tasks),
            affectedOrders: [], // 插入策略不影響既有訂單
          }
        : { ok: false, reason: insert.reason },
      rebuild: {
        ok: true,
        tasks: rebuild.tasks.map(taskToJson),
        metrics: rebuild.metrics,
        urgentTardinessMinutes: urgentTardiness(rebuild.tasks),
        affectedOrders: rebuildImpacts.map(impactToJson),
        unscheduled: rebuild.unscheduled,
      },
    });
  }),
);

const breakdownInputSchema = z.object({
  scenarioId: z.string().min(1, '請先產生排程方案'),
  machineId: z.string().min(1, '請選擇故障機台'),
  startTime: z.string().datetime({ offset: true, message: '故障開始時間須為 ISO 8601 格式' }),
  estimatedRepairTime: z.string().datetime({ offset: true, message: '預估修復時間須為 ISO 8601 格式' }),
});
const breakdownTimeOrder = (b: { startTime: string; estimatedRepairTime: string }) =>
  new Date(b.estimatedRepairTime) > new Date(b.startTime);
const breakdownSchema = breakdownInputSchema.refine(breakdownTimeOrder, {
  message: '預估修復時間必須晚於故障開始時間',
});

function breakdownScenarioToJson(sim: BreakdownSimulation) {
  return {
    metrics: sim.metrics,
    tasks: sim.tasks.map(taskToJson),
    impacts: sim.impacts.map(impactToJson),
    lateOrders: sim.lateOrders,
    lateOrderCount: sim.lateOrders.length,
    unscheduled: sim.unscheduled,
  };
}

simulationsRouter.post(
  '/machine-breakdown',
  wrap(async (req, res) => {
    const body = breakdownSchema.parse(req.body);
    const { scenario, anchorTime } = await loadScenario(body.scenarioId);
    const input = await loadSchedulingInput(
      anchorTime,
      scenarioOrderIds(scenario.tasks),
    );
    const machine = input.machines.find((m) => m.id === body.machineId);
    if (!machine) throw notFound('機台');

    const start = Date.parse(body.startTime);
    const repairEnd = Date.parse(body.estimatedRepairTime);

    // 方案 A:局部修復——只重排被故障波及的訂單,其餘機台/訂單原封不動
    const localRepair = localRepairBreakdown(input, scenario.algorithm, scenario.tasks, body.machineId, start, repairEnd);
    // 方案 B:全局重排——故障當成新 downtime,全部訂單、全部機台重新跑一次演算法
    const rebuild = simulateBreakdown(input, scenario.algorithm, scenario.tasks, body.machineId, start, repairEnd);

    // 情境二:反向計算最晚安全修復時間(以全局重排的結果為準)
    const safeRepair = latestSafeRepairTime(input, scenario.algorithm, body.machineId, start, repairEnd);

    // 無法完全避免時的建議(以全局重排——理論上最佳的結果——為準)
    const lateOrderIds = new Set(rebuild.lateOrders.map((o) => o.orderId));
    const lateOrdersFull = input.orders.filter((o) => lateOrderIds.has(o.id));
    const lateProductIds = new Set(lateOrdersFull.map((o) => o.productId));
    const transferMachines = input.machines
      .filter(
        (m) =>
          m.id !== body.machineId &&
          m.status !== 'disabled' &&
          [...lateProductIds].some((p) => m.supportedProductIds.includes(p)),
      )
      .map((m) => ({ machineId: m.id, machineCode: m.machineCode, machineName: m.machineName }));
    const priorityOrders = rebuild.lateOrders
      .filter((o) => o.priority <= 2)
      .map((o) => o.orderNumber);
    const negotiableOrders = rebuild.lateOrders
      .filter((o) => o.priority >= 4)
      .map((o) => o.orderNumber);

    res.json({
      baseline: { metrics: scenario.metrics },
      breakdown: {
        machineId: body.machineId,
        machineName: machine.machineName,
        startTime: body.startTime,
        estimatedRepairTime: body.estimatedRepairTime,
      },
      localRepair: { ...breakdownScenarioToJson(localRepair), affectedOrderNumbers: localRepair.affectedOrderNumbers },
      rebuild: breakdownScenarioToJson(rebuild),
      reverseAnalysis: {
        latestSafeRepairTime: safeRepair ? new Date(safeRepair).toISOString() : null,
        message: safeRepair
          ? `最晚須於 ${new Date(safeRepair).toISOString()} 前修復,重要訂單(優先級 ≤ 2)才不會逾期`
          : '即使立即修復,仍無法完全避免重要訂單逾期',
      },
      suggestions: {
        minimumLateOrderCount: rebuild.lateOrders.length,
        transferMachines,
        priorityOrders,
        negotiableOrders,
      },
    });
  }),
);

// ---- 套用模擬結果:把模擬算出的排程真的寫回正式資料 ----

const applyUrgentSchema = z.object({
  scenarioId: z.string().min(1, '請先產生排程方案'),
  strategy: z.enum(['insert', 'rebuild']),
  order: urgentOrderInputSchema,
});

simulationsRouter.post(
  '/urgent-order/apply',
  wrap(async (req, res) => {
    const body = applyUrgentSchema.parse(req.body);
    const { scenario, anchorTime } = await loadScenario(body.scenarioId);

    const product = await prisma.product.findUnique({ where: { id: body.order.productId } });
    if (!product) throw notFound('產品');
    const duplicate = await prisma.productionOrder.findUnique({ where: { orderNumber: body.order.orderNumber } });
    if (duplicate) throw new AppError('DUPLICATE_CODE', `訂單編號 ${body.order.orderNumber} 已存在`, 409);

    const input = await loadSchedulingInput(anchorTime, scenarioOrderIds(scenario.tasks));

    // 先用暫時 id 試算,確定排得進去才建立正式訂單,避免留下排不進去的孤兒資料
    const tempId = `sim-urgent-${body.order.orderNumber}`;
    const urgent: ProductionOrder = {
      id: tempId,
      orderNumber: body.order.orderNumber,
      productId: body.order.productId,
      quantity: body.order.quantity,
      releaseTime: Date.parse(body.order.releaseTime),
      dueDate: Date.parse(body.order.dueDate),
      processingTime: body.order.processingTime ?? body.order.quantity * product.defaultProcessingTime,
      priority: body.order.priority,
      eligibleMachineIds: body.order.eligibleMachineIds,
      status: 'pending',
      createdAt: anchorTime,
    };

    let resultTasks: ScheduledTask[];
    let resultMetrics: ScheduleMetrics;
    let unscheduled: { orderNumber: string; reason: string }[] = [];

    if (body.strategy === 'insert') {
      // 策略一:既有任務不動,急單接在後面——符合「已經發給員工的排程不要動」的現場需求
      const result = insertUrgentOrder(input, scenario.tasks, urgent);
      if (!result.ok) throw new AppError('CANNOT_APPLY', result.reason ?? '無法插入急單', 422);
      resultTasks = result.tasks!;
      resultMetrics = result.metrics!;
    } else {
      // 策略二:含急單重新跑一次演算法,可能調整既有任務
      const result = rebuildWithUrgent(input, scenario.algorithm, urgent);
      resultTasks = result.tasks;
      resultMetrics = result.metrics;
      unscheduled = result.unscheduled;
      if (unscheduled.some((u) => u.orderNumber === urgent.orderNumber)) {
        throw new AppError('CANNOT_APPLY', '即使重新排程,急單仍無法在規劃期間內排入,請調整交期或機台範圍', 422);
      }
    }

    // 試算成功,建立正式訂單並把暫時 id 換成真正的訂單 id 後寫回排程
    const created = await createProductionOrder({ ...body.order, status: 'scheduled' });
    const finalTasks = resultTasks.map((t) => (t.orderId === tempId ? { ...t, orderId: created.id } : t));
    await replaceScenarioTasks(scenario.scenarioId, finalTasks, resultMetrics, body.strategy === 'insert');

    res.json({ ok: true, orderId: created.id, orderNumber: created.orderNumber, unscheduled });
  }),
);

const applyBreakdownSchema = breakdownInputSchema
  .extend({ strategy: z.enum(['localRepair', 'rebuild']) })
  .refine(breakdownTimeOrder, { message: '預估修復時間必須晚於故障開始時間' });

simulationsRouter.post(
  '/machine-breakdown/apply',
  wrap(async (req, res) => {
    const body = applyBreakdownSchema.parse(req.body);
    const { scenario, anchorTime } = await loadScenario(body.scenarioId);
    const input = await loadSchedulingInput(anchorTime, scenarioOrderIds(scenario.tasks));
    const machine = input.machines.find((m) => m.id === body.machineId);
    if (!machine) throw notFound('機台');

    const start = Date.parse(body.startTime);
    const repairEnd = Date.parse(body.estimatedRepairTime);

    const result =
      body.strategy === 'localRepair'
        ? localRepairBreakdown(input, scenario.algorithm, scenario.tasks, body.machineId, start, repairEnd)
        : simulateBreakdown(input, scenario.algorithm, scenario.tasks, body.machineId, start, repairEnd);

    // 真的把故障時段記錄成機台停機,之後重新排程也會考慮進去
    await prisma.machineDowntime.create({
      data: {
        machineId: body.machineId,
        type: 'breakdown',
        startTime: new Date(start),
        endTime: new Date(repairEnd),
        reason: body.strategy === 'localRepair' ? '情境模擬套用:機台故障(局部修復)' : '情境模擬套用:機台故障(全局重排)',
      },
    });
    // 局部修復只動了被波及的訂單,標記人工調整;全局重排等同一次正常的演算法重跑
    await replaceScenarioTasks(scenario.scenarioId, result.tasks, result.metrics, body.strategy === 'localRepair');

    res.json({ ok: true, lateOrderCount: result.lateOrders.length, unscheduled: result.unscheduled });
  }),
);
