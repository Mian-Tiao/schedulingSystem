/** API 呼叫封裝:統一錯誤格式解析 */

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

async function handle<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const err = (body as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    throw new ApiError(
      err?.code ?? 'UNKNOWN',
      err?.message ?? `伺服器發生錯誤(HTTP ${res.status})`,
      res.status,
      err?.details,
    );
  }
  return body as T;
}

import { tryMockRequest } from './mock';

export async function apiGet<T>(url: string): Promise<T> {
  try {
    const { handled, data } = tryMockRequest('GET', url);
    if (handled) return data as T;
  } catch (e: any) {
    throw new ApiError('MOCK_ERROR', e.message, 400);
  }
  return handle(await fetch(url));
}

export async function apiSend<T>(method: string, url: string, body?: unknown): Promise<T> {
  try {
    const { handled, data } = tryMockRequest(method, url, body);
    if (handled) return data as T;
  } catch (e: any) {
    throw new ApiError('MOCK_ERROR', e.message, 400);
  }
  return handle(
    await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

export const apiPost = <T,>(url: string, body?: unknown) => apiSend<T>('POST', url, body);
export const apiPut = <T,>(url: string, body?: unknown) => apiSend<T>('PUT', url, body);
export const apiDelete = <T,>(url: string) => apiSend<T>('DELETE', url);

