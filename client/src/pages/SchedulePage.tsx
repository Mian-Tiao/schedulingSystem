import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../api/client';
import { useScenarios, useScheduleMutations } from '../api/hooks';
import { Badge, Banner, Button, EmptyState, ErrorState, Loading, PageHeader, PageMetrics } from '../components/ui';
import type { Metrics, ObjectiveId, ScenarioSummary } from '../types';
import { OBJECTIVE_LABELS } from '../types';
import { fmtDateTime, fmtMinutes, pct } from '../utils/time';

const METRIC_ROWS: { key: keyof Metrics; label: string; fmt: (v: number) => string; better: 'high' | 'low' }[] = [
  { key: 'onTimeDeliveryRate', label: '準時交貨率', fmt: pct, better: 'high' },
  { key: 'averageTardinessMinutes', label: '平均延遲時間', fmt: fmtMinutes, better: 'low' },
  { key: 'maximumTardinessMinutes', label: '最大延遲時間', fmt: fmtMinutes, better: 'low' },
  { key: 'lateOrderCount', label: '延遲訂單數', fmt: (v) => `${v} 張`, better: 'low' },
  { key: 'makespanMinutes', label: '總完工時間 Makespan', fmt: fmtMinutes, better: 'low' },
  { key: 'machineUtilizationRate', label: '機台利用率(純生產)', fmt: pct, better: 'high' },
  { key: 'machineOccupancyRate', label: '機台占用率(含換模清洗)', fmt: pct, better: 'high' },
  { key: 'totalSetupMinutes', label: '總換模時間', fmt: fmtMinutes, better: 'low' },
  { key: 'totalCleaningMinutes', label: '總清洗時間', fmt: fmtMinutes, better: 'low' },
  { key: 'averageFlowTimeMinutes', label: '平均流程時間', fmt: fmtMinutes, better: 'low' },
];

