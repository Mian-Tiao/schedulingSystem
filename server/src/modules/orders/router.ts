import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../shared/db.js';
import { AppError, notFound, wrap } from '../../shared/errors.js';
import { syncOrderStatuses } from '../../shared/orderSync.js';
import { createProductionOrder, updateProductionOrder } from './service.js';

export const ordersRouter = Router();

const listQuerySchema = z.object({
  search: z.string().optional(),
  productId: z.string().optional(),
  status: z.string().optional(),
  priority: z.coerce.number().int().optional(),
  dueBefore: z.string().optional(),
  dueAfter: z.string().optional(),
});

ordersRouter.get(
  '/',
  wrap(async (req, res) => {
    await syncOrderStatuses();
    const q = listQuerySchema.parse(req.query);
    const where: Record<string, unknown> = {};
    if (q.productId) where.productId = q.productId;
    if (q.status) where.status = q.status;
    if (q.priority) where.priority = q.priority;
    if (q.search) {
      where.OR = [{ orderNumber: { contains: q.search } }, { notes: { contains: q.search } }];
    }
    if (q.dueBefore || q.dueAfter) {
      where.dueDate = {
        ...(q.dueBefore ? { lte: new Date(q.dueBefore) } : {}),
        ...(q.dueAfter ? { gte: new Date(q.dueAfter) } : {}),
      };
    }
    const orders = await prisma.productionOrder.findMany({
      where,
      orderBy: { dueDate: 'asc' },
      include: { product: { select: { productCode: true, productName: true } } },
    });
    res.json(
      orders.map((o) => ({ ...o, eligibleMachineIds: JSON.parse(o.eligibleMachineIds) as string[] })),
    );
  }),
);

ordersRouter.post(
  '/',
  wrap(async (req, res) => {
    const created = await createProductionOrder(req.body);
    res.status(201).json(created);
  }),
);

ordersRouter.put(
  '/:id',
  wrap(async (req, res) => {
    const updated = await updateProductionOrder(req.params.id!, req.body);
    res.json(updated);
  }),
);

ordersRouter.patch(
  '/:id/status',
  wrap(async (req, res) => {
    const found = await prisma.productionOrder.findUnique({ where: { id: req.params.id } });
    if (!found) throw notFound('訂單');
    const data = z.object({
      status: z.enum(['pending', 'scheduled', 'inProgress', 'completed', 'cancelled']),
    }).parse(req.body);
    const updated = await prisma.productionOrder.update({
      where: { id: req.params.id },
      data: { status: data.status },
    });
    res.json(updated);
  }),
);

ordersRouter.post(
  '/:id/duplicate',
  wrap(async (req, res) => {
    const found = await prisma.productionOrder.findUnique({ where: { id: req.params.id } });
    if (!found) throw notFound('訂單');
    // 產生不重複的複製編號
    let copyNumber = `${found.orderNumber}-C1`;
    for (let i = 1; i <= 99; i++) {
      copyNumber = `${found.orderNumber}-C${i}`;
      const dup = await prisma.productionOrder.findUnique({ where: { orderNumber: copyNumber } });
      if (!dup) break;
    }
    const created = await prisma.productionOrder.create({
      data: {
        orderNumber: copyNumber,
        productId: found.productId,
        quantity: found.quantity,
        releaseTime: found.releaseTime,
        dueDate: found.dueDate,
        processingTime: found.processingTime,
        priority: found.priority,
        eligibleMachineIds: found.eligibleMachineIds,
        status: 'pending',
        notes: found.notes,
      },
    });
    res.status(201).json(created);
  }),
);

