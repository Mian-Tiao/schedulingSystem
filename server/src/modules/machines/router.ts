import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../shared/db.js';
import { AppError, notFound, wrap } from '../../shared/errors.js';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, '時間格式須為 HH:MM');
const segmentSchema = z
  .object({ start: hhmm, end: hhmm })
  .refine((s) => s.end > s.start, { message: '工作時段結束時間必須晚於開始時間' });
const workingHoursSchema = z.object({
  mon: z.array(segmentSchema).default([]),
  tue: z.array(segmentSchema).default([]),
  wed: z.array(segmentSchema).default([]),
  thu: z.array(segmentSchema).default([]),
  fri: z.array(segmentSchema).default([]),
  sat: z.array(segmentSchema).default([]),
  sun: z.array(segmentSchema).default([]),
});

const machineSchema = z.object({
  machineCode: z.string().min(1, '機台編號為必填'),
  machineName: z.string().min(1, '機台名稱為必填'),
  model: z.string().nullish(),
  description: z.string().nullish(),
  supportedProductIds: z.array(z.string()).default([]),
  defaultSetupTime: z.number().min(0, '換模時間不可為負數').default(0),
  defaultCleaningTime: z.number().min(0, '清洗時間不可為負數').default(0),
  workingHours: workingHoursSchema,
  status: z.enum(['available', 'maintenance', 'disabled']).default('available'),
});

const downtimeSchema = z
  .object({
    type: z.enum(['maintenance', 'breakdown', 'plannedStop', 'other']),
    startTime: z.string().datetime({ offset: true, message: '開始時間須為 ISO 8601 格式' }),
    endTime: z.string().datetime({ offset: true, message: '結束時間須為 ISO 8601 格式' }),
    reason: z.string().nullish(),
  })
  .refine((d) => new Date(d.endTime) > new Date(d.startTime), {
    message: '停機結束時間必須晚於開始時間',
  });

function serialize(data: z.infer<typeof machineSchema>) {
  return {
    ...data,
    supportedProductIds: JSON.stringify(data.supportedProductIds),
    workingHours: JSON.stringify(data.workingHours),
  };
}

function deserialize<T extends { supportedProductIds: string; workingHours: string }>(m: T) {
  return {
    ...m,
    supportedProductIds: JSON.parse(m.supportedProductIds) as string[],
    workingHours: JSON.parse(m.workingHours) as unknown,
  };
}

export const machinesRouter = Router();

machinesRouter.get(
  '/',
  wrap(async (_req, res) => {
    const machines = await prisma.machine.findMany({
      orderBy: { machineCode: 'asc' },
      include: { downtimes: { orderBy: { startTime: 'asc' } } },
    });
    res.json(machines.map(deserialize));
  }),
);

machinesRouter.post(
  '/',
  wrap(async (req, res) => {
    const data = machineSchema.parse(req.body);
    const exists = await prisma.machine.findUnique({ where: { machineCode: data.machineCode } });
    if (exists) throw new AppError('DUPLICATE_CODE', `機台編號 ${data.machineCode} 已存在`, 409);
    const created = await prisma.machine.create({ data: serialize(data) });
    res.status(201).json(deserialize(created));
  }),
);

machinesRouter.put(
  '/:id',
  wrap(async (req, res) => {
    const found = await prisma.machine.findUnique({ where: { id: req.params.id } });
    if (!found) throw notFound('機台');
    const data = machineSchema.parse(req.body);
    if (data.machineCode !== found.machineCode) {
      const dup = await prisma.machine.findUnique({ where: { machineCode: data.machineCode } });
      if (dup) throw new AppError('DUPLICATE_CODE', `機台編號 ${data.machineCode} 已存在`, 409);
    }
    const updated = await prisma.machine.update({ where: { id: req.params.id }, data: serialize(data) });
    res.json(deserialize(updated));
  }),
);

machinesRouter.delete(
  '/:id',
  wrap(async (req, res) => {
    const found = await prisma.machine.findUnique({ where: { id: req.params.id } });
    if (!found) throw notFound('機台');
    await prisma.machine.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);

// ---- 停機時段 ----

machinesRouter.get(
  '/:id/downtimes',
  wrap(async (req, res) => {
    const found = await prisma.machine.findUnique({ where: { id: req.params.id } });
    if (!found) throw notFound('機台');
    const downtimes = await prisma.machineDowntime.findMany({
      where: { machineId: req.params.id },
      orderBy: { startTime: 'asc' },
    });
    res.json(downtimes);
  }),
);

machinesRouter.post(
  '/:id/downtimes',
  wrap(async (req, res) => {
    const found = await prisma.machine.findUnique({ where: { id: req.params.id } });
    if (!found) throw notFound('機台');
    const data = downtimeSchema.parse(req.body);
    const created = await prisma.machineDowntime.create({
      data: {
        machineId: req.params.id!,
        type: data.type,
        startTime: new Date(data.startTime),
        endTime: new Date(data.endTime),
        reason: data.reason ?? null,
      },
    });
    res.status(201).json(created);
  }),
);

machinesRouter.delete(
  '/:id/downtimes/:downtimeId',
  wrap(async (req, res) => {
    const found = await prisma.machineDowntime.findUnique({ where: { id: req.params.downtimeId } });
    if (!found || found.machineId !== req.params.id) throw notFound('停機時段');
    await prisma.machineDowntime.delete({ where: { id: req.params.downtimeId } });
    res.status(204).end();
  }),
);

// ---- 換模規則 ----

const changeoverSchema = z.object({
  machineId: z.string().nullish(),
  fromProductId: z.string().nullish(),
  toProductId: z.string().min(1, '目標產品為必填'),
  setupMinutes: z.number().min(0).default(0),
  cleaningMinutes: z.number().min(0).default(0),
});

export const changeoverRouter = Router();

changeoverRouter.get(
  '/',
  wrap(async (_req, res) => {
    const rules = await prisma.changeoverRule.findMany();
    res.json(rules);
  }),
);

changeoverRouter.post(
  '/',
  wrap(async (req, res) => {
    const data = changeoverSchema.parse(req.body);
    const created = await prisma.changeoverRule.create({
      data: {
        machineId: data.machineId ?? null,
        fromProductId: data.fromProductId ?? null,
        toProductId: data.toProductId,
        setupMinutes: data.setupMinutes,
        cleaningMinutes: data.cleaningMinutes,
      },
    });
    res.status(201).json(created);
  }),
);

changeoverRouter.delete(
  '/:id',
  wrap(async (req, res) => {
    const found = await prisma.changeoverRule.findUnique({ where: { id: req.params.id } });
    if (!found) throw notFound('換模規則');
    await prisma.changeoverRule.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);
