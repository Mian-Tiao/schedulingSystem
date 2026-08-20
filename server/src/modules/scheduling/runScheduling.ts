/**
 * 排程流程整合:執行全部演算法 → 計算績效 → 排名 → 產生方案。
 */
import { runAlgorithm } from './engine/engine.js';
import {
  ALGORITHMS,
  type ObjectiveId,
  type ScheduleScenario,
  type SchedulingInput,
} from './engine/types.js';
import { calculateMetrics } from './metrics/metrics.js';
import { rankScenarios } from './ranking/ranking.js';
import { validateSchedulingInput, type ValidationIssue } from './validators/validators.js';

export interface SchedulingRunResult {
  scenarios: ScheduleScenario[];
  issues: ValidationIssue[];
}

/**
 * 執行 FIFO / EDD / SPT / CR 四種演算法並排名。
 * 有 error 等級的資料問題時不執行,直接回傳 issues。
 */
export function runAllAlgorithms(
  input: SchedulingInput,
  objective: ObjectiveId,
  idPrefix: string,
): SchedulingRunResult {
  const issues = validateSchedulingInput(input);
  if (issues.some((i) => i.level === 'error')) {
    return { scenarios: [], issues };
  }

  const results = ALGORITHMS.map((algorithm) => {
    const r = runAlgorithm(input, algorithm);
    const metrics = calculateMetrics({
      tasks: r.tasks,
      orders: input.orders,
      machines: input.machines,
      downtimes: input.downtimes,
      anchorTime: input.anchorTime,
    });
    return { ...r, metrics };
  });

  const hasProductionTask = results.some((result) =>
    result.tasks.some((task) => task.taskType === 'production'),
  );
  if (!hasProductionTask) {
    const reasons = [
      ...new Set(results.flatMap((result) => result.unscheduledOrders.map((order) => order.reason))),
    ];
    return {
      scenarios: [],
      issues: [
        ...issues,
        {
          level: 'error',
          code: 'NO_SCHEDULED_TASKS',
          message: reasons.length
            ? `沒有任何訂單能排入甘特圖:${reasons.join('、')}`
            : '沒有任何訂單能排入甘特圖',
        },
      ],
    };
  }

  const ranking = rankScenarios(
    results.map((r) => ({ algorithm: r.algorithm, metrics: r.metrics })),
    objective,
  );

  const scenarios: ScheduleScenario[] = results.map((r) => {
    const rk = ranking.find((e) => e.algorithm === r.algorithm)!;
    return {
      scenarioId: `${idPrefix}-${r.algorithm}`,
      name: `${r.algorithm} 方案`,
      algorithm: r.algorithm,
      objective,
      generatedAt: input.anchorTime,
      tasks: r.tasks,
      metrics: r.metrics,
      score: rk.score,
      rank: rk.rank,
      recommendationReason: rk.recommendationReason,
      isManuallyAdjusted: false,
      unscheduledOrders: r.unscheduledOrders,
    };
  });

  scenarios.sort((a, b) => a.rank - b.rank);
  return { scenarios, issues };
}
