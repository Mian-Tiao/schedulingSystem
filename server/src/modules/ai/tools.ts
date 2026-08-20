import { randomUUID } from 'node:crypto';
import type { FunctionCall, FunctionDeclaration } from '@google/genai';
import { z } from 'zod';
import { prisma } from '../../shared/db.js';
import { AppError } from '../../shared/errors.js';
import { createProductionOrder } from '../orders/service.js';
import { generateSchedules, objectiveSchema } from '../scenarios/generateService.js';

const listProductsSchema = z.object({ search: z.string().optional() });
const listMachinesSchema = z.object({
  status: z.enum(['available', 'maintenance', 'disabled']).optional(),
});
const listOrdersSchema = z.object({
  search: z.string().optional(),
  status: z.enum(['pending', 'scheduled', 'inProgress', 'completed', 'cancelled']).optional(),
  limit: z.number().int().min(1).max(50).default(20),
});

const createOrderToolSchema = z.object({
  orderNumber: z.string().min(1),
  product: z.string().min(1),
  quantity: z.number().positive(),
  releaseTime: z.string().datetime({ offset: true }).optional(),
  dueDate: z.string().datetime({ offset: true }),
  priority: z.number().int().min(1).max(5).default(3),
  eligibleMachines: z.array(z.string().min(1)).default([]),
  notes: z.string().optional(),
  runSchedulingAfterCreate: z.boolean().default(false),
  schedulingObjective: objectiveSchema.default('ON_TIME_DELIVERY'),
});

const runSchedulingToolSchema = z.object({
  objective: objectiveSchema.default('ON_TIME_DELIVERY'),
  horizonDays: z.number().int().min(1).max(365).optional(),
});

export const AI_TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'list_products',
    description: '查詢系統現有產品。當使用者只提供產品名稱或不確定產品編號時先呼叫此工具。',
    parametersJsonSchema: {
      type: 'object',
      properties: { search: { type: 'string', description: '產品編號或名稱關鍵字' } },
      additionalProperties: false,
    },
  },
  {
    name: 'list_machines',
    description: '查詢機台編號、名稱、狀態與可加工產品。',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['available', 'maintenance', 'disabled'] },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list_orders',
    description: '查詢現有訂單、交期、產品、數量、優先級與狀態。',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: '訂單編號關鍵字' },
        status: {
          type: 'string',
          enum: ['pending', 'scheduled', 'inProgress', 'completed', 'cancelled'],
        },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'create_order',
    description:
      '新增生產訂單。這是寫入操作，Server 只會建立待確認操作，使用者確認後才執行。若使用者要求新增後立刻排程，將 runSchedulingAfterCreate 設為 true。',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        orderNumber: { type: 'string', description: '唯一訂單編號，例如 PO-013' },
        product: { type: 'string', description: '現有產品編號或完整產品名稱' },
        quantity: { type: 'number', exclusiveMinimum: 0 },
        releaseTime: {
          type: 'string',
          description: 'ISO 8601 可開始生產時間，須含時區；未提供時由 Server 使用現在時間',
        },
        dueDate: { type: 'string', description: 'ISO 8601 交期，須含時區' },
        priority: { type: 'integer', minimum: 1, maximum: 5, default: 3 },
        eligibleMachines: {
          type: 'array',
          items: { type: 'string' },
          description: '可用機台編號或完整名稱；空陣列表示所有支援此產品的機台',
          default: [],
        },
        notes: { type: 'string' },
        runSchedulingAfterCreate: { type: 'boolean', default: false },
        schedulingObjective: {
          type: 'string',
          enum: objectiveSchema.options,
          default: 'ON_TIME_DELIVERY',
        },
      },
      required: ['orderNumber', 'product', 'quantity', 'dueDate'],
      additionalProperties: false,
    },
  },
  {
    name: 'run_scheduling',
    description: '執行四種排程演算法並產生排名。這是寫入操作，使用者確認後才執行。',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        objective: { type: 'string', enum: objectiveSchema.options, default: 'ON_TIME_DELIVERY' },
        horizonDays: { type: 'integer', minimum: 1, maximum: 365 },
      },
      additionalProperties: false,
    },
  },
];

const MUTATION_TOOL_NAMES = new Set(['create_order', 'run_scheduling']);

