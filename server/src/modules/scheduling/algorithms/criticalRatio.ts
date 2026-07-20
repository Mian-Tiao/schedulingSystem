/**
 * CR(Critical Ratio)= 剩餘交期時間 ÷ 剩餘加工時間。
 * CR 越小代表越緊急,應優先處理。
 * 不是一開始算一次:排程過程中依「目前模擬時間」動態重算(見 engine.ts)。
 * Tie-break:priority(小者優先)→ dueDate → orderNumber。
 */
import { byDueDate, byOrderNumber, byPriority, chain, type OrderComparator } from './shared.js';
import type { ProductionOrder } from '../engine/types.js';

/** CR 值,以分鐘計;交期已過時為負值(最緊急) */
export function criticalRatio(order: ProductionOrder, nowMs: number): number {
  const remainingDueMinutes = (order.dueDate - nowMs) / 60_000;
  return remainingDueMinutes / order.processingTime;
}

export function crComparator(nowMs: number): OrderComparator {
  return chain(
    (a, b) => criticalRatio(a, nowMs) - criticalRatio(b, nowMs),
    byPriority,
    byDueDate,
    byOrderNumber,
  );
}
