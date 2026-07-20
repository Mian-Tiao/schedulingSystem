import { describe, expect, it } from 'vitest';
import {
  expandWorkingWindows,
  findSlot,
  machineAvailability,
  machineCapacityMinutes,
  mergeIntervals,
  subtractIntervals,
} from '../engine/calendar.js';
import { downtime, FULL_DAY, machine, t, WITH_LUNCH } from './fixtures.js';

describe('expandWorkingWindows', () => {
  it('依台北時區展開每日工作時段', () => {
    const windows = expandWorkingWindows(FULL_DAY, t('2026-08-10 00:00'), t('2026-08-11 00:00'));
    // 2026-08-10 是週一
    expect(windows).toEqual([{ start: t('2026-08-10 08:00'), end: t('2026-08-10 17:00') }]);
  });

  it('週末無工作時段', () => {
    const windows = expandWorkingWindows(FULL_DAY, t('2026-08-08 00:00'), t('2026-08-10 00:00'));
    // 08-08 週六、08-09 週日
    expect(windows).toEqual([]);
  });

  it('午休以兩段時段表達', () => {
    const windows = expandWorkingWindows(WITH_LUNCH, t('2026-08-10 00:00'), t('2026-08-11 00:00'));
    expect(windows).toEqual([
      { start: t('2026-08-10 08:00'), end: t('2026-08-10 12:00') },
      { start: t('2026-08-10 13:00'), end: t('2026-08-10 17:00') },
    ]);
  });

  it('裁切至查詢範圍', () => {
    const windows = expandWorkingWindows(FULL_DAY, t('2026-08-10 10:00'), t('2026-08-10 11:00'));
    expect(windows).toEqual([{ start: t('2026-08-10 10:00'), end: t('2026-08-10 11:00') }]);
  });
});

describe('mergeIntervals / subtractIntervals', () => {
  it('合併重疊時段', () => {
    expect(
      mergeIntervals([
        { start: 10, end: 20 },
        { start: 15, end: 30 },
        { start: 40, end: 50 },
      ]),
    ).toEqual([
      { start: 10, end: 30 },
      { start: 40, end: 50 },
    ]);
  });

  it('扣除中段', () => {
    expect(subtractIntervals([{ start: 0, end: 100 }], [{ start: 30, end: 40 }])).toEqual([
      { start: 0, end: 30 },
      { start: 40, end: 100 },
    ]);
  });

  it('扣除完全覆蓋', () => {
    expect(subtractIntervals([{ start: 10, end: 20 }], [{ start: 0, end: 30 }])).toEqual([]);
  });
});

describe('findSlot', () => {
  const avail = [
    { start: 100, end: 200 },
    { start: 300, end: 500 },
  ];
  it('找到最早可容納時段', () => {
    expect(findSlot(avail, 0, 50)).toEqual({ start: 100, end: 150 });
  });
  it('第一段放不下時跳到下一段(non-preemptive)', () => {
    expect(findSlot(avail, 0, 150)).toEqual({ start: 300, end: 450 });
  });
  it('earliest 之後才開始', () => {
    expect(findSlot(avail, 150, 40)).toEqual({ start: 150, end: 190 });
  });
  it('放不下回傳 null', () => {
    expect(findSlot(avail, 0, 500)).toBeNull();
  });
});

describe('machineAvailability', () => {
  it('扣除停機與已占用時段', () => {
    const m = machine({ id: 'mx', workingHours: FULL_DAY });
    const avail = machineAvailability(
      m,
      [downtime({ machineId: 'mx', startTime: t('2026-08-10 09:00'), endTime: t('2026-08-10 10:00') })],
      [{ start: t('2026-08-10 13:00'), end: t('2026-08-10 14:00') }],
      t('2026-08-10 00:00'),
      t('2026-08-11 00:00'),
    );
    expect(avail).toEqual([
      { start: t('2026-08-10 08:00'), end: t('2026-08-10 09:00') },
      { start: t('2026-08-10 10:00'), end: t('2026-08-10 13:00') },
      { start: t('2026-08-10 14:00'), end: t('2026-08-10 17:00') },
    ]);
  });

  it('capacity 計算正確', () => {
    const m = machine({ id: 'my', workingHours: FULL_DAY });
    const cap = machineCapacityMinutes(
      m,
      [downtime({ machineId: 'my', startTime: t('2026-08-10 09:00'), endTime: t('2026-08-10 10:00') })],
      t('2026-08-10 00:00'),
      t('2026-08-11 00:00'),
    );
    expect(cap).toBe(8 * 60); // 9 小時 - 1 小時停機
  });
});
