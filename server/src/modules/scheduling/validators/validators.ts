/**
 * 排程前資料合法性檢查,回傳繁體中文錯誤訊息。
 */
import { eligibleMachines } from '../engine/engine.js';
import type { SchedulingInput } from '../engine/types.js';

export interface ValidationIssue {
  level: 'error' | 'warning';
  code: string;
  message: string;
}

export function validateSchedulingInput(input: SchedulingInput): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (input.orders.length === 0) {
    issues.push({ level: 'error', code: 'NO_ORDERS', message: '沒有待排程的訂單' });
  }
  const activeMachines = input.machines.filter((m) => m.status !== 'disabled');
  if (activeMachines.length === 0) {
    issues.push({ level: 'error', code: 'NO_MACHINES', message: '沒有可用的機台(全部停用)' });
  }

  for (const m of activeMachines) {
    const hasWorking = Object.values(m.workingHours).some((segs) => segs.length > 0);
    if (!hasWorking) {
      issues.push({
        level: 'warning',
        code: 'MACHINE_NO_WORKING_HOURS',
        message: `機台 ${m.machineName}(${m.machineCode})沒有設定任何工作時段,將無法安排工作`,
      });
    }
    for (const [day, segs] of Object.entries(m.workingHours)) {
      for (const seg of segs) {
        if (seg.end <= seg.start) {
          issues.push({
            level: 'error',
            code: 'INVALID_WORKING_HOURS',
            message: `機台 ${m.machineName} 的 ${day} 工作時段結束時間必須晚於開始時間(${seg.start}~${seg.end})`,
          });
        }
      }
    }
  }

  for (const d of input.downtimes) {
    if (d.endTime <= d.startTime) {
      issues.push({
        level: 'error',
        code: 'INVALID_DOWNTIME',
        message: `停機時段結束時間必須晚於開始時間(${new Date(d.startTime).toISOString()})`,
      });
    }
  }

  for (const o of input.orders) {
    if (o.processingTime <= 0) {
      issues.push({
        level: 'error',
        code: 'INVALID_PROCESSING_TIME',
        message: `訂單 ${o.orderNumber} 的加工時間必須大於零`,
      });
    }
    if (o.dueDate < o.releaseTime) {
      issues.push({
        level: 'error',
        code: 'DUE_BEFORE_RELEASE',
        message: `訂單 ${o.orderNumber} 的交期早於可開始生產時間`,
      });
    }
    if (eligibleMachines(o, input.machines).length === 0) {
      issues.push({
        level: 'warning',
        code: 'NO_ELIGIBLE_MACHINE',
        message: `訂單 ${o.orderNumber} 沒有可加工的機台(請確認機台可加工產品設定)`,
      });
    }
  }

  return issues;
}
