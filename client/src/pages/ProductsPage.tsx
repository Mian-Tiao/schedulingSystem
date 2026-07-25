import { useState } from 'react';
import { useMachines, useProductMutations, useProducts } from '../api/hooks';
import { ApiError } from '../api/client';
import {
  Badge,
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
import type { Product } from '../types';

interface FormState {
  id?: string;
  productCode: string;
  productName: string;
  description: string;
  defaultProcessingTime: string;
  defaultCleaningTime: string;
}

const emptyForm: FormState = {
  productCode: '',
  productName: '',
  description: '',
  defaultProcessingTime: '10',
  defaultCleaningTime: '0',
};

export function ProductsPage() {
  const { data: products, isLoading, error } = useProducts();
  const { data: machines } = useMachines();
  const { create, update, remove } = useProductMutations();
  const [form, setForm] = useState<FormState | null>(null);
  const [deleting, setDeleting] = useState<Product | null>(null);
  const [formError, setFormError] = useState('');

  const save = async () => {
    if (!form) return;
    setFormError('');
    const body = {
      productCode: form.productCode.trim(),
      productName: form.productName.trim(),
      description: form.description.trim() || null,
      defaultProcessingTime: Number(form.defaultProcessingTime),
      defaultCleaningTime: Number(form.defaultCleaningTime),
    };
    try {
      if (form.id) await update.mutateAsync({ id: form.id, ...body });
      else await create.mutateAsync(body);
      setForm(null);
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : '儲存失敗,請稍後再試');
    }
  };

  if (isLoading) return <Loading />;
  if (error) return <ErrorState message={(error as Error).message} />;

  const unsupportedCount = (products ?? []).filter(
    (product) => !(machines ?? []).some((machine) => machine.supportedProductIds.includes(product.id)),
  ).length;
  const averageProcessingTime =
    products && products.length > 0
      ? Math.round(products.reduce((sum, product) => sum + product.defaultProcessingTime, 0) / products.length)
      : 0;

  return (
    <div className="products-page space-y-5">
      <PageHeader
        eyebrow="PRODUCT CATALOG"
        title="產品管理"
        description="維護產品加工時間、清洗需求與支援機台，作為排程運算的基礎資料。"
        actions={<Button onClick={() => setForm({ ...emptyForm })}>+ 新增產品</Button>}
      />

      <PageMetrics
        items={[
          { label: '產品總數', value: products?.length ?? 0, detail: '已建立產品', tone: 'blue' },
          { label: '可加工機台', value: machines?.length ?? 0, detail: '目前機台資源', tone: 'green' },
          { label: '平均加工時間', value: `${averageProcessingTime} 分`, detail: '每單位預設值' },
          { label: '缺少支援機台', value: unsupportedCount, detail: '需要補齊設定', tone: unsupportedCount > 0 ? 'amber' : 'default' },
        ]}
      />

      {!products || products.length === 0 ? (
        <EmptyState text="尚未建立產品。請先新增產品,才能建立訂單與設定機台。" />
      ) : (
        <div className="data-table-card overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="data-table w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2.5">產品編號</th>
                <th className="px-4 py-2.5">名稱</th>
                <th className="px-4 py-2.5">每單位加工時間</th>
                <th className="px-4 py-2.5">清洗時間</th>
                <th className="px-4 py-2.5">可加工機台</th>
                <th className="px-4 py-2.5 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {products.map((p) => {
                const supported = (machines ?? []).filter((m) => m.supportedProductIds.includes(p.id));
                return (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-medium text-slate-700">{p.productCode}</td>
                    <td className="px-4 py-2.5">
                      {p.productName}
                      {p.description && <span className="ml-2 text-xs text-slate-400">{p.description}</span>}
                    </td>
                    <td className="px-4 py-2.5">{p.defaultProcessingTime} 分鐘</td>
                    <td className="px-4 py-2.5">{p.defaultCleaningTime} 分鐘</td>
                    <td className="px-4 py-2.5">
                      {supported.length === 0 ? (
                        <Badge tone="amber">尚無機台可加工</Badge>
                      ) : (
                        supported.map((m) => (
                          <Badge key={m.id} tone="slate">
                            {m.machineCode}
                          </Badge>
                        ))
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Button
                        variant="ghost"
                        onClick={() =>
                          setForm({
                            id: p.id,
                            productCode: p.productCode,
                            productName: p.productName,
                            description: p.description ?? '',
                            defaultProcessingTime: String(p.defaultProcessingTime),
                            defaultCleaningTime: String(p.defaultCleaningTime),
                          })
                        }
                      >
                        編輯
                      </Button>
                      <Button variant="ghost" onClick={() => setDeleting(p)}>
                        刪除
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal title={form?.id ? '編輯產品' : '新增產品'} open={Boolean(form)} onClose={() => setForm(null)}>
        {form && (
          <div className="space-y-3">
            {formError && <ErrorState message={formError} />}
            <Field label="產品編號" required hint="例如 P-A、PROD-001,不可重複">
              <input
                className={inputCls}
                value={form.productCode}
                onChange={(e) => setForm({ ...form, productCode: e.target.value })}
              />
            </Field>
            <Field label="產品名稱" required>
              <input
                className={inputCls}
                value={form.productName}
                onChange={(e) => setForm({ ...form, productName: e.target.value })}
              />
            </Field>
            <Field label="說明">
              <input
                className={inputCls}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="每單位加工時間(分鐘)" required hint="訂單未填加工時間時 = 數量 × 此值">
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  className={inputCls}
                  value={form.defaultProcessingTime}
                  onChange={(e) => setForm({ ...form, defaultProcessingTime: e.target.value })}
                />
              </Field>
              <Field label="清洗時間(分鐘)" hint="切換為此產品後的清洗時間預設值">
                <input
                  type="number"
                  min="0"
                  className={inputCls}
                  value={form.defaultCleaningTime}
                  onChange={(e) => setForm({ ...form, defaultCleaningTime: e.target.value })}
                />
              </Field>
            </div>
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

      <ConfirmDialog
        open={Boolean(deleting)}
        title="刪除產品"
        message={`確定要刪除產品「${deleting?.productName}」嗎?若有訂單使用此產品將無法刪除。`}
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await remove.mutateAsync(deleting.id);
          } catch (e) {
            alert(e instanceof ApiError ? e.message : '刪除失敗');
          }
          setDeleting(null);
        }}
      />
    </div>
  );
}
