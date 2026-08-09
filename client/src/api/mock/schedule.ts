/**
 * ⚙️ 排程中心「手動選機台」暫時 MOCK（排程中心負責人專用，不影響其他頁面）
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ▶ 給後端的串接契約（後端照此實作，完成後把下方 USE_MOCK 改成 false 即整合）
 * ─────────────────────────────────────────────────────────────────────────
 *   POST /api/schedules/generate
 *   Request:  {
 *     objective: ObjectiveId,        // 既有
 *     machineIds?: string[]          // ★新增：限定只用這些機台排程
 *   }
 *   Response: 格式完全同現有 generate（GenerateResult），不需更動。
 *
 *   行為約定：
 *     • machineIds 省略或為空陣列 → 使用全部機台（等同現有「自動模式」）。
 *     • machineIds 有值 → 引擎只在這些機台上排程；作法建議是在
 *       loadSchedulingInput 之後、runAllAlgorithms 之前，先把
 *       input.machines 過濾成 machineIds 內的機台再跑（演算法本身不用改）。
 * ─────────────────────────────────────────────────────────────────────────
 */
import type { GenerateResult } from '../hooks';
import type { AlgorithmId, Metrics, ObjectiveId, ScenarioSummary } from '../../types';

/** 後端支援 machineIds 後改成 false，全頁自動改走真 API。 */
export const USE_MOCK = false;

export interface MockGenerateResult extends GenerateResult {
  /** 各機台被占用的分鐘數；busyMinutes === 0 代表閒置（僅 mock 提供，供防呆建議用）。 */
  machineLoad: { machineId: string; busyMinutes: number }[];
}

const ALGORITHMS: AlgorithmId[] = ['FIFO', 'EDD', 'SPT', 'CR'];
/** mock 假設：單班一週可用工時（分鐘）、每張訂單平均工時（分鐘）。 */
const HORIZON_MIN = 5 * 8 * 60; // 2400
const AVG_ORDER_MIN = 300;

/** 各演算法相對表現：延遲加權（FIFO 最差）、makespan 加成（SPT 最短）。 */
const LATE_PENALTY: Record<AlgorithmId, number> = { FIFO: 2, SPT: 1, EDD: 0, CR: 0 };
const MAKESPAN_FACTOR: Record<AlgorithmId, number> = { FIFO: 0.08, EDD: 0.04, CR: 0.05, SPT: 0 };

/**
 * 「開最少機台」自動模式：估算滿足產能所需的最少機台數，回傳選用（chosen）與可關閉（dropped）的機台。
 *
 * ▶ 後端串接：此邏輯可留在前端 —— 算出 chosen 後，用與手動模式相同的 machineIds 參數呼叫
 *   POST /api/schedules/generate，因此後端「不需另寫開最少機台演算法」，支援 machineIds 即可。
 *   若要更精準，可改為前端由少到多逐一嘗試機台數、取最少且無逾期者。
 */
export function pickMinimumMachines(
  machineIds: string[],
  orderCount: number,
): { chosen: string[]; dropped: string[] } {
  const demandMin = Math.max(1, orderCount) * AVG_ORDER_MIN;
  const needed = Math.min(machineIds.length, Math.max(1, Math.ceil(demandMin / HORIZON_MIN)));
  return { chosen: machineIds.slice(0, needed), dropped: machineIds.slice(needed) };
}

