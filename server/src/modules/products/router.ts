import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../shared/db.js';
import { AppError, notFound, wrap } from '../../shared/errors.js';

/** 模具欄位(產品 1:1 的那副模;共模例外另處理) */
const moldInputSchema = z.object({
  copies: z.number().int().positive('副數必須為正整數').default(1),
  requiredTonnage: z.number().int().positive('需求噸數必須為正整數').nullish(),
  /// 可上機台 id 清單
  allowedMachines: z.array(z.string()).default([]),
});

const productSchema = z.object({
  productCode: z.string().min(1, '產品編號為必填'),
  productName: z.string().min(1, '產品名稱為必填'),
  description: z.string().nullish(),
  /// 學校版用;射出版改用穴數×秒數,故改選填
  defaultProcessingTime: z.number().positive('預設加工時間必須大於零').optional(),
  defaultCleaningTime: z.number().min(0, '清洗時間不可為負數').default(0),
  // ── 射出版欄位 ──
  customer: z.string().nullish(),
  cavityCount: z.number().int().positive('穴數必須為正整數').nullish(),
  cycleSeconds: z.number().positive('秒數必須大於零').nullish(),
  material: z.string().nullish(),
  /// 連帶編輯這副模的欄位(選填)
  mold: moldInputSchema.optional(),
});

/** 回傳時把模具的 allowedMachines(JSON 字串)還原成陣列 */
function outProduct<T extends { mold?: { allowedMachines: string } | null }>(p: T) {
  if (p.mold) {
    return { ...p, mold: { ...p.mold, allowedMachines: JSON.parse(p.mold.allowedMachines) as string[] } };
  }
  return p;
}

export const productsRouter = Router();

productsRouter.get(
  '/',
  wrap(async (_req, res) => {
    const products = await prisma.product.findMany({
      orderBy: { productCode: 'asc' },
      include: { mold: true },
    });
    res.json(products.map(outProduct));
  }),
);

productsRouter.post(
  '/',
  wrap(async (req, res) => {
    const data = productSchema.parse(req.body);
    const exists = await prisma.product.findUnique({ where: { productCode: data.productCode } });
    if (exists) throw new AppError('DUPLICATE_CODE', `產品編號 ${data.productCode} 已存在`, 409);

    const created = await prisma.$transaction(async (tx) => {
      // 1) 自動建一副模具(名稱帶品名)
      const mold = await tx.mold.create({
        data: {
          name: data.productName,
          copies: data.mold?.copies ?? 1,
          requiredTonnage: data.mold?.requiredTonnage ?? null,
          allowedMachines: JSON.stringify(data.mold?.allowedMachines ?? []),
        },
      });
      // 2) 建產品並指向該模具
      return tx.product.create({
        data: {
          productCode: data.productCode,
          productName: data.productName,
          description: data.description ?? null,
          defaultProcessingTime: data.defaultProcessingTime ?? 0,
          defaultCleaningTime: data.defaultCleaningTime,
          customer: data.customer ?? null,
          cavityCount: data.cavityCount ?? null,
          cycleSeconds: data.cycleSeconds ?? null,
          material: data.material ?? null,
          moldId: mold.id,
        },
        include: { mold: true },
      });
    });
    res.status(201).json(outProduct(created));
  }),
);

productsRouter.put(
  '/:id',
  wrap(async (req, res) => {
    const data = productSchema.partial().parse(req.body);
    const found = await prisma.product.findUnique({ where: { id: req.params.id } });
    if (!found) throw notFound('產品');
    if (data.productCode && data.productCode !== found.productCode) {
      const dup = await prisma.product.findUnique({ where: { productCode: data.productCode } });
      if (dup) throw new AppError('DUPLICATE_CODE', `產品編號 ${data.productCode} 已存在`, 409);
    }

    const updated = await prisma.$transaction(async (tx) => {
      const product = await tx.product.update({
        where: { id: req.params.id },
        data: {
          ...(data.productCode !== undefined ? { productCode: data.productCode } : {}),
          ...(data.productName !== undefined ? { productName: data.productName } : {}),
          ...(data.description !== undefined ? { description: data.description ?? null } : {}),
          ...(data.defaultProcessingTime !== undefined ? { defaultProcessingTime: data.defaultProcessingTime } : {}),
          ...(data.defaultCleaningTime !== undefined ? { defaultCleaningTime: data.defaultCleaningTime } : {}),
          ...(data.customer !== undefined ? { customer: data.customer ?? null } : {}),
          ...(data.cavityCount !== undefined ? { cavityCount: data.cavityCount ?? null } : {}),
          ...(data.cycleSeconds !== undefined ? { cycleSeconds: data.cycleSeconds ?? null } : {}),
          ...(data.material !== undefined ? { material: data.material ?? null } : {}),
        },
        include: { mold: true },
      });
      // 有帶模具欄位就更新連結的那副模
      if (data.mold && product.moldId) {
        await tx.mold.update({
          where: { id: product.moldId },
          data: {
            copies: data.mold.copies,
            requiredTonnage: data.mold.requiredTonnage ?? null,
            allowedMachines: JSON.stringify(data.mold.allowedMachines),
          },
        });
      }
      return tx.product.findUnique({ where: { id: req.params.id }, include: { mold: true } });
    });
    res.json(updated ? outProduct(updated) : null);
  }),
);

