/**
 * 情境模擬:急單插入、機台故障。純模擬,不寫入正式排程。
 */
import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, apiPost } from '../api/client';
import { useMachines, useProducts, useScenarios } from '../api/hooks';
import { Badge, Banner, Button, EmptyState, ErrorState, Field, inputCls, Loading, PageHeader, PageMetrics } from '../components/ui';
import type { Machine, Metrics, OrderImpact, Task } from '../types';
import { fmtDateTime, fmtMinutes, fmtTime, fromLocalInput, pct, toLocalInput } from '../utils/time';

type Tab = 'urgent' | 'breakdown';

interface UrgentResult {
  baseline: { metrics: Metrics };
  urgentOrder: { orderNumber: string; processingTime: number };
  insert:
    | { ok: true; tasks: Task[]; metrics: Metrics; urgentTardinessMinutes: number | null; affectedOrders: OrderImpact[] }
    | { ok: false; reason: string };
  rebuild: {
    ok: boolean;
    tasks: Task[];
    metrics: Metrics;
    urgentTardinessMinutes: number | null;
    affectedOrders: OrderImpact[];
    unscheduled: { orderNumber: string; reason: string }[];
  };
}

interface BreakdownResult {
  baseline: { metrics: Metrics };
  breakdown: { machineId: string; machineName: string; startTime: string; estimatedRepairTime: string };
  withEstimatedRepair: {
    metrics: Metrics;
    tasks: Task[];
    impacts: OrderImpact[];
    lateOrders: { orderNumber: string; tardinessMinutes: number; priority: number }[];
    lateOrderCount: number;
  };
  reverseAnalysis: { latestSafeRepairTime: string | null; message: string };
  suggestions: {
    minimumLateOrderCount: number;
    transferMachines: { machineId: string; machineCode: string; machineName: string }[];
    priorityOrders: string[];
    negotiableOrders: string[];
  };
}

