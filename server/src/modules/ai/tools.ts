import { randomUUID } from 'node:crypto';
import type { FunctionCall, FunctionDeclaration } from '@google/genai';
import { z } from 'zod';
import { prisma } from '../../shared/db.js';
import { AppError } from '../../shared/errors.js';
import { loadSchedulingInput } from '../../shared/mappers.js';
import { createProductionOrder, updateProductionOrder, type OrderInput } from '../orders/service.js';
import { generateSchedules, objectiveSchema } from '../scenarios/generateService.js';
import { loadScenario } from '../scenarios/service.js';
import type { ProductionOrder, ScheduledTask } from '../scheduling/engine/types.js';
import {
  compareImpacts,
  insertUrgentOrder,
  latestSafeRepairTime,
  localRepairBreakdown,
  rebuildWithUrgent,
  simulateBreakdown,
} from '../simulations/service.js';
import { buildAiContext } from './promptBuilder.js';

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

const updateOrderToolSchema = z
  .object({
    orderNumber: z.string().min(1),
    quantity: z.number().positive().optional(),
    releaseTime: z.string().datetime({ offset: true }).optional(),
    dueDate: z.string().datetime({ offset: true }).optional(),
    processingTime: z.number().positive().optional(),
    priority: z.number().int().min(1).max(5).optional(),
    eligibleMachines: z.array(z.string().min(1)).optional(),
    notes: z.string().optional(),
    clearNotes: z.boolean().default(false),
    runSchedulingAfterUpdate: z.boolean().default(false),
    schedulingObjective: objectiveSchema.default('ON_TIME_DELIVERY'),
  })
  .refine(
    (value) =>
      value.quantity !== undefined ||
      value.releaseTime !== undefined ||
      value.dueDate !== undefined ||
      value.processingTime !== undefined ||
      value.priority !== undefined ||
      value.eligibleMachines !== undefined ||
      value.notes !== undefined ||
      value.clearNotes,
    { message: '請至少提供一個要修改的欄位' },
  );

