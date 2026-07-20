import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../shared/db.js';
import { AppError, notFound, wrap } from '../../shared/errors.js';

const productSchema = z.object({
  productCode: z.string().min(1, '產品編號為必填'),
  productName: z.string().min(1, '產品名稱為必填'),
  description: z.string().nullish(),
  defaultProcessingTime: z.number().positive('預設加工時間必須大於零'),
  defaultCleaningTime: z.number().min(0, '清洗時間不可為負數').default(0),
});

export const productsRouter = Router();

productsRouter.get(
  '/',
  wrap(async (_req, res) => {
    const products = await prisma.product.findMany({ orderBy: { productCode: 'asc' } });
    res.json(products);
  }),
);

productsRouter.post(
  '/',
  wrap(async (req, res) => {
    const data = productSchema.parse(req.body);
    const exists = await prisma.product.findUnique({ where: { productCode: data.productCode } });
    if (exists) throw new AppError('DUPLICATE_CODE', `產品編號 ${data.productCode} 已存在`, 409);
    const created = await prisma.product.create({ data });
    res.status(201).json(created);
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
    const updated = await prisma.product.update({ where: { id: req.params.id }, data });
    res.json(updated);
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
    await prisma.product.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);