export function SimulationPage() {
  const { data: scenarios, isLoading } = useScenarios();
  const { data: products } = useProducts();
  const { data: machines } = useMachines();
  const [tab, setTab] = useState<Tab>('urgent');
  const top = scenarios?.find((s) => s.rank === 1) ?? null;

  const navigate = useNavigate();
  const [applyBusy, setApplyBusy] = useState<string | null>(null);

  const handleApplyUrgent = async (strategy: 'insert' | 'rebuild') => {
    setApplyBusy(strategy);
    try {
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (strategy === 'insert') {
        alert('急單插入策略套用成功！(模擬)');
      } else {
        alert('急單重排策略套用成功！(模擬)');
      }
      navigate('/gantt');
    } catch {
      alert('套用失敗，請重試');
    } finally {
      setApplyBusy(null);
    }
  };

  const handleApplyBreakdown = async () => {
    setApplyBusy('breakdown');
    try {
      await new Promise((resolve) => setTimeout(resolve, 500));
      alert('故障排程套用成功！(模擬)');
      navigate('/gantt');
    } catch {
      alert('套用失敗，請重試');
    } finally {
      setApplyBusy(null);
    }
  };
  const [urgentForm, setUrgentForm] = useState({
    orderNumber: 'URGENT-001',
    productId: '',
    quantity: '10',
    releaseTime: toLocalInput(new Date()),
    dueDate: toLocalInput(new Date(Date.now() + 86400_000)),
    priority: '1',
  });
  const [urgentResult, setUrgentResult] = useState<UrgentResult | null>(null);
  const [urgentBusy, setUrgentBusy] = useState(false);
  const [urgentError, setUrgentError] = useState('');

  const [bdForm, setBdForm] = useState({
    machineId: '',
    startTime: toLocalInput(new Date()),
    estimatedRepairTime: toLocalInput(new Date(Date.now() + 4 * 3600_000)),
  });
  const [bdResult, setBdResult] = useState<BreakdownResult | null>(null);
  const [bdBusy, setBdBusy] = useState(false);
  const [bdError, setBdError] = useState('');

  if (isLoading) return <Loading />;
  if (!top)
    return (
      <div className="space-y-4">
        <PageHeader
          eyebrow="WHAT-IF ANALYSIS"
          title="情境模擬"
          description="在不影響正式排程的前提下，預演急單與機台故障可能造成的衝擊。"
        />
        <EmptyState text="請先到排程中心執行排程,再進行情境模擬。" />
      </div>
    );

  const runUrgent = async () => {
    setUrgentBusy(true);
    setUrgentError('');
    setUrgentResult(null);
    try {
      const result = await apiPost<UrgentResult>('/api/simulations/urgent-order', {
        scenarioId: top.scenarioId,
        order: {
          orderNumber: urgentForm.orderNumber.trim(),
          productId: urgentForm.productId || products?.[0]?.id,
          quantity: Number(urgentForm.quantity),
          releaseTime: fromLocalInput(urgentForm.releaseTime),
          dueDate: fromLocalInput(urgentForm.dueDate),
          priority: Number(urgentForm.priority),
        },
      });
      setUrgentResult(result);
    } catch (e) {
      setUrgentError(e instanceof ApiError ? e.message : '模擬失敗,請稍後再試');
    } finally {
      setUrgentBusy(false);
    }
  };

  const runBreakdown = async () => {
    setBdBusy(true);
    setBdError('');
    setBdResult(null);
    try {
      const result = await apiPost<BreakdownResult>('/api/simulations/machine-breakdown', {
        scenarioId: top.scenarioId,
        machineId: bdForm.machineId || machines?.[0]?.id,
        startTime: fromLocalInput(bdForm.startTime),
        estimatedRepairTime: fromLocalInput(bdForm.estimatedRepairTime),
      });
      setBdResult(result);
    } catch (e) {
      setBdError(e instanceof ApiError ? e.message : '模擬失敗,請稍後再試');
    } finally {
      setBdBusy(false);
    }
  };

  return (
    <div className="simulation-page space-y-5">
      <PageHeader
        eyebrow="WHAT-IF ANALYSIS"
        title="情境模擬"
        description="以目前最佳方案為基準，預演突發事件並比較不同應變策略。"
      />
      <PageMetrics
        items={[
          { label: '模擬基準', value: top.algorithm, detail: '目前排名第一方案', tone: 'blue' },
          { label: '準時交貨率', value: pct(top.metrics.onTimeDeliveryRate), detail: '正式排程基準', tone: 'green' },
          { label: '延遲訂單', value: `${top.metrics.lateOrderCount} 張`, detail: '模擬前狀態', tone: top.metrics.lateOrderCount > 0 ? 'red' : 'default' },
          { label: '機台利用率', value: pct(top.metrics.machineUtilizationRate), detail: '純生產時間占比' },
        ]}
      />
      <Banner tone="info">
        模擬以目前排名第一的方案({top.algorithm})為基準,結果不會寫入正式排程。
      </Banner>

      <div className="simulation-tabs">
        <Button variant={tab === 'urgent' ? 'primary' : 'secondary'} onClick={() => setTab('urgent')}>
          <span aria-hidden>01</span> 急單插入
        </Button>
        <Button variant={tab === 'breakdown' ? 'primary' : 'secondary'} onClick={() => setTab('breakdown')}>
          <span aria-hidden>02</span> 機台故障
        </Button>
      </div>

      {tab === 'urgent' && (
        <section className="simulation-workbench">
          <div className="section-command-heading">
            <span>01</span>
            <div>
              <p>URGENT ORDER</p>
              <h2>設定急單條件</h2>
              <small>比較直接插入與全體重排兩種策略對現有訂單的衝擊。</small>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Field label="急單編號" required>
              <input className={inputCls} value={urgentForm.orderNumber} onChange={(e) => setUrgentForm({ ...urgentForm, orderNumber: e.target.value })} />
            </Field>
            <Field label="產品" required>
              <select className={inputCls} value={urgentForm.productId} onChange={(e) => setUrgentForm({ ...urgentForm, productId: e.target.value })}>
                {(products ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.productCode} {p.productName}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="數量" required>
              <input type="number" min="1" className={inputCls} value={urgentForm.quantity} onChange={(e) => setUrgentForm({ ...urgentForm, quantity: e.target.value })} />
            </Field>
            <Field label="可開始時間" required>
              <input type="datetime-local" className={inputCls} value={urgentForm.releaseTime} onChange={(e) => setUrgentForm({ ...urgentForm, releaseTime: e.target.value })} />
            </Field>
            <Field label="交期" required>
              <input type="datetime-local" className={inputCls} value={urgentForm.dueDate} onChange={(e) => setUrgentForm({ ...urgentForm, dueDate: e.target.value })} />
            </Field>
            <Field label="優先級">
              <select className={inputCls} value={urgentForm.priority} onChange={(e) => setUrgentForm({ ...urgentForm, priority: e.target.value })}>
                {[1, 2, 3].map((p) => (
                  <option key={p} value={p}>
                    {p}(急單通常為 1)
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="mt-3">
            <Button onClick={runUrgent} disabled={urgentBusy}>
              {urgentBusy ? '模擬中…' : '▶ 執行急單模擬'}
            </Button>
          </div>
          {urgentError && <ErrorState message={urgentError} />}

          {urgentResult && (
            <div className="simulation-result-grid mt-5 grid gap-4 lg:grid-cols-2">
              <div className="scenario-result">
                <h3 className="mb-2 text-sm font-semibold text-slate-700">策略一:插入目前排程(既有訂單不動)</h3>
                {urgentResult.insert.ok ? (
                  <>
                    <MetricsCompare before={urgentResult.baseline.metrics} after={urgentResult.insert.metrics} />
                    <p className="mt-2 text-sm">
                      急單預計{' '}
                      {urgentResult.insert.urgentTardinessMinutes === 0 ? (
                        <Badge tone="green">✓ 準時完成</Badge>
                      ) : (
                        <Badge tone="red">延遲 {fmtMinutes(urgentResult.insert.urgentTardinessMinutes ?? 0)}</Badge>
                      )}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">此策略不影響任何既有訂單。</p>
                    <GanttPreview
                      tasks={urgentResult.insert.tasks}
                      breakdown={null}
                      machines={machines ?? []}
                    />
                    <div className="mt-3">
                      <Button
                        variant="primary"
                        onClick={() => handleApplyUrgent('insert')}
                        disabled={applyBusy !== null}
                      >
                        {applyBusy === 'insert' ? '套用中…' : '套用此策略'}
                      </Button>
                    </div>
                  </>
                ) : (
                  <Banner tone="error">{urgentResult.insert.reason}</Banner>
                )}
              </div>
              <div className="scenario-result">
                <h3 className="mb-2 text-sm font-semibold text-slate-700">策略二:重新計算全部排程(含急單)</h3>
                <MetricsCompare before={urgentResult.baseline.metrics} after={urgentResult.rebuild.metrics} />
                <p className="mt-2 text-sm">
                  急單預計{' '}
                  {urgentResult.rebuild.urgentTardinessMinutes === 0 ? (
                    <Badge tone="green">✓ 準時完成</Badge>
                  ) : (
                    <Badge tone="red">延遲 {fmtMinutes(urgentResult.rebuild.urgentTardinessMinutes ?? 0)}</Badge>
                  )}
                </p>
                {urgentResult.rebuild.affectedOrders.length > 0 ? (
                  <div className="mt-2">
                    <p className="text-xs font-medium text-slate-600">受影響的訂單:</p>
                    <ImpactTable impacts={urgentResult.rebuild.affectedOrders} />
                  </div>
                ) : (
                  <p className="mt-1 text-xs text-slate-500">沒有訂單受影響。</p>
                )}
                <GanttPreview
                  tasks={urgentResult.rebuild.tasks}
                  breakdown={null}
                  machines={machines ?? []}
                />
                <div className="mt-3">
                  <Button
                    variant="primary"
                    onClick={() => handleApplyUrgent('rebuild')}
                    disabled={applyBusy !== null}
                  >
                    {applyBusy === 'rebuild' ? '套用中…' : '套用此策略'}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {tab === 'breakdown' && (
        <section className="simulation-workbench">
          <div className="section-command-heading">
            <span>02</span>
            <div>
              <p>MACHINE BREAKDOWN</p>
              <h2>設定故障條件</h2>
              <small>評估修復時間、延遲訂單與可轉移機台，提前準備應變方案。</small>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Field label="故障機台" required>
              <select className={inputCls} value={bdForm.machineId} onChange={(e) => setBdForm({ ...bdForm, machineId: e.target.value })}>
                {(machines ?? []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.machineCode} {m.machineName}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="故障開始時間" required>
              <input
                type="datetime-local"
                className={inputCls}
                value={bdForm.startTime}
                onChange={(e) => {
                  const newStart = e.target.value;
                  let newRepair = bdForm.estimatedRepairTime;
                  if (newStart) {
                    const startDate = new Date(newStart);
                    if (!isNaN(startDate.getTime())) {
                      const repairDate = new Date(startDate.getTime() + 4 * 60 * 60 * 1000); // 預設加 4 小時
                      newRepair = toLocalInput(repairDate);
                    }
                  }
                  setBdForm({ ...bdForm, startTime: newStart, estimatedRepairTime: newRepair });
                }}
              />
            </Field>
            <Field label="預估修復時間" required>
              <input type="datetime-local" className={inputCls} value={bdForm.estimatedRepairTime} onChange={(e) => setBdForm({ ...bdForm, estimatedRepairTime: e.target.value })} />
            </Field>
          </div>
          <div className="mt-3">
            <Button onClick={runBreakdown} disabled={bdBusy}>
              {bdBusy ? '模擬中…' : '▶ 執行故障模擬'}
            </Button>
          </div>
          {bdError && <ErrorState message={bdError} />}

          {bdResult && (
            <div className="mt-4 space-y-4">
              <div className="scenario-result">
                <h3 className="mb-2 text-sm font-semibold text-slate-700">
                  情境一:按預估修復時間({fmtDateTime(bdResult.breakdown.estimatedRepairTime)} 修復)
                </h3>
                <MetricsCompare before={bdResult.baseline.metrics} after={bdResult.withEstimatedRepair.metrics} />
                {bdResult.withEstimatedRepair.lateOrders.length === 0 ? (
                  <Banner tone="success">在此修復時間下,沒有訂單會逾期。</Banner>
                ) : (
                  <>
                    <p className="mt-2 text-sm text-red-600">將有 {bdResult.withEstimatedRepair.lateOrderCount} 張訂單逾期:</p>
                    <ul className="mt-1 space-y-0.5 text-sm">
                      {bdResult.withEstimatedRepair.lateOrders.map((o) => (
                        <li key={o.orderNumber}>
                          {o.orderNumber} — 延遲 {fmtMinutes(o.tardinessMinutes)}
                          {o.priority <= 2 && <Badge tone="red"> 重要訂單</Badge>}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>

              <div className="scenario-result">
                <h3 className="mb-2 text-sm font-semibold text-slate-700">情境二:反向分析 — 最晚何時要修好?</h3>
                <Banner tone={bdResult.reverseAnalysis.latestSafeRepairTime ? 'info' : 'warn'}>
                  {bdResult.reverseAnalysis.latestSafeRepairTime
                    ? `最晚須於 ${fmtDateTime(bdResult.reverseAnalysis.latestSafeRepairTime)} 前修復,重要訂單(優先級 ≤ 2)才不會逾期。`
                    : bdResult.reverseAnalysis.message}
                </Banner>
              </div>

              {bdResult.withEstimatedRepair.lateOrders.length > 0 && (
                <div className="scenario-result is-recommendation">
                  <h3 className="mb-2 text-sm font-semibold text-slate-700">建議</h3>
                  <ul className="space-y-1 text-sm text-slate-600">
                    <li>・最少會有 {bdResult.suggestions.minimumLateOrderCount} 張訂單逾期</li>
                    <li>
                      ・可考慮轉移工作到:
                      {(() => {
                        const brokenMachine = machines?.find((m) => m.id === bdForm.machineId);
                        const compatible = bdResult.suggestions.transferMachines.filter((tm) => {
                          const machineInfo = machines?.find((m) => m.id === tm.machineId);
                          return machineInfo?.supportedProductIds.some((pId) =>
                            brokenMachine?.supportedProductIds.includes(pId)
                          );
                        });
                        return compatible.length > 0
                          ? compatible.map((m) => `${m.machineCode} ${m.machineName}`).join('、')
                          : '(沒有其他相容機台可支援)';
                      })()}
                    </li>
                    {bdResult.suggestions.priorityOrders.length > 0 && (
                      <li>・建議優先處理:{bdResult.suggestions.priorityOrders.join('、')}</li>
                    )}
                    {bdResult.suggestions.negotiableOrders.length > 0 && (
                      <li>・可與客戶協調交期:{bdResult.suggestions.negotiableOrders.join('、')}</li>
                    )}
                  </ul>
                </div>
              )}

              <GanttPreview
                tasks={bdResult.withEstimatedRepair.tasks}
                breakdown={bdResult.breakdown}
                machines={machines ?? []}
              />
              <div className="mt-3">
                <Button
                  variant="primary"
                  onClick={handleApplyBreakdown}
                  disabled={applyBusy !== null}
                >
                  {applyBusy === 'breakdown' ? '套用中…' : '套用故障調整'}
                </Button>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function MetricsCompare({ before, after }: { before: Metrics; after: Metrics }) {
  const rows = [
    { label: '準時交貨率', b: pct(before.onTimeDeliveryRate), a: pct(after.onTimeDeliveryRate), good: after.onTimeDeliveryRate >= before.onTimeDeliveryRate },
    { label: '平均延遲', b: fmtMinutes(before.averageTardinessMinutes), a: fmtMinutes(after.averageTardinessMinutes), good: after.averageTardinessMinutes <= before.averageTardinessMinutes },
    { label: '延遲訂單', b: `${before.lateOrderCount} 張`, a: `${after.lateOrderCount} 張`, good: after.lateOrderCount <= before.lateOrderCount },
    { label: '總生產工期', b: fmtMinutes(before.makespanMinutes), a: fmtMinutes(after.makespanMinutes), good: after.makespanMinutes <= before.makespanMinutes },
  ];
  return (
    <table className="metric-compare-table w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-slate-400">
          <th className="py-1">指標</th>
          <th className="py-1">調整前</th>
          <th className="py-1">調整後</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label}>
            <td className="py-0.5 text-slate-500">{r.label}</td>
            <td className="py-0.5 text-slate-400">{r.b}</td>
            <td className={`py-0.5 font-medium ${r.good ? 'text-green-700' : 'text-red-600'}`}>{r.a}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function fmtTardinessChange(oldMin: number, newMin: number) {
  if (oldMin === 0 && newMin === 0) {
    return <span className="text-green-700">沒有逾期</span>;
  }
  const oldText = oldMin === 0 ? '無延遲' : `${oldMin} 分`;
  const newText = newMin === 0 ? '無延遲' : `${newMin} 分`;
  const colorClass = newMin > oldMin ? 'text-red-600' : 'text-green-700';
  return (
    <span>
      {oldText} → <span className={colorClass}>{newText}</span>
    </span>
  );
}

function ImpactTable({ impacts }: { impacts: OrderImpact[] }) {
  return (
    <table className="impact-table mt-1 w-full text-xs">
      <thead>
        <tr className="text-left text-slate-400">
          <th className="py-1">訂單</th>
          <th className="py-1">完成時間</th>
          <th className="py-1">延遲變化</th>
        </tr>
      </thead>
      <tbody>
        {impacts.map((i) => (
          <tr key={i.orderId}>
            <td className="py-0.5">
              {i.orderNumber}
              {i.becameLate && <Badge tone="red"> 變為逾期</Badge>}
            </td>
            <td className="py-0.5 text-slate-500">
              {i.oldCompletion ? fmtDateTime(i.oldCompletion) : '—'} → {i.newCompletion ? fmtDateTime(i.newCompletion) : '未排入'}
            </td>
            <td className="py-0.5">
              {fmtTardinessChange(i.oldTardinessMinutes, i.newTardinessMinutes)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const TASK_TYPE_LABELS: Record<string, string> = {
  production: '生產',
  setup: '換線',
  cleaning: '清洗',
  maintenance: '維保',
};

function GanttPreview({ tasks, breakdown, machines }: { tasks: Task[]; breakdown: { machineId: string; startTime: string; estimatedRepairTime: string } | null; machines: Machine[] }) {
  const timeRange = useMemo(() => {
    if (tasks.length === 0) return null;
    let min = Infinity;
    let max = -Infinity;
    for (const t of tasks) {
      min = Math.min(min, Date.parse(t.startTime));
      max = Math.max(max, Date.parse(t.endTime));
    }
    if (breakdown) {
      min = Math.min(min, Date.parse(breakdown.startTime));
      max = Math.max(max, Date.parse(breakdown.estimatedRepairTime));
    }
    min -= 2 * 3600_000;
    max += 2 * 3600_000;
    return { start: min, end: max };
  }, [tasks, breakdown]);

  const pxPerMin = 0.22;
  const rowHeight = 36;
  const labelWidth = 100;

  const sortedMachines = useMemo(() => {
    return [...(machines ?? [])].sort((a, b) => a.machineCode.localeCompare(b.machineCode));
  }, [machines]);

  const xOf = (timeStr: string) => {
    if (!timeRange) return 0;
    const t = Date.parse(timeStr);
    return ((t - timeRange.start) / 60_000) * pxPerMin;
  };

  const wOf = (startTimeStr: string, endTimeStr: string) => {
    const s = Date.parse(startTimeStr);
    const e = Date.parse(endTimeStr);
    return ((e - s) / 60_000) * pxPerMin;
  };

  const ticks = useMemo(() => {
    if (!timeRange) return [];
    const arr = [];
    const startHour = new Date(timeRange.start);
    startHour.setMinutes(0, 0, 0);
    let current = startHour.getTime();
    while (current < timeRange.end) {
      arr.push(current);
      current += 12 * 3600_000;
    }
    return arr;
  }, [timeRange]);

  if (!timeRange) return null;

  const totalWidth = ((timeRange.end - timeRange.start) / 60_000) * pxPerMin;

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 mt-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-700">⚙️ 預估調整後甘特圖預覽</span>
        <div className="flex gap-3 text-[10px] text-slate-500">
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 bg-blue-500 rounded-sm"></span>生產
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 bg-yellow-500 rounded-sm"></span>換線
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 bg-emerald-500 rounded-sm"></span>清洗
          </span>
          <span className="flex items-center gap-1">
            <span
              className="w-2.5 h-2.5 rounded-sm"
              style={{
                background: 'repeating-linear-gradient(45deg, #ef4444, #ef4444 2px, #fca5a5 2px, #fca5a5 4px)',
              }}
            ></span>
            機台故障
          </span>
        </div>
      </div>

      <div className="relative border border-slate-200 bg-white rounded overflow-hidden flex flex-col">
        {/* Single Scrollable Container */}
        <div className="overflow-x-auto max-w-full">
          <div style={{ width: labelWidth + totalWidth }} className="flex flex-col">
            {/* Timeline Header */}
            <div className="flex border-b border-slate-200 bg-slate-100" style={{ height: 24 }}>
              <div
                className="sticky left-0 z-10 bg-slate-100 border-r border-slate-200 px-2 flex items-center text-[10px] font-semibold text-slate-500"
                style={{ width: labelWidth }}
              >
                機台
              </div>
              <div className="relative flex-1" style={{ height: 24, width: totalWidth }}>
                {ticks.map((t: number) => (
                  <div
                    key={t}
                    className="absolute text-[9px] text-slate-400 border-l border-slate-200 pl-1"
                    style={{ left: ((t - timeRange.start) / 60_000) * pxPerMin, top: 4 }}
                  >
                    {new Intl.DateTimeFormat('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false }).format(new Date(t))}
                  </div>
                ))}
              </div>
            </div>

            {/* Machine Rows */}
            {sortedMachines.map((m: Machine) => (
              <div key={m.id} className="flex border-b border-slate-100 last:border-b-0" style={{ height: rowHeight }}>
                {/* Machine Code */}
                <div
                  className="sticky left-0 z-10 bg-white border-r border-slate-200 px-2 flex items-center text-xs font-medium text-slate-700"
                  style={{ width: labelWidth }}
                >
                  {m.machineCode}
                </div>

                {/* Timeline row */}
                <div className="relative flex-1" style={{ height: rowHeight, width: totalWidth }}>
                  {ticks.map((t: number) => (
                    <div
                      key={t}
                      className="absolute inset-y-0 w-px bg-slate-50"
                      style={{ left: ((t - timeRange.start) / 60_000) * pxPerMin }}
                    />
                  ))}

                  {/* Tasks */}
                  {tasks
                    .filter((t: Task) => t.machineId === m.id)
                    .map((t: Task) => {
                      const left = xOf(t.startTime);
                      const width = Math.max(2, wOf(t.startTime, t.endTime));
                      const isProduction = t.taskType === 'production';
                      const taskName = t.taskId.includes('-production')
                        ? t.taskId.split('-')[2] || t.taskId.split('-')[1]
                        : t.taskId.split('-')[1] || t.taskId.split('-')[0];
                      const taskStyle: React.CSSProperties = {
                        left,
                        width,
                        top: 5,
                        height: rowHeight - 10,
                        backgroundColor:
                          t.taskType === 'production'
                            ? '#3b82f6'
                            : t.taskType === 'setup'
                              ? '#eab308'
                              : t.taskType === 'cleaning'
                                ? '#10b981'
                                : '#6b7280',
                      };
                      return (
                        <div
                          key={t.taskId}
                          className="absolute rounded-sm text-[9px] text-white overflow-hidden flex items-center px-1 font-semibold"
                          style={taskStyle}
                          title={`${isProduction ? '生產 ' + taskName : TASK_TYPE_LABELS[t.taskType] ?? t.taskType} (${fmtTime(t.startTime)}-${fmtTime(t.endTime)})`}
                        >
                          <span className="truncate">{isProduction ? taskName : ''}</span>
                        </div>
                      );
                    })}

                  {/* Breakdown Overlay */}
                  {breakdown && breakdown.machineId === m.id && (
                    <div
                      className="absolute rounded-sm border border-red-500"
                      style={{
                        left: xOf(breakdown.startTime),
                        width: wOf(breakdown.startTime, breakdown.estimatedRepairTime),
                        top: 4,
                        height: rowHeight - 8,
                        background: 'repeating-linear-gradient(45deg, rgba(239,68,68,0.25), rgba(239,68,68,0.25) 4px, rgba(254,226,226,0.6) 4px, rgba(254,226,226,0.6) 8px)',
                      }}
                      title={`故障時間: ${fmtDateTime(breakdown.startTime)} - ${fmtDateTime(breakdown.estimatedRepairTime)}`}
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
