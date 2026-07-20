/**
 * FIFO:依訂單建立時間(進入訂單池的順序)安排。
 */
import { byCreatedAt, byOrderNumber, chain, type OrderComparator } from './shared.js';

export const fifoComparator: OrderComparator = chain(byCreatedAt, byOrderNumber);
