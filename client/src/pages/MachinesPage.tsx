import { useState } from 'react';
import { ApiError } from '../api/client';
import {
  useChangeoverMutations,
  useChangeoverRules,
  useMachineMutations,
  useMachines,
  useProducts,
} from '../api/hooks';
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
} from '../components/ui';
import type { DaySegment, Machine, WeekKey, WorkingHours } from '../types';
import { fmtDateTime, fromLocalInput } from '../utils/time';

const WEEK_LABELS: Record<WeekKey, string> = {
  mon: '週一',
  tue: '週二',
  wed: '週三',
  thu: '週四',
  fri: '週五',
  sat: '週六',
  sun: '週日',
};
const WEEK_KEYS: WeekKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

const DEFAULT_WH: WorkingHours = {
  mon: [{ start: '08:00', end: '17:00' }],
  tue: [{ start: '08:00', end: '17:00' }],
  wed: [{ start: '08:00', end: '17:00' }],
  thu: [{ start: '08:00', end: '17:00' }],
  fri: [{ start: '08:00', end: '17:00' }],
  sat: [],
  sun: [],
};

interface FormState {
  id?: string;
  machineCode: string;
  machineName: string;
  model: string;
  description: string;
  supportedProductIds: string[];
  defaultSetupTime: string;
  defaultCleaningTime: string;
  workingHours: WorkingHours;
  status: string;
}

const DOWNTIME_TYPES = [
  { value: 'maintenance', label: '定期維護' },
  { value: 'breakdown', label: '故障' },
  { value: 'plannedStop', label: '計畫停機(如午休)' },
  { value: 'other', label: '其他' },
];

