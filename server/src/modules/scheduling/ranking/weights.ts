/**
 * 方案推薦權重設定。所有權重集中於此,不散落在程式碼各處。
 * 每個目標的權重總和為 1;方向見 METRIC_DIRECTIONS(higher = 越大越好)。
 */
import type { ObjectiveId } from '../engine/types.js';

export type RankedMetricKey =
  | 'onTimeDeliveryRate'
  | 'averageTardinessMinutes'
  | 'maximumTardinessMinutes'
  | 'makespanMinutes'
  | 'machineUtilizationRate'
  | 'totalChangeoverMinutes';

export const METRIC_DIRECTIONS: Record<RankedMetricKey, 'higher' | 'lower'> = {
  onTimeDeliveryRate: 'higher',
  averageTardinessMinutes: 'lower',
  maximumTardinessMinutes: 'lower',
  makespanMinutes: 'lower',
  machineUtilizationRate: 'higher',
  totalChangeoverMinutes: 'lower',
};

export const OBJECTIVE_WEIGHTS: Record<ObjectiveId, Record<RankedMetricKey, number>> = {
  // 優先準時交貨
  ON_TIME_DELIVERY: {
    onTimeDeliveryRate: 0.4,
    averageTardinessMinutes: 0.25,
    maximumTardinessMinutes: 0.15,
    makespanMinutes: 0.1,
    machineUtilizationRate: 0.1,
    totalChangeoverMinutes: 0,
  },
  // 優先降低平均延遲
  MIN_AVG_TARDINESS: {
    onTimeDeliveryRate: 0.2,
    averageTardinessMinutes: 0.4,
    maximumTardinessMinutes: 0.2,
    makespanMinutes: 0.1,
    machineUtilizationRate: 0.1,
    totalChangeoverMinutes: 0,
  },
  // 優先縮短 Makespan
  MIN_MAKESPAN: {
    onTimeDeliveryRate: 0.15,
    averageTardinessMinutes: 0.1,
    maximumTardinessMinutes: 0.05,
    makespanMinutes: 0.5,
    machineUtilizationRate: 0.15,
    totalChangeoverMinutes: 0.05,
  },
  // 優先提高機台利用率
  MAX_UTILIZATION: {
    onTimeDeliveryRate: 0.15,
    averageTardinessMinutes: 0.1,
    maximumTardinessMinutes: 0.05,
    makespanMinutes: 0.15,
    machineUtilizationRate: 0.45,
    totalChangeoverMinutes: 0.1,
  },
  // 優先降低換模與清洗時間
  MIN_CHANGEOVER: {
    onTimeDeliveryRate: 0.15,
    averageTardinessMinutes: 0.1,
    maximumTardinessMinutes: 0.05,
    makespanMinutes: 0.1,
    machineUtilizationRate: 0.1,
    totalChangeoverMinutes: 0.5,
  },
  // 綜合平衡
  BALANCED: {
    onTimeDeliveryRate: 0.25,
    averageTardinessMinutes: 0.2,
    maximumTardinessMinutes: 0.1,
    makespanMinutes: 0.2,
    machineUtilizationRate: 0.15,
    totalChangeoverMinutes: 0.1,
  },
};

export const OBJECTIVE_LABELS: Record<ObjectiveId, string> = {
  ON_TIME_DELIVERY: '優先準時交貨',
  MIN_AVG_TARDINESS: '優先降低平均延遲',
  MIN_MAKESPAN: '優先縮短 Makespan',
  MAX_UTILIZATION: '優先提高機台利用率',
  MIN_CHANGEOVER: '優先降低換模與清洗時間',
  BALANCED: '綜合平衡',
};
