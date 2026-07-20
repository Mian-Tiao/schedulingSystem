/**
 * EDD(Earliest Due Date):交期越早越優先。
 * Tie-break:使用者自訂 priority(小者優先)→ createdAt → orderNumber。
 */
import { byCreatedAt, byDueDate, byOrderNumber, byPriority, chain, type OrderComparator } from './shared.js';

export const eddComparator: OrderComparator = chain(byDueDate, byPriority, byCreatedAt, byOrderNumber);
