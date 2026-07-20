/**
 * AI prompt builder:組合結構化 JSON 輸入與防捏造 system prompt。
 * AI 只負責解釋與建議,不取代排程演算法。
 */
import { prisma } from '../../shared/db.js';
import type { ScheduleMetrics } from '../scheduling/engine/types.js';

export const SYSTEM_PROMPT = `你是一套生產排程決策輔助系統的分析顧問,對象是不熟悉排程演算法的工廠現場管理人員、生管人員與廠長。

嚴格遵守以下規則:
1. 你只能根據使用者訊息中提供的結構化 JSON 數據回答,絕對不可以捏造任何訂單、時間、機台或績效數據。
2. 排程結果由系統的排程引擎(deterministic scheduling engine)產生,你不負責重新排程,只負責解釋與提供建議。
3. 回答必須引用 JSON 中的實際數據(例如「準時交貨率由 65% 提升至 88%」),不可以只給結論。
4. 說明建議時必須同時講清楚:優點、缺點、可能的代價。
5. 若 JSON 中沒有回答問題所需的資料,直接明確說明缺少哪些資料,不要猜測。
6. 使用非技術人員容易理解的繁體中文,避免術語;必要時用一句話解釋術語(例如 Makespan = 全部訂單做完所需的總時間)。
7. 你的建議不會直接修改排程;提醒使用者確認後才套用。
8. 數值請適當換算為易讀單位(分鐘 → 小時/天),但要保留原始數字。`;

export interface AiContext {
  objectiveLabel: string;
  scenarios: {
    algorithm: string;
    rank: number;
    score: number;
    isManuallyAdjusted: boolean;
    metrics: ScheduleMetrics;
    recommendationReason: string;
  }[];
  lateOrders: {
    orderNumber: string;
    productName: string;
    dueDate: string;
    completionTime: string | null;
    tardinessMinutes: number;
    priority: number;
    machineCode: string | null;
  }[];
  machineLoads: {
    machineCode: string;
    machineName: string;
    status: string;
    productionMinutes: number;
    setupMinutes: number;
    cleaningMinutes: number;
    taskCount: number;
  }[];
  changeoverSummary: { setupCount: number; cleaningCount: number };
  unscheduledOrders: { orderNumber: string; reason: string }[];
  manualAdjustments: { note: string } | null;
}

const OBJECTIVE_LABELS: Record<string, string> = {
  ON_TIME_DELIVERY: '優先準時交貨',
  MIN_AVG_TARDINESS: '優先降低平均延遲',
  MIN_MAKESPAN: '優先縮短 Makespan',
  MAX_UTILIZATION: '優先提高機台利用率',
  MIN_CHANGEOVER: '優先降低換模與清洗時間',
  BALANCED: '綜合平衡',
};

/**
 * 從資料庫組合傳給 AI 的結構化數據(所有方案指標、排程目標、
 * 延遲訂單、機台負載、換模清洗次數、人工調整、情境資訊)。
 */
export async function buildAiContext(): Promise<AiContext | null> {
  const scenarioRecords = await prisma.scheduleScenario.findMany({
    orderBy: { rank: 'asc' },
    include: { tasks: true },
  });
  if (scenarioRecords.length === 0) return null;

  const [orders, machines, products] = await Promise.all([
    prisma.productionOrder.findMany({ include: { product: true } }),
    prisma.machine.findMany(),
    prisma.product.findMany(),
  ]);
  void products;
  const machineById = new Map(machines.map((m) => [m.id, m]));
  const orderById = new Map(orders.map((o) => [o.id, o]));

  const top = scenarioRecords[0]!;
  const topTasks = top.tasks;

  // 延遲訂單(以排名第一方案計)
  const completionByOrder = new Map<string, { end: Date; machineId: string }>();
  for (const t of topTasks) {
    if (t.taskType === 'production' && t.orderId) {
      const cur = completionByOrder.get(t.orderId);
      if (!cur || t.endTime > cur.end) completionByOrder.set(t.orderId, { end: t.endTime, machineId: t.machineId });
    }
  }
  const lateOrders = [...completionByOrder.entries()]
    .map(([orderId, c]) => {
      const o = orderById.get(orderId);
      if (!o) return null;
      const tardiness = Math.max(0, Math.round((c.end.getTime() - o.dueDate.getTime()) / 60_000));
      return {
        orderNumber: o.orderNumber,
        productName: o.product.productName,
        dueDate: o.dueDate.toISOString(),
        completionTime: c.end.toISOString(),
        tardinessMinutes: tardiness,
        priority: o.priority,
        machineCode: machineById.get(c.machineId)?.machineCode ?? null,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null && x.tardinessMinutes > 0)
    .sort((a, b) => b.tardinessMinutes - a.tardinessMinutes);

  const machineLoads = machines.map((m) => {
    const tasks = topTasks.filter((t) => t.machineId === m.id);
    const sum = (type: string) =>
      Math.round(
        tasks
          .filter((t) => t.taskType === type)
          .reduce((s, t) => s + (t.endTime.getTime() - t.startTime.getTime()) / 60_000, 0),
      );
    return {
      machineCode: m.machineCode,
      machineName: m.machineName,
      status: m.status,
      productionMinutes: sum('production'),
      setupMinutes: sum('setup'),
      cleaningMinutes: sum('cleaning'),
      taskCount: tasks.filter((t) => t.taskType !== 'maintenance').length,
    };
  });

  return {
    objectiveLabel: OBJECTIVE_LABELS[top.objective] ?? top.objective,
    scenarios: scenarioRecords.map((s) => ({
      algorithm: s.algorithm,
      rank: s.rank,
      score: s.score,
      isManuallyAdjusted: s.isManuallyAdjusted,
      metrics: JSON.parse(s.metrics) as ScheduleMetrics,
      recommendationReason: s.recommendationReason,
    })),
    lateOrders,
    machineLoads,
    changeoverSummary: {
      setupCount: topTasks.filter((t) => t.taskType === 'setup').length,
      cleaningCount: topTasks.filter((t) => t.taskType === 'cleaning').length,
    },
    unscheduledOrders: (JSON.parse(top.unscheduledOrders) as { orderNumber: string; reason: string }[]).map(
      (u) => ({ orderNumber: u.orderNumber, reason: u.reason }),
    ),
    manualAdjustments: top.isManuallyAdjusted ? { note: '排名第一的方案已經過人工拖曳調整' } : null,
  };
}

/** 將額外情境(急單/故障模擬結果)與問題組成 user message */
export function buildUserMessage(
  context: AiContext,
  question: string,
  extraContext?: unknown,
): string {
  const payload: Record<string, unknown> = {
    排程目標: context.objectiveLabel,
    方案列表: context.scenarios,
    延遲訂單: context.lateOrders,
    機台負載: context.machineLoads,
    換模與清洗次數: context.changeoverSummary,
    無法排入的訂單: context.unscheduledOrders,
    人工調整: context.manualAdjustments,
  };
  if (extraContext) payload['情境模擬'] = extraContext;
  return `以下是目前系統的真實排程數據(JSON):\n${JSON.stringify(payload, null, 2)}\n\n使用者的問題:${question}`;
}
