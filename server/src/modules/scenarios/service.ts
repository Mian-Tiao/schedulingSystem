/**
 * 方案儲存/載入:引擎結果 ⇄ 資料庫。
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '../../shared/db.js';
import { notFound } from '../../shared/errors.js';
import { toTask } from '../../shared/mappers.js';
import type {
  ScheduleMetrics,
  ScheduleScenario,
  ScheduledTask,
} from '../scheduling/engine/types.js';

export interface StoredScenario {
  scenario: ScheduleScenario;
  batchId: string;
  anchorTime: number;
}

export async function saveScenarios(
  scenarios: ScheduleScenario[],
  batchId: string,
  anchorTime: number,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // 只保留最新一批方案
    await tx.scheduledTask.deleteMany({});
    await tx.scheduleScenario.deleteMany({});
    for (const s of scenarios) {
      await tx.scheduleScenario.create({
        data: {
          id: s.scenarioId,
          name: s.name,
          algorithm: s.algorithm,
          objective: s.objective,
          generatedAt: new Date(s.generatedAt),
          metrics: JSON.stringify(s.metrics),
          score: s.score,
          rank: s.rank,
          recommendationReason: s.recommendationReason,
          isManuallyAdjusted: false,
          baselineTasks: JSON.stringify(s.tasks),
          unscheduledOrders: JSON.stringify(s.unscheduledOrders),
          batchId,
          anchorTime: new Date(anchorTime),
        },
      });
      await tx.scheduledTask.createMany({
        data: s.tasks.map((t) => taskToDb(t, s.scenarioId)),
      });
    }
  });
}

function taskToDb(t: ScheduledTask, scenarioId: string): Prisma.ScheduledTaskCreateManyInput {
  return {
    id: `${scenarioId}:${t.id}`,
    scenarioId,
    orderId: t.orderId,
    machineId: t.machineId,
    taskType: t.taskType,
    startTime: new Date(t.startTime),
    endTime: new Date(t.endTime),
    sequence: t.sequence,
    isManuallyAdjusted: t.isManuallyAdjusted,
  };
}

export async function loadScenario(scenarioId: string): Promise<StoredScenario> {
  const record = await prisma.scheduleScenario.findUnique({
    where: { id: scenarioId },
    include: { tasks: { orderBy: { startTime: 'asc' } } },
  });
  if (!record) throw notFound('排程方案(可能已被新的排程取代)');
  const tasks: ScheduledTask[] = record.tasks.map((t) => ({
    ...toTask(t),
    // 還原引擎層 task id(去掉 scenario 前綴)
    id: t.id.startsWith(`${record.id}:`) ? t.id.slice(record.id.length + 1) : t.id,
  }));
  return {
    scenario: {
      scenarioId: record.id,
      name: record.name,
      algorithm: record.algorithm as ScheduleScenario['algorithm'],
      objective: record.objective as ScheduleScenario['objective'],
      generatedAt: record.generatedAt.getTime(),
      tasks,
      metrics: JSON.parse(record.metrics) as ScheduleMetrics,
      score: record.score,
      rank: record.rank,
      recommendationReason: record.recommendationReason,
      isManuallyAdjusted: record.isManuallyAdjusted,
      unscheduledOrders: JSON.parse(record.unscheduledOrders) as ScheduleScenario['unscheduledOrders'],
    },
    batchId: record.batchId,
    anchorTime: record.anchorTime.getTime(),
  };
}

export async function replaceScenarioTasks(
  scenarioId: string,
  tasks: ScheduledTask[],
  metrics: ScheduleMetrics,
  isManuallyAdjusted: boolean,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.scheduledTask.deleteMany({ where: { scenarioId } });
    await tx.scheduledTask.createMany({ data: tasks.map((t) => taskToDb(t, scenarioId)) });
    await tx.scheduleScenario.update({
      where: { id: scenarioId },
      data: { metrics: JSON.stringify(metrics), isManuallyAdjusted },
    });
  });
}

export async function loadBaseline(scenarioId: string): Promise<ScheduledTask[]> {
  const record = await prisma.scheduleScenario.findUnique({ where: { id: scenarioId } });
  if (!record) throw notFound('排程方案');
  return JSON.parse(record.baselineTasks) as ScheduledTask[];
}