export function isMutationTool(call: FunctionCall): boolean {
  return Boolean(call.name && MUTATION_TOOL_NAMES.has(call.name));
}

export async function executeReadTool(call: FunctionCall): Promise<unknown> {
  switch (call.name) {
    case 'list_products': {
      const args = listProductsSchema.parse(call.args ?? {});
      const products = await prisma.product.findMany({ orderBy: { productCode: 'asc' } });
      const search = args.search?.toLocaleLowerCase();
      return products
        .filter(
          (product) =>
            !search ||
            product.productCode.toLocaleLowerCase().includes(search) ||
            product.productName.toLocaleLowerCase().includes(search),
        )
        .map((product) => ({
          productCode: product.productCode,
          productName: product.productName,
          unitProcessingMinutes: product.defaultProcessingTime,
          defaultCleaningMinutes: product.defaultCleaningTime,
        }));
    }
    case 'list_machines': {
      const args = listMachinesSchema.parse(call.args ?? {});
      const [machines, products] = await Promise.all([
        prisma.machine.findMany({
          where: args.status ? { status: args.status } : undefined,
          orderBy: { machineCode: 'asc' },
        }),
        prisma.product.findMany(),
      ]);
      const productById = new Map(products.map((product) => [product.id, product.productCode]));
      return machines.map((machine) => ({
        machineCode: machine.machineCode,
        machineName: machine.machineName,
        status: machine.status,
        supportedProducts: (JSON.parse(machine.supportedProductIds) as string[])
          .map((id) => productById.get(id))
          .filter(Boolean),
      }));
    }
    case 'list_orders': {
      const args = listOrdersSchema.parse(call.args ?? {});
      const orders = await prisma.productionOrder.findMany({
        where: {
          ...(args.status ? { status: args.status } : {}),
          ...(args.search ? { orderNumber: { contains: args.search } } : {}),
        },
        include: { product: { select: { productCode: true, productName: true } } },
        orderBy: { dueDate: 'asc' },
        take: args.limit,
      });
      return orders.map((order) => ({
        orderNumber: order.orderNumber,
        product: `${order.product.productCode} ${order.product.productName}`,
        quantity: order.quantity,
        releaseTime: order.releaseTime.toISOString(),
        dueDate: order.dueDate.toISOString(),
        priority: order.priority,
        status: order.status,
      }));
    }
    default:
      throw new AppError('AI_TOOL_NOT_ALLOWED', `不允許的 AI 工具:${call.name ?? 'unknown'}`, 400);
  }
}

export interface PendingActionView {
  id: string;
  toolName: 'create_order' | 'run_scheduling';
  title: string;
  description: string;
  details: { label: string; value: string }[];
  expiresAt: string;
}

interface CreateOrderAction {
  kind: 'create_order';
  input: {
    orderNumber: string;
    productId: string;
    productLabel: string;
    quantity: number;
    releaseTime: string;
    dueDate: string;
    priority: number;
    eligibleMachineIds: string[];
    eligibleMachineLabels: string[];
    notes?: string;
    runSchedulingAfterCreate: boolean;
    schedulingObjective: z.infer<typeof objectiveSchema>;
  };
}

interface RunSchedulingAction {
  kind: 'run_scheduling';
  input: z.infer<typeof runSchedulingToolSchema>;
}

interface PendingActionRecord {
  view: PendingActionView;
  action: CreateOrderAction | RunSchedulingAction;
}

const pendingActions = new Map<string, PendingActionRecord>();
const ACTION_TTL_MS = 10 * 60 * 1000;

const OBJECTIVE_LABELS: Record<z.infer<typeof objectiveSchema>, string> = {
  ON_TIME_DELIVERY: '優先準時交貨',
  MIN_AVG_TARDINESS: '優先降低平均延遲',
  MIN_MAKESPAN: '優先縮短完工時間',
  MAX_UTILIZATION: '優先提高機台利用率',
  MIN_CHANGEOVER: '優先降低換模與清洗',
  BALANCED: '綜合平衡',
};

function cleanExpiredActions(): void {
  const now = Date.now();
  for (const [id, record] of pendingActions) {
    if (Date.parse(record.view.expiresAt) <= now) pendingActions.delete(id);
  }
}

function formatTaipeiDateTime(value: string): string {
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    dateStyle: 'medium',
    timeStyle: 'short',
    hour12: false,
  }).format(new Date(value));
}