productsRouter.delete(
  '/:id',
  wrap(async (req, res) => {
    const found = await prisma.product.findUnique({ where: { id: req.params.id } });
    if (!found) throw notFound('產品');
    const orderCount = await prisma.productionOrder.count({ where: { productId: req.params.id } });
    if (orderCount > 0) {
      throw new AppError('PRODUCT_IN_USE', `此產品仍有 ${orderCount} 張訂單使用中,請先刪除相關訂單`, 409);
    }
    await prisma.$transaction(async (tx) => {
      await tx.product.delete({ where: { id: req.params.id } });
      // 連帶刪自動建的模具,但共模(其他產品仍指向同一副)時保留
      if (found.moldId) {
        const stillUsed = await tx.product.count({ where: { moldId: found.moldId } });
        if (stillUsed === 0) {
          await tx.mold.delete({ where: { id: found.moldId } });
        }
      }
    });
    res.status(204).end();
  }),
);

// ---- BOM 表管理 ----

const bomItemSchema = z.object({
  materialName: z.string().min(1, '原料名稱為必填'),
  unit: z.string().min(1, '用量單位為必填'),
  quantity: z.number().positive('用量必須大於零'),
  customFields: z.record(z.string()).default({}),
});

function serializeBom(data: z.infer<typeof bomItemSchema> & { productId: string }) {
  return {
    productId: data.productId,
    materialName: data.materialName,
    unit: data.unit,
    quantity: data.quantity,
    customFields: JSON.stringify(data.customFields),
  };
}

function deserializeBom<T extends { customFields: string }>(b: T) {
  return {
    ...b,
    customFields: JSON.parse(b.customFields) as Record<string, string>,
  };
}

productsRouter.get(
  '/:productId/bom',
  wrap(async (req, res) => {
    const productId = req.params.productId!;
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw notFound('產品');
    const bomItems = await prisma.bomItem.findMany({
      where: { productId },
      orderBy: { createdAt: 'asc' },
    });
    res.json(bomItems.map(deserializeBom));
  }),
);

productsRouter.post(
  '/:productId/bom',
  wrap(async (req, res) => {
    const productId = req.params.productId!;
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw notFound('產品');
    const data = bomItemSchema.parse(req.body);
    const created = await prisma.bomItem.create({
      data: serializeBom({ ...data, productId }),
    });
    res.status(201).json(deserializeBom(created));
  }),
);

productsRouter.put(
  '/:productId/bom/:id',
  wrap(async (req, res) => {
    const productId = req.params.productId!;
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw notFound('產品');
    const found = await prisma.bomItem.findFirst({
      where: { id: req.params.id, productId },
    });
    if (!found) throw notFound('BOM 項目');
    const data = bomItemSchema.parse(req.body);
    const updated = await prisma.bomItem.update({
      where: { id: req.params.id },
      data: serializeBom({ ...data, productId }),
    });
    res.json(deserializeBom(updated));
  }),
);

productsRouter.delete(
  '/:productId/bom/:id',
  wrap(async (req, res) => {
    const productId = req.params.productId!;
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw notFound('產品');
    const found = await prisma.bomItem.findFirst({
      where: { id: req.params.id, productId },
    });
    if (!found) throw notFound('BOM 項目');
    await prisma.bomItem.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);

