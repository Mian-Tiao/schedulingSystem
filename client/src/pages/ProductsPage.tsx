import { useMemo, useState } from 'react';
import { useMachines, useProductMutations, useProducts, useBom, useBomMutations } from '../api/hooks';
import { ApiError } from '../api/client';
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
import type { Product } from '../types';

interface FormState {
  id?: string;
  productCode: string;
  productName: string;
  description: string;
  defaultProcessingTime: string;
  defaultCleaningTime: string;
  // ── 射出 ──
  customer: string;
  cavityCount: string;
  cycleSeconds: string;
  material: string;
  // ── 模具 ──
  moldCopies: string;
  moldRequiredTonnage: string;
  moldAllowedMachines: string[];
}

const emptyForm: FormState = {
  productCode: '',
  productName: '',
  description: '',
  defaultProcessingTime: '10',
  defaultCleaningTime: '0',
  customer: '',
  cavityCount: '',
  cycleSeconds: '',
  material: '',
  moldCopies: '1',
  moldRequiredTonnage: '',
  moldAllowedMachines: [],
};

export function ProductsPage() {
  const { data: products, isLoading, error } = useProducts();
  const { data: machines } = useMachines();
  const { create, update, remove } = useProductMutations();
  const [form, setForm] = useState<FormState | null>(null);
  const [deleting, setDeleting] = useState<Product | null>(null);
  const [bomProduct, setBomProduct] = useState<Product | null>(null);
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
      customer: form.customer.trim() || null,
      cavityCount: form.cavityCount ? Number(form.cavityCount) : null,
      cycleSeconds: form.cycleSeconds ? Number(form.cycleSeconds) : null,
      material: form.material.trim() || null,
      mold: {
        copies: form.moldCopies ? Number(form.moldCopies) : 1,
        requiredTonnage: form.moldRequiredTonnage ? Number(form.moldRequiredTonnage) : null,
        allowedMachines: form.moldAllowedMachines,
      },
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
                      {(p.cavityCount != null || p.customer) && (
                        <span className="ml-2 text-xs text-slate-400">
                          {p.cavityCount != null && `${p.cavityCount}穴·${p.cycleSeconds}秒`}
                          {p.customer && ` · ${p.customer}`}
                        </span>
                      )}
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
                      <Button variant="ghost" onClick={() => setBomProduct(p)}>
                        BOM表
                      </Button>
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
                            customer: p.customer ?? '',
                            cavityCount: p.cavityCount != null ? String(p.cavityCount) : '',
                            cycleSeconds: p.cycleSeconds != null ? String(p.cycleSeconds) : '',
                            material: p.material ?? '',
                            moldCopies: p.mold?.copies != null ? String(p.mold.copies) : '1',
                            moldRequiredTonnage: p.mold?.requiredTonnage != null ? String(p.mold.requiredTonnage) : '',
                            moldAllowedMachines: p.mold?.allowedMachines ?? [],
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
            {/* ── 射出成型 ── */}
            <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold text-slate-600">射出成型(選填)</p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="客戶">
                  <input className={inputCls} value={form.customer} onChange={(e) => setForm({ ...form, customer: e.target.value })} />
                </Field>
                <Field label="材質">
                  <input className={inputCls} value={form.material} onChange={(e) => setForm({ ...form, material: e.target.value })} />
                </Field>
                <Field label="穴數" hint="一模產出幾個">
                  <input type="number" min="1" className={inputCls} value={form.cavityCount} onChange={(e) => setForm({ ...form, cavityCount: e.target.value })} />
                </Field>
                <Field label="秒數(單模週期)" hint="一模幾秒">
                  <input type="number" min="0" step="0.1" className={inputCls} value={form.cycleSeconds} onChange={(e) => setForm({ ...form, cycleSeconds: e.target.value })} />
                </Field>
              </div>
              {form.cavityCount && form.cycleSeconds && (
                <p className="text-xs text-slate-400">加工時間 ≈ ⌈數量 ÷ {form.cavityCount}⌉ 模 × {form.cycleSeconds} 秒</p>
              )}
            </div>

            {/* ── 模具 ── */}
            <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold text-slate-600">模具(系統自動建一副,可在此調整)</p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="副數" hint="有幾副;=2 可同時上兩台機">
                  <input type="number" min="1" className={inputCls} value={form.moldCopies} onChange={(e) => setForm({ ...form, moldCopies: e.target.value })} />
                </Field>
                <Field label="需求噸數" hint="要上噸數 ≥ 此值的機台">
                  <input type="number" min="0" className={inputCls} value={form.moldRequiredTonnage} onChange={(e) => setForm({ ...form, moldRequiredTonnage: e.target.value })} />
                </Field>
              </div>
              <div>
                <span className="mb-1.5 block text-sm text-slate-600">可上機台(留空 = 只看噸數)</span>
                {!machines || machines.length === 0 ? (
                  <p className="text-xs text-slate-400">尚無機台,請先到「機台管理」建立</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {machines.map((m) => {
                      const checked = form.moldAllowedMachines.includes(m.id);
                      return (
                        <label
                          key={m.id}
                          className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm transition-colors ${
                            checked ? 'border-blue-400 bg-blue-50 text-blue-800' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setForm({
                                ...form,
                                moldAllowedMachines: checked
                                  ? form.moldAllowedMachines.filter((x) => x !== m.id)
                                  : [...form.moldAllowedMachines, m.id],
                              })
                            }
                          />
                          {m.machineCode}
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
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

      {bomProduct && (
        <BomModal
          product={bomProduct}
          onClose={() => setBomProduct(null)}
        />
      )}
    </div>
  );
}

function BomModal({ product, onClose }: { product: Product; onClose: () => void }) {
  const { data: bomItems, isLoading, error } = useBom(product.id);
  const bomMut = useBomMutations(product.id);

  const [newColName, setNewColName] = useState('');
  const [addedKeys, setAddedKeys] = useState<string[]>([]);
  const [newMaterial, setNewMaterial] = useState({ materialName: '', quantity: '', unit: '' });
  const [newCustomFields, setNewCustomFields] = useState<Record<string, string>>({});

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingData, setEditingData] = useState<{ materialName: string; quantity: string; unit: string; customFields: Record<string, string> } | null>(null);

  const customKeys = useMemo(() => {
    const keys = new Set<string>();
    if (bomItems) {
      bomItems.forEach((item) => {
        if (item.customFields) {
          Object.keys(item.customFields).forEach((k) => keys.add(k));
        }
      });
    }
    return Array.from(keys);
  }, [bomItems]);

  const allCustomKeys = useMemo(() => {
    return Array.from(new Set([...customKeys, ...addedKeys]));
  }, [customKeys, addedKeys]);

  const handleAdd = async () => {
    if (!newMaterial.materialName.trim() || !newMaterial.quantity || !newMaterial.unit.trim()) {
      alert('請填寫完整原料名稱、用量與單位');
      return;
    }
    try {
      await bomMut.create.mutateAsync({
        materialName: newMaterial.materialName.trim(),
        quantity: Number(newMaterial.quantity),
        unit: newMaterial.unit.trim(),
        customFields: newCustomFields,
      });
      setNewMaterial({ materialName: '', quantity: '', unit: '' });
      setNewCustomFields({});
    } catch (e) {
      alert(e instanceof ApiError ? e.message : '新增失敗');
    }
  };

  const handleSaveEdit = async (id: string) => {
    if (!editingData || !editingData.materialName.trim() || !editingData.quantity || !editingData.unit.trim()) {
      alert('請填寫完整原料名稱、用量與單位');
      return;
    }
    try {
      await bomMut.update.mutateAsync({
        id,
        materialName: editingData.materialName.trim(),
        quantity: Number(editingData.quantity),
        unit: editingData.unit.trim(),
        customFields: editingData.customFields,
      });
      setEditingId(null);
      setEditingData(null);
    } catch (e) {
      alert(e instanceof ApiError ? e.message : '儲存失敗');
    }
  };

  return (
    <Modal title={`BOM表管理 — ${product.productCode} ${product.productName}`} open={true} onClose={onClose} wide>
      <div className="space-y-4">
        <Banner tone="info">
          設定生產每單位此產品所需的原料與數量。您可以點擊「新增欄位」來擴充物料屬性（例如：規格、供應商、材質等）。
        </Banner>

        <div className="flex gap-2 items-center mb-3">
          <input
            type="text"
            placeholder="自定義欄位名稱 (如: 規格)"
            className={`${inputCls} !w-48 !py-1`}
            value={newColName}
            onChange={(e) => setNewColName(e.target.value)}
          />
          <Button
            variant="secondary"
            onClick={() => {
              if (newColName.trim()) {
                if (allCustomKeys.includes(newColName.trim())) {
                  alert('此欄位名稱已存在');
                  return;
                }
                setAddedKeys([...addedKeys, newColName.trim()]);
                setNewColName('');
              }
            }}
          >
            + 新增自訂欄位
          </Button>
        </div>

        {isLoading ? (
          <div className="py-8 text-center text-slate-500">載入中…</div>
        ) : error ? (
          <ErrorState message={(error as Error).message} />
        ) : (
          <div className="border border-slate-200 rounded-lg overflow-hidden bg-white">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="py-2.5 px-3">原料名稱</th>
                  <th className="py-2.5 px-3">每單位用量</th>
                  <th className="py-2.5 px-3">用量單位</th>
                  {allCustomKeys.map((k) => (
                    <th key={k} className="py-2.5 px-3 group">
                      <span className="flex items-center gap-1">
                        {k}
                        <button
                          className="text-slate-400 hover:text-red-500 font-normal text-xs"
                          onClick={() => {
                            setAddedKeys(addedKeys.filter((x) => x !== k));
                          }}
                          title="移除自訂欄位"
                        >
                          ✕
                        </button>
                      </span>
                    </th>
                  ))}
                  <th className="py-2.5 px-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {bomItems?.map((item) => {
                  const isEditing = editingId === item.id;
                  return (
                    <tr key={item.id} className="hover:bg-slate-50">
                      {isEditing && editingData ? (
                        <>
                          <td className="py-2 px-3">
                            <input
                              className={`${inputCls} !py-1 !px-2`}
                              value={editingData.materialName}
                              onChange={(e) => setEditingData({ ...editingData, materialName: e.target.value })}
                            />
                          </td>
                          <td className="py-2 px-3">
                            <input
                              type="number"
                              className={`${inputCls} !py-1 !px-2`}
                              value={editingData.quantity}
                              onChange={(e) => setEditingData({ ...editingData, quantity: e.target.value })}
                            />
                          </td>
                          <td className="py-2 px-3">
                            <input
                              className={`${inputCls} !py-1 !px-2`}
                              value={editingData.unit}
                              onChange={(e) => setEditingData({ ...editingData, unit: e.target.value })}
                            />
                          </td>
                          {allCustomKeys.map((k) => (
                            <td key={k} className="py-2 px-3">
                              <input
                                className={`${inputCls} !py-1 !px-2`}
                                value={editingData.customFields[k] ?? ''}
                                onChange={(e) =>
                                  setEditingData({
                                    ...editingData,
                                    customFields: { ...editingData.customFields, [k]: e.target.value },
                                  })
                                }
                              />
                            </td>
                          ))}
                          <td className="py-2 px-3 text-right space-x-1 whitespace-nowrap">
                            <Button variant="ghost" onClick={() => handleSaveEdit(item.id)}>
                              儲存
                            </Button>
                            <Button
                              variant="ghost"
                              onClick={() => {
                                setEditingId(null);
                                setEditingData(null);
                              }}
                            >
                              取消
                            </Button>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="py-2 px-3 font-medium text-slate-700">{item.materialName}</td>
                          <td className="py-2 px-3">{item.quantity}</td>
                          <td className="py-2 px-3">
                            <Badge tone="slate">{item.unit}</Badge>
                          </td>
                          {allCustomKeys.map((k) => (
                            <td key={k} className="py-2 px-3 text-slate-500">
                              {item.customFields?.[k] ?? '-'}
                            </td>
                          ))}
                          <td className="py-2 px-3 text-right space-x-1 whitespace-nowrap">
                            <Button
                              variant="ghost"
                              onClick={() => {
                                setEditingId(item.id);
                                setEditingData({
                                  materialName: item.materialName,
                                  quantity: String(item.quantity),
                                  unit: item.unit,
                                  customFields: { ...item.customFields },
                                });
                              }}
                            >
                              編輯
                            </Button>
                            <Button
                              variant="ghost"
                              onClick={async () => {
                                if (confirm(`確定要刪除原料 ${item.materialName} 嗎？`)) {
                                  try {
                                    await bomMut.remove.mutateAsync(item.id);
                                  } catch {
                                    alert('刪除失敗');
                                  }
                                }
                              }}
                            >
                              刪除
                            </Button>
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}

                {/* 新增列 */}
                <tr className="bg-slate-50">
                  <td className="py-2 px-3">
                    <input
                      placeholder="原料名稱 (如: 鋼板)"
                      className={`${inputCls} !py-1 !px-2 bg-white`}
                      value={newMaterial.materialName}
                      onChange={(e) => setNewMaterial({ ...newMaterial, materialName: e.target.value })}
                    />
                  </td>
                  <td className="py-2 px-3">
                    <input
                      type="number"
                      placeholder="數量"
                      className={`${inputCls} !py-1 !px-2 bg-white`}
                      value={newMaterial.quantity}
                      onChange={(e) => setNewMaterial({ ...newMaterial, quantity: e.target.value })}
                    />
                  </td>
                  <td className="py-2 px-3">
                    <input
                      placeholder="單位 (如: 公斤)"
                      className={`${inputCls} !py-1 !px-2 bg-white`}
                      value={newMaterial.unit}
                      onChange={(e) => setNewMaterial({ ...newMaterial, unit: e.target.value })}
                    />
                  </td>
                  {allCustomKeys.map((k) => (
                    <td key={k} className="py-2 px-3">
                      <input
                        placeholder={`自訂欄位 ${k}`}
                        className={`${inputCls} !py-1 !px-2 bg-white`}
                        value={newCustomFields[k] ?? ''}
                        onChange={(e) => setNewCustomFields({ ...newCustomFields, [k]: e.target.value })}
                      />
                    </td>
                  ))}
                  <td className="py-2 px-3 text-right">
                    <Button onClick={handleAdd} disabled={bomMut.create.isPending}>
                      新增
                    </Button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <Button variant="secondary" onClick={onClose}>
            關閉
          </Button>
        </div>
      </div>
    </Modal>
  );
}