function maxContinuousWorkingMinutes(workingHoursJson: string): number {
  const workingHours = JSON.parse(workingHoursJson) as Record<string, { start: string; end: string }[]>;
  const toMinutes = (time: string) => {
    const [hours, minutes] = time.split(':').map(Number);
    return (hours ?? 0) * 60 + (minutes ?? 0);
  };
  return Math.max(
    0,
    ...Object.values(workingHours).flatMap((segments) =>
      segments.map((segment) => toMinutes(segment.end) - toMinutes(segment.start)),
    ),
  );
}

async function resolveProduct(reference: string) {
  const products = await prisma.product.findMany({
    where: { OR: [{ productCode: reference }, { productName: reference }] },
    take: 2,
  });
  if (products.length === 0) {
    throw new AppError('AI_TOOL_PRODUCT_NOT_FOUND', `找不到產品「${reference}」,請提供產品編號或完整名稱。`, 422);
  }
  if (products.length > 1) {
    throw new AppError('AI_TOOL_PRODUCT_AMBIGUOUS', `產品名稱「${reference}」不唯一,請改用產品編號。`, 422);
  }
  return products[0]!;
}

async function resolveMachines(references: string[]) {
  if (references.length === 0) return [];
  const machines = await prisma.machine.findMany({
    where: { OR: [{ machineCode: { in: references } }, { machineName: { in: references } }] },
  });
  const unresolved = references.filter(
    (reference) => !machines.some((machine) => machine.machineCode === reference || machine.machineName === reference),
  );
  if (unresolved.length > 0) {
    throw new AppError('AI_TOOL_MACHINE_NOT_FOUND', `找不到機台:${unresolved.join('、')}`, 422);
  }
  return machines;
}

export async function preparePendingAction(call: FunctionCall): Promise<PendingActionView> {
  cleanExpiredActions();
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + ACTION_TTL_MS).toISOString();

  if (call.name === 'create_order') {
    const args = createOrderToolSchema.parse(call.args ?? {});
    const [product, machines, allMachines] = await Promise.all([
      resolveProduct(args.product),
      resolveMachines(args.eligibleMachines),
      prisma.machine.findMany({ where: { status: { not: 'disabled' } } }),
    ]);
    const releaseTime = args.releaseTime ?? new Date().toISOString();
    if (new Date(args.dueDate) < new Date(releaseTime)) {
      throw new AppError('AI_TOOL_INVALID_DATE', '訂單交期不可早於可開始生產時間。', 422);
    }
    const action: CreateOrderAction = {
      kind: 'create_order',
      input: {
        orderNumber: args.orderNumber,
        productId: product.id,
        productLabel: `${product.productCode} ${product.productName}`,
        quantity: args.quantity,
        releaseTime,
        dueDate: args.dueDate,
        priority: args.priority,
        eligibleMachineIds: machines.map((machine) => machine.id),
        eligibleMachineLabels: machines.map((machine) => `${machine.machineCode} ${machine.machineName}`),
        notes: args.notes,
        runSchedulingAfterCreate: args.runSchedulingAfterCreate,
        schedulingObjective: args.schedulingObjective,
      },
    };
    const candidateMachines = machines.length
      ? machines
      : allMachines.filter((machine) =>
          (JSON.parse(machine.supportedProductIds) as string[]).includes(product.id),
        );
    const estimatedProcessingMinutes = args.quantity * product.defaultProcessingTime;
    const longestContinuousWindow = Math.max(
      0,
      ...candidateMachines.map((machine) => maxContinuousWorkingMinutes(machine.workingHours)),
    );
    const hasNoCandidateMachine = candidateMachines.length === 0;
    const spansMultipleWorkingWindows =
      longestContinuousWindow > 0 && estimatedProcessingMinutes > longestContinuousWindow;
    const view: PendingActionView = {
      id,
      toolName: 'create_order',
      title: args.runSchedulingAfterCreate ? '新增訂單並重新排程' : '新增生產訂單',
      description: hasNoCandidateMachine
        ? '目前沒有支援此產品的可用機台,新增後將無法排程。'
        : spansMultipleWorkingWindows
          ? '此訂單會跨多個工作時段分段生產,系統將避開午休、下班與停機時段。'
          : '以下操作會寫入系統,請確認資料正確後再執行。',
      details: [
        { label: '訂單編號', value: args.orderNumber },
        { label: '產品', value: action.input.productLabel },
        { label: '數量', value: String(args.quantity) },
        { label: '預估加工時間', value: `${estimatedProcessingMinutes} 分鐘` },
        { label: '可開始時間', value: formatTaipeiDateTime(releaseTime) },
        { label: '交期', value: formatTaipeiDateTime(args.dueDate) },
        { label: '優先級', value: String(args.priority) },
        {
          label: '可用機台',
          value: action.input.eligibleMachineLabels.length
            ? action.input.eligibleMachineLabels.join('、')
            : '所有支援此產品的機台',
        },
        ...(hasNoCandidateMachine
          ? [
              {
                label: '排程警告',
                value: '沒有支援此產品且已啟用的機台。',
              },
            ]
          : []),
        ...(spansMultipleWorkingWindows
          ? [{ label: '排程方式', value: '跨班次分段續做,總加工時間不變。' }]
          : []),
        ...(args.runSchedulingAfterCreate
          ? [{ label: '排程目標', value: OBJECTIVE_LABELS[args.schedulingObjective] }]
          : []),
      ],
      expiresAt,
    };
    pendingActions.set(id, { view, action });
    return view;
  }

  if (call.name === 'run_scheduling') {
    const args = runSchedulingToolSchema.parse(call.args ?? {});
    const action: RunSchedulingAction = { kind: 'run_scheduling', input: args };
    const view: PendingActionView = {
      id,
      toolName: 'run_scheduling',
      title: '執行生產排程',
      description: '系統將重新執行四種演算法並覆蓋目前的方案列表。',
      details: [
        { label: '排程目標', value: OBJECTIVE_LABELS[args.objective] },
        ...(args.horizonDays ? [{ label: '排程範圍', value: `${args.horizonDays} 天` }] : []),
      ],
      expiresAt,
    };
    pendingActions.set(id, { view, action });
    return view;
  }

  throw new AppError('AI_TOOL_NOT_ALLOWED', `不允許的 AI 工具:${call.name ?? 'unknown'}`, 400);
}

