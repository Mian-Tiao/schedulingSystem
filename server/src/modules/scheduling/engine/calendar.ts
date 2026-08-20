/**
 * 機台可用時間計算(pure functions)。
 * 工作時段以 Asia/Taipei(UTC+8,無日光節約)解讀,運算使用 epoch ms。
 */
import type { DaySegment, Machine, MachineDowntime, WorkingHours } from './types.js';

export interface TimeInterval {
  start: number;
  end: number;
}

const TAIPEI_OFFSET_MS = 8 * 3600_000;
const DAY_MS = 24 * 3600_000;

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

function parseHm(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return ((h ?? 0) * 60 + (m ?? 0)) * 60_000;
}

/**
 * 將每週工作時段表展開為 [from, to) 期間內的具體時段(epoch ms)。
 */
export function expandWorkingWindows(
  workingHours: WorkingHours,
  fromMs: number,
  toMs: number,
): TimeInterval[] {
  const windows: TimeInterval[] = [];
  // 以台北時間為基準,找出 from 當天 00:00(台北)
  const firstLocalDayStart = Math.floor((fromMs + TAIPEI_OFFSET_MS) / DAY_MS) * DAY_MS - TAIPEI_OFFSET_MS;
  for (let dayStart = firstLocalDayStart; dayStart < toMs; dayStart += DAY_MS) {
    const weekday = new Date(dayStart + TAIPEI_OFFSET_MS).getUTCDay();
    const key = WEEKDAY_KEYS[weekday] as keyof WorkingHours;
    const segments: DaySegment[] = workingHours[key] ?? [];
    for (const seg of segments) {
      const start = dayStart + parseHm(seg.start);
      const end = dayStart + parseHm(seg.end);
      if (end <= start) continue;
      if (end <= fromMs || start >= toMs) continue;
      windows.push({ start: Math.max(start, fromMs), end: Math.min(end, toMs) });
    }
  }
  return mergeIntervals(windows);
}

/** 合併重疊/相鄰時段,並依開始時間排序 */
export function mergeIntervals(intervals: TimeInterval[]): TimeInterval[] {
  const sorted = [...intervals].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: TimeInterval[] = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv.start <= last.end) {
      last.end = Math.max(last.end, iv.end);
    } else {
      out.push({ ...iv });
    }
  }
  return out;
}

/** 從 windows 中扣除 blockers,回傳剩餘可用時段 */
export function subtractIntervals(
  windows: TimeInterval[],
  blockers: TimeInterval[],
): TimeInterval[] {
  const blocks = mergeIntervals(blockers);
  const out: TimeInterval[] = [];
  for (const w of windows) {
    let cursor = w.start;
    for (const b of blocks) {
      if (b.end <= cursor) continue;
      if (b.start >= w.end) break;
      if (b.start > cursor) out.push({ start: cursor, end: Math.min(b.start, w.end) });
      cursor = Math.max(cursor, b.end);
      if (cursor >= w.end) break;
    }
    if (cursor < w.end) out.push({ start: cursor, end: w.end });
  }
  return out.filter((iv) => iv.end > iv.start);
}

/**
 * 計算機台在 [from, to) 的可用時段:工作時段 - 停機時段 - 已占用時段。
 */
export function machineAvailability(
  machine: Machine,
  downtimes: MachineDowntime[],
  busy: TimeInterval[],
  fromMs: number,
  toMs: number,
): TimeInterval[] {
  const windows = expandWorkingWindows(machine.workingHours, fromMs, toMs);
  const blockers: TimeInterval[] = [
    ...downtimes
      .filter((d) => d.machineId === machine.id)
      .map((d) => ({ start: d.startTime, end: d.endTime })),
    ...busy,
  ];
  return subtractIntervals(windows, blockers);
}

/**
 * 在可用時段中找出最早能連續容納 duration 的時間點(non-preemptive)。
 * 回傳 null 表示規劃期間內找不到。
 */
export function findSlot(
  availability: TimeInterval[],
  earliest: number,
  durationMs: number,
): TimeInterval | null {
  if (durationMs <= 0) {
    // 零長度任務:直接回傳最早可用時間點
    for (const w of availability) {
      const start = Math.max(w.start, earliest);
      if (start <= w.end) return { start, end: start };
    }
    return null;
  }
  for (const w of availability) {
    const start = Math.max(w.start, earliest);
    if (start + durationMs <= w.end) return { start, end: start + durationMs };
  }
  return null;
}

/**
 * 從多個可用時段依序配置可分段的 production 工時。
 * 休息、下班、維護或既有任務會形成自然斷點；總工時仍須在規劃期間內完成。
 */
export function findSlots(
  availability: TimeInterval[],
  earliest: number,
  durationMs: number,
): TimeInterval[] | null {
  if (durationMs <= 0) {
    const slot = findSlot(availability, earliest, 0);
    return slot ? [slot] : null;
  }

  let remaining = durationMs;
  const slots: TimeInterval[] = [];
  for (const window of availability) {
    const start = Math.max(window.start, earliest);
    if (start >= window.end) continue;
    const allocated = Math.min(remaining, window.end - start);
    slots.push({ start, end: start + allocated });
    remaining -= allocated;
    if (remaining <= 0) return slots;
  }
  return null;
}

/** 機台在期間內的總可用分鐘數(工作時段 - 停機),不扣已占用 */
export function machineCapacityMinutes(
  machine: Machine,
  downtimes: MachineDowntime[],
  fromMs: number,
  toMs: number,
): number {
  const avail = machineAvailability(machine, downtimes, [], fromMs, toMs);
  return avail.reduce((sum, iv) => sum + (iv.end - iv.start), 0) / 60_000;
}
