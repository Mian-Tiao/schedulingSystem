import { describe, expect, it } from 'vitest';
import { rankScenarios } from '../ranking/ranking.js';
import type { ScheduleMetrics } from '../engine/types.js';

function metrics(overrides: Partial<ScheduleMetrics>): ScheduleMetrics {
  return {
    makespanMinutes: 960,
    averageTardinessMinutes: 60,
    maximumTardinessMinutes: 120,
    onTimeDeliveryRate: 0.7,
    machineUtilizationRate: 0.6,
    machineOccupancyRate: 0.7,
    totalSetupMinutes: 100,
    totalCleaningMinutes: 50,
    averageFlowTimeMinutes: 300,
    lateOrderCount: 3,
    scheduledOrderCount: 10,
    ...overrides,
  };
}

describe('rankScenarios', () => {
  it('ON_TIME_DELIVERY 目標下,交貨率高者排名前', () => {
    const ranked = rankScenarios(
      [
        { algorithm: 'FIFO', metrics: metrics({ onTimeDeliveryRate: 0.65, averageTardinessMinutes: 90 }) },
        { algorithm: 'EDD', metrics: metrics({ onTimeDeliveryRate: 0.88, averageTardinessMinutes: 40 }) },
        { algorithm: 'SPT', metrics: metrics({ onTimeDeliveryRate: 0.7, averageTardinessMinutes: 80 }) },
        { algorithm: 'CR', metrics: metrics({ onTimeDeliveryRate: 0.8, averageTardinessMinutes: 50 }) },
      ],
      'ON_TIME_DELIVERY',
    );
    expect(ranked[0]?.algorithm).toBe('EDD');
    expect(ranked[0]?.rank).toBe(1);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
  });

  it('MIN_MAKESPAN 目標下,makespan 短者排名前', () => {
    const ranked = rankScenarios(
      [
        { algorithm: 'FIFO', metrics: metrics({ makespanMinutes: 1200 }) },
        { algorithm: 'SPT', metrics: metrics({ makespanMinutes: 800 }) },
      ],
      'MIN_MAKESPAN',
    );
    expect(ranked[0]?.algorithm).toBe('SPT');
  });

  it('推薦原因引用實際數據並與 FIFO 基準比較', () => {
    const ranked = rankScenarios(
      [
        { algorithm: 'FIFO', metrics: metrics({ onTimeDeliveryRate: 0.65 }) },
        { algorithm: 'EDD', metrics: metrics({ onTimeDeliveryRate: 0.88 }) },
      ],
      'ON_TIME_DELIVERY',
    );
    const reason = ranked[0]?.recommendationReason ?? '';
    expect(reason).toContain('EDD');
    expect(reason).toContain('65%');
    expect(reason).toContain('88%');
  });

  it('分數為 0~100 之間', () => {
    const ranked = rankScenarios(
      [
        { algorithm: 'FIFO', metrics: metrics({}) },
        { algorithm: 'EDD', metrics: metrics({ onTimeDeliveryRate: 0.9 }) },
      ],
      'BALANCED',
    );
    for (const r of ranked) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
    }
  });

  it('指標全相同時分數相同且 deterministic', () => {
    const same = metrics({});
    const ranked = rankScenarios(
      [
        { algorithm: 'SPT', metrics: same },
        { algorithm: 'EDD', metrics: same },
      ],
      'BALANCED',
    );
    expect(ranked[0]?.score).toBe(ranked[1]?.score);
    expect(ranked[0]?.algorithm).toBe('EDD'); // 同分依字母序
  });
});
