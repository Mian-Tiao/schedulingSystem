import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../shared/db.js';
import { AppError, wrap } from '../../shared/errors.js';
import { loadSchedulingInput, taskToJson } from '../../shared/mappers.js';
import { applyAdjustment } from '../scheduling/engine/adjust.js';
import type { ScheduleScenario } from '../scheduling/engine/types.js';
import { calculateMetrics } from '../scheduling/metrics/metrics.js';
import { generateSchedules } from './generateService.js';
import { loadBaseline, loadScenario, replaceScenarioTasks } from './service.js';

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
    const result = await generateSchedules(req.body);
    if (result.blocked) {
      res.status(422).json({
        error: {
          code: 'SCHEDULING_BLOCKED',
          message: '資料檢查未通過,無法執行排程',
          details: result.issues,
        },
      });
      return;
    }

    res.json({
      batchId: result.batchId,
      anchorTime: new Date(result.anchorTime).toISOString(),
      issues: result.issues,
      scenarios: result.scenarios.map(scenarioSummary),
      recommended: result.scenarios.filter((scenario) => scenario.rank <= 3).map((scenario) => scenario.scenarioId),
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

/** 收集方案任務涉及的訂單 id(去重)——載入既有排程時,連 completed/inProgress 的訂單一起載入 */
function scenarioOrderIds(...taskLists: { orderId: string | null }[][]): string[] {
  return [...new Set(taskLists.flat().map((t) => t.orderId).filter((x): x is string => Boolean(x)))];
}

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
    const input = await loadSchedulingInput(anchorTime, scenarioOrderIds(scenario.tasks));
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
    const input = await loadSchedulingInput(anchorTime, scenarioOrderIds(scenario.tasks));
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
    const input = await loadSchedulingInput(anchorTime, scenarioOrderIds(scenario.tasks));
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
    const input = await loadSchedulingInput(anchorTime, scenarioOrderIds(scenario.tasks, baseline));
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
