import { describe, expect, it } from 'vitest';
import { resolveChangeover } from '../engine/changeover.js';
import { changeoverRule, machine } from './fixtures.js';

describe('resolveChangeover', () => {
  const m = machine({ id: 'm1', defaultSetupTime: 15, defaultCleaningTime: 5 });

  it('同產品連續生產不需換模/清洗', () => {
    expect(resolveChangeover(m, 'pA', 'pA', [])).toEqual({ setupMinutes: 0, cleaningMinutes: 0 });
  });

  it('精確規則優先', () => {
    const rules = [
      changeoverRule({ machineId: 'm1', fromProductId: 'pA', toProductId: 'pB', setupMinutes: 30, cleaningMinutes: 20 }),
      changeoverRule({ machineId: null, fromProductId: 'pA', toProductId: 'pB', setupMinutes: 99, cleaningMinutes: 99 }),
    ];
    expect(resolveChangeover(m, 'pA', 'pB', rules)).toEqual({ setupMinutes: 30, cleaningMinutes: 20 });
  });

  it('無精確規則時採全域規則', () => {
    const rules = [
      changeoverRule({ machineId: null, fromProductId: 'pA', toProductId: 'pB', setupMinutes: 40, cleaningMinutes: 10 }),
    ];
    expect(resolveChangeover(m, 'pA', 'pB', rules)).toEqual({ setupMinutes: 40, cleaningMinutes: 10 });
  });

  it('無任何規則時採機台預設', () => {
    expect(resolveChangeover(m, 'pA', 'pB', [])).toEqual({ setupMinutes: 15, cleaningMinutes: 5 });
  });

  it('空機首單無規則時不加換模', () => {
    expect(resolveChangeover(m, null, 'pB', [])).toEqual({ setupMinutes: 0, cleaningMinutes: 0 });
  });

  it('空機首單有明確規則時採規則', () => {
    const rules = [
      changeoverRule({ machineId: 'm1', fromProductId: null, toProductId: 'pB', setupMinutes: 10, cleaningMinutes: 0 }),
    ];
    expect(resolveChangeover(m, null, 'pB', rules)).toEqual({ setupMinutes: 10, cleaningMinutes: 0 });
  });
});
