/**
 * 方案排名:指標 min-max 正規化 → 依目標權重加權計分(0~100)→ 產生推薦原因。
 */
import type { AlgorithmId, ObjectiveId, ScheduleMetrics } from '../engine/types.js';
import { METRIC_DIRECTIONS, OBJECTIVE_LABELS, OBJECTIVE_WEIGHTS, type RankedMetricKey } from './weights.js';

export interface RankableScenario {
  algorithm: AlgorithmId;
  metrics: ScheduleMetrics;
}

export interface RankingEntry {
  algorithm: AlgorithmId;
  score: number;
  rank: number;
  recommendationReason: string;
}

function metricValue(m: ScheduleMetrics, key: RankedMetricKey): number {
  if (key === 'totalChangeoverMinutes') return m.totalSetupMinutes + m.totalCleaningMinutes;
  return m[key];
}

/**
 * 對多個方案計分排名。分數 = Σ 權重 × 正規化值 × 100。
 * 指標全相同時正規化值取 1(不區分)。
 */
export function rankScenarios(scenarios: RankableScenario[], objective: ObjectiveId): RankingEntry[] {
  const weights = OBJECTIVE_WEIGHTS[objective];
  const keys = Object.keys(weights) as RankedMetricKey[];

  const ranges = new Map<RankedMetricKey, { min: number; max: number }>();
  for (const key of keys) {
    const values = scenarios.map((s) => metricValue(s.metrics, key));
    ranges.set(key, { min: Math.min(...values), max: Math.max(...values) });
  }

  const scored = scenarios.map((s) => {
    let score = 0;
    for (const key of keys) {
      const w = weights[key];
      if (w === 0) continue;
      const { min, max } = ranges.get(key)!;
      const v = metricValue(s.metrics, key);
      let norm: number;
      if (max === min) norm = 1;
      else if (METRIC_DIRECTIONS[key] === 'higher') norm = (v - min) / (max - min);
      else norm = (max - v) / (max - min);
      score += w * norm;
    }
    return { algorithm: s.algorithm, metrics: s.metrics, score: Math.round(score * 1000) / 10 };
  });

  // 分數相同時以演算法名稱排序,維持 deterministic
  const sorted = [...scored].sort((a, b) => b.score - a.score || a.algorithm.localeCompare(b.algorithm));
  const baseline = scenarios.find((s) => s.algorithm === 'FIFO')?.metrics ?? null;

  return sorted.map((s, i) => ({
    algorithm: s.algorithm,
    score: s.score,
    rank: i + 1,
    recommendationReason: buildReason(s.algorithm, s.metrics, baseline, objective, i + 1),
  }));
}

/** 推薦原因:引用實際數據,並與 FIFO 基準比較 */
export function buildReason(
  algorithm: AlgorithmId,
  m: ScheduleMetrics,
  baseline: ScheduleMetrics | null,
  objective: ObjectiveId,
  rank: number,
): string {
  const parts: string[] = [];
  const head =
    rank === 1
      ? `建議採用 ${algorithm}(目標:${OBJECTIVE_LABELS[objective]})`
      : `${algorithm} 方案(排名第 ${rank})`;

  if (baseline && algorithm !== 'FIFO') {
    const otd = compareRate(baseline.onTimeDeliveryRate, m.onTimeDeliveryRate);
    if (otd) parts.push(`準時交貨率由 ${pct(baseline.onTimeDeliveryRate)} ${otd} ${pct(m.onTimeDeliveryRate)}`);
    const tard = compareDelta(baseline.averageTardinessMinutes, m.averageTardinessMinutes);
    if (tard) parts.push(`平均延遲時間${tard}`);
    const mk = compareDelta(baseline.makespanMinutes, m.makespanMinutes);
    if (mk) parts.push(`總完工時間${mk}`);
    if (parts.length === 0) parts.push('各項指標與 FIFO 基準相近');
  } else {
    parts.push(
      `準時交貨率 ${pct(m.onTimeDeliveryRate)}、平均延遲 ${m.averageTardinessMinutes} 分鐘、Makespan ${m.makespanMinutes} 分鐘`,
    );
    if (algorithm === 'FIFO') parts.push('此為基準方案');
  }
  parts.push(`延遲訂單 ${m.lateOrderCount} 張、總換模 ${m.totalSetupMinutes} 分鐘、總清洗 ${m.totalCleaningMinutes} 分鐘`);
  return `${head}:${parts.join(',')}。`;
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

function compareRate(base: number, cur: number): string | null {
  if (Math.abs(cur - base) < 0.005) return null;
  return cur > base ? '提升至' : '下降至';
}

function compareDelta(base: number, cur: number): string | null {
  if (base === 0 && cur === 0) return null;
  const diff = cur - base;
  if (Math.abs(diff) < 1) return null;
  if (base === 0) return diff > 0 ? `增加 ${Math.round(diff)} 分鐘` : null;
  const ratio = Math.round((Math.abs(diff) / base) * 100);
  if (ratio === 0) return null;
  return diff < 0 ? `減少 ${ratio}%` : `增加約 ${ratio}%`;
}
