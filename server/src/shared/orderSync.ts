import { prisma } from './db.js';

/**
 * 自動同步訂單狀態：比對「現在時間」與排行第一的排程方案，
 * 將超時的訂單標記為已完成 (completed)，將正在預計時間內的訂單標記為生產中 (inProgress)。
 */
export async function syncOrderStatuses(now: Date = new Date()) {
  const topScenario = await prisma.scheduleScenario.findFirst({
    where: { rank: 1 },
    include: { tasks: { where: { taskType: 'production' } } },
  });

  if (!topScenario) return;

  const inProgressIds: string[] = [];
  const completedIds: string[] = [];

  for (const t of topScenario.tasks) {
    if (!t.orderId) continue;
    if (t.endTime <= now) {
      completedIds.push(t.orderId);
    } else if (t.startTime <= now) {
      inProgressIds.push(t.orderId);
    }
  }

  // 1. 更新為已完成 (completed)
  if (completedIds.length > 0) {
    await prisma.productionOrder.updateMany({
      where: {
        id: { in: completedIds },
        status: { in: ['pending', 'scheduled', 'inProgress'] },
      },
      data: { status: 'completed' },
    });
  }

  // 2. 更新為生產中 (inProgress)
  if (inProgressIds.length > 0) {
    await prisma.productionOrder.updateMany({
      where: {
        id: { in: inProgressIds },
        status: 'scheduled', // 只將處於「已排程」狀態的訂單轉為「生產中」
      },
      data: { status: 'inProgress' },
    });
  }
}