const runSimulationToolSchema = z
  .object({
    simulationType: z.enum(['urgent_order', 'machine_breakdown']),
    scenarioAlgorithm: z.enum(['FIFO', 'EDD', 'SPT', 'CR']).optional(),
    orderNumber: z.string().min(1).optional(),
    product: z.string().min(1).optional(),
    quantity: z.number().positive().optional(),
    releaseTime: z.string().datetime({ offset: true }).optional(),
    dueDate: z.string().datetime({ offset: true }).optional(),
    processingTime: z.number().positive().optional(),
    priority: z.number().int().min(1).max(5).default(1),
    eligibleMachines: z.array(z.string().min(1)).default([]),
    machine: z.string().min(1).optional(),
    startTime: z.string().datetime({ offset: true }).optional(),
    estimatedRepairTime: z.string().datetime({ offset: true }).optional(),
  })
  .superRefine((value, ctx) => {
    const required = value.simulationType === 'urgent_order'
      ? (['orderNumber', 'product', 'quantity', 'dueDate'] as const)
      : (['machine', 'startTime', 'estimatedRepairTime'] as const);
    for (const field of required) {
      if (value[field] === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: `${field} 為必填` });
      }
    }
    if (
      value.simulationType === 'machine_breakdown' &&
      value.startTime &&
      value.estimatedRepairTime &&
      new Date(value.estimatedRepairTime) <= new Date(value.startTime)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['estimatedRepairTime'],
        message: '預估修復時間必須晚於故障開始時間',
      });
    }
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
    name: 'get_schedule_analysis',
    description: '取得目前推薦方案、四演算法績效、延遲訂單、瓶頸機台與未排入訂單的結構化分析。',
    parametersJsonSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'run_simulation',
    description:
      '唯讀預演急單插入或機台故障，不會修改訂單、停機資料或正式排程。urgent_order 需提供訂單資料；machine_breakdown 需提供機台與故障時間。',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        simulationType: { type: 'string', enum: ['urgent_order', 'machine_breakdown'] },
        scenarioAlgorithm: { type: 'string', enum: ['FIFO', 'EDD', 'SPT', 'CR'], description: '不填時使用推薦第一名' },
        orderNumber: { type: 'string', description: '急單模擬用的暫時訂單編號' },
        product: { type: 'string', description: '急單產品編號或完整名稱' },
        quantity: { type: 'number', exclusiveMinimum: 0 },
        releaseTime: { type: 'string', description: '急單可開始時間，ISO 8601；不填使用現在時間' },
        dueDate: { type: 'string', description: '急單交期，ISO 8601' },
        processingTime: { type: 'number', exclusiveMinimum: 0, description: '急單總加工分鐘；不填時自動計算' },
        priority: { type: 'integer', minimum: 1, maximum: 5, default: 1 },
        eligibleMachines: { type: 'array', items: { type: 'string' }, default: [] },
        machine: { type: 'string', description: '故障模擬用的機台編號或完整名稱' },
        startTime: { type: 'string', description: '故障開始時間，ISO 8601' },
        estimatedRepairTime: { type: 'string', description: '預估修復時間，ISO 8601' },
      },
      required: ['simulationType'],
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
  {
    name: 'update_order',
    description:
      '修改現有待排程或已排程訂單的數量、時間、優先級、加工時間、可用機台或備註。這是寫入操作，使用者確認後才執行；可選擇修改後重新排程。',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        orderNumber: { type: 'string', description: '要修改的完整訂單編號' },
        quantity: { type: 'number', exclusiveMinimum: 0 },
        releaseTime: { type: 'string', description: 'ISO 8601，須含時區' },
        dueDate: { type: 'string', description: 'ISO 8601，須含時區' },
        processingTime: { type: 'number', exclusiveMinimum: 0, description: '總加工分鐘；數量改變但未填時會重新自動計算' },
        priority: { type: 'integer', minimum: 1, maximum: 5 },
        eligibleMachines: { type: 'array', items: { type: 'string' }, description: '完整機台編號或名稱；空陣列代表不限' },
        notes: { type: 'string' },
        clearNotes: { type: 'boolean', default: false },
        runSchedulingAfterUpdate: { type: 'boolean', default: false },
        schedulingObjective: { type: 'string', enum: objectiveSchema.options, default: 'ON_TIME_DELIVERY' },
      },
      required: ['orderNumber'],
      additionalProperties: false,
    },
  },
];

const MUTATION_TOOL_NAMES = new Set(['create_order', 'run_scheduling', 'update_order']);

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
    case 'get_schedule_analysis': {
      const context = await buildAiContext();
      if (!context) return { hasSchedule: false, message: '目前尚未產生排程方案' };
      const maxProductionMinutes = Math.max(0, ...context.machineLoads.map((load) => load.productionMinutes));
      return {
        hasSchedule: true,
        ...context,
        bottleneckMachines: context.machineLoads
          .filter((load) => load.productionMinutes === maxProductionMinutes && maxProductionMinutes > 0)
          .map((load) => ({
            machineCode: load.machineCode,
            machineName: load.machineName,
            productionMinutes: load.productionMinutes,
          })),
      };
    }
    case 'run_simulation':
      return runSimulationPreview(call.args ?? {});
    default:
      throw new AppError('AI_TOOL_NOT_ALLOWED', `不允許的 AI 工具:${call.name ?? 'unknown'}`, 400);
  }
}

function scenarioOrderIds(tasks: { orderId: string | null }[]): string[] {
  return [...new Set(tasks.map((task) => task.orderId).filter((id): id is string => Boolean(id)))];
}

function completionOf(tasks: ScheduledTask[], orderId: string): number | null {
  const production = tasks.filter((task) => task.orderId === orderId && task.taskType === 'production');
  return production.length > 0 ? Math.max(...production.map((task) => task.endTime)) : null;
}