ordersRouter.delete(
  '/:id',
  wrap(async (req, res) => {
    const found = await prisma.productionOrder.findUnique({ where: { id: req.params.id } });
    if (!found) throw notFound('訂單');
    await prisma.productionOrder.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);

// ---- CSV 匯入 ----
// 欄位:orderNumber,productCode,quantity,releaseTime,dueDate,processingTime,priority,eligibleMachineCodes,notes

const importSchema = z.object({ csv: z.string().min(1, '請提供 CSV 內容') });

function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  const pushCell = () => {
    row.push(cell.trim());
    cell = '';
  };
  const pushRow = () => {
    pushCell();
    if (row.some((value) => value.length > 0)) rows.push(row);
    row = [];
  };

  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i]!;

    if (inQuotes) {
      if (ch === '"') {
        if (csv[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      if (cell.trim().length === 0) {
        cell = '';
        inQuotes = true;
      } else {
        cell += ch;
      }
    } else if (ch === ',') {
      pushCell();
    } else if (ch === '\n') {
      pushRow();
    } else if (ch === '\r') {
      pushRow();
      if (csv[i + 1] === '\n') i += 1;
    } else {
      cell += ch;
    }
  }

  if (inQuotes) {
    throw new AppError('CSV_PARSE_ERROR', 'CSV 引號未正確關閉', 400);
  }
  if (cell.length > 0 || row.length > 0) pushRow();

  return rows;
}

ordersRouter.post(
  '/import',
  wrap(async (req, res) => {
    const { csv } = importSchema.parse(req.body);
    const rows = parseCsv(csv);
    if (rows.length < 2) {
      throw new AppError('CSV_EMPTY', 'CSV 至少需要標題列與一筆資料', 400);
    }
    const header = rows[0]!.map((h) => h.trim());
    const required = ['orderNumber', 'productCode', 'quantity', 'releaseTime', 'dueDate'];
    for (const col of required) {
      if (!header.includes(col)) {
        throw new AppError('CSV_MISSING_COLUMN', `CSV 缺少必要欄位:${col}`, 400);
      }
    }
    const idx = (name: string) => header.indexOf(name);
    const products = await prisma.product.findMany();
    const machines = await prisma.machine.findMany();
    const byCode = new Map(products.map((p) => [p.productCode, p]));
    const machineByCode = new Map(machines.map((m) => [m.machineCode, m]));

    const results: { line: number; orderNumber: string; ok: boolean; error?: string }[] = [];
    for (let i = 1; i < rows.length; i++) {
      const cols = rows[i]!;
      const orderNumber = cols[idx('orderNumber')] ?? '';
      try {
        const productCode = cols[idx('productCode')] ?? '';
        const product = byCode.get(productCode);
        if (!product) throw new Error(`找不到產品編號 ${productCode}`);
        const quantity = Number(cols[idx('quantity')]);
        if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('數量必須為正數');
        const releaseTime = new Date(cols[idx('releaseTime')] ?? '');
        const dueDate = new Date(cols[idx('dueDate')] ?? '');
        if (Number.isNaN(releaseTime.getTime())) throw new Error('可開始生產時間格式錯誤');
        if (Number.isNaN(dueDate.getTime())) throw new Error('交期格式錯誤');
        if (dueDate < releaseTime) throw new Error('交期不可早於可開始生產時間');
        const ptRaw = idx('processingTime') >= 0 ? cols[idx('processingTime')] : '';
        const processingTime = ptRaw ? Number(ptRaw) : quantity * product.defaultProcessingTime;
        if (!Number.isFinite(processingTime) || processingTime <= 0) throw new Error('加工時間必須為正數');
        const prRaw = idx('priority') >= 0 ? cols[idx('priority')] : '';
        const priority = prRaw ? Number(prRaw) : 3;
        const emRaw = idx('eligibleMachineCodes') >= 0 ? (cols[idx('eligibleMachineCodes')] ?? '') : '';
        const eligibleMachineIds = emRaw
          ? emRaw.split(';').map((code) => {
              const m = machineByCode.get(code.trim());
              if (!m) throw new Error(`找不到機台編號 ${code.trim()}`);
              return m.id;
            })
          : [];
        const dup = await prisma.productionOrder.findUnique({ where: { orderNumber } });
        if (dup) throw new Error(`訂單編號 ${orderNumber} 已存在`);
        await prisma.productionOrder.create({
          data: {
            orderNumber,
            productId: product.id,
            quantity,
            releaseTime,
            dueDate,
            processingTime,
            priority: Math.min(5, Math.max(1, Math.round(priority))),
            eligibleMachineIds: JSON.stringify(eligibleMachineIds),
            status: 'pending',
            notes: idx('notes') >= 0 ? (cols[idx('notes')] || null) : null,
          },
        });
        results.push({ line: i + 1, orderNumber, ok: true });
      } catch (e) {
        results.push({
          line: i + 1,
          orderNumber,
          ok: false,
          error: e instanceof Error ? e.message : '未知錯誤',
        });
      }
    }
    res.json({
      imported: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    });
  }),
);
