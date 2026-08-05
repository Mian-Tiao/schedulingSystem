import { Router } from 'express';
import { prisma } from '../../shared/db.js';
import { wrap } from '../../shared/errors.js';
import { toTask } from '../../shared/mappers.js';
import { syncOrderStatuses } from '../../shared/orderSync.js';

export const dashboardRouter = Router();

dashboardRouter.get(
  '/',
  wrap(async (_req, res) => {
    await syncOrderStatuses();
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart.getTime() + 24 * 3600_000);
    const riskWindowEnd = new Date(now.getTime() + 48 * 3600_000);

    const [
      pendingCount,
      dueTodayOrders,
      riskOrders,
      machines,
      topScenario,
    ] = await Promise.all([
      prisma.productionOrder.count({ where: { status: 'pending' } }),
      prisma.productionOrder.findMany({
        where: {
          status: { in: ['pending', 'scheduled', 'inProgress'] },
          dueDate: { gte: todayStart, lt: todayEnd },
        },
        include: { product: { select: { productName: true } } },
        orderBy: { dueDate: 'asc' },
      }),
      prisma.productionOrder.findMany({
        where: {
          status: { in: ['pending', 'scheduled', 'inProgress'] },
          dueDate: { gte: now, lt: riskWindowEnd },
        },
        include: { product: { select: { productName: true } } },
        orderBy: { dueDate: 'asc' },
      }),
      prisma.machine.findMany({ select: { id: true, machineCode: true, machineName: true, status: true } }),
      prisma.scheduleScenario.findFirst({
        where: { rank: 1 },
        include: { tasks: true },
      }),
    ]);

    // 機台負載概況:取排名第一方案的生產分鐘數
    const machineLoad = machines.map((m) => {
      const tasks = (topScenario?.tasks ?? []).filter((t) => t.machineId === m.id);
      const engineTasks = tasks.map(toTask);
      const productionMinutes = engineTasks
        .filter((t) => t.taskType === 'production')
        .reduce((sum, t) => sum + (t.endTime - t.startTime) / 60_000, 0);
      const changeoverMinutes = engineTasks
        .filter((t) => t.taskType === 'setup' || t.taskType === 'cleaning')
        .reduce((sum, t) => sum + (t.endTime - t.startTime) / 60_000, 0);
      return {
        machineId: m.id,
        machineCode: m.machineCode,
        machineName: m.machineName,
        status: m.status,
        productionMinutes: Math.round(productionMinutes),
        changeoverMinutes: Math.round(changeoverMinutes),
      };
    });

    res.json({
      pendingOrderCount: pendingCount,
      dueTodayOrders: dueTodayOrders.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        productName: o.product.productName,
        dueDate: o.dueDate.toISOString(),
        priority: o.priority,
      })),
      riskOrders: riskOrders.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        productName: o.product.productName,
        dueDate: o.dueDate.toISOString(),
        priority: o.priority,
      })),
      availableMachineCount: machines.filter((m) => m.status === 'available').length,
      maintenanceMachineCount: machines.filter((m) => m.status === 'maintenance').length,
      disabledMachineCount: machines.filter((m) => m.status === 'disabled').length,
      latestRecommendation: topScenario
        ? {
            scenarioId: topScenario.id,
            algorithm: topScenario.algorithm,
            score: topScenario.score,
            recommendationReason: topScenario.recommendationReason,
            generatedAt: topScenario.generatedAt.toISOString(),
          }
        : null,
      machineLoad,
    });
  }),
);