function impactsToJson(impacts: ReturnType<typeof compareImpacts>) {
  return impacts.slice(0, 20).map((impact) => ({
    ...impact,
    oldCompletion: impact.oldCompletion ? new Date(impact.oldCompletion).toISOString() : null,
    newCompletion: impact.newCompletion ? new Date(impact.newCompletion).toISOString() : null,
  }));
}

async function loadSimulationScenario(algorithm?: 'FIFO' | 'EDD' | 'SPT' | 'CR') {
  const record = await prisma.scheduleScenario.findFirst({
    where: algorithm ? { algorithm } : undefined,
    orderBy: { rank: 'asc' },
  });
  if (!record) {
    throw new AppError(
      'AI_TOOL_NO_SCHEDULE',
      algorithm ? `目前找不到 ${algorithm} 排程方案。` : '目前沒有排程方案可以模擬。',
      422,
    );
  }
  return loadScenario(record.id);
}

async function runSimulationPreview(rawArgs: unknown): Promise<unknown> {
  const args = runSimulationToolSchema.parse(rawArgs);
  const { scenario, anchorTime } = await loadSimulationScenario(args.scenarioAlgorithm);
  const input = await loadSchedulingInput(anchorTime, scenarioOrderIds(scenario.tasks));

  if (args.simulationType === 'urgent_order') {
    const product = await resolveProduct(args.product!);
    const machines = await resolveMachines(args.eligibleMachines);
    const releaseTime = args.releaseTime ?? new Date().toISOString();
    if (new Date(args.dueDate!) < new Date(releaseTime)) {
      throw new AppError('AI_TOOL_INVALID_DATE', '急單交期不可早於可開始生產時間。', 422);
    }
    const urgent: ProductionOrder = {
      id: `ai-sim-${randomUUID()}`,
      orderNumber: args.orderNumber!,
      productId: product.id,
      quantity: args.quantity!,
      releaseTime: Date.parse(releaseTime),
      dueDate: Date.parse(args.dueDate!),
      processingTime: args.processingTime ?? args.quantity! * product.defaultProcessingTime,
      priority: args.priority,
      eligibleMachineIds: machines.map((machine) => machine.id),
      status: 'pending',
      createdAt: anchorTime,
    };
    const insert = insertUrgentOrder(input, scenario.tasks, urgent);
    const rebuild = rebuildWithUrgent(input, scenario.algorithm, urgent);
    const rebuildImpacts = compareImpacts(scenario.tasks, rebuild.tasks, input.orders);
    const insertCompletion = insert.ok ? completionOf(insert.tasks!, urgent.id) : null;
    const rebuildCompletion = completionOf(rebuild.tasks, urgent.id);
    const tardiness = (completion: number | null) =>
      completion === null ? null : Math.max(0, Math.round((completion - urgent.dueDate) / 60_000));

    return {
      simulationType: 'urgent_order',
      previewOnly: true,
      scenario: { algorithm: scenario.algorithm, rank: scenario.rank, metrics: scenario.metrics },
      urgentOrder: {
        orderNumber: urgent.orderNumber,
        product: `${product.productCode} ${product.productName}`,
        quantity: urgent.quantity,
        processingTime: urgent.processingTime,
        releaseTime,
        dueDate: args.dueDate,
        priority: urgent.priority,
      },
      insert: insert.ok
        ? {
            ok: true,
            metrics: insert.metrics,
            completionTime: insertCompletion ? new Date(insertCompletion).toISOString() : null,
            tardinessMinutes: tardiness(insertCompletion),
            existingOrdersMoved: 0,
          }
        : { ok: false, reason: insert.reason },
      rebuild: {
        ok: !rebuild.unscheduled.some((order) => order.orderNumber === urgent.orderNumber),
        metrics: rebuild.metrics,
        completionTime: rebuildCompletion ? new Date(rebuildCompletion).toISOString() : null,
        tardinessMinutes: tardiness(rebuildCompletion),
        affectedOrders: impactsToJson(rebuildImpacts),
        unscheduled: rebuild.unscheduled,
      },
    };
  }

  const machine = input.machines.find(
    (candidate) => candidate.machineCode === args.machine || candidate.machineName === args.machine,
  );
  if (!machine) {
    throw new AppError('AI_TOOL_MACHINE_NOT_FOUND', `找不到機台「${args.machine}」。`, 422);
  }
  const start = Date.parse(args.startTime!);
  const repairEnd = Date.parse(args.estimatedRepairTime!);
  const localRepair = localRepairBreakdown(
    input,
    scenario.algorithm,
    scenario.tasks,
    machine.id,
    start,
    repairEnd,
  );
  const rebuild = simulateBreakdown(
    input,
    scenario.algorithm,
    scenario.tasks,
    machine.id,
    start,
    repairEnd,
  );
  const safeRepair = latestSafeRepairTime(input, scenario.algorithm, machine.id, start, repairEnd);

  return {
    simulationType: 'machine_breakdown',
    previewOnly: true,
    scenario: { algorithm: scenario.algorithm, rank: scenario.rank, metrics: scenario.metrics },
    breakdown: {
      machineCode: machine.machineCode,
      machineName: machine.machineName,
      startTime: args.startTime,
      estimatedRepairTime: args.estimatedRepairTime,
    },
    localRepair: {
      metrics: localRepair.metrics,
      lateOrderCount: localRepair.lateOrders.length,
      lateOrders: localRepair.lateOrders,
      affectedOrderNumbers: localRepair.affectedOrderNumbers,
      impacts: impactsToJson(localRepair.impacts),
      unscheduled: localRepair.unscheduled,
    },
    rebuild: {
      metrics: rebuild.metrics,
      lateOrderCount: rebuild.lateOrders.length,
      lateOrders: rebuild.lateOrders,
      impacts: impactsToJson(rebuild.impacts),
      unscheduled: rebuild.unscheduled,
    },
    latestSafeRepairTime: safeRepair ? new Date(safeRepair).toISOString() : null,
  };
}

