/**
 * 換模(setup)與清洗(cleaning)時間查找。
 * 查找順序(ASSUMPTIONS #11):
 *   1. 精確規則:machineId + fromProductId + toProductId
 *   2. 機台通用:machineId + toProductId(fromProductId = null)
 *   3. 全域規則:machineId = null + fromProductId + toProductId
 *   4. 機台預設:defaultSetupTime / defaultCleaningTime
 * 同產品連續生產不需換模與清洗;空機(fromProductId = null)若無明確規則亦不需。
 */
import type { ChangeoverRule, Machine } from './types.js';

export interface ChangeoverTime {
  setupMinutes: number;
  cleaningMinutes: number;
}

export function resolveChangeover(
  machine: Machine,
  fromProductId: string | null,
  toProductId: string,
  rules: ChangeoverRule[],
): ChangeoverTime {
  if (fromProductId === toProductId && fromProductId !== null) {
    return { setupMinutes: 0, cleaningMinutes: 0 };
  }

  const exact = rules.find(
    (r) => r.machineId === machine.id && r.fromProductId === fromProductId && r.toProductId === toProductId,
  );
  if (exact) return pick(exact);

  const machineGeneric = rules.find(
    (r) => r.machineId === machine.id && r.fromProductId === null && r.toProductId === toProductId,
  );
  if (machineGeneric && fromProductId !== null) return pick(machineGeneric);
  if (machineGeneric && fromProductId === null) return pick(machineGeneric);

  const global = rules.find(
    (r) => r.machineId === null && r.fromProductId === fromProductId && r.toProductId === toProductId,
  );
  if (global) return pick(global);

  // 空機首單:無明確規則時不加換模/清洗
  if (fromProductId === null) {
    return { setupMinutes: 0, cleaningMinutes: 0 };
  }

  return { setupMinutes: machine.defaultSetupTime, cleaningMinutes: machine.defaultCleaningTime };
}

function pick(rule: ChangeoverRule): ChangeoverTime {
  return { setupMinutes: rule.setupMinutes, cleaningMinutes: rule.cleaningMinutes };
}