export function MachinesPage() {
  const { data: machines, isLoading, error } = useMachines();
  const { data: products } = useProducts();
  const { data: rules } = useChangeoverRules();
  const machineMut = useMachineMutations();
  const changeoverMut = useChangeoverMutations();

  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState('');
  const [deleting, setDeleting] = useState<Machine | null>(null);
  const [downtimeFor, setDowntimeFor] = useState<Machine | null>(null);
  const [dtForm, setDtForm] = useState({ type: 'maintenance', startTime: '', endTime: '', reason: '' });
  const [ruleOpen, setRuleOpen] = useState(false);
  const [ruleForm, setRuleForm] = useState({ machineId: '', fromProductId: '', toProductId: '', setupMinutes: '30', cleaningMinutes: '15' });

  const productName = (id: string | null) =>
    id === null ? '(空機/任何)' : (products ?? []).find((p) => p.id === id)?.productCode ?? '?';
  const machineName = (id: string | null) =>
    id === null ? '所有機台' : (machines ?? []).find((m) => m.id === id)?.machineCode ?? '?';

  const save = async () => {
    if (!form) return;
    setFormError('');
    const body = {
      machineCode: form.machineCode.trim(),
      machineName: form.machineName.trim(),
      model: form.model.trim() || null,
      description: form.description.trim() || null,
      supportedProductIds: form.supportedProductIds,
      defaultSetupTime: Number(form.defaultSetupTime),
      defaultCleaningTime: Number(form.defaultCleaningTime),
      workingHours: form.workingHours,
      status: form.status,
    };
    try {
      if (form.id) await machineMut.update.mutateAsync({ id: form.id, body });
      else await machineMut.create.mutateAsync(body);
      setForm(null);
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : '儲存失敗,請稍後再試');
    }
  };

  if (isLoading) return <Loading />;
  if (error) return <ErrorState message={(error as Error).message} />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-800">機台管理</h1>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setRuleOpen(true)}>
            換模規則
          </Button>
          <Button
            onClick={() =>
              setForm({
                machineCode: '',
                machineName: '',
                model: '',
                description: '',
                supportedProductIds: [],
                defaultSetupTime: '20',
                defaultCleaningTime: '10',
                workingHours: structuredClone(DEFAULT_WH),
                status: 'available',
              })
            }
          >
            + 新增機台
          </Button>
        </div>
      </div>

      {!machines || machines.length === 0 ? (
        <EmptyState text="尚未建立機台。" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {machines.map((m) => (
            <div key={m.id} className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="mb-2 flex items-start justify-between">
                <div>
                  <h2 className="font-semibold text-slate-800">
                    {m.machineCode} {m.machineName}
                    {m.model && <span className="ml-2 text-xs font-normal text-slate-400">{m.model}</span>}
                  </h2>
                  <div className="mt-1 flex gap-1">
                    {m.status === 'available' && <Badge tone="green">✓ 可用</Badge>}
                    {m.status === 'maintenance' && <Badge tone="amber">🔧 維護中</Badge>}
                    {m.status === 'disabled' && <Badge tone="slate">⛔ 停用</Badge>}
                  </div>
                </div>
                <div>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      setForm({
                        id: m.id,
                        machineCode: m.machineCode,
                        machineName: m.machineName,
                        model: m.model ?? '',
                        description: m.description ?? '',
                        supportedProductIds: m.supportedProductIds,
                        defaultSetupTime: String(m.defaultSetupTime),
                        defaultCleaningTime: String(m.defaultCleaningTime),
                        workingHours: structuredClone(m.workingHours),
                        status: m.status,
                      })
                    }
                  >
                    編輯
                  </Button>
                  <Button variant="ghost" onClick={() => setDeleting(m)}>
                    刪除
                  </Button>
                </div>
              </div>

              <dl className="space-y-1 text-sm text-slate-600">
                <div>
                  <dt className="inline text-slate-400">可加工產品:</dt>
                  <dd className="inline">
                    {m.supportedProductIds.length === 0
                      ? '(未設定)'
                      : m.supportedProductIds.map((pid) => (
                          <Badge key={pid} tone="slate">
                            {productName(pid)}
                          </Badge>
                        ))}
                  </dd>
                </div>
                <div>
                  <dt className="inline text-slate-400">預設換模 / 清洗:</dt>
                  <dd className="inline">
                    {m.defaultSetupTime} 分 / {m.defaultCleaningTime} 分
                  </dd>
                </div>
                <div>
                  <dt className="inline text-slate-400">工作時段:</dt>
                  <dd className="inline text-xs">
                    {WEEK_KEYS.filter((k) => m.workingHours[k]?.length > 0)
                      .map((k) => `${WEEK_LABELS[k]} ${m.workingHours[k].map((s) => `${s.start}-${s.end}`).join('、')}`)
                      .join(';') || '(未設定)'}
                  </dd>
                </div>
              </dl>

              <div className="mt-3 border-t border-slate-100 pt-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-slate-500">維護 / 停機時段</h3>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setDowntimeFor(m);
                      setDtForm({ type: 'maintenance', startTime: '', endTime: '', reason: '' });
                    }}
                  >
                    + 新增
                  </Button>
                </div>
                {(m.downtimes ?? []).length === 0 ? (
                  <p className="text-xs text-slate-400">無停機時段</p>
                ) : (
                  <ul className="space-y-1 text-xs">
                    {(m.downtimes ?? []).map((d) => (
                      <li key={d.id} className="flex items-center justify-between">
                        <span>
                          <Badge tone={d.type === 'breakdown' ? 'red' : 'amber'}>
                            {DOWNTIME_TYPES.find((t) => t.value === d.type)?.label ?? d.type}
                          </Badge>{' '}
                          {fmtDateTime(d.startTime)} ~ {fmtDateTime(d.endTime)}
                          {d.reason && <span className="ml-1 text-slate-400">({d.reason})</span>}
                        </span>
                        <button
                          className="text-slate-400 hover:text-red-500"
                          onClick={() => machineMut.removeDowntime.mutate({ machineId: m.id, downtimeId: d.id })}
                          title="刪除停機時段"
                        >
                          ✕
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 機台表單 */}
      <Modal title={form?.id ? '編輯機台' : '新增機台'} open={Boolean(form)} onClose={() => setForm(null)} wide>
        {form && (
          <div className="space-y-3">
            {formError && <ErrorState message={formError} />}
            <div className="grid grid-cols-3 gap-3">
              <Field label="機台編號" required hint="例如 M-01">
                <input className={inputCls} value={form.machineCode} onChange={(e) => setForm({ ...form, machineCode: e.target.value })} />
              </Field>
              <Field label="機台名稱" required>
                <input className={inputCls} value={form.machineName} onChange={(e) => setForm({ ...form, machineName: e.target.value })} />
              </Field>
              <Field label="型號">
                <input className={inputCls} value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
              </Field>
              <Field label="狀態">
                <select className={inputCls} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  <option value="available">可用</option>
                  <option value="maintenance">維護中(仍可排程,避開停機時段)</option>
                  <option value="disabled">停用(不參與排程)</option>
                </select>
              </Field>
              <Field label="預設換模時間(分鐘)" hint="無特定換模規則時使用">
                <input type="number" min="0" className={inputCls} value={form.defaultSetupTime} onChange={(e) => setForm({ ...form, defaultSetupTime: e.target.value })} />
              </Field>
              <Field label="預設清洗時間(分鐘)">
                <input type="number" min="0" className={inputCls} value={form.defaultCleaningTime} onChange={(e) => setForm({ ...form, defaultCleaningTime: e.target.value })} />
              </Field>
            </div>

            <Field label="可加工產品" hint="勾選此機台能生產的產品">
              <div className="flex flex-wrap gap-3 rounded-md border border-slate-200 p-2">
                {(products ?? []).map((p) => (
                  <label key={p.id} className="flex items-center gap-1 text-sm">
                    <input
                      type="checkbox"
                      checked={form.supportedProductIds.includes(p.id)}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          supportedProductIds: e.target.checked
                            ? [...form.supportedProductIds, p.id]
                            : form.supportedProductIds.filter((id) => id !== p.id),
                        })
                      }
                    />
                    {p.productCode} {p.productName}
                  </label>
                ))}
                {(products ?? []).length === 0 && <span className="text-xs text-slate-400">請先建立產品</span>}
              </div>
            </Field>

            <Field label="每日工作時段" hint="每天可設定多段(以中午休息分隔),留空 = 當日不工作。例:08:00-12:00、13:00-17:00">
              <div className="space-y-1.5 rounded-md border border-slate-200 p-2">
                {WEEK_KEYS.map((k) => (
                  <WorkingHoursRow
                    key={k}
                    label={WEEK_LABELS[k]}
                    segments={form.workingHours[k]}
                    onChange={(segs) => setForm({ ...form, workingHours: { ...form.workingHours, [k]: segs } })}
                  />
                ))}
              </div>
            </Field>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setForm(null)}>
                取消
              </Button>
              <Button onClick={save} disabled={machineMut.create.isPending || machineMut.update.isPending}>
                {machineMut.create.isPending || machineMut.update.isPending ? '儲存中…' : '儲存'}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* 停機時段表單 */}
      <Modal title={`新增停機時段 — ${downtimeFor?.machineName ?? ''}`} open={Boolean(downtimeFor)} onClose={() => setDowntimeFor(null)}>
        <div className="space-y-3">
          <Field label="類型">
            <select className={inputCls} value={dtForm.type} onChange={(e) => setDtForm({ ...dtForm, type: e.target.value })}>
              {DOWNTIME_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="開始時間" required hint="例如 2026-08-10 09:00">
            <input type="datetime-local" className={inputCls} value={dtForm.startTime} onChange={(e) => setDtForm({ ...dtForm, startTime: e.target.value })} />
          </Field>
          <Field label="結束時間" required>
            <input type="datetime-local" className={inputCls} value={dtForm.endTime} onChange={(e) => setDtForm({ ...dtForm, endTime: e.target.value })} />
          </Field>
          <Field label="原因">
            <input className={inputCls} value={dtForm.reason} onChange={(e) => setDtForm({ ...dtForm, reason: e.target.value })} placeholder="例如:每月定期保養" />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDowntimeFor(null)}>
              取消
            </Button>
            <Button
              disabled={!dtForm.startTime || !dtForm.endTime || machineMut.addDowntime.isPending}
              onClick={async () => {
                if (!downtimeFor) return;
                try {
                  await machineMut.addDowntime.mutateAsync({
                    machineId: downtimeFor.id,
                    body: {
                      type: dtForm.type,
                      startTime: fromLocalInput(dtForm.startTime),
                      endTime: fromLocalInput(dtForm.endTime),
                      reason: dtForm.reason.trim() || null,
                    },
                  });
                  setDowntimeFor(null);
                } catch (e) {
                  alert(e instanceof ApiError ? e.message : '新增失敗');
                }
              }}
            >
              新增
            </Button>
          </div>
        </div>
      </Modal>

      {/* 換模規則 */}
      <Modal title="產品切換換模規則" open={ruleOpen} onClose={() => setRuleOpen(false)} wide>
        <div className="space-y-3">
          <Banner tone="info">
            設定「從產品 A 切換到產品 B」所需的換模與清洗時間。未設定規則時使用機台預設值;同產品連續生產不需換模。
          </Banner>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr>
                <th className="py-1.5">機台</th>
                <th className="py-1.5">從產品</th>
                <th className="py-1.5">到產品</th>
                <th className="py-1.5">換模(分)</th>
                <th className="py-1.5">清洗(分)</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(rules ?? []).map((r) => (
                <tr key={r.id}>
                  <td className="py-1.5">{machineName(r.machineId)}</td>
                  <td className="py-1.5">{productName(r.fromProductId)}</td>
                  <td className="py-1.5">{productName(r.toProductId)}</td>
                  <td className="py-1.5">{r.setupMinutes}</td>
                  <td className="py-1.5">{r.cleaningMinutes}</td>
                  <td className="py-1.5 text-right">
                    <button className="text-slate-400 hover:text-red-500" onClick={() => changeoverMut.remove.mutate(r.id)} title="刪除規則">
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
              <tr>
                <td className="py-1.5 pr-1">
                  <select className={inputCls} value={ruleForm.machineId} onChange={(e) => setRuleForm({ ...ruleForm, machineId: e.target.value })}>
                    <option value="">所有機台</option>
                    {(machines ?? []).map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.machineCode}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-1.5 pr-1">
                  <select className={inputCls} value={ruleForm.fromProductId} onChange={(e) => setRuleForm({ ...ruleForm, fromProductId: e.target.value })}>
                    <option value="">(空機/任何)</option>
                    {(products ?? []).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.productCode}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-1.5 pr-1">
                  <select className={inputCls} value={ruleForm.toProductId} onChange={(e) => setRuleForm({ ...ruleForm, toProductId: e.target.value })}>
                    <option value="">選擇產品</option>
                    {(products ?? []).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.productCode}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-1.5 pr-1">
                  <input type="number" min="0" className={inputCls} value={ruleForm.setupMinutes} onChange={(e) => setRuleForm({ ...ruleForm, setupMinutes: e.target.value })} />
                </td>
                <td className="py-1.5 pr-1">
                  <input type="number" min="0" className={inputCls} value={ruleForm.cleaningMinutes} onChange={(e) => setRuleForm({ ...ruleForm, cleaningMinutes: e.target.value })} />
                </td>
                <td className="py-1.5 text-right">
                  <Button
                    disabled={!ruleForm.toProductId || changeoverMut.create.isPending}
                    onClick={async () => {
                      try {
                        await changeoverMut.create.mutateAsync({
                          machineId: ruleForm.machineId || null,
                          fromProductId: ruleForm.fromProductId || null,
                          toProductId: ruleForm.toProductId,
                          setupMinutes: Number(ruleForm.setupMinutes),
                          cleaningMinutes: Number(ruleForm.cleaningMinutes),
                        });
                        setRuleForm({ ...ruleForm, toProductId: '' });
                      } catch (e) {
                        alert(e instanceof ApiError ? e.message : '新增失敗');
                      }
                    }}
                  >
                    新增
                  </Button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleting)}
        title="刪除機台"
        message={`確定要刪除機台「${deleting?.machineName}」嗎?其停機時段會一併刪除。`}
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          if (deleting) {
            try {
              await machineMut.remove.mutateAsync(deleting.id);
            } catch (e) {
              alert(e instanceof ApiError ? e.message : '刪除失敗');
            }
          }
          setDeleting(null);
        }}
      />
    </div>
  );
}

function WorkingHoursRow({
  label,
  segments,
  onChange,
}: {
  label: string;
  segments: DaySegment[];
  onChange: (segs: DaySegment[]) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-10 text-xs text-slate-500">{label}</span>
      <div className="flex flex-1 flex-wrap items-center gap-1.5">
        {segments.map((s, i) => (
          <span key={i} className="flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-xs">
            <input
              type="time"
              className="bg-transparent"
              value={s.start}
              onChange={(e) => onChange(segments.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))}
            />
            -
            <input
              type="time"
              className="bg-transparent"
              value={s.end}
              onChange={(e) => onChange(segments.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))}
            />
            <button className="text-slate-400 hover:text-red-500" onClick={() => onChange(segments.filter((_, j) => j !== i))} title="刪除時段">
              ✕
            </button>
          </span>
        ))}
        <button
          className="text-xs text-blue-600 hover:underline"
          onClick={() => onChange([...segments, { start: '08:00', end: '17:00' }])}
        >
          + 加時段
        </button>
        {segments.length === 0 && <span className="text-xs text-slate-300">(不工作)</span>}
      </div>
    </div>
  );
}