export interface PendingActionView {
  id: string;
  toolName: 'create_order' | 'run_scheduling' | 'update_order';
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

interface UpdateOrderAction {
  kind: 'update_order';
  orderId: string;
  orderNumber: string;
  input: OrderInput;
  runSchedulingAfterUpdate: boolean;
  schedulingObjective: z.infer<typeof objectiveSchema>;
}

interface PendingActionRecord {
  view: PendingActionView;
  action: CreateOrderAction | RunSchedulingAction | UpdateOrderAction;
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

  if (call.name === 'update_order') {
    const args = updateOrderToolSchema.parse(call.args ?? {});
    const found = await prisma.productionOrder.findUnique({
      where: { orderNumber: args.orderNumber },
      include: { product: { select: { productCode: true, productName: true } } },
    });
    if (!found) {
      throw new AppError('AI_TOOL_ORDER_NOT_FOUND', `找不到訂單「${args.orderNumber}」。`, 422);
    }
    if (!['pending', 'scheduled'].includes(found.status)) {
      throw new AppError(
        'AI_TOOL_ORDER_NOT_EDITABLE',
        `訂單 ${found.orderNumber} 目前狀態為 ${found.status}，只能修改待排程或已排程訂單。`,
        422,
      );
    }

    const machines = args.eligibleMachines === undefined
      ? null
      : await resolveMachines(args.eligibleMachines);
    const releaseTime = args.releaseTime ?? found.releaseTime.toISOString();
    const dueDate = args.dueDate ?? found.dueDate.toISOString();
    if (new Date(dueDate) < new Date(releaseTime)) {
      throw new AppError('AI_TOOL_INVALID_DATE', '訂單交期不可早於可開始生產時間。', 422);
    }

    const changes: { label: string; value: string }[] = [];
    if (args.quantity !== undefined) changes.push({ label: '數量', value: `${found.quantity} → ${args.quantity}` });
    if (args.releaseTime !== undefined) {
      changes.push({
        label: '可開始時間',
        value: `${formatTaipeiDateTime(found.releaseTime.toISOString())} → ${formatTaipeiDateTime(releaseTime)}`,
      });
    }
    if (args.dueDate !== undefined) {
      changes.push({
        label: '交期',
        value: `${formatTaipeiDateTime(found.dueDate.toISOString())} → ${formatTaipeiDateTime(dueDate)}`,
      });
    }
    if (args.processingTime !== undefined) {
      changes.push({ label: '加工時間', value: `${found.processingTime} → ${args.processingTime} 分鐘` });
    } else if (args.quantity !== undefined) {
      changes.push({ label: '加工時間', value: '依新數量與產品單位時間重新計算' });
    }
    if (args.priority !== undefined) changes.push({ label: '優先級', value: `${found.priority} → ${args.priority}` });
    if (machines !== null) {
      changes.push({
        label: '可用機台',
        value: machines.length > 0
          ? machines.map((machine) => `${machine.machineCode} ${machine.machineName}`).join('、')
          : '所有支援此產品的機台',
      });
    }
    if (args.notes !== undefined || args.clearNotes) {
      changes.push({ label: '備註', value: args.clearNotes ? '清除備註' : args.notes! });
    }

    const input: OrderInput = {
      orderNumber: found.orderNumber,
      productId: found.productId,
      quantity: args.quantity ?? found.quantity,
      releaseTime,
      dueDate,
      processingTime: args.processingTime ?? (args.quantity !== undefined ? undefined : found.processingTime),
      priority: args.priority ?? found.priority,
      eligibleMachineIds: machines?.map((machine) => machine.id) ??
        (JSON.parse(found.eligibleMachineIds) as string[]),
      status: found.status as 'pending' | 'scheduled',
      notes: args.clearNotes ? null : (args.notes ?? found.notes),
    };
    const action: UpdateOrderAction = {
      kind: 'update_order',
      orderId: found.id,
      orderNumber: found.orderNumber,
      input,
      runSchedulingAfterUpdate: args.runSchedulingAfterUpdate,
      schedulingObjective: args.schedulingObjective,
    };
    const view: PendingActionView = {
      id,
      toolName: 'update_order',
      title: args.runSchedulingAfterUpdate ? '修改訂單並重新排程' : '修改生產訂單',
      description: args.runSchedulingAfterUpdate
        ? '確認後會先更新訂單，再重新執行四種排程演算法。'
        : '確認後只更新訂單；目前排程方案不會自動重算。',
      details: [
        { label: '訂單編號', value: found.orderNumber },
        { label: '產品', value: `${found.product.productCode} ${found.product.productName}` },
        ...changes,
        ...(args.runSchedulingAfterUpdate
          ? [{ label: '排程目標', value: OBJECTIVE_LABELS[args.schedulingObjective] }]
          : []),
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

  if (record.action.kind === 'update_order') {
    const action = record.action;
    await updateProductionOrder(action.orderId, action.input);
    if (!action.runSchedulingAfterUpdate) {
      return {
        answer: `已更新訂單 ${action.orderNumber}。目前排程方案尚未重算。`,
        navigateTo: '/orders',
      };
    }
    const scheduling = await generateSchedules({ objective: action.schedulingObjective });
    if (scheduling.blocked) {
      const reason = scheduling.issues.map((issue) => issue.message).join('；');
      return {
        answer: `訂單 ${action.orderNumber} 已更新，但重新排程失敗：${reason}`,
        navigateTo: '/schedule',
      };
    }
    const recommended = scheduling.scenarios.find((scenario) => scenario.rank === 1)!;
    return {
      answer: `已更新訂單 ${action.orderNumber} 並完成排程。推薦方案為 ${recommended.algorithm}，得分 ${recommended.score.toFixed(1)}。`,
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
