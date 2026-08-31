import { z } from 'zod';
import { prisma } from '../../shared/db.js';
import { AppError } from '../../shared/errors.js';

export const orderSchema = z
  .object({
    orderNumber: z.string().min(1, '訂單編號為必填'),
    productId: z.string().min(1, '請選擇產品'),
    quantity: z.number().positive('數量必須大於零'),
    releaseTime: z.string().datetime({ offset: true, message: '可開始生產時間須為 ISO 8601 格式' }),
    dueDate: z.string().datetime({ offset: true, message: '交期須為 ISO 8601 格式' }),
    processingTime: z.number().positive('加工時間必須大於零').nullish(),
    priority: z.number().int().min(1).max(5).default(3),
    eligibleMachineIds: z.array(z.string()).default([]),
    status: z.enum(['pending', 'scheduled', 'inProgress', 'completed', 'cancelled']).default('pending'),
    notes: z.string().nullish(),
  })
  .refine((order) => new Date(order.dueDate) >= new Date(order.releaseTime), {
    message: '交期不可早於可開始生產時間',
  });

export type OrderInput = z.input<typeof orderSchema>;

export async function resolveProcessingTime(
  productId: string,
  quantity: number,
  explicit: number | null | undefined,
): Promise<number> {
  if (explicit != null) return explicit;
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw new AppError('NOT_FOUND', '找不到選擇的產品', 404);
  return quantity * product.defaultProcessingTime;
}

export async function createProductionOrder(input: OrderInput) {
  const data = orderSchema.parse(input);
  const duplicate = await prisma.productionOrder.findUnique({ where: { orderNumber: data.orderNumber } });
  if (duplicate) throw new AppError('DUPLICATE_CODE', `訂單編號 ${data.orderNumber} 已存在`, 409);

  const processingTime = await resolveProcessingTime(data.productId, data.quantity, data.processingTime);
  return prisma.productionOrder.create({
    data: {
      orderNumber: data.orderNumber,
      productId: data.productId,
      quantity: data.quantity,
      releaseTime: new Date(data.releaseTime),
      dueDate: new Date(data.dueDate),
      processingTime,
      priority: data.priority,
      eligibleMachineIds: JSON.stringify(data.eligibleMachineIds),
      status: data.status,
      notes: data.notes ?? null,
    },
  });
}

export async function updateProductionOrder(id: string, input: OrderInput) {
  const found = await prisma.productionOrder.findUnique({ where: { id } });
  if (!found) throw new AppError('NOT_FOUND', '找不到訂單', 404);

  const data = orderSchema.parse(input);
  if (data.orderNumber !== found.orderNumber) {
    const duplicate = await prisma.productionOrder.findUnique({ where: { orderNumber: data.orderNumber } });
    if (duplicate) throw new AppError('DUPLICATE_CODE', `訂單編號 ${data.orderNumber} 已存在`, 409);
  }

  const processingTime = await resolveProcessingTime(data.productId, data.quantity, data.processingTime);
  return prisma.productionOrder.update({
    where: { id },
    data: {
      orderNumber: data.orderNumber,
      productId: data.productId,
      quantity: data.quantity,
      releaseTime: new Date(data.releaseTime),
      dueDate: new Date(data.dueDate),
      processingTime,
      priority: data.priority,
      eligibleMachineIds: JSON.stringify(data.eligibleMachineIds),
      status: data.status,
      notes: data.notes ?? null,
    },
  });
}
