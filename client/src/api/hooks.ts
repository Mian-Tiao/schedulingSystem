/** TanStack Query hooks:所有 API 資料存取集中於此 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BomItem,
  ChangeoverRule,
  Dashboard,
  Downtime,
  Machine,
  ObjectiveId,
  Order,
  Product,
  ScenarioDetail,
  ScenarioSummary,
  ValidateAdjustmentResult,
} from '../types';
import { apiDelete, apiGet, apiPost, apiPut } from './client';

// ---- Products ----
export const useProducts = () => useQuery({ queryKey: ['products'], queryFn: () => apiGet<Product[]>('/api/products') });

export function useProductMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['products'] });
  return {
    create: useMutation({ mutationFn: (b: Partial<Product>) => apiPost('/api/products', b), onSuccess: invalidate }),
    update: useMutation({
      mutationFn: ({ id, ...b }: Partial<Product> & { id: string }) => apiPut(`/api/products/${id}`, b),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: (id: string) => apiDelete(`/api/products/${id}`), onSuccess: invalidate }),
  };
}

// ---- Machines ----
export const useMachines = () => useQuery({ queryKey: ['machines'], queryFn: () => apiGet<Machine[]>('/api/machines') });

export function useMachineMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['machines'] });
  return {
    create: useMutation({ mutationFn: (b: unknown) => apiPost('/api/machines', b), onSuccess: invalidate }),
    update: useMutation({
      mutationFn: ({ id, body }: { id: string; body: unknown }) => apiPut(`/api/machines/${id}`, body),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: (id: string) => apiDelete(`/api/machines/${id}`), onSuccess: invalidate }),
    addDowntime: useMutation({
      mutationFn: ({ machineId, body }: { machineId: string; body: unknown }) =>
        apiPost<Downtime>(`/api/machines/${machineId}/downtimes`, body),
      onSuccess: invalidate,
    }),
    removeDowntime: useMutation({
      mutationFn: ({ machineId, downtimeId }: { machineId: string; downtimeId: string }) =>
        apiDelete(`/api/machines/${machineId}/downtimes/${downtimeId}`),
      onSuccess: invalidate,
    }),
  };
}

// ---- Changeover rules ----
export const useChangeoverRules = () =>
  useQuery({ queryKey: ['changeover'], queryFn: () => apiGet<ChangeoverRule[]>('/api/changeover-rules') });

export function useChangeoverMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['changeover'] });
  return {
    create: useMutation({ mutationFn: (b: unknown) => apiPost('/api/changeover-rules', b), onSuccess: invalidate }),
    remove: useMutation({ mutationFn: (id: string) => apiDelete(`/api/changeover-rules/${id}`), onSuccess: invalidate }),
  };
}

// ---- Orders ----
export const useOrders = (filters?: Record<string, string>) => {
  const qs = filters ? `?${new URLSearchParams(Object.entries(filters).filter(([, v]) => v))}` : '';
  return useQuery({ queryKey: ['orders', qs], queryFn: () => apiGet<Order[]>(`/api/orders${qs}`) });
};

export function useOrderMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['orders'] });
  return {
    create: useMutation({ mutationFn: (b: unknown) => apiPost('/api/orders', b), onSuccess: invalidate }),
    update: useMutation({
      mutationFn: ({ id, body }: { id: string; body: unknown }) => apiPut(`/api/orders/${id}`, body),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: (id: string) => apiDelete(`/api/orders/${id}`), onSuccess: invalidate }),
    duplicate: useMutation({ mutationFn: (id: string) => apiPost(`/api/orders/${id}/duplicate`), onSuccess: invalidate }),
    importCsv: useMutation({
      mutationFn: (csv: string) =>
        apiPost<{ imported: number; failed: number; results: { line: number; orderNumber: string; ok: boolean; error?: string }[] }>(
          '/api/orders/import',
          { csv },
        ),
      onSuccess: invalidate,
    }),
  };
}

// ---- Schedules ----
export const useScenarios = () =>
  useQuery({ queryKey: ['scenarios'], queryFn: () => apiGet<ScenarioSummary[]>('/api/schedules') });

export const useScenarioDetail = (scenarioId: string | null) =>
  useQuery({
    queryKey: ['scenario', scenarioId],
    queryFn: () => apiGet<ScenarioDetail>(`/api/schedules/${scenarioId}`),
    enabled: Boolean(scenarioId),
  });

export interface GenerateResult {
  batchId: string;
  anchorTime: string;
  issues: { level: string; code: string; message: string }[];
  scenarios: ScenarioSummary[];
  recommended: string[];
}

export interface GeneratePayload {
  objective: ObjectiveId;
  machineIds?: string[];
}

export function useScheduleMutations() {
  const qc = useQueryClient();
  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['scenarios'] });
    qc.invalidateQueries({ queryKey: ['scenario'] });
    qc.invalidateQueries({ queryKey: ['orders'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
  return {
    generate: useMutation({
      mutationFn: (payload: GeneratePayload) => apiPost<GenerateResult>('/api/schedules/generate', payload),
      onSuccess: invalidateAll,
    }),
    validateAdjustment: useMutation({
      mutationFn: ({ scenarioId, ...body }: { scenarioId: string; taskId: string; machineId: string; startTime: string }) =>
        apiPost<ValidateAdjustmentResult>(`/api/schedules/${scenarioId}/validate-adjustment`, body),
    }),
    adjust: useMutation({
      mutationFn: ({ scenarioId, ...body }: { scenarioId: string; taskId: string; machineId: string; startTime: string }) =>
        apiPost<ScenarioDetail & { warnings: string[] }>(`/api/schedules/${scenarioId}/adjust`, body),
      onSuccess: invalidateAll,
    }),
    reset: useMutation({
      mutationFn: (scenarioId: string) => apiPost<ScenarioDetail>(`/api/schedules/${scenarioId}/reset`),
      onSuccess: invalidateAll,
    }),
  };
}

// ---- Dashboard ----
export const useDashboard = () =>
  useQuery({ queryKey: ['dashboard'], queryFn: () => apiGet<Dashboard>('/api/dashboard') });

// ---- AI ----
export const useAiStatus = () =>
  useQuery({ queryKey: ['ai-status'], queryFn: () => apiGet<{ enabled: boolean }>('/api/ai/status') });

// ---- BOM ----
export const useBom = (productId: string | null) =>
  useQuery({
    queryKey: ['bom', productId],
    queryFn: () => apiGet<BomItem[]>(`/api/products/${productId}/bom`),
    enabled: Boolean(productId),
  });

export function useBomMutations(productId: string | null) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['bom', productId] });
  return {
    create: useMutation({
      mutationFn: (body: Omit<BomItem, 'id' | 'productId'>) =>
        apiPost<BomItem>(`/api/products/${productId}/bom`, body),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, ...body }: Omit<BomItem, 'productId'>) =>
        apiPut<BomItem>(`/api/products/${productId}/bom/${id}`, body),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) => apiDelete(`/api/products/${productId}/bom/${id}`),
      onSuccess: invalidate,
    }),
  };
}

