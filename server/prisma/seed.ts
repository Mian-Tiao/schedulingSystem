/**
 * 種子測試資料(規格 §25):
 * - 3 種產品、3 台機台(支援產品不同)、12 張訂單
 * - 2 個機台維護區段、4 組產品切換規則
 * - 至少 2 張會在 FIFO 下逾期的訂單、1 張高優先級急單
 * 日期以「今天(台北時間)」為基準向後展開,方便直接展示。
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TAIPEI_OFFSET_MS = 8 * 3600_000;
const DAY = 24 * 3600_000;

/** 今天台北時間 00:00 */
function todayTaipei(): number {
  return Math.floor((Date.now() + TAIPEI_OFFSET_MS) / DAY) * DAY - TAIPEI_OFFSET_MS;
}

/** base 日 + d 天的 hh:mm(台北) */
function at(base: number, d: number, hh: number, mm = 0): Date {
  return new Date(base + d * DAY + hh * 3600_000 + mm * 60_000);
}

const WEEKDAY_FULL = {
  mon: [{ start: '08:00', end: '12:00' }, { start: '13:00', end: '17:00' }],
  tue: [{ start: '08:00', end: '12:00' }, { start: '13:00', end: '17:00' }],
  wed: [{ start: '08:00', end: '12:00' }, { start: '13:00', end: '17:00' }],
  thu: [{ start: '08:00', end: '12:00' }, { start: '13:00', end: '17:00' }],
  fri: [{ start: '08:00', end: '12:00' }, { start: '13:00', end: '17:00' }],
  sat: [],
  sun: [],
};

const WEEKDAY_NO_BREAK = {
  mon: [{ start: '08:00', end: '17:00' }],
  tue: [{ start: '08:00', end: '17:00' }],
  wed: [{ start: '08:00', end: '17:00' }],
  thu: [{ start: '08:00', end: '17:00' }],
  fri: [{ start: '08:00', end: '17:00' }],
  sat: [{ start: '08:00', end: '12:00' }],
  sun: [],
};

