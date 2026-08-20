/**
 * 甘特圖手動調整:驗證拖曳合法性、重排受影響機台、重算換模與績效。
 *
 * 規則(ASSUMPTIONS #19-21):
 * - 只允許移動 production 任務;setup/cleaning 由系統自動重算。
 * - 合法調整後,受影響機台的後續任務保持原順序、必要時往後推移。
 * - 換模/清洗在重排時緊接前一任務之後前向放置。
 */
import { machineAvailability, findSlot, findSlots, expandWorkingWindows, subtractIntervals } from './calendar.js';
import { resolveChangeover } from './changeover.js';
import { maintenanceTasks } from './engine.js';
import {
  minutesToMs,
  type ProductionOrder,
  type ScheduledTask,
  type SchedulingInput,
} from './types.js';

export interface AdjustmentRequest {
  /** 要移動的 production 任務 id */
  taskId: string;
  /** 目標機台 */
  machineId: string;
  /** 目標開始時間(epoch ms) */
  startTime: number;
}

export interface OrderDelayDiff {
  orderId: string;
  orderNumber: string;
  oldCompletion: number;
  newCompletion: number;
  oldTardinessMinutes: number;
  newTardinessMinutes: number;
}

export interface AdjustmentResult {
  valid: boolean;
  /** 不合法原因(繁體中文) */
  errors: string[];
  /** 合法但需注意的警告,如造成訂單延遲 */
  warnings: string[];
  /** 調整後完整任務清單(valid 時才有) */
  tasks: ScheduledTask[] | null;
  /** 受影響訂單的延遲差異 */
  delayDiffs: OrderDelayDiff[];
}

interface SeqEntry {
  order: ProductionOrder;
  desiredStart: number;
  isMoved: boolean;
}

