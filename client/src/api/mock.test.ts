import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tryMockRequest } from './mock';

function createStorage(): Storage {
  const values = new Map<string, string>();

  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

describe('tryMockRequest', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createStorage());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('does not intercept API requests by default', () => {
    expect(tryMockRequest('GET', '/api/products')).toEqual({ handled: false });
  });

  it('intercepts supported requests only when explicitly enabled', () => {
    vi.stubEnv('VITE_USE_MOCK', 'true');

    const result = tryMockRequest('GET', '/api/products');

    expect(result.handled).toBe(true);
    expect(Array.isArray(result.data)).toBe(true);
  });
});