async function main() {
  const base = todayTaipei();

  // 冪等:資料庫已有資料就跳過,讓 Render 每次重新部署時不會清空使用者的資料。
  // 要強制重新灌入示範資料,執行:FORCE_SEED=1 npm run db:seed
  const existing = await prisma.product.count();
  if (existing > 0 && process.env.FORCE_SEED !== '1') {
    console.log(`已有 ${existing} 筆產品資料,略過 seed(要強制重灌請設 FORCE_SEED=1)`);
    return;
  }

  // 清空既有資料
  await prisma.scheduledTask.deleteMany();
  await prisma.scheduleScenario.deleteMany();
  await prisma.productionOrder.deleteMany();
  await prisma.changeoverRule.deleteMany();
  await prisma.machineDowntime.deleteMany();
  await prisma.machine.deleteMany();
  await prisma.product.deleteMany();

  // ---- 產品 ----
  const pA = await prisma.product.create({
    data: {
      productCode: 'P-A',
      productName: '塑膠外殼',
      description: '射出成型塑膠外殼',
      defaultProcessingTime: 5,
      defaultCleaningTime: 10,
    },
  });
  const pB = await prisma.product.create({
    data: {
      productCode: 'P-B',
      productName: '金屬支架',
      description: '沖壓金屬支架',
      defaultProcessingTime: 8,
      defaultCleaningTime: 15,
    },
  });
  const pC = await prisma.product.create({
    data: {
      productCode: 'P-C',
      productName: '電路板',
      description: 'SMT 電路板',
      defaultProcessingTime: 12,
      defaultCleaningTime: 20,
    },
  });

  // ---- 機台(支援不同產品)----
  const m1 = await prisma.machine.create({
    data: {
      machineCode: 'M-01',
      machineName: '一號射出機',
      model: 'IJ-2000',
      supportedProductIds: JSON.stringify([pA.id, pB.id]),
      defaultSetupTime: 20,
      defaultCleaningTime: 10,
      workingHours: JSON.stringify(WEEKDAY_FULL),
      status: 'available',
    },
  });
  const m2 = await prisma.machine.create({
    data: {
      machineCode: 'M-02',
      machineName: '二號多功能機',
      model: 'MF-500',
      supportedProductIds: JSON.stringify([pA.id, pB.id, pC.id]),
      defaultSetupTime: 25,
      defaultCleaningTime: 15,
      workingHours: JSON.stringify(WEEKDAY_NO_BREAK),
      status: 'available',
    },
  });
  const m3 = await prisma.machine.create({
    data: {
      machineCode: 'M-03',
      machineName: '三號 SMT 線',
      model: 'SMT-8',
      supportedProductIds: JSON.stringify([pC.id]),
      defaultSetupTime: 30,
      defaultCleaningTime: 20,
      workingHours: JSON.stringify(WEEKDAY_FULL),
      status: 'available',
    },
  });

  // ---- 維護區段(2 個)----
  await prisma.machineDowntime.create({
    data: {
      machineId: m1.id,
      type: 'maintenance',
      startTime: at(base, 1, 9),
      endTime: at(base, 1, 12),
      reason: '每月定期保養',
    },
  });
  await prisma.machineDowntime.create({
    data: {
      machineId: m3.id,
      type: 'plannedStop',
      startTime: at(base, 2, 13),
      endTime: at(base, 2, 15),
      reason: '錫爐更換',
    },
  });

  // ---- 換模規則(4 組)----
  await prisma.changeoverRule.createMany({
    data: [
      { machineId: m1.id, fromProductId: pA.id, toProductId: pB.id, setupMinutes: 30, cleaningMinutes: 20 },
      { machineId: m1.id, fromProductId: pB.id, toProductId: pA.id, setupMinutes: 15, cleaningMinutes: 10 },
      { machineId: m2.id, fromProductId: pB.id, toProductId: pC.id, setupMinutes: 40, cleaningMinutes: 25 },
      { machineId: null, fromProductId: pA.id, toProductId: pC.id, setupMinutes: 35, cleaningMinutes: 20 },
    ],
  });

  // ---- 訂單(12 張)----
  // createdAt 依序遞增使 FIFO 順序固定。
  // 設計:早建立的訂單量大且交期較鬆,晚建立的交期很緊 → FIFO 下緊急單會逾期,EDD/CR 明顯較優。
  // 注意:M-01 / M-03 的工作時段被午休切成 4 小時區段(non-preemptive),
  // 因此所有訂單加工時間設計為 ≤ 240 分鐘,才能在各機台間彈性分派。
  const orders: {
    orderNumber: string;
    productId: string;
    quantity: number;
    releaseDay: number;
    releaseHour: number;
    dueDay: number;
    dueHour: number;
    priority: number;
    eligible?: string[];
    notes?: string;
  }[] = [
    // 建立時間早、量大但交期寬鬆 → FIFO 會先做這些,把後面的急件擠到逾期
    { orderNumber: 'PO-001', productId: pA.id, quantity: 48, releaseDay: 0, releaseHour: 8, dueDay: 3, dueHour: 17, priority: 3, notes: '常規補貨單' },
    { orderNumber: 'PO-002', productId: pB.id, quantity: 30, releaseDay: 0, releaseHour: 8, dueDay: 3, dueHour: 17, priority: 3 },
    { orderNumber: 'PO-003', productId: pC.id, quantity: 20, releaseDay: 0, releaseHour: 8, dueDay: 4, dueHour: 17, priority: 4 },
    { orderNumber: 'PO-004', productId: pA.id, quantity: 45, releaseDay: 0, releaseHour: 8, dueDay: 4, dueHour: 17, priority: 4, notes: '批量單,交期寬鬆' },
    { orderNumber: 'PO-005', productId: pB.id, quantity: 28, releaseDay: 0, releaseHour: 8, dueDay: 4, dueHour: 12, priority: 3 },
    // 交期很緊、但建立時間晚 → FIFO 下會逾期,EDD/CR 應可準時
    { orderNumber: 'PO-006', productId: pA.id, quantity: 24, releaseDay: 0, releaseHour: 8, dueDay: 0, dueHour: 17, priority: 2, notes: '客戶催單,今天要出貨(FIFO 下預期逾期)' },
    { orderNumber: 'PO-007', productId: pC.id, quantity: 15, releaseDay: 0, releaseHour: 8, dueDay: 1, dueHour: 12, priority: 2, notes: 'FIFO 下預期逾期' },
    { orderNumber: 'PO-008', productId: pB.id, quantity: 20, releaseDay: 0, releaseHour: 8, dueDay: 1, dueHour: 17, priority: 3 },
    // 短加工時間單(SPT 會優先)
    { orderNumber: 'PO-009', productId: pA.id, quantity: 10, releaseDay: 0, releaseHour: 8, dueDay: 2, dueHour: 17, priority: 4, notes: '樣品小單' },
    { orderNumber: 'PO-010', productId: pC.id, quantity: 8, releaseDay: 1, releaseHour: 8, dueDay: 2, dueHour: 12, priority: 3 },
    // 高優先級急單
    { orderNumber: 'PO-URGENT-001', productId: pB.id, quantity: 15, releaseDay: 0, releaseHour: 10, dueDay: 1, dueHour: 10, priority: 1, notes: '高優先級急單:重點客戶' },
    { orderNumber: 'PO-012', productId: pA.id, quantity: 40, releaseDay: 1, releaseHour: 8, dueDay: 5, dueHour: 17, priority: 5 },
  ];

  const unitTime = new Map([
    [pA.id, 5],
    [pB.id, 8],
    [pC.id, 12],
  ]);

  let i = 0;
  for (const o of orders) {
    i += 1;
    await prisma.productionOrder.create({
      data: {
        orderNumber: o.orderNumber,
        productId: o.productId,
        quantity: o.quantity,
        releaseTime: at(base, o.releaseDay, o.releaseHour),
        dueDate: at(base, o.dueDay, o.dueHour),
        processingTime: o.quantity * (unitTime.get(o.productId) ?? 10),
        priority: o.priority,
        eligibleMachineIds: JSON.stringify(o.eligible ?? []),
        status: 'pending',
        notes: o.notes ?? null,
        createdAt: new Date(base - 7 * DAY + i * 3600_000),
      },
    });
  }

  console.log('Seed 完成:3 產品、3 機台、2 維護區段、4 換模規則、12 訂單');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
