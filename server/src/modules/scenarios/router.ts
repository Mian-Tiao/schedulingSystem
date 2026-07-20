import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../shared/db.js';
import { AppError, wrap } from '../../shared/errors.js';
import { logger } from '../../shared/logger.js';
import { loadSchedulingInput, taskToJson } from '../../shared/mappers.js';
import { applyAdjustment } from '../scheduling/engine/adjust.js';
import type { ScheduleScenario } from '../scheduling/engine/types.js';
import { calculateMetrics } from '../scheduling/metrics/metrics.js';
import { runAllAlgorithms } from '../scheduling/runScheduling.js';
import { loadBaseline, loadScenario, replaceScenarioTasks, saveScenarios } from './service.js';

const objectiveSchema = z.enum([
  'ON_TIME_DELIVERY',
  'MIN_AVG_TARDINESS',
  'MIN_MAKESPAN',
  'MAX_UTILIZATION',
  'MIN_CHANGEOVER',
  'BALANCED',
]);

export const schedulesRouter = Router();

function scenarioSummary(s: ScheduleScenario) {
  return {
    scenarioId: s.scenarioId,
    name: s.name,
    algorithm: s.algorithm,
    objective: s.objective,
    generatedAt: new Date(s.generatedAt).toISOString(),
    metrics: s.metrics,
    score: s.score,
    rank: s.rank,
    recommendationReason: s.recommendationReason,
    isManuallyAdjusted: s.isManuallyAdjusted,
    unscheduledOrders: s.unscheduledOrders,
    taskCount: s.tasks.length,
  };
}

function scenarioDetail(s: ScheduleScenario) {
  return { ...scenarioSummary(s), tasks: s.tasks.map(taskToJson) };
}

// 產生排程:執行全部演算法 → 排名 → 儲存
schedulesRouter.post(
  '/generate',
  wrap(async (req, res) => {
    const body = z
      .object({
        objective: objectiveSchema,
        /** 測試用:固定排程起點以確保 deterministic */
        anchorTime: z.string().datetime({ offset: true }).optional(),
        horizonDays: z.number().int().min(1).max(365).optional(),
      })
      .parse(req.body);

    const anchorTime = body.anchorTime ? Date.parse(body.anchorTime) : Date.now();
    const input = await loadSchedulingInput(anchorTime);
    if (body.horizonDays) input.horizonDays = body.horizonDays;

    const started = Date.now();
    const batchId = `b${anchorTime}`;
    const { scenarios, issues } = runAllAlgorithms(input, body.objective, batchId);
    logger.info(
      { batchId, orders: input.orders.length, machines: input.machines.length, ms: Date.now() - started },
      'scheduling completed',
    );

    if (scenarios.length === 0) {
      res.status(422).json({
        error: {
          code: 'SCHEDULING_BLOCKED',
          message: '資料檢查未通過,無法執行排程',
          details: issues,
        },
      });
      return;
    }

    await saveScenarios(scenarios, batchId, anchorTime);
    // 更新已被排入方案的訂單狀態
    const scheduledOrderIds = new Set(
      scenarios.flatMap((s) => s.tasks.filter((t) => t.orderId).map((t) => t.orderId!)),
    );
    await prisma.productionOrder.updateMany({
      where: { id: { in: [...scheduledOrderIds] }, status: 'pending' },
      data: { status: 'scheduled' },
    });

    res.json({
      batchId,
      anchorTime: new Date(anchorTime).toISOString(),
      issues,
      scenarios: scenarios.map(scenarioSummary),
      recommended: scenarios.filter((s) => s.rank <= 3).map((s) => s.scenarioId),
    });
  }),
);

schedulesRouter.get(
  '/',
  wrap(async (_req, res) => {
    const records = await prisma.scheduleScenario.findMany({ orderBy: { rank: 'asc' } });
    const scenarios = await Promise.all(records.map((r) => loadScenario(r.id)));
    res.json(scenarios.map((s) => scenarioSummary(s.scenario)));
  }),
);

schedulesRouter.get(
  '/:scenarioId',
  wrap(async (req, res) => {
    const { scenario } = await loadScenario(req.params.scenarioId!);
    res.json(scenarioDetail(scenario));
  }),
);

