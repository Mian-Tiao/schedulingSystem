import { beforeEach, describe, expect, it } from 'vitest';
import { useGanttStore } from './ganttStore';
import type { Task } from '../types';

function task(id: string): Task {
  return {
    taskId: id,
    orderId: 'o1',
    machineId: 'm1',
    taskType: 'production',
    startTime: '2026-08-10T00:00:00.000Z',
    endTime: '2026-08-10T01:00:00.000Z',
    sequence: 1,
    isManuallyAdjusted: false,
  };
}

describe('ganttStore undo/redo', () => {
  beforeEach(() => {
    useGanttStore.getState().init([task('a')]);
  });

  it('初始狀態不可 undo/redo', () => {
    const s = useGanttStore.getState();
    expect(s.canUndo()).toBe(false);
    expect(s.canRedo()).toBe(false);
  });

  it('push 後可 undo 回到前一版,redo 回到新版', () => {
    const s = useGanttStore.getState();
    s.pushSnapshot([task('b')], { taskId: 'b', machineId: 'm1', startTime: 'x' });
    expect(useGanttStore.getState().canUndo()).toBe(true);

    const undone = useGanttStore.getState().undo();
    expect(undone?.[0]?.taskId).toBe('a');
    expect(useGanttStore.getState().canRedo()).toBe(true);

    const redone = useGanttStore.getState().redo();
    expect(redone?.[0]?.taskId).toBe('b');
  });

  it('undo 後再 push 會截斷 redo 分支', () => {
    const s = useGanttStore.getState();
    s.pushSnapshot([task('b')], { taskId: 'b', machineId: 'm1', startTime: 'x' });
    useGanttStore.getState().undo();
    useGanttStore.getState().pushSnapshot([task('c')], { taskId: 'c', machineId: 'm1', startTime: 'y' });
    expect(useGanttStore.getState().canRedo()).toBe(false);
    expect(useGanttStore.getState().currentTasks()?.[0]?.taskId).toBe('c');
  });

  it('reset 清空歷史', () => {
    const s = useGanttStore.getState();
    s.pushSnapshot([task('b')], { taskId: 'b', machineId: 'm1', startTime: 'x' });
    useGanttStore.getState().reset([task('a')]);
    expect(useGanttStore.getState().canUndo()).toBe(false);
    expect(useGanttStore.getState().currentTasks()?.[0]?.taskId).toBe('a');
  });
});
