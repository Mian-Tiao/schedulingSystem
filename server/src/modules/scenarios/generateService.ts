import { z } from 'zod';
import { prisma } from '../../shared/db.js';
import { logger } from '../../shared/logger.js';
import { loadSchedulingInput } from '../../shared/mappers.js';
import { runAllAlgorithms } from '../scheduling/runScheduling.js';
import { saveScenarios } from './service.js';

export const objectiveSchema = z.enum([
  'ON_TIME_DELIVERY',
  'MIN_AVG_TARDINESS',
  'MIN_MAKESPAN',
  'MAX_UTILIZATION',
  'MIN_CHANGEOVER',
  'BALANCED',
]);

export const generateScheduleSchema = z.object({
  objective: objectiveSchema,
  machineIds: z.array(z.string().min(1)).optional(),
  anchorTime: z.string().datetime({ offset: true }).optional(),
  horizonDays: z.number().int().min(1).max(365).optional(),
});

export async function generateSchedules(rawInput: unknown) {
  const body = generateScheduleSchema.parse(rawInput);
  const anchorTime = body.anchorTime ? Date.parse(body.anchorTime) : Date.now();
  const input = await loadSchedulingInput(anchorTime);
  if (body.horizonDays) input.horizonDays = body.horizonDays;
  if (body.machineIds?.length) {
    const selectedMachineIds = new Set(body.machineIds);
    input.machines = input.machines.filter((machine) => selectedMachineIds.has(machine.id));
    input.downtimes = input.downtimes.filter((downtime) => selectedMachineIds.has(downtime.machineId));
    input.changeoverRules = input.changeoverRules.filter(
      (rule) => !rule.machineId || selectedMachineIds.has(rule.machineId),
    );
  }

  const started = Date.now();
  const batchId = `b${anchorTime}`;
  const { scenarios, issues } = runAllAlgorithms(input, body.objective, batchId);
  logger.info(
    { batchId, orders: input.orders.length, machines: input.machines.length, ms: Date.now() - started },
    'scheduling completed',
  );

  if (scenarios.length === 0) {
    return { blocked: true as const, issues };
  }

  await saveScenarios(scenarios, batchId, anchorTime);
  const scheduledOrderIds = new Set(
    scenarios.flatMap((scenario) =>
      scenario.tasks.filter((task) => task.orderId).map((task) => task.orderId!),
    ),
  );
  await prisma.productionOrder.updateMany({
    where: { id: { in: [...scheduledOrderIds] }, status: 'pending' },
    data: { status: 'scheduled' },
  });

  return {
    blocked: false as const,
    batchId,
    anchorTime,
    issues,
    scenarios,
  };
}
