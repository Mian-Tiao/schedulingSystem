/**
 * 情境模擬:急單插入、機台故障。純模擬,不寫入正式排程。
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, apiPost } from '../api/client';
import { useMachines, useProducts, useScenarios } from '../api/hooks';
import { Badge, Banner, Button, EmptyState, ErrorState, Field, inputCls, Loading, PageHeader, PageMetrics } from '../components/ui';
import type { Metrics, OrderImpact } from '../types';
import { fmtDateTime, fmtMinutes, fromLocalInput, pct, toLocalInput } from '../utils/time';

type Tab = 'urgent' | 'breakdown';

interface UrgentResult {
  baseline: { metrics: Metrics };
  urgentOrder: { orderNumber: string; processingTime: number };
  insert:
    | { ok: true; metrics: Metrics; urgentTardinessMinutes: number | null; affectedOrders: OrderImpact[] }
    | { ok: false; reason: string };
  rebuild: {
    ok: boolean;
    metrics: Metrics;
    urgentTardinessMinutes: number | null;
    affectedOrders: OrderImpact[];
    unscheduled: { orderNumber: string; reason: string }[];
  };
}

interface BreakdownResult {
  baseline: { metrics: Metrics };
  breakdown: { machineName: string; startTime: string; estimatedRepairTime: string };
  withEstimatedRepair: {
    metrics: Metrics;
    impacts: OrderImpact[];
    lateOrders: { orderNumber: string; tardinessMinutes: number; priority: number }[];
    lateOrderCount: number;
  };
  reverseAnalysis: { latestSafeRepairTime: string | null; message: string };
  suggestions: {
    minimumLateOrderCount: number;
    transferMachines: { machineCode: string; machineName: string }[];
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
              <input type="datetime-local" className={inputCls} value={bdForm.startTime} onChange={(e) => setBdForm({ ...bdForm, startTime: e.target.value })} />
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
                      {bdResult.suggestions.transferMachines.length > 0
                        ? bdResult.suggestions.transferMachines.map((m) => `${m.machineCode} ${m.machineName}`).join('、')
                        : '(沒有其他機台可支援)'}
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
    { label: 'Makespan', b: fmtMinutes(before.makespanMinutes), a: fmtMinutes(after.makespanMinutes), good: after.makespanMinutes <= before.makespanMinutes },
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

function ImpactTable({ impacts }: { impacts: OrderImpact[] }) {
  return (
    <table className="impact-table mt-1 w-full text-xs">
      <thead>
        <tr className="text-left text-slate-400">
          <th className="py-1">訂單</th>
          <th className="py-1">完成時間變化</th>
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
              {i.oldTardinessMinutes} 分 → <span className={i.newTardinessMinutes > i.oldTardinessMinutes ? 'text-red-600' : 'text-green-700'}>{i.newTardinessMinutes} 分</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
