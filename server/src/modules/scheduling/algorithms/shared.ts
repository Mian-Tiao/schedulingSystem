import type { ProductionOrder } from '../engine/types.js';

export type OrderComparator = (a: ProductionOrder, b: ProductionOrder) => number;

export const byOrderNumber: OrderComparator = (a, b) => a.orderNumber.localeCompare(b.orderNumber);
export const byPriority: OrderComparator = (a, b) => a.priority - b.priority;
export const byCreatedAt: OrderComparator = (a, b) => a.createdAt - b.createdAt;
export const byDueDate: OrderComparator = (a, b) => a.dueDate - b.dueDate;

export const chain =
  (...cmps: OrderComparator[]): OrderComparator =>
  (a, b) => {
    for (const cmp of cmps) {
      const r = cmp(a, b);
      if (r !== 0) return r;
    }
    return 0;
  };