export async function confirmPendingAction(id: string) {
  cleanExpiredActions();
  const record = pendingActions.get(id);
  if (!record) throw new AppError('AI_ACTION_EXPIRED', '此操作已失效,請重新輸入指令。', 404);
  pendingActions.delete(id);

  if (record.action.kind === 'create_order') {
    const input = record.action.input;
    const order = await createProductionOrder({
      orderNumber: input.orderNumber,
      productId: input.productId,
      quantity: input.quantity,
      releaseTime: input.releaseTime,
      dueDate: input.dueDate,
      priority: input.priority,
      eligibleMachineIds: input.eligibleMachineIds,
      status: 'pending',
      notes: input.notes,
    });

    if (!input.runSchedulingAfterCreate) {
      return {
        answer: `已新增訂單 ${order.orderNumber}（${input.productLabel}，數量 ${order.quantity}）。`,
        navigateTo: '/orders',
      };
    }

    const scheduling = await generateSchedules({ objective: input.schedulingObjective });
    if (scheduling.blocked) {
      const reason = scheduling.issues.map((issue) => issue.message).join('；');
      return {
        answer: `訂單 ${order.orderNumber} 已新增,但無法產生甘特圖:${reason}`,
        navigateTo: '/schedule',
      };
    }
    const recommended = scheduling.scenarios.find((scenario) => scenario.rank === 1)!;
    return {
      answer: `已新增訂單 ${order.orderNumber} 並完成排程。推薦方案為 ${recommended.algorithm},得分 ${recommended.score.toFixed(1)}。`,
      navigateTo: `/gantt/${recommended.scenarioId}`,
    };
  }

  const scheduling = await generateSchedules(record.action.input);
  if (scheduling.blocked) {
    throw new AppError('SCHEDULING_BLOCKED', '資料檢查未通過,無法執行排程', 422, scheduling.issues);
  }
  const recommended = scheduling.scenarios.find((scenario) => scenario.rank === 1)!;
  return {
    answer: `排程已完成。推薦方案為 ${recommended.algorithm},得分 ${recommended.score.toFixed(1)}。`,
    navigateTo: `/gantt/${recommended.scenarioId}`,
  };
}

export function cancelPendingAction(id: string): void {
  pendingActions.delete(id);
}
