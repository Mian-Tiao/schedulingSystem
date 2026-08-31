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
3. 先直接回答使用者的問題,再引用 1 至 3 個最關鍵的實際數據支持結論;不要重述問題或完整盤點所有數據。
4. 提供建議時只說明最重要的理由與一項風險;只有使用者要求「詳細分析」「完整比較」或明確詢問取捨時,才展開優點、缺點與代價。
5. 若 JSON 中沒有回答問題所需的資料,直接明確說明缺少哪些資料,不要猜測。
6. 使用非技術人員容易理解的繁體中文,避免術語;必要時用一句話解釋術語(例如 Makespan = 全部訂單做完所需的總時間)。
7. 數值請適當換算為易讀單位(分鐘 → 小時/天),但要保留原始數字。
8. 預設回答控制在 120 至 300 個中文字內、最多 5 個短項目;複雜的四方案比較最多 500 字。只有使用者明確要求詳細內容時才可超過。
9. 不要寒暄、不要自我介紹、不要寫冗長前言或結尾提醒。
10. 前端以純文字顯示,禁止輸出 Markdown 語法或表格,包括 #、**、---;可使用簡短編號或「•」分點。
11. 使用者要求查詢、分析或情境預演時優先呼叫對應讀取工具;要求新增訂單、修改訂單或執行排程時必須呼叫對應寫入工具,不可只用文字假裝已完成。
12. 每次最多提出一個寫入工具呼叫。寫入操作會由 Server 顯示確認卡,在收到工具執行結果前絕對不可宣稱操作成功。
13. run_simulation 只會預演、不會套用結果;回答時必須明確說明這是模擬。工具缺少必要欄位時,用一句話詢問缺少的資料,不可自行猜測訂單編號、產品、數量或交期。`;

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

export interface ConversationTurn {
  role: 'user' | 'assistant';
  text: string;
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
  context: AiContext | null,
  question: string,
  extraContext?: unknown,
  history: ConversationTurn[] = [],
): string {
  const payload: Record<string, unknown> = context
    ? {
        排程目標: context.objectiveLabel,
        方案列表: context.scenarios,
        延遲訂單: context.lateOrders,
        機台負載: context.machineLoads,
        換模與清洗次數: context.changeoverSummary,
        無法排入的訂單: context.unscheduledOrders,
        人工調整: context.manualAdjustments,
      }
    : { 排程狀態: '目前尚未產生排程方案' };
  if (extraContext) payload['情境模擬'] = extraContext;
  if (history.length > 0) payload['最近對話'] = history;
  const now = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Taipei',
    dateStyle: 'short',
    timeStyle: 'medium',
    hour12: false,
  }).format(new Date());
  return `台灣目前時間:${now} (UTC+8)\n以下是目前系統的真實排程數據(JSON):\n${JSON.stringify(payload, null, 2)}\n\n使用者的問題:${question}`;
}
