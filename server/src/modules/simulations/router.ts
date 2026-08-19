import { Router } from 'express';
import { z } from 'zod';
import { notFound, wrap } from '../../shared/errors.js';
import { prisma } from '../../shared/db.js';
import { loadSchedulingInput, taskToJson } from '../../shared/mappers.js';
import type { ProductionOrder, ScheduledTask } from '../scheduling/engine/types.js';
import { loadScenario } from '../scenarios/service.js';
import {
  compareImpacts,
  insertUrgentOrder,
  latestSafeRepairTime,
  rebuildWithUrgent,
  simulateBreakdown,
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

const urgentSchema = z.object({
  scenarioId: z.string().min(1, '請先產生排程方案'),
  order: z
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
    }),
});

simulationsRouter.post(
  '/urgent-order',
  wrap(async (req, res) => {
    const body = urgentSchema.parse(req.body);
    const { scenario, anchorTime } = await loadScenario(body.scenarioId);
    const input = await loadSchedulingInput(
      anchorTime,
      [...new Set(scenario.tasks.map((t) => t.orderId).filter((x): x is string => Boolean(x)))],
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

const breakdownSchema = z
  .object({
    scenarioId: z.string().min(1, '請先產生排程方案'),
    machineId: z.string().min(1, '請選擇故障機台'),
    startTime: z.string().datetime({ offset: true, message: '故障開始時間須為 ISO 8601 格式' }),
    estimatedRepairTime: z.string().datetime({ offset: true, message: '預估修復時間須為 ISO 8601 格式' }),
  })
  .refine((b) => new Date(b.estimatedRepairTime) > new Date(b.startTime), {
    message: '預估修復時間必須晚於故障開始時間',
  });

simulationsRouter.post(
  '/machine-breakdown',
  wrap(async (req, res) => {
    const body = breakdownSchema.parse(req.body);
    const { scenario, anchorTime } = await loadScenario(body.scenarioId);
    const input = await loadSchedulingInput(
      anchorTime,
      [...new Set(scenario.tasks.map((t) => t.orderId).filter((x): x is string => Boolean(x)))],
    );
    const machine = input.machines.find((m) => m.id === body.machineId);
    if (!machine) throw notFound('機台');

    const start = Date.parse(body.startTime);
    const repairEnd = Date.parse(body.estimatedRepairTime);

    // 情境一:按預估修復時間,哪些訂單延遲、延遲多久
    const sim = simulateBreakdown(input, scenario.algorithm, scenario.tasks, body.machineId, start, repairEnd);

    // 情境二:反向計算最晚安全修復時間
    const safeRepair = latestSafeRepairTime(input, scenario.algorithm, body.machineId, start, repairEnd);

    // 無法完全避免時的建議
    const lateOrderIds = new Set(sim.lateOrders.map((o) => o.orderId));
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
    const priorityOrders = sim.lateOrders
      .filter((o) => o.priority <= 2)
      .map((o) => o.orderNumber);
    const negotiableOrders = sim.lateOrders
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
      withEstimatedRepair: {
        metrics: sim.metrics,
        tasks: sim.tasks.map(taskToJson),
        impacts: sim.impacts.map(impactToJson),
        lateOrders: sim.lateOrders,
        lateOrderCount: sim.lateOrders.length,
      },
      reverseAnalysis: {
        latestSafeRepairTime: safeRepair ? new Date(safeRepair).toISOString() : null,
        message: safeRepair
          ? `最晚須於 ${new Date(safeRepair).toISOString()} 前修復,重要訂單(優先級 ≤ 2)才不會逾期`
          : '即使立即修復,仍無法完全避免重要訂單逾期',
      },
      suggestions: {
        minimumLateOrderCount: sim.lateOrders.length,
        transferMachines,
        priorityOrders,
        negotiableOrders,
      },
    });
  }),
);
