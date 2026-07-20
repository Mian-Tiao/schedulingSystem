/**
 * 甘特圖狀態:目前任務快照 + undo / redo 歷史。
 * 每次成功套用調整後 push 一筆快照;undo/redo 僅在前端切換快照,
 * 並以「重新套用該快照對應的調整」與後端同步(由頁面層處理)。
 */
import { create } from 'zustand';
import type { Task } from '../types';

export interface AdjustmentRecord {
  taskId: string;
  machineId: string;
  startTime: string;
}

interface GanttState {
  /** 歷史快照(index 0 = 原始排程) */
  history: { tasks: Task[]; adjustment: AdjustmentRecord | null }[];
  /** 目前指向的歷史位置 */
  cursor: number;
  init: (tasks: Task[]) => void;
  pushSnapshot: (tasks: Task[], adjustment: AdjustmentRecord) => void;
  undo: () => Task[] | null;
  redo: () => Task[] | null;
  reset: (tasks: Task[]) => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  currentTasks: () => Task[] | null;
}

export const useGanttStore = create<GanttState>((set, get) => ({
  history: [],
  cursor: -1,

  init: (tasks) => set({ history: [{ tasks, adjustment: null }], cursor: 0 }),

  pushSnapshot: (tasks, adjustment) =>
    set((s) => {
      const kept = s.history.slice(0, s.cursor + 1);
      return { history: [...kept, { tasks, adjustment }], cursor: kept.length };
    }),

  undo: () => {
    const { history, cursor } = get();
    if (cursor <= 0) return null;
    const next = cursor - 1;
    set({ cursor: next });
    return history[next]?.tasks ?? null;
  },

  redo: () => {
    const { history, cursor } = get();
    if (cursor >= history.length - 1) return null;
    const next = cursor + 1;
    set({ cursor: next });
    return history[next]?.tasks ?? null;
  },

  reset: (tasks) => set({ history: [{ tasks, adjustment: null }], cursor: 0 }),

  canUndo: () => get().cursor > 0,
  canRedo: () => get().cursor < get().history.length - 1,
  currentTasks: () => get().history[get().cursor]?.tasks ?? null,
}));