export function SchedulePage() {
  const { data: scenarios, isLoading, error } = useScenarios();
  const { generate } = useScheduleMutations();
  const [objective, setObjective] = useState<ObjectiveId>('ON_TIME_DELIVERY');
  const [genError, setGenError] = useState('');
  const [issues, setIssues] = useState<{ level: string; message: string }[]>([]);

  const run = async () => {
    setGenError('');
    setIssues([]);
    try {
      const result = await generate.mutateAsync(objective);
      setIssues(result.issues);
    } catch (e) {
      if (e instanceof ApiError) {
        setGenError(e.message);
        const details = e.details as { level: string; message: string }[] | undefined;
        if (Array.isArray(details)) setIssues(details);
      } else {
        setGenError('排程執行失敗,請稍後再試');
      }
    }
  };

  if (isLoading) return <Loading />;
  if (error) return <ErrorState message={(error as Error).message} />;

  const list = scenarios ?? [];
  const top3 = list.filter((s) => s.rank <= 3);
  const best = list.find((s) => s.rank === 1);

  return (
    <div className="schedule-page space-y-6">
      <PageHeader
        eyebrow="SCHEDULING ENGINE"
        title="排程中心"
        description="依照交期、流程時間與機台效率比較多種演算法，找出最符合現場目標的方案。"
      />

      <PageMetrics
        items={[
          { label: '現有方案', value: list.length, detail: '可供比較的演算法結果', tone: 'blue' },
          { label: '最佳方案', value: best?.algorithm ?? '—', detail: best ? `系統評分 ${best.score}` : '尚未執行排程', tone: 'green' },
          { label: '準時交貨率', value: best ? pct(best.metrics.onTimeDeliveryRate) : '—', detail: '排名第一方案' },
          { label: '延遲訂單', value: best ? `${best.metrics.lateOrderCount} 張` : '—', detail: '排名第一方案', tone: best && best.metrics.lateOrderCount > 0 ? 'red' : 'default' },
        ]}
      />

      <section className="schedule-launch-card">
        <div className="section-command-heading">
          <span>01</span>
          <div>
            <p>SCHEDULE RUN</p>
            <h2>建立新排程</h2>
            <small>選擇這次最重要的營運目標，系統會同時計算四種演算法。</small>
          </div>
        </div>
        <div className="schedule-launch-controls">
          <label className="block">
            <span className="mb-2 block text-xs font-semibold text-slate-600">本次排程最重要的目標</span>
            <select
              className="app-input !w-72"
              value={objective}
              onChange={(e) => setObjective(e.target.value as ObjectiveId)}
            >
              {(Object.keys(OBJECTIVE_LABELS) as ObjectiveId[]).map((o) => (
                <option key={o} value={o}>
                  {OBJECTIVE_LABELS[o]}
                </option>
              ))}
            </select>
          </label>
          <Button onClick={run} disabled={generate.isPending}>
            {generate.isPending ? '排程運算中,請稍候…' : '▶ 執行排程(FIFO / EDD / SPT / CR)'}
          </Button>
          {generate.isPending && (
            <span className="flex items-center gap-2 text-sm text-slate-500">
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-blue-500" />
              正在執行四種演算法並計算績效…
            </span>
          )}
        </div>
        {genError && <ErrorState message={genError} />}
        {issues.map((i, idx) => (
          <Banner key={idx} tone={i.level === 'error' ? 'error' : 'warn'}>
            {i.message}
          </Banner>
        ))}
      </section>

      {list.length === 0 ? (
        <EmptyState text="尚未產生排程方案。請先建立產品、機台與訂單,再執行排程。" />
      ) : (
        <>
          <section>
            <div className="section-row-heading">
              <div>
                <span>02 / RECOMMENDATION</span>
                <h2>推薦方案</h2>
              </div>
              <p>目標：{OBJECTIVE_LABELS[list[0]!.objective]} · {fmtDateTime(list[0]!.generatedAt)} 產生</p>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              {top3.map((s) => (
                <RecommendCard key={s.scenarioId} s={s} />
              ))}
            </div>
          </section>

          <section className="data-table-card rounded-lg border border-slate-200 bg-white p-4">
            <div className="section-row-heading compact">
              <div>
                <span>03 / PERFORMANCE</span>
                <h2>方案績效比較</h2>
              </div>
              <p>綠色數值代表該指標的最佳結果</p>
            </div>
            <div className="overflow-x-auto">
              <table className="data-table w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500">
                    <th className="py-2 pr-4">指標</th>
                    {list.map((s) => (
                      <th key={s.scenarioId} className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          {s.rank === 1 && <span title="推薦第一名">🏆</span>}
                          {s.algorithm}
                          {s.isManuallyAdjusted && <Badge tone="blue">已人工調整</Badge>}
                        </div>
                        <span className="font-normal text-slate-400">
                          第 {s.rank} 名・{s.score} 分
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {METRIC_ROWS.map((row) => {
                    const values = list.map((s) => s.metrics[row.key]);
                    const best = row.better === 'high' ? Math.max(...values) : Math.min(...values);
                    return (
                      <tr key={row.key}>
                        <td className="py-2 pr-4 text-slate-600">{row.label}</td>
                        {list.map((s) => {
                          const v = s.metrics[row.key];
                          const isBest = v === best && new Set(values).size > 1;
                          return (
                            <td key={s.scenarioId} className={`px-3 py-2 ${isBest ? 'font-semibold text-green-700' : ''}`}>
                              {row.fmt(v)}
                              {isBest && <span className="ml-1 text-xs">最佳</span>}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                  <tr>
                    <td className="py-2 pr-4 text-slate-600">甘特圖</td>
                    {list.map((s) => (
                      <td key={s.scenarioId} className="px-3 py-2">
                        <Link className="text-blue-600 hover:underline" to={`/gantt/${s.scenarioId}`}>
                          查看 →
                        </Link>
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
            {list.some((s) => s.unscheduledOrders.length > 0) && (
              <div className="mt-3">
                {list.map((s) =>
                  s.unscheduledOrders.map((u) => (
                    <Banner key={`${s.scenarioId}-${u.orderId}`} tone="warn">
                      [{s.algorithm}] 訂單 {u.orderNumber} 未排入:{u.reason}
                    </Banner>
                  )),
                )}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function RecommendCard({ s }: { s: ScenarioSummary }) {
  const medal = s.rank === 1 ? '🥇 推薦第一名' : s.rank === 2 ? '🥈 推薦第二名' : '🥉 推薦第三名';
  return (
    <article className={`scenario-card ${s.rank === 1 ? 'is-winner' : ''}`}>
      <div className="scenario-card-top">
        <span>{medal}</span>
        <Badge tone={s.rank === 1 ? 'blue' : 'slate'}>{s.algorithm}</Badge>
      </div>
      <div className="scenario-score">
        <strong>{s.score}</strong>
        <span>系統評分</span>
      </div>
      <div className="scenario-mini-metrics">
        <span><small>準交率</small>{pct(s.metrics.onTimeDeliveryRate)}</span>
        <span><small>延遲單</small>{s.metrics.lateOrderCount} 張</span>
        <span><small>利用率</small>{pct(s.metrics.machineUtilizationRate)}</span>
      </div>
      <p className="scenario-reason">{s.recommendationReason}</p>
      <Link to={`/gantt/${s.scenarioId}`} className="scenario-link">
        查看時間軸 <span aria-hidden>→</span>
      </Link>
    </article>
  );
}
