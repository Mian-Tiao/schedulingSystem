/**
 * 排程中心的純呈現/建議邏輯(與 React 無關,方便單元測試)。
 * 這裡不含任何排程運算——真正的排程演算法在後端;此處只決定「怎麼呈現與給建議」。
 */
import type { MockGenerateResult } from '../api/mock/schedule';
import type { Machine, Metrics, ObjectiveId, ScenarioSummary } from '../types';
import { fmtMinutes, pct } from '../utils/time';

export type MetricRow = { key: keyof Metrics; label: string; fmt: (v: number) => string; better: 'high' | 'low' };

export const METRIC_ROWS: MetricRow[] = [
  { key: 'onTimeDeliveryRate', label: '準時交貨率', fmt: pct, better: 'high' },
  { key: 'averageTardinessMinutes', label: '平均延遲時間', fmt: fmtMinutes, better: 'low' },
  { key: 'maximumTardinessMinutes', label: '最大延遲時間', fmt: fmtMinutes, better: 'low' },
  { key: 'lateOrderCount', label: '延遲訂單數', fmt: (v) => `${v} 張`, better: 'low' },
  { key: 'makespanMinutes', label: '總完工時間 Makespan', fmt: fmtMinutes, better: 'low' },
  { key: 'machineUtilizationRate', label: '機台利用率(純生產)', fmt: pct, better: 'high' },
  { key: 'machineOccupancyRate', label: '機台占用率(含換模清洗)', fmt: pct, better: 'high' },
  { key: 'totalSetupMinutes', label: '總換模時間', fmt: fmtMinutes, better: 'low' },
  { key: 'totalCleaningMinutes', label: '總清洗時間', fmt: fmtMinutes, better: 'low' },
  { key: 'averageFlowTimeMinutes', label: '平均流程時間', fmt: fmtMinutes, better: 'low' },
];

/** 依「排程目標」與「候選方案間的差異」把指標分成:決定性(預設顯示)/ 一致性(預設收合)。 */
export function splitMetrics(
  list: ScenarioSummary[],
  objective: ObjectiveId,
): { decisive: MetricRow[]; consistent: MetricRow[] } {
  const primary = new Set<keyof Metrics>(objectivePrimaryKeys(objective));
  const decisive: MetricRow[] = [];
  const consistent: MetricRow[] = [];
  for (const row of METRIC_ROWS) {
    if (primary.has(row.key)) {
      decisive.push(row);
      continue;
    }
    if (list.length < 2) {
      consistent.push(row);
      continue;
    }
    const values = list.map((s) => s.metrics[row.key]);
    const max = Math.max(...values);
    const min = Math.min(...values);
    const denom = Math.max(Math.abs(max), Math.abs(min), 1e-9);
    const varies = new Set(values).size > 1 && (max - min) / denom >= 0.03;
    (varies ? decisive : consistent).push(row);
  }
  // 保底:若沒有任何決定性指標,退回顯示全部,避免表格空白
  if (decisive.length === 0) return { decisive: METRIC_ROWS, consistent: [] };
  return { decisive, consistent };
}

/** 依排程目標對應的「主要指標」,一律列入決定性指標。 */
export function objectivePrimaryKeys(objective: ObjectiveId): (keyof Metrics)[] {
  switch (objective) {
    case 'ON_TIME_DELIVERY':
      return ['onTimeDeliveryRate'];
    case 'MIN_AVG_TARDINESS':
      return ['averageTardinessMinutes'];
    case 'MIN_MAKESPAN':
      return ['makespanMinutes'];
    case 'MAX_UTILIZATION':
      return ['machineUtilizationRate'];
    case 'MIN_CHANGEOVER':
      return ['totalSetupMinutes', 'totalCleaningMinutes'];
    default:
      return [];
  }
}

/** 產生單張卡片的「差異化說明」:在決定性指標中挑出此方案與其餘方案差距最大者;優先講領先項。 */
export function cardHighlight(s: ScenarioSummary, all: ScenarioSummary[], rows: MetricRow[]): string {
  const others = all.filter((o) => o.scenarioId !== s.scenarioId);
  if (others.length === 0 || rows.length === 0) return '各項指標與其他方案相近';

  let lead: { row: MetricRow; gap: number; sVal: number; othersAvg: number } | null = null;
  let lag: { row: MetricRow; gap: number; sVal: number; othersAvg: number } | null = null;

  for (const row of rows) {
    const sVal = s.metrics[row.key];
    const otherVals = others.map((o) => o.metrics[row.key]);
    const othersAvg = otherVals.reduce((a, b) => a + b, 0) / otherVals.length;
    const gap = Math.abs(sVal - othersAvg) / Math.max(Math.abs(othersAvg), 1e-9);
    const isBetter = row.better === 'high' ? sVal > othersAvg : sVal < othersAvg;
    const entry = { row, gap, sVal, othersAvg };
    if (isBetter) {
      if (!lead || gap > lead.gap) lead = entry;
    } else {
      if (!lag || gap > lag.gap) lag = entry;
    }
  }

  const pick = lead && lead.gap >= 0.01 ? { ...lead, better: true } : lag ? { ...lag, better: false } : null;
  if (!pick || pick.gap < 0.01) return '各項指標與其他方案相近';
  const verb = pick.better ? '領先' : '偏弱';
  return `${pick.row.label}${verb}:${pick.row.fmt(pick.sVal)}(其他方案約 ${pick.row.fmt(pick.othersAvg)})`;
}

/** 防呆建議:依排程結果與所選機台,判斷機台開太少 / 太多。 */
export function buildAdvice(
  result: MockGenerateResult,
  selectedIds: string[],
  allMachines: Machine[],
): { tone: 'info' | 'warn' | 'success'; text: string }[] {
  const best = result.scenarios.find((s) => s.rank === 1) ?? result.scenarios[0];
  if (!best) return [];
  const nameOf = (id: string) => allMachines.find((m) => m.id === id)?.machineName ?? id;
  const lateCount = best.metrics.lateOrderCount + best.unscheduledOrders.length;

  if (lateCount > 0) {
    const candidate = allMachines.find((m) => !selectedIds.includes(m.id));
    const suggestion = candidate ? `建議加開機台「${candidate.machineName}」` : '建議安排加班';
    return [
      {
        tone: 'warn',
        text: `偵測到約 ${lateCount} 張訂單會延遲(機台開太少)。${suggestion},或安排加班以趕上交期。`,
      },
    ];
  }

  const idle = result.machineLoad.filter((l) => l.busyMinutes === 0);
  if (idle.length > 0) {
    const names = idle.map((l) => `「${nameOf(l.machineId)}」`).join('、');
    return [
      {
        tone: 'info',
        text: `機台利用率約 ${Math.round(best.metrics.machineUtilizationRate * 100)}%,${names} 幾乎閒置(機台開太多)。可考慮關閉以節省電費。`,
      },
    ];
  }

  return [{ tone: 'success', text: '目前機台配置合理:沒有訂單延遲,也沒有閒置機台。' }];
}