export function applyAdjustment(
  currentTasks: ScheduledTask[],
  request: AdjustmentRequest,
  input: SchedulingInput,
): AdjustmentResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const horizonEnd = input.anchorTime + (input.horizonDays ?? 60) * 24 * 3600_000;

  const moved = currentTasks.find((t) => t.id === request.taskId);
  if (!moved || moved.taskType !== 'production' || !moved.orderId) {
    return fail(['找不到要移動的生產任務,請重新整理頁面後再試']);
  }
  const order = input.orders.find((o) => o.id === moved.orderId);
  if (!order) return fail(['找不到任務對應的訂單資料']);

  const targetMachine = input.machines.find((m) => m.id === request.machineId);
  if (!targetMachine) return fail(['找不到目標機台']);

  const product = input.products.find((p) => p.id === order.productId);
  const productName = product ? product.productName : order.productId;

  // 1. 機台支援檢查
  if (targetMachine.status === 'disabled') {
    errors.push(`機台 ${targetMachine.machineName} 目前停用,無法安排工作`);
  }
  if (!targetMachine.supportedProductIds.includes(order.productId)) {
    errors.push(`機台 ${targetMachine.machineName} 不支援加工產品「${productName}」`);
  }
  if (order.eligibleMachineIds.length > 0 && !order.eligibleMachineIds.includes(targetMachine.id)) {
    errors.push(`訂單 ${order.orderNumber} 已限定可用機台,不包含 ${targetMachine.machineName}`);
  }

  // 2. release time 檢查
  if (request.startTime < order.releaseTime) {
    errors.push(`開始時間早於訂單可開始生產時間(release time)`);
  }

  const durationMs = minutesToMs(order.processingTime);
  // 3. 工作時段與維護檢查:production 可跨工作時段分段,但指定起點必須可生產
  const downtimeBlocks = input.downtimes
    .filter((d) => d.machineId === targetMachine.id)
    .map((d) => ({ start: d.startTime, end: d.endTime }));
  const windows = expandWorkingWindows(targetMachine.workingHours, input.anchorTime, horizonEnd);
  const windowsMinusDown = subtractIntervals(windows, downtimeBlocks);
  const startIsAvailable = windowsMinusDown.some(
    (w) => w.start <= request.startTime && request.startTime < w.end,
  );
  const requestedSegments = findSlots(windowsMinusDown, request.startTime, durationMs);
  if (!startIsAvailable || !requestedSegments || requestedSegments[0]?.start !== request.startTime) {
    const startsDuringDowntime = downtimeBlocks.some(
      (d) => d.start <= request.startTime && request.startTime < d.end,
    );
    const startsDuringWorkingHours = windows.some(
      (w) => w.start <= request.startTime && request.startTime < w.end,
    );
    if (startsDuringDowntime) errors.push('開始時間位於機台維護或停機時段');
    else if (!startsDuringWorkingHours) errors.push('開始時間位於機台非工作時段');
    else errors.push('規劃期間內的剩餘工時不足以完成此工作');
  }

  if (errors.length > 0) return fail(errors);

  // 4. 重排受影響機台
  const sourceMachineId = moved.machineId;
  const affectedMachineIds = new Set([sourceMachineId, request.machineId]);

  // 依機台整理 production 順序(移除被移動訂單,再插入目標位置)
  const productionTasks = currentTasks.filter((t) => t.taskType === 'production' && t.orderId);
  const orderByIdMap = new Map(input.orders.map((o) => [o.id, o]));

  const seqByMachine = new Map<string, SeqEntry[]>();
  const sequencedOrderIds = new Set<string>();
  for (const t of [...productionTasks].sort((a, b) => a.startTime - b.startTime)) {
    if (t.orderId === order.id) continue;
    if (sequencedOrderIds.has(t.orderId!)) continue;
    const o = orderByIdMap.get(t.orderId!);
    if (!o) continue;
    sequencedOrderIds.add(t.orderId!);
    const list = seqByMachine.get(t.machineId) ?? [];
    list.push({ order: o, desiredStart: t.startTime, isMoved: false });
    seqByMachine.set(t.machineId, list);
  }
  const targetList = seqByMachine.get(request.machineId) ?? [];
  const insertIdx = targetList.findIndex((e) => e.desiredStart > request.startTime);
  const entry: SeqEntry = { order, desiredStart: request.startTime, isMoved: true };
  if (insertIdx === -1) targetList.push(entry);
  else targetList.splice(insertIdx, 0, entry);
  seqByMachine.set(request.machineId, targetList);

  // 未受影響機台的任務原樣保留
  const keptTasks = currentTasks.filter(
    (t) => !affectedMachineIds.has(t.machineId) && t.taskType !== 'maintenance',
  );
  const newTasks: ScheduledTask[] = [...keptTasks];

  const oldCompletion = new Map<string, number>();
  for (const t of productionTasks) {
    if (t.orderId) oldCompletion.set(t.orderId, Math.max(oldCompletion.get(t.orderId) ?? 0, t.endTime));
  }
  const newCompletion = new Map<string, number>();
  for (const t of keptTasks) {
    if (t.taskType === 'production' && t.orderId) {
      newCompletion.set(t.orderId, Math.max(newCompletion.get(t.orderId) ?? 0, t.endTime));
    }
  }

  for (const machineId of affectedMachineIds) {
    const machine = input.machines.find((m) => m.id === machineId);
    if (!machine) continue;
    const seq = seqByMachine.get(machineId) ?? [];
    const busy: { start: number; end: number }[] = [];
    let lastProductId: string | null = null;
    let lastEnd = input.anchorTime;
    let seqNo = 0;

    for (const e of seq) {
      const changeover = resolveChangeover(machine, lastProductId, e.order.productId, input.changeoverRules);
      const availability = machineAvailability(machine, input.downtimes, busy, input.anchorTime, horizonEnd);
      let cursor = Math.max(input.anchorTime, lastEnd);

      const push = (taskType: 'cleaning' | 'setup', minutes: number): boolean => {
        if (minutes <= 0) return true;
        const slot = findSlot(availability, cursor, minutesToMs(minutes));
        if (!slot) return false;
        seqNo += 1;
        newTasks.push({
          id: `adj-${e.order.orderNumber}-${taskType}`,
          orderId: e.order.id,
          machineId,
          taskType,
          startTime: slot.start,
          endTime: slot.end,
          sequence: seqNo,
          isManuallyAdjusted: e.isMoved,
        });
        busy.push({ start: slot.start, end: slot.end });
        cursor = slot.end;
        return true;
      };

      if (!push('cleaning', changeover.cleaningMinutes) || !push('setup', changeover.setupMinutes)) {
        return fail([`重排後換模/清洗時間無法安排於機台 ${machine.machineName} 的可用時段內`]);
      }

      const prodEarliest = Math.max(cursor, e.order.releaseTime, e.desiredStart);
      const slots = findSlots(availability, prodEarliest, minutesToMs(e.order.processingTime));
      if (!slots || slots.length === 0) {
        return fail([`重排後訂單 ${e.order.orderNumber} 無法在規劃期間內完成`]);
      }
      if (e.isMoved && slots[0]!.start !== request.startTime) {
        // 換模/前置任務擠壓,無法在指定時間開始
        return fail(['該位置與其他訂單重疊,或換模/清洗時間不足,無法於指定時間開始']);
      }
      slots.forEach((slot, index) => {
        seqNo += 1;
        const segmentSuffix = slots.length === 1 ? '' : `-${index + 1}`;
        newTasks.push({
          id: `adj-${e.order.orderNumber}-production${segmentSuffix}`,
          orderId: e.order.id,
          machineId,
          taskType: 'production',
          startTime: slot.start,
          endTime: slot.end,
          sequence: seqNo,
          isManuallyAdjusted: e.isMoved,
        });
        busy.push({ start: slot.start, end: slot.end });
      });
      lastProductId = e.order.productId;
      lastEnd = slots[slots.length - 1]!.end;
      newCompletion.set(e.order.id, lastEnd);
    }
  }

  // 5. 延遲差異與警告
  const delayDiffs: OrderDelayDiff[] = [];
  for (const [orderId, newC] of newCompletion) {
    const oldC = oldCompletion.get(orderId);
    if (oldC === undefined) continue;
    const o = orderByIdMap.get(orderId);
    if (!o) continue;
    const oldT = Math.max(0, (oldC - o.dueDate) / 60_000);
    const newT = Math.max(0, (newC - o.dueDate) / 60_000);
    if (oldC !== newC || oldT !== newT) {
      delayDiffs.push({
        orderId,
        orderNumber: o.orderNumber,
        oldCompletion: oldC,
        newCompletion: newC,
        oldTardinessMinutes: Math.round(oldT),
        newTardinessMinutes: Math.round(newT),
      });
      if (newT > oldT) {
        warnings.push(`訂單 ${o.orderNumber} 將延遲 ${Math.round(newT)} 分鐘(原 ${Math.round(oldT)} 分鐘)`);
      }
    }
  }

  newTasks.push(...maintenanceTasks(input, horizonEnd, 'adj'));
  newTasks.sort((a, b) => a.startTime - b.startTime || a.machineId.localeCompare(b.machineId));

  return { valid: true, errors: [], warnings, tasks: newTasks, delayDiffs };

  function fail(errs: string[]): AdjustmentResult {
    return { valid: false, errors: errs, warnings: [], tasks: null, delayDiffs: [] };
  }
}