const adjustmentSchema = z.object({
  taskId: z.string().min(1),
  machineId: z.string().min(1),
  startTime: z.string().datetime({ offset: true, message: '開始時間須為 ISO 8601 格式' }),
});

// 拖曳前驗證(不寫入)
schedulesRouter.post(
  '/:scenarioId/validate-adjustment',
  wrap(async (req, res) => {
    const body = adjustmentSchema.parse(req.body);
    const { scenario, anchorTime } = await loadScenario(req.params.scenarioId!);
    const input = await loadSchedulingInput(anchorTime);
    const result = applyAdjustment(scenario.tasks, {
      taskId: body.taskId,
      machineId: body.machineId,
      startTime: Date.parse(body.startTime),
    }, input);

    if (!result.valid) {
      res.json({ valid: false, errors: result.errors, warnings: [], metricsAfter: null, delayDiffs: [] });
      return;
    }
    const metricsAfter = calculateMetrics({
      tasks: result.tasks!,
      orders: input.orders,
      machines: input.machines,
      downtimes: input.downtimes,
      anchorTime,
    });
    res.json({
      valid: true,
      errors: [],
      warnings: result.warnings,
      metricsBefore: scenario.metrics,
      metricsAfter,
      delayDiffs: result.delayDiffs.map(diffToJson),
    });
  }),
);

// 套用調整(寫入)
schedulesRouter.post(
  '/:scenarioId/adjust',
  wrap(async (req, res) => {
    const body = adjustmentSchema.parse(req.body);
    const { scenario, anchorTime } = await loadScenario(req.params.scenarioId!);
    const input = await loadSchedulingInput(anchorTime);
    const result = applyAdjustment(scenario.tasks, {
      taskId: body.taskId,
      machineId: body.machineId,
      startTime: Date.parse(body.startTime),
    }, input);

    if (!result.valid) {
      throw new AppError('INVALID_ADJUSTMENT', result.errors.join('; '), 422, { errors: result.errors });
    }
    const metricsAfter = calculateMetrics({
      tasks: result.tasks!,
      orders: input.orders,
      machines: input.machines,
      downtimes: input.downtimes,
      anchorTime,
    });
    await replaceScenarioTasks(scenario.scenarioId, result.tasks!, metricsAfter, true);
    const updated = await loadScenario(scenario.scenarioId);
    res.json({
      ...scenarioDetail(updated.scenario),
      warnings: result.warnings,
      metricsBefore: scenario.metrics,
      delayDiffs: result.delayDiffs.map(diffToJson),
    });
  }),
);

// 重算績效
schedulesRouter.post(
  '/:scenarioId/recalculate',
  wrap(async (req, res) => {
    const { scenario, anchorTime } = await loadScenario(req.params.scenarioId!);
    const input = await loadSchedulingInput(anchorTime);
    const metrics = calculateMetrics({
      tasks: scenario.tasks,
      orders: input.orders,
      machines: input.machines,
      downtimes: input.downtimes,
      anchorTime,
    });
    await replaceScenarioTasks(scenario.scenarioId, scenario.tasks, metrics, scenario.isManuallyAdjusted);
    const updated = await loadScenario(scenario.scenarioId);
    res.json(scenarioDetail(updated.scenario));
  }),
);

// 回復系統原始排程
schedulesRouter.post(
  '/:scenarioId/reset',
  wrap(async (req, res) => {
    const { scenario, anchorTime } = await loadScenario(req.params.scenarioId!);
    const baseline = await loadBaseline(scenario.scenarioId);
    const input = await loadSchedulingInput(anchorTime);
    const metrics = calculateMetrics({
      tasks: baseline,
      orders: input.orders,
      machines: input.machines,
      downtimes: input.downtimes,
      anchorTime,
    });
    await replaceScenarioTasks(scenario.scenarioId, baseline, metrics, false);
    const updated = await loadScenario(scenario.scenarioId);
    res.json(scenarioDetail(updated.scenario));
  }),
);

function diffToJson(d: {
  orderId: string;
  orderNumber: string;
  oldCompletion: number;
  newCompletion: number;
  oldTardinessMinutes: number;
  newTardinessMinutes: number;
}) {
  return {
    ...d,
    oldCompletion: new Date(d.oldCompletion).toISOString(),
    newCompletion: new Date(d.newCompletion).toISOString(),
  };
}
