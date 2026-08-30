import { useEffect, useMemo, useState } from 'react';
import { ApiError } from '../api/client';
import { useMachines, useOrderMutations, useOrders, useProducts } from '../api/hooks';
import {
  Badge,
  Banner,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  inputCls,
  Loading,
  Modal,
  PageHeader,
  PageMetrics,
} from '../components/ui';
import type { Order } from '../types';
import { PRIORITY_LABELS } from '../types';
import { fmtDateTime, fmtMinutes, fromLocalInput, toLocalInput } from '../utils/time';

interface FormState {
  id?: string;
  orderNumber: string;
  productId: string;
  quantity: string;
  releaseTime: string;
  dueDate: string;
  processingTime: string;
  priority: string;
  eligibleMachineIds: string[];
  notes: string;
  status: string;
}

function defaultForm(productId: string): FormState {
  const now = new Date();
  const in3days = new Date(now.getTime() + 3 * 86400_000);
  return {
    orderNumber: `PO-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-`,
    productId,
    quantity: '10',
    releaseTime: toLocalInput(now),
    dueDate: toLocalInput(in3days),
    processingTime: '',
    priority: '3',
    eligibleMachineIds: [],
    notes: '',
    status: 'pending',
  };
}

export function OrdersPage() {
  const [filters, setFilters] = useState({ search: '', productId: '', status: '', priority: '' });
  const { data: orders, isLoading, error } = useOrders(filters);
  const { data: products } = useProducts();
  const { data: machines } = useMachines();
  const { create, update, remove, removeMany, duplicate, importCsv, updateStatus } = useOrderMutations();

  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState('');
  const [deleting, setDeleting] = useState<Order | null>(null);
  const [deletingCompleted, setDeletingCompleted] = useState(false);
  const [csvOpen, setCsvOpen] = useState(false);
  const [csvText, setCsvText] = useState('');
  const [csvResult, setCsvResult] = useState<{ imported: number; failed: number; results: { line: number; orderNumber: string; ok: boolean; error?: string }[] } | null>(null);
  const [sortKey, setSortKey] = useState<'dueDate' | 'orderNumber' | 'priority'>('dueDate');

  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

  useEffect(() => {
    if (!activeMenuId) return;
    const onClick = () => setActiveMenuId(null);
    window.addEventListener('click', onClick);
    return () => window.removeEventListener('click', onClick);
  }, [activeMenuId]);

  const productById = useMemo(() => new Map((products ?? []).map((p) => [p.id, p])), [products]);

  const sorted = useMemo(() => {
    const list = [...(orders ?? [])];
    list.sort((a, b) => {
      if (sortKey === 'dueDate') return a.dueDate.localeCompare(b.dueDate);
      if (sortKey === 'priority') return a.priority - b.priority;
      return a.orderNumber.localeCompare(b.orderNumber);
    });
    return list;
  }, [orders, sortKey]);

  const save = async () => {
    if (!form) return;
    setFormError('');
    const body = {
      orderNumber: form.orderNumber.trim(),
      productId: form.productId,
      quantity: Number(form.quantity),
      releaseTime: fromLocalInput(form.releaseTime),
      dueDate: fromLocalInput(form.dueDate),
      processingTime: form.processingTime ? Number(form.processingTime) : null,
      priority: Number(form.priority),
      eligibleMachineIds: form.eligibleMachineIds,
      notes: form.notes.trim() || null,
      status: form.status,
    };
    try {
      if (form.id) await update.mutateAsync({ id: form.id, body });
      else await create.mutateAsync(body);
      setForm(null);
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : '儲存失敗,請稍後再試');
    }
  };

  if (isLoading) return <Loading />;
  if (error) return <ErrorState message={(error as Error).message} />;

  const product = form ? productById.get(form.productId) : null;
  const estimated = form && product && !form.processingTime ? Number(form.quantity || 0) * product.defaultProcessingTime : null;
  const pendingCount = (orders ?? []).filter((o) => o.status === 'pending').length;
  const activeCount = (orders ?? []).filter((o) => o.status === 'scheduled' || o.status === 'inProgress').length;
  const priorityCount = (orders ?? []).filter((o) => o.priority <= 2).length;
  const completedOrders = (orders ?? []).filter((o) => o.status === 'completed');

  return (
    <div className="orders-page space-y-5">
      <PageHeader
        eyebrow="ORDER PIPELINE"
        title="訂單管理"
        description="集中管理交期、優先級與可用機台，讓每張工單都有清楚的排程條件。"
        actions={
          <>
          <Button
            variant="secondary"
            onClick={() => setDeletingCompleted(true)}
            disabled={completedOrders.length === 0}
            title={completedOrders.length === 0 ? '目前沒有已完成訂單' : undefined}
          >
            一鍵刪除已完成訂單
          </Button>
          <Button variant="secondary" onClick={() => { setCsvOpen(true); setCsvResult(null); }}>
            匯入 CSV
          </Button>
          <Button
            onClick={() => setForm(defaultForm(products?.[0]?.id ?? ''))}
            disabled={!products || products.length === 0}
            title={!products || products.length === 0 ? '請先建立產品' : undefined}
          >
            + 新增訂單
          </Button>
          </>
        }
      />

      <PageMetrics
        items={[
          { label: '目前訂單', value: orders?.length ?? 0, detail: '系統內全部工單', tone: 'blue' },
          { label: '等待排程', value: pendingCount, detail: '尚未指派時段', tone: pendingCount > 0 ? 'amber' : 'default' },
          { label: '排程執行中', value: activeCount, detail: '已排程或生產中', tone: 'green' },
          { label: '高優先訂單', value: priorityCount, detail: '優先級 1–2', tone: priorityCount > 0 ? 'red' : 'default' },
        ]}
      />

      <div className="data-toolbar">
        <div className="toolbar-label">
          <span>FILTER</span>
          <strong>篩選與排序</strong>
        </div>
        <input
          className={`${inputCls} !w-48`}
          placeholder="搜尋訂單編號或備註"
          value={filters.search}
          onChange={(e) => setFilters({ ...filters, search: e.target.value })}
        />
        <select className={`${inputCls} !w-40`} value={filters.productId} onChange={(e) => setFilters({ ...filters, productId: e.target.value })}>
          <option value="">全部產品</option>
          {(products ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.productCode} {p.productName}
            </option>
          ))}
        </select>
        <select className={`${inputCls} !w-36`} value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
          <option value="">全部狀態</option>
          <option value="pending">尚未排程</option>
          <option value="scheduled">已排程</option>
          <option value="inProgress">生產中</option>
          <option value="completed">已完成</option>
          <option value="cancelled">已取消</option>
        </select>
        <select className={`${inputCls} !w-36`} value={filters.priority} onChange={(e) => setFilters({ ...filters, priority: e.target.value })}>
          <option value="">全部優先級</option>
          {[1, 2, 3, 4, 5].map((p) => (
            <option key={p} value={p}>
              優先級 {PRIORITY_LABELS[p]}
            </option>
          ))}
        </select>
        <select className={`${inputCls} !w-40`} value={sortKey} onChange={(e) => setSortKey(e.target.value as typeof sortKey)}>
          <option value="dueDate">依交期排序</option>
          <option value="orderNumber">依訂單編號排序</option>
          <option value="priority">依優先級排序</option>
        </select>
        <span className="toolbar-result">{sorted.length} 筆結果</span>
      </div>

      {sorted.length === 0 ? (
        <EmptyState text="沒有符合條件的訂單。" />
      ) : (
        <div className="data-table-card overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="data-table w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2.5">訂單編號</th>
                <th className="px-3 py-2.5">產品</th>
                <th className="px-3 py-2.5">數量</th>
                <th className="px-3 py-2.5">可開始時間</th>
                <th className="px-3 py-2.5">交期</th>
                <th className="px-3 py-2.5">加工時間</th>
                <th className="px-3 py-2.5">優先級</th>
                <th className="px-3 py-2.5">狀態</th>
                <th className="px-3 py-2.5 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sorted.map((o) => (
                <tr key={o.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 font-medium text-slate-700">
                    {o.orderNumber}
                    {o.notes && (
                      <span className="ml-1 cursor-help text-slate-400" title={o.notes}>
                        📝
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">{o.product ? `${o.product.productCode} ${o.product.productName}` : o.productId}</td>
                  <td className="px-3 py-2">{o.quantity}</td>
                  <td className="px-3 py-2 text-slate-500">{fmtDateTime(o.releaseTime)}</td>
                  <td className="px-3 py-2">{fmtDateTime(o.dueDate)}</td>
                  <td className="px-3 py-2">{fmtMinutes(o.processingTime)}</td>
                  <td className="px-3 py-2">
                    {o.priority <= 2 ? <Badge tone="red">{PRIORITY_LABELS[o.priority]}</Badge> : PRIORITY_LABELS[o.priority]}
                  </td>
                  <td className="px-3 py-2">
                    {o.status === 'pending' && <Badge tone="amber">尚未排程</Badge>}
                    {o.status === 'scheduled' && <Badge tone="green">已排程</Badge>}
                    {o.status === 'inProgress' && <Badge tone="blue">生產中</Badge>}
                    {o.status === 'completed' && <Badge tone="slate">已完成</Badge>}
                    {o.status === 'cancelled' && <Badge tone="slate">已取消</Badge>}
                  </td>
                  <td className="px-3 py-2 text-right relative overflow-visible">
                    <div className="inline-block text-left">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveMenuId(activeMenuId === o.id ? null : o.id);
                        }}
                        className="rounded border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors focus:outline-none"
                      >
                        操作 ▾
                      </button>

                      {activeMenuId === o.id && (
                        <div className="absolute right-3 mt-1 z-30 w-36 rounded-md border border-slate-200 bg-white py-1 shadow-lg text-left">
                          <button
                            className="block w-full px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 text-left"
                            onClick={() => {
                              setForm({
                                id: o.id,
                                orderNumber: o.orderNumber,
                                productId: o.productId,
                                quantity: String(o.quantity),
                                releaseTime: toLocalInput(o.releaseTime),
                                dueDate: toLocalInput(o.dueDate),
                                processingTime: String(o.processingTime),
                                priority: String(o.priority),
                                eligibleMachineIds: o.eligibleMachineIds,
                                notes: o.notes ?? '',
                                status: o.status,
                              });
                            }}
                          >
                            編輯訂單
                          </button>
                          <button
                            className="block w-full px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 text-left"
                            onClick={() => duplicate.mutate(o.id)}
                          >
                            複製訂單
                          </button>
                          <button
                            className="block w-full px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 text-left font-medium"
                            onClick={() => setDeleting(o)}
                          >
                            刪除訂單
                          </button>

                          <div className="my-1 border-t border-slate-100" />

                          {(o.status === 'pending' || o.status === 'scheduled') && (
                            <>
                              <button
                                className="block w-full px-3 py-1.5 text-xs text-blue-600 hover:bg-slate-50 text-left"
                                onClick={() => updateStatus.mutate({ id: o.id, status: 'inProgress' })}
                              >
                                開始生產
                              </button>
                              <button
                                className="block w-full px-3 py-1.5 text-xs text-green-600 hover:bg-slate-50 text-left"
                                onClick={() => updateStatus.mutate({ id: o.id, status: 'completed' })}
                              >
                                標記為已完成
                              </button>
                              <button
                                className="block w-full px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-50 text-left"
                                onClick={() => updateStatus.mutate({ id: o.id, status: 'cancelled' })}
                              >
                                取消訂單
                              </button>
                            </>
                          )}

                          {o.status === 'inProgress' && (
                            <>
                              <button
                                className="block w-full px-3 py-1.5 text-xs text-green-600 hover:bg-slate-50 text-left"
                                onClick={() => updateStatus.mutate({ id: o.id, status: 'completed' })}
                              >
                                標記為已完成
                              </button>
                              <button
                                className="block w-full px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-50 text-left"
                                onClick={() => updateStatus.mutate({ id: o.id, status: 'cancelled' })}
                              >
                                取消訂單
                              </button>
                            </>
                          )}

                          {(o.status === 'completed' || o.status === 'cancelled') && (
                            <button
                              className="block w-full px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 text-left"
                              onClick={() => updateStatus.mutate({ id: o.id, status: 'pending' })}
                            >
                              重設為未排程
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 新增/編輯表單 */}
      <Modal title={form?.id ? '編輯訂單' : '新增訂單'} open={Boolean(form)} onClose={() => setForm(null)} wide>
        {form && (
          <div className="space-y-3">
            {formError && <ErrorState message={formError} />}
            <div className="grid grid-cols-2 gap-3">
              <Field label="訂單編號" required hint="例如 PO-20260810-001,不可重複">
                <input className={inputCls} value={form.orderNumber} onChange={(e) => setForm({ ...form, orderNumber: e.target.value })} />
              </Field>
              <Field label="產品" required>
                <select className={inputCls} value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value, eligibleMachineIds: [] })}>
                  {(products ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.productCode} {p.productName}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="數量" required>
                <input type="number" min="1" className={inputCls} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
              </Field>
              <Field
                label="預估加工時間(分鐘)"
                hint={estimated !== null ? `留空時自動計算:${form.quantity} × ${product?.defaultProcessingTime} = ${estimated} 分鐘` : '留空時依產品預設值計算'}
              >
                <input type="number" min="1" className={inputCls} value={form.processingTime} onChange={(e) => setForm({ ...form, processingTime: e.target.value })} placeholder="留空自動計算" />
              </Field>
              <Field label="可開始生產時間" required>
                <input type="datetime-local" className={inputCls} value={form.releaseTime} onChange={(e) => setForm({ ...form, releaseTime: e.target.value })} />
              </Field>
              <Field label="交期" required>
                <input type="datetime-local" className={inputCls} value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
              </Field>
              <Field label="優先級" hint="1 最高、5 最低;同條件時優先安排高優先級">
                <select className={inputCls} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                  {[1, 2, 3, 4, 5].map((p) => (
                    <option key={p} value={p}>
                      {PRIORITY_LABELS[p]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="可使用機台" hint="不勾選 = 所有支援此產品的機台皆可">
                <div className="flex flex-wrap gap-2 rounded-md border border-slate-200 p-2">
                  {(machines ?? [])
                    .filter((m) => m.supportedProductIds.includes(form.productId))
                    .map((m) => (
                      <label key={m.id} className="flex items-center gap-1 text-sm">
                        <input
                          type="checkbox"
                          checked={form.eligibleMachineIds.includes(m.id)}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              eligibleMachineIds: e.target.checked
                                ? [...form.eligibleMachineIds, m.id]
                                : form.eligibleMachineIds.filter((id) => id !== m.id),
                            })
                          }
                        />
                        {m.machineCode}
                      </label>
                    ))}
                  {(machines ?? []).filter((m) => m.supportedProductIds.includes(form.productId)).length === 0 && (
                    <span className="text-xs text-amber-600">⚠️ 尚無機台支援此產品,排程時會被擋下</span>
                  )}
                </div>
              </Field>
            </div>
            <Field label="備註">
              <input className={inputCls} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setForm(null)}>
                取消
              </Button>
              <Button onClick={save} disabled={create.isPending || update.isPending}>
                {create.isPending || update.isPending ? '儲存中…' : '儲存'}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* CSV 匯入 */}
      <Modal title="批次匯入訂單(CSV)" open={csvOpen} onClose={() => setCsvOpen(false)} wide>
        <div className="space-y-3">
          <Banner tone="info">
            第一列為標題,必要欄位:orderNumber, productCode, quantity, releaseTime, dueDate;
            選填:processingTime, priority, eligibleMachineCodes(以分號分隔), notes。時間格式:2026-08-10T08:00:00+08:00
          </Banner>
          <div className="flex items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
              選擇 CSV 檔案
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = () => {
                    setCsvText(typeof reader.result === 'string' ? reader.result : '');
                    setCsvResult(null);
                  };
                  reader.readAsText(file);
                  e.target.value = '';
                }}
              />
            </label>
            <span className="text-xs text-slate-500">或直接把內容貼到下方欄位</span>
          </div>
          <textarea
            className={`${inputCls} h-40 font-mono text-xs`}
            placeholder={'orderNumber,productCode,quantity,releaseTime,dueDate,processingTime,priority\nPO-100,P-A,20,2026-08-10T08:00:00+08:00,2026-08-12T17:00:00+08:00,,3'}
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
          />
          {csvResult && (
            <div>
              <Banner tone={csvResult.failed === 0 ? 'success' : 'warn'}>
                成功匯入 {csvResult.imported} 筆,失敗 {csvResult.failed} 筆
              </Banner>
              {csvResult.results
                .filter((r) => !r.ok)
                .map((r) => (
                  <p key={r.line} className="text-xs text-red-600">
                    第 {r.line} 列({r.orderNumber || '無編號'}):{r.error}
                  </p>
                ))}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCsvOpen(false)}>
              關閉
            </Button>
            <Button
              onClick={async () => {
                try {
                  setCsvResult(await importCsv.mutateAsync(csvText));
                } catch (e) {
                  alert(e instanceof ApiError ? e.message : '匯入失敗');
                }
              }}
              disabled={!csvText.trim() || importCsv.isPending}
            >
              {importCsv.isPending ? '匯入中…' : '開始匯入'}
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleting)}
        title="刪除訂單"
        message={`確定要刪除訂單「${deleting?.orderNumber}」嗎?此操作無法復原。`}
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          if (deleting) {
            try {
              await remove.mutateAsync(deleting.id);
            } catch (e) {
              alert(e instanceof ApiError ? e.message : '刪除失敗');
            }
          }
          setDeleting(null);
        }}
      />

      <ConfirmDialog
        open={deletingCompleted}
        title="刪除已完成訂單"
        message={`確定要刪除全部 ${completedOrders.length} 筆已完成訂單嗎?此操作無法復原。`}
        onCancel={() => setDeletingCompleted(false)}
        onConfirm={async () => {
          try {
            await removeMany.mutateAsync(completedOrders.map((o) => o.id));
          } catch (e) {
            alert(e instanceof ApiError ? e.message : '刪除失敗');
          }
          setDeletingCompleted(false);
        }}
      />
    </div>
  );
}