/** 依「所選機台數」產生一組可信的假排程結果，讓手動模式與防呆建議可運作。 */
export function mockGenerateWithMachines(params: {
  objective: ObjectiveId;
  machineIds: string[];
  orderCount: number;
}): MockGenerateResult {
  const { objective, machineIds, orderCount } = params;
  const m = machineIds.length;
  const demandMin = Math.max(1, orderCount) * AVG_ORDER_MIN;
  const neededMachines = Math.max(1, Math.ceil(demandMin / HORIZON_MIN));
  const usedMachines = Math.min(m, neededMachines);

  // 機台負載：前 usedMachines 台平均分擔需求，其餘閒置（機台選太多會出現閒置 → 觸發「關掉」建議）
  const perMachine = usedMachines > 0 ? demandMin / usedMachines : 0;
  const machineLoad = machineIds.map((id, i) => ({
    machineId: id,
    busyMinutes: i < usedMachines ? Math.round(perMachine) : 0,
  }));

  // 產能不足 → 逾期訂單（機台選太少會觸發「多開/加班」建議）
  const capacity = m * HORIZON_MIN;
  const overloadOrders = capacity >= demandMin ? 0 : Math.ceil((demandMin - capacity) / AVG_ORDER_MIN);
  const utilization = Math.min(0.99, demandMin / Math.max(1, capacity));

  const scenarios = ALGORITHMS.map((algo) =>
    buildScenario({ algo, objective, orderCount, overloadOrders, utilization, perMachine, machineCount: m }),
  );
  scenarios.sort((a, b) => b.score - a.score);
  scenarios.forEach((s, i) => {
    s.rank = i + 1;
  });

  const issues: GenerateResult['issues'] = [];
  if (overloadOrders > 0) {
    issues.push({
      level: 'warn',
      code: 'CAPACITY_SHORTAGE',
      message: `所選 ${m} 台機台產能不足，約有 ${overloadOrders} 張訂單會逾期`,
    });
  }

  return {
    batchId: `mock-${Date.now()}`,
    anchorTime: new Date().toISOString(),
    issues,
    scenarios,
    recommended: scenarios.filter((s) => s.rank <= 3).map((s) => s.scenarioId),
    machineLoad,
  };
}

function buildScenario(p: {
  algo: AlgorithmId;
  objective: ObjectiveId;
  orderCount: number;
  overloadOrders: number;
  utilization: number;
  perMachine: number;
  machineCount: number;
}): ScenarioSummary {
  const { algo, objective, orderCount, overloadOrders, utilization, perMachine, machineCount } = p;
  const penalty = LATE_PENALTY[algo];
  const lateCount = overloadOrders > 0 ? overloadOrders + penalty : 0;
  const onTime = Math.max(0, (orderCount - lateCount) / Math.max(1, orderCount));
  const makespan = Math.round(perMachine * (1 + MAKESPAN_FACTOR[algo]) + overloadOrders * AVG_ORDER_MIN);
  const avgTardiness = lateCount > 0 ? Math.round(120 + penalty * 30) : 0;

  const metrics: Metrics = {
    makespanMinutes: makespan,
    averageTardinessMinutes: avgTardiness,
    maximumTardinessMinutes: lateCount > 0 ? Math.round(avgTardiness * 2.5) : 0,
    onTimeDeliveryRate: Number(onTime.toFixed(2)),
    machineUtilizationRate: Number(utilization.toFixed(2)),
    machineOccupancyRate: Number(Math.min(0.99, utilization + 0.1).toFixed(2)),
    totalSetupMinutes: 60 + penalty * 15,
    totalCleaningMinutes: 30 + penalty * 8,
    averageFlowTimeMinutes: Math.round(makespan * 0.6 + 200),
    lateOrderCount: lateCount,
    scheduledOrderCount: orderCount,
  };

  const score = Math.round(onTime * 70 + utilization * 30 - penalty * 2);

  return {
    scenarioId: `mock-${algo}`,
    name: `${algo} 方案`,
    algorithm: algo,
    objective,
    generatedAt: new Date().toISOString(),
    metrics,
    score,
    rank: 0, // 由呼叫端依 score 重新排名
    recommendationReason:
      lateCount > 0
        ? `使用 ${machineCount} 台機台，準時率約 ${Math.round(onTime * 100)}%，仍有 ${lateCount} 張逾期。`
        : `使用 ${machineCount} 台機台即可全部準時，機台利用率約 ${Math.round(utilization * 100)}%。`,
    isManuallyAdjusted: false,
    unscheduledOrders: [],
    taskCount: orderCount * 2,
  };
}
