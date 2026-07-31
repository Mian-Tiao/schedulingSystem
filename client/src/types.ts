/** 與後端 API 對應的型別 */

export type MachineStatus = 'available' | 'maintenance' | 'disabled';
export type TaskType = 'production' | 'setup' | 'cleaning' | 'maintenance';
export type AlgorithmId = 'FIFO' | 'EDD' | 'SPT' | 'CR';
export type ObjectiveId =
  | 'ON_TIME_DELIVERY'
  | 'MIN_AVG_TARDINESS'
  | 'MIN_MAKESPAN'
  | 'MAX_UTILIZATION'
  | 'MIN_CHANGEOVER'
  | 'BALANCED';

export interface DaySegment {
  start: string;
  end: string;
}
export type WeekKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export type WorkingHours = Record<WeekKey, DaySegment[]>;

export interface Product {
  id: string;
  productCode: string;
  productName: string;
  description: string | null;
  defaultProcessingTime: number;
  defaultCleaningTime: number;
}

export interface Downtime {
  id: string;
  machineId: string;
  type: 'maintenance' | 'breakdown' | 'plannedStop' | 'other';
  startTime: string;
  endTime: string;
  reason: string | null;
}

export interface Machine {
  id: string;
  machineCode: string;
  machineName: string;
  model: string | null;
  description: string | null;
  supportedProductIds: string[];
  defaultSetupTime: number;
  defaultCleaningTime: number;
  workingHours: WorkingHours;
  status: MachineStatus;
  downtimes?: Downtime[];
}

export interface ChangeoverRule {
  id: string;
  machineId: string | null;
  fromProductId: string | null;
  toProductId: string;
  setupMinutes: number;
  cleaningMinutes: number;
}

export interface Order {
  id: string;
  orderNumber: string;
  productId: string;
  quantity: number;
  releaseTime: string;
  dueDate: string;
  processingTime: number;
  priority: number;
  eligibleMachineIds: string[];
  status: string;
  notes: string | null;
  createdAt: string;
  product?: { productCode: string; productName: string };
}

export interface Metrics {
  makespanMinutes: number;
  averageTardinessMinutes: number;
  maximumTardinessMinutes: number;
  onTimeDeliveryRate: number;
  machineUtilizationRate: number;
  machineOccupancyRate: number;
  totalSetupMinutes: number;
  totalCleaningMinutes: number;
  averageFlowTimeMinutes: number;
  lateOrderCount: number;
  scheduledOrderCount: number;
}

export interface Task {
  taskId: string;
  orderId: string | null;
  machineId: string;
  taskType: TaskType;
  startTime: string;
  endTime: string;
  sequence: number;
  isManuallyAdjusted: boolean;
}

export interface ScenarioSummary {
  scenarioId: string;
  name: string;
  algorithm: AlgorithmId;
  objective: ObjectiveId;
  generatedAt: string;
  metrics: Metrics;
  score: number;
  rank: number;
  recommendationReason: string;
  isManuallyAdjusted: boolean;
  unscheduledOrders: { orderId: string; orderNumber: string; reason: string }[];
  taskCount: number;
}

export interface ScenarioDetail extends ScenarioSummary {
  tasks: Task[];
}

export interface ValidateAdjustmentResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  metricsBefore?: Metrics;
  metricsAfter: Metrics | null;
  delayDiffs: DelayDiff[];
}

export interface DelayDiff {
  orderId: string;
  orderNumber: string;
  oldCompletion: string;
  newCompletion: string;
  oldTardinessMinutes: number;
  newTardinessMinutes: number;
}

export interface OrderImpact {
  orderId: string;
  orderNumber: string;
  oldCompletion: string | null;
  newCompletion: string | null;
  oldTardinessMinutes: number;
  newTardinessMinutes: number;
  becameLate: boolean;
}

export interface Dashboard {
  pendingOrderCount: number;
  dueTodayOrders: { id: string; orderNumber: string; productName: string; dueDate: string; priority: number }[];
  riskOrders: { id: string; orderNumber: string; productName: string; dueDate: string; priority: number }[];
  availableMachineCount: number;
  maintenanceMachineCount: number;
  disabledMachineCount: number;
  latestRecommendation: {
    scenarioId: string;
    algorithm: string;
    score: number;
    recommendationReason: string;
    generatedAt: string;
  } | null;
  machineLoad: {
    machineId: string;
    machineCode: string;
    machineName: string;
    status: MachineStatus;
    productionMinutes: number;
    changeoverMinutes: number;
  }[];
}

export const OBJECTIVE_LABELS: Record<ObjectiveId, string> = {
  ON_TIME_DELIVERY: '優先準時交貨',
  MIN_AVG_TARDINESS: '優先降低平均延遲',
  MIN_MAKESPAN: '優先縮短總完工時間',
  MAX_UTILIZATION: '優先提高機台利用率',
  MIN_CHANGEOVER: '優先降低換模與清洗時間',
  BALANCED: '綜合平衡',
};

export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  production: '生產',
  setup: '換模',
  cleaning: '清洗',
  maintenance: '維護/停機',
};

export const PRIORITY_LABELS: Record<number, string> = {
  1: '1(最高)',
  2: '2(高)',
  3: '3(一般)',
  4: '4(低)',
  5: '5(最低)',
};

export interface BomItem {
  id: string;
  productId: string;
  materialName: string;
  unit: string;
  quantity: number;
  customFields: Record<string, string>;
  createdAt?: string;
  updatedAt?: string;
}

