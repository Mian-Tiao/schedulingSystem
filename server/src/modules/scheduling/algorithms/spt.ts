/**
 * SPT(Shortest Processing Time):加工時間越短越優先。
 * Tie-break:使用者自訂 priority(小者優先)→ createdAt → orderNumber。
 */
import { byCreatedAt, byOrderNumber, byPriority, chain, type OrderComparator } from './shared.js';
import type { ProductionOrder } from '../engine/types.js';

const byProcessingTime = (a: ProductionOrder, b: ProductionOrder) => a.processingTime - b.processingTime;

export const sptComparator: OrderComparator = chain(byProcessingTime, byPriority, byCreatedAt, byOrderNumber);
