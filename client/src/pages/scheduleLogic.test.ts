import { describe, expect, it } from 'vitest';
import { pickMinimumMachines, type MockGenerateResult } from '../api/mock/schedule';
import type { Machine, Metrics, ScenarioSummary } from '../types';
import { METRIC_ROWS, buildAdvice, cardHighlight, splitMetrics } from './scheduleLogic';

// ---- 測試用假資料 ----
const baseMetrics: Metrics = {
  makespanMinutes: 1000,
  averageTardinessMinutes: 0,
  maximumTardinessMinutes: 0,
  onTimeDeliveryRate: 1,
  machineUtilizationRate: 0.75,
  machineOccupancyRate: 0.85,
  totalSetupMinutes: 60,
  totalCleaningMinutes: 30,
  averageFlowTimeMinutes: 800,
  lateOrderCount: 0,
  scheduledOrderCount: 12,
};

function mkScenario(over: Partial<Omit<ScenarioSummary, 'metrics'>> & { metrics?: Partial<Metrics> } = {}): ScenarioSummary {
  const { metrics, ...rest } = over;
  return {
    scenarioId: 'mock-EDD',
    name: 'EDD 方案',
    algorithm: 'EDD',
    objective: 'MIN_MAKESPAN',
    generatedAt: new Date().toISOString(),
    metrics: { ...baseMetrics, ...metrics },
    score: 90,
    rank: 1,
    recommendationReason: '',
    isManuallyAdjusted: false,
    unscheduledOrders: [],
    taskCount: 10,
    ...rest,
  };
}

function mkMachine(id: string, code: string, name: string): Machine {
  return {
    id,
    machineCode: code,
    machineName: name,
    model: null,
    description: null,
    supportedProductIds: [],
    defaultSetupTime: 0,
    defaultCleaningTime: 0,
    workingHours: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] },
    status: 'available',
  };
}

const machines = [mkMachine('m1', 'M-01', '一號機'), mkMachine('m2', 'M-02', '二號機'), mkMachine('m3', 'M-03', '三號機')];

function mkResult(scenario: ScenarioSummary, machineLoad: { machineId: string; busyMinutes: number }[]): MockGenerateResult {
  return { batchId: 'b', anchorTime: '', issues: [], scenarios: [scenario], recommended: [], machineLoad };
}

// ---- pickMinimumMachines:開最少機台建議 ----
describe('pickMinimumMachines', () => {
  it('12 張訂單、3 台機台 → 選最少 2 台,關 1 台', () => {
    expect(pickMinimumMachines(['m1', 'm2', 'm3'], 12)).toEqual({ chosen: ['m1', 'm2'], dropped: ['m3'] });
  });

  it('訂單爆量也不會超過現有機台數', () => {
    expect(pickMinimumMachines(['m1'], 100)).toEqual({ chosen: ['m1'], dropped: [] });
  });

  it('訂單很少時至少選 1 台', () => {
    expect(pickMinimumMachines(['m1', 'm2'], 1).chosen).toEqual(['m1']);
  });
});

// ---- buildAdvice:防呆建議 ----
describe('buildAdvice', () => {
  it('有訂單延遲 → 建議多開/加班(warn)', () => {
    const s = mkScenario({ rank: 1, metrics: { lateOrderCount: 3 } });
    const advice = buildAdvice(mkResult(s, [{ machineId: 'm1', busyMinutes: 2000 }]), ['m1'], machines);
    expect(advice[0]!.tone).toBe('warn');
    expect(advice[0]!.text).toContain('機台開太少');
    expect(advice[0]!.text).toContain('二號機'); // 建議加開第一台未選的機台
  });

  it('沒延遲但有機台閒置 → 建議關閉省電(info)', () => {
    const s = mkScenario({ rank: 1, metrics: { lateOrderCount: 0, machineUtilizationRate: 0.4 } });
    const load = [
      { machineId: 'm1', busyMinutes: 2000 },
      { machineId: 'm2', busyMinutes: 0 },
    ];
    const advice = buildAdvice(mkResult(s, load), ['m1', 'm2'], machines);
    expect(advice[0]!.tone).toBe('info');
    expect(advice[0]!.text).toContain('可考慮關閉');
    expect(advice[0]!.text).toContain('二號機'); // 閒置的機台
  });

  it('無延遲也無閒置 → 配置合理(success)', () => {
    const s = mkScenario({ rank: 1, metrics: { lateOrderCount: 0 } });
    const advice = buildAdvice(mkResult(s, [{ machineId: 'm1', busyMinutes: 2000 }]), ['m1'], machines);
    expect(advice[0]!.tone).toBe('success');
  });
});

// ---- splitMetrics:決定性 / 一致性指標分組 ----
describe('splitMetrics', () => {
  it('目標指標一律列入決定性;三方案全相等的指標歸一致性', () => {
    const a = mkScenario({ scenarioId: 'a', metrics: { makespanMinutes: 1000, onTimeDeliveryRate: 1 } });
    const b = mkScenario({ scenarioId: 'b', metrics: { makespanMinutes: 1400, onTimeDeliveryRate: 1 } });
    const { decisive, consistent } = splitMetrics([a, b], 'MIN_MAKESPAN');
    expect(decisive.map((r) => r.key)).toContain('makespanMinutes'); // 目標 + 有差異
    expect(consistent.map((r) => r.key)).toContain('onTimeDeliveryRate'); // 都 100% → 一致
  });

  it('只有一個方案時,非目標指標一律當一致性', () => {
    const { decisive, consistent } = splitMetrics([mkScenario()], 'MIN_MAKESPAN');
    expect(decisive.map((r) => r.key)).toEqual(['makespanMinutes']);
    expect(consistent.length).toBeGreaterThan(0);
  });
});

// ---- cardHighlight:卡片差異化說明 ----
describe('cardHighlight', () => {
  const makespanRow = METRIC_ROWS.filter((r) => r.key === 'makespanMinutes');

  it('在領先的決定性指標上回傳「領先」說明', () => {
    const winner = mkScenario({ scenarioId: 'a', metrics: { makespanMinutes: 600 } });
    const other = mkScenario({ scenarioId: 'b', metrics: { makespanMinutes: 1200 } });
    const text = cardHighlight(winner, [winner, other], makespanRow);
    expect(text).toContain('總完工時間');
    expect(text).toContain('領先');
  });

  it('數值相近時回傳「相近」', () => {
    const a = mkScenario({ scenarioId: 'a', metrics: { makespanMinutes: 1000 } });
    const b = mkScenario({ scenarioId: 'b', metrics: { makespanMinutes: 1000 } });
    expect(cardHighlight(a, [a, b], makespanRow)).toContain('相近');
  });
});
