/**
 * 排程引擎 domain model。
 * 引擎為 pure functions,不依賴 Express / Prisma;時間一律以「epoch 毫秒」運算,
 * 對外輸出入使用 ISO 8601 字串。
 */

export type MachineStatus = 'available' | 'maintenance' | 'disabled';
export type DowntimeType = 'maintenance' | 'breakdown' | 'plannedStop' | 'other';
export type OrderStatus = 'pending' | 'scheduled' | 'inProgress' | 'completed' | 'cancelled';
export type TaskType = 'production' | 'setup' | 'cleaning' | 'maintenance';

export type AlgorithmId = 'FIFO' | 'EDD' | 'SPT' | 'CR';
export const ALGORITHMS: AlgorithmId[] = ['FIFO', 'EDD', 'SPT', 'CR'];

export type ObjectiveId =
  | 'ON_TIME_DELIVERY'
  | 'MIN_AVG_TARDINESS'
  | 'MIN_MAKESPAN'
  | 'MAX_UTILIZATION'
  | 'MIN_CHANGEOVER'
  | 'BALANCED';

export interface Product {
  id: string;
  productCode: string;
  productName: string;
  /** 每單位加工分鐘數 */
  defaultProcessingTime: number;
  defaultCleaningTime: number;
}

/** 一天內的工作時段,如 { start: "08:00", end: "17:00" } */
export interface DaySegment {
  start: string;
  end: string;
}

/** 週一至週日的工作時段表;空陣列 = 當日不工作 */
export interface WorkingHours {
  mon: DaySegment[];
  tue: DaySegment[];
  wed: DaySegment[];
  thu: DaySegment[];
  fri: DaySegment[];
  sat: DaySegment[];
  sun: DaySegment[];
}

export interface Machine {
  id: string;
  machineCode: string;
  machineName: string;
  model: string | null;
  supportedProductIds: string[];
  defaultSetupTime: number;
  defaultCleaningTime: number;
  workingHours: WorkingHours;
  status: MachineStatus;
}

export interface MachineDowntime {
  id: string;
  machineId: string;
  type: DowntimeType;
  /** epoch ms */
  startTime: number;
  endTime: number;
  reason: string | null;
}

export interface ChangeoverRule {
  id: string;
  /** null = 適用所有機台 */
  machineId: string | null;
  /** null = 空機(該機台第一張訂單) */
  fromProductId: string | null;
  toProductId: string;
  setupMinutes: number;
  cleaningMinutes: number;
}

export interface ProductionOrder {
  id: string;
  orderNumber: string;
  productId: string;
  quantity: number;
  /** epoch ms */
  releaseTime: number;
  /** epoch ms */
  dueDate: number;
  /** 分鐘 */
  processingTime: number;
  /** 1(最高)~ 5(最低) */
  priority: number;
  /** 空陣列 = 所有支援該產品的機台皆可 */
  eligibleMachineIds: string[];
  status: OrderStatus;
  /** epoch ms,FIFO 排序用 */
  createdAt: number;
}

export interface ScheduledTask {
  id: string;
  orderId: string | null;
  machineId: string;
  taskType: TaskType;
  /** epoch ms */
  startTime: number;
  endTime: number;
  sequence: number;
  isManuallyAdjusted: boolean;
}

export interface ScheduleMetrics {
  makespanMinutes: number;
  averageTardinessMinutes: number;
  maximumTardinessMinutes: number;
  onTimeDeliveryRate: number;
  /** 純生產利用率 */
  machineUtilizationRate: number;
  /** 含換模與清洗的占用率 */
  machineOccupancyRate: number;
  totalSetupMinutes: number;
  totalCleaningMinutes: number;
  averageFlowTimeMinutes: number;
  lateOrderCount: number;
  scheduledOrderCount: number;
}

export interface ScheduleScenario {
  scenarioId: string;
  name: string;
  algorithm: AlgorithmId;
  objective: ObjectiveId;
  generatedAt: number;
  tasks: ScheduledTask[];
  metrics: ScheduleMetrics;
  score: number;
  rank: number;
  recommendationReason: string;
  isManuallyAdjusted: boolean;
  /** 無法排入的訂單與原因 */
  unscheduledOrders: { orderId: string; orderNumber: string; reason: string }[];
}

/** 排程引擎輸入 */
export interface SchedulingInput {
  products: Product[];
  machines: Machine[];
  downtimes: MachineDowntime[];
  changeoverRules: ChangeoverRule[];
  orders: ProductionOrder[];
  /** 排程起點 epoch ms */
  anchorTime: number;
  /** 規劃期間(天),預設 60 */
  horizonDays?: number;
}

/** 單一訂單在某機台上的一次安排(cleaning → setup → production) */
export interface Placement {
  machineId: string;
  cleaningStart: number | null;
  cleaningEnd: number | null;
  setupStart: number | null;
  setupEnd: number | null;
  productionStart: number;
  productionEnd: number;
  setupMinutes: number;
  cleaningMinutes: number;
}

/** 引擎內部:機台目前狀態 */
export interface MachineState {
  machine: Machine;
  /** 已占用時段(含 production/setup/cleaning),依開始時間排序 */
  busy: { start: number; end: number }[];
  /** 最後一張生產訂單的產品(換模判斷用);null = 空機 */
  lastProductId: string | null;
  /** 最後一個任務結束時間 */
  lastEnd: number;
  /** 已累積純生產分鐘(負載 tie-break 用) */
  loadMinutes: number;
}

export const MINUTE_MS = 60_000;

export function minutesToMs(min: number): number {
  return min * MINUTE_MS;
}

export function msToMinutes(ms: number): number {
  return ms / MINUTE_MS;
}
