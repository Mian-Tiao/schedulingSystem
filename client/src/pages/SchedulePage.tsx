import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../api/client';
import { useMachines, useOrders, useScenarios, useScheduleMutations } from '../api/hooks';
import { pickMinimumMachines, type MockGenerateResult } from '../api/mock/schedule';
import { Badge, Banner, Button, EmptyState, ErrorState, Loading } from '../components/ui';
import type { ObjectiveId, ScenarioSummary } from '../types';
import { OBJECTIVE_LABELS } from '../types';
import { downloadCsv, fileStamp } from '../utils/exportCsv';
import { fmtDateTime } from '../utils/time';
import { GanttPreview } from './GanttPreview';
import { METRIC_ROWS, buildAdvice, cardHighlight, splitMetrics, type MetricRow } from './scheduleLogic';

type Mode = 'auto' | 'manual';

export function SchedulePage() {
  const { data: scenarios, isLoading, error } = useScenarios();
  const { data: machines } = useMachines();
  const { data: orders } = useOrders();
  const { generate } = useScheduleMutations();

  const [mode, setMode] = useState<Mode>('auto');
  const [objective, setObjective] = useState<ObjectiveId>('ON_TIME_DELIVERY');
  const [selectedMachineIds, setSelectedMachineIds] = useState<string[]>([]);
  const [machinesReady, setMachinesReady] = useState(false);
  const [genError, setGenError] = useState('');
  const [issues, setIssues] = useState<{ level: string; message: string }[]>([]);
  const [runResult, setRunResult] = useState<MockGenerateResult | null>(null);
  const [autoPick, setAutoPick] = useState<{ chosen: string[]; dropped: string[] } | null>(null);
  const [running, setRunning] = useState(false);
  const [setupCollapsed, setSetupCollapsed] = useState(false);
  const [tableExpanded, setTableExpanded] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);

  const availableMachines = (machines ?? []).filter((m) => m.status !== 'disabled');

  // 機台載入後,預設全選(僅初始化一次)
  useEffect(() => {
    if (machines && !machinesReady) {
      setSelectedMachineIds(availableMachines.map((m) => m.id));
      setMachinesReady(true);
    }
  }, [machines, machinesReady, availableMachines]);

  const toggleMachine = (id: string) =>
    setSelectedMachineIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const busy = generate.isPending || running;

  // 切換模式時清掉上一次的結果與提示,避免自動模式仍顯示手動模式的模擬卡片
  const switchMode = (m: Mode) => {
    setMode(m);
    setRunResult(null);
    setAutoPick(null);
    setIssues([]);
    setGenError('');
  };

  const run = async () => {
    setGenError('');
    setIssues([]);
    setAutoPick(null);
    try {
      if (mode === 'manual') {
        if (selectedMachineIds.length === 0) {
          setGenError('請至少勾選一台機台再執行排程');
          return;
        }
        const result = await generate.mutateAsync({ objective, machineIds: selectedMachineIds });
        setRunResult({
          ...result,
          machineLoad: selectedMachineIds.map((machineId) => ({ machineId, busyMinutes: 1 })),
        });
        setIssues(result.issues);
      } else {
        // 自動模式:走真後端(用全部機台 → 產生真方案,可看真甘特圖)。
        // 「開最少機台」仍是建議顯示；手動模式則已會將 machineIds 送至後端限定排程機台。
        const result = await generate.mutateAsync({ objective });
        setRunResult({ ...result, machineLoad: [] });
        setIssues(result.issues);
        const ids = availableMachines.map((m) => m.id);
        setAutoPick(pickMinimumMachines(ids, orders?.length ?? 12));
      }
      setSetupCollapsed(true); // 執行成功後收合設置區,把版面還給決策內容
    } catch (e) {
      if (e instanceof ApiError) {
        const details = e.details as { level: string; message: string }[] | undefined;
        if (Array.isArray(details) && details.length > 0) {
          const errors = details.filter((detail) => detail.level === 'error');
          const warnings = details.filter((detail) => detail.level !== 'error');
          setGenError(errors.map((detail) => detail.message).join('；') || e.message);
          setIssues(warnings);
        } else {
          setGenError(e.message);
        }
      } else {
        setGenError(e instanceof Error ? e.message : '排程執行失敗,請稍後再試');
      }
    } finally {
      setRunning(false);
    }
  };

  if (isLoading) return <Loading />;
  if (error) return <ErrorState message={(error as Error).message} />;

  const list: ScenarioSummary[] = runResult?.scenarios ?? scenarios ?? [];
  const top3 = list.filter((s) => s.rank <= 3);
  const advice = mode === 'manual' && runResult ? buildAdvice(runResult, selectedMachineIds, availableMachines) : [];
  const resultObjective = list[0]?.objective ?? objective;
  const { decisive, consistent } = splitMetrics(list, resultObjective);
  const maxScore = Math.max(1, ...list.map((s) => s.score));

  // 可預覽甘特圖的方案(排除模擬資料);預設顯示推薦第一名
  const previewable = list.filter((s) => !s.scenarioId.startsWith('mock-'));
  const activePreviewId =
    previewId && previewable.some((s) => s.scenarioId === previewId)
      ? previewId
      : previewable.find((s) => s.rank === 1)?.scenarioId ?? previewable[0]?.scenarioId ?? null;

  const exportComparison = () => {
    const rows: (string | number)[][] = [];
    rows.push(['方案(演算法)', ...list.map((s) => s.algorithm)]);
    rows.push(['排名', ...list.map((s) => `第 ${s.rank} 名`)]);
    rows.push(['綜合分數', ...list.map((s) => s.score)]);
    for (const row of METRIC_ROWS) {
      rows.push([row.label, ...list.map((s) => row.fmt(s.metrics[row.key]))]);
    }
    downloadCsv(`方案績效比較_${fileStamp()}`, rows);
  };

  const renderMetricRow = (row: MetricRow) => {
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
              {isBest && <span className="ml-1 text-xs">✓ 最佳</span>}
            </td>
          );
        })}
      </tr>
    );
  };

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-800">排程中心</h1>

      {/* 收合後的單行狀態列 */}
      {setupCollapsed && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3">
          <button
            type="button"
            onClick={() => setSetupCollapsed(false)}
            aria-expanded={false}
            className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-left text-sm transition hover:opacity-70"
          >
            <Badge tone={mode === 'auto' ? 'blue' : 'slate'}>{mode === 'auto' ? '自動模式' : '手動模式'}</Badge>
            <span className="text-slate-600">
              目標:<span className="font-medium text-slate-800">{OBJECTIVE_LABELS[objective]}</span>
            </span>
            {mode === 'manual' && <span className="text-slate-500">機台 {selectedMachineIds.length} 台</span>}
            {mode === 'auto' && autoPick && <span className="text-slate-500">建議最少 {autoPick.chosen.length} 台</span>}
            <span className="text-xs text-slate-400">✎ 點此修改設定</span>
          </button>
          <Button onClick={run} disabled={busy}>
            {busy ? '排程運算中…' : '↻ 重新執行排程'}
          </Button>
        </div>
      )}

      {/* 完整設置表單(收合時以 grid-rows 動畫收起) */}
      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-in-out ${
          setupCollapsed ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]'
        }`}
      >
        <div className={`overflow-hidden ${setupCollapsed ? 'pointer-events-none' : ''}`} aria-hidden={setupCollapsed}>
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">1. 選擇排程模式與目標,執行排程</h2>

            {/* 模式切換 */}
            <div className="mb-4">
              <span className="mb-1.5 block text-sm text-slate-600">排程模式</span>
              <div className="inline-flex overflow-hidden rounded-md border border-slate-300">
                <button
                  type="button"
                  onClick={() => switchMode('auto')}
                  className={`px-4 py-1.5 text-sm font-medium transition-colors ${
                    mode === 'auto' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  自動模式
                </button>
                <button
                  type="button"
                  onClick={() => switchMode('manual')}
                  className={`px-4 py-1.5 text-sm font-medium transition-colors ${
                    mode === 'manual' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  手動模式
                </button>
              </div>
              <p className="mt-1.5 text-xs text-slate-400">
                {mode === 'auto'
                  ? '自動模式:系統用全部機台自動排好(可查看甘特圖),並評估「其實最少需要幾台」供你參考。'
                  : '手動模式:由你勾選要投入的機台,系統只在這些機台上排程,並提供機台配置建議。'}
              </p>
            </div>

            {/* 手動模式:機台勾選 */}
            {mode === 'manual' && (
              <div className="mb-4 rounded-md border border-slate-200 bg-slate-50 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-700">
                    選擇投入排程的機台(已選 {selectedMachineIds.length} / {availableMachines.length} 台)
                  </span>
                  <div className="flex gap-2">
                    <Button variant="ghost" onClick={() => setSelectedMachineIds(availableMachines.map((m) => m.id))}>
                      全選
                    </Button>
                    <Button variant="ghost" onClick={() => setSelectedMachineIds([])}>
                      全不選
                    </Button>
                  </div>
                </div>
                {availableMachines.length === 0 ? (
                  <p className="text-sm text-slate-400">尚無可用機台,請先到「機台管理」建立機台。</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {availableMachines.map((m) => {
                      const checked = selectedMachineIds.includes(m.id);
                      return (
                        <label
                          key={m.id}
                          className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors ${
                            checked
                              ? 'border-blue-400 bg-blue-50 text-blue-800'
                              : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                          }`}
                        >
                          <input type="checkbox" checked={checked} onChange={() => toggleMachine(m.id)} />
                          <span className="font-medium">{m.machineCode}</span>
                          <span className="text-slate-400">{m.machineName}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* 目標 + 執行 */}
            <div className="flex flex-wrap items-end gap-3">
              <label className="block">
                <span className="mb-1 block text-sm text-slate-600">本次排程最重要的目標是?</span>
                <select
                  className="w-64 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
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
              <Button onClick={run} disabled={busy}>
                {busy
                  ? '排程運算中,請稍候…'
                  : mode === 'manual'
                    ? `▶ 執行排程(手動・${selectedMachineIds.length} 台機台)`
                    : '▶ 執行排程(FIFO / EDD / SPT / CR)'}
              </Button>
              {busy && (
                <span className="flex items-center gap-2 text-sm text-slate-500">
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-blue-500" />
                  正在執行四種演算法並計算績效…
                </span>
              )}
            </div>
          </section>
        </div>
      </div>

      {/* 執行提示與警告(收合後仍需可見,故置於設置區之外) */}
      {genError && <ErrorState title="無法執行排程" message={genError} />}
      {issues.map((i, idx) => (
        <Banner key={idx} tone={i.level === 'error' ? 'error' : 'warn'}>
          {i.message}
        </Banner>
      ))}

      {/* 自動模式:開最少機台結果 */}
      {mode === 'auto' && autoPick && (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">🖥 機台數建議(開最少機台)</h2>
          <Banner tone="info">
            本次以全部機台排程。系統評估其實只需 {autoPick.chosen.length} 台(
            {autoPick.chosen.map((id) => availableMachines.find((m) => m.id === id)?.machineName ?? id).join('、')})
            即可滿足產能
            {autoPick.dropped.length > 0
              ? `,可考慮關閉其餘 ${autoPick.dropped.length} 台(${autoPick.dropped
                  .map((id) => availableMachines.find((m) => m.id === id)?.machineName ?? id)
                  .join('、')})節省電費。`
              : '(目前已是最少機台數)。'}
          </Banner>
        </section>
      )}

      {/* 防呆智慧建議(手動模式) */}
      {advice.length > 0 && (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">💡 機台配置建議(防呆)</h2>
          {advice.map((a, idx) => (
            <Banner key={idx} tone={a.tone}>
              {a.text}
            </Banner>
          ))}
        </section>
      )}

      {list.length === 0 ? (
        <EmptyState text="尚未產生排程方案。請先建立產品、機台與訂單,再執行排程。" />
      ) : (
        <>
          <section>
            <h2 className="mb-3 text-sm font-semibold text-slate-700">
              2. 推薦方案(目標:{OBJECTIVE_LABELS[list[0]!.objective]},{fmtDateTime(list[0]!.generatedAt)} 產生)
            </h2>
            <div className="grid gap-4 md:grid-cols-3">
              {top3.map((s) => (
                <RecommendCard key={s.scenarioId} s={s} all={list} maxScore={maxScore} decisiveRows={decisive} />
              ))}
            </div>
          </section>

          {activePreviewId && (
            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-700">3. 排程結果甘特圖(直接在此檢視,免跳頁)</h2>
                <Link
                  to={`/gantt/${activePreviewId}`}
                  className="text-sm font-medium text-blue-600 hover:underline"
                >
                  在完整甘特圖中拖曳調整 →
                </Link>
              </div>
              {/* 演算法分頁切換 */}
              <div className="mb-3 flex flex-wrap gap-1.5">
                {previewable.map((s) => (
                  <button
                    key={s.scenarioId}
                    type="button"
                    onClick={() => setPreviewId(s.scenarioId)}
                    className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
                      s.scenarioId === activePreviewId
                        ? 'border-blue-500 bg-blue-600 text-white'
                        : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {s.rank === 1 && '🏆 '}
                    {s.algorithm}
                    <span className={s.scenarioId === activePreviewId ? 'ml-1 opacity-80' : 'ml-1 text-slate-400'}>
                      第 {s.rank} 名
                    </span>
                  </button>
                ))}
              </div>
              <GanttPreview scenarioId={activePreviewId} />
            </section>
          )}

          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-700">4. 方案績效比較</h2>
              <Button variant="secondary" onClick={exportComparison}>
                ⬇ 匯出績效比較(CSV)
              </Button>
            </div>
            <p className="mb-3 text-xs text-slate-400">
              預設只顯示各方案「有明顯差異」的決定性指標;三方案表現相近的項目可展開查看。
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
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
                  {decisive.map(renderMetricRow)}
                  {tableExpanded && consistent.map(renderMetricRow)}
                  <tr>
                    <td className="py-2 pr-4 text-slate-600">甘特圖</td>
                    {list.map((s) => (
                      <td key={s.scenarioId} className="px-3 py-2">
                        {s.scenarioId.startsWith('mock-') ? (
                          <span className="text-slate-300" title="模擬資料無法查看甘特圖">
                            —
                          </span>
                        ) : (
                          <Link className="text-blue-600 hover:underline" to={`/gantt/${s.scenarioId}`}>
                            查看 →
                          </Link>
                        )}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
            {consistent.length > 0 && (
              <button
                type="button"
                onClick={() => setTableExpanded((v) => !v)}
                className="mt-3 text-sm font-medium text-blue-600 hover:underline"
              >
                {tableExpanded
                  ? '收合一致性指標 ⌃'
                  : `展開完整績效比較(共 ${METRIC_ROWS.length} 項,另 ${consistent.length} 項三方案表現相近) ⌄`}
              </button>
            )}
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

function RecommendCard({
  s,
  all,
  maxScore,
  decisiveRows,
}: {
  s: ScenarioSummary;
  all: ScenarioSummary[];
  maxScore: number;
  decisiveRows: MetricRow[];
}) {
  const medal = s.rank === 1 ? '🥇 推薦第一名' : s.rank === 2 ? '🥈 推薦第二名' : '🥉 推薦第三名';
  const isMock = s.scenarioId.startsWith('mock-');
  const barPct = Math.round((s.score / maxScore) * 100);
  const highlight = cardHighlight(s, all, decisiveRows);
  return (
    <div
      className={`flex min-h-[188px] flex-col rounded-lg bg-white p-4 ${
        s.rank === 1 ? 'border-2 border-blue-500' : 'border border-slate-200'
      }`}
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-700">{medal}</span>
        <Badge tone={s.rank === 1 ? 'blue' : 'slate'}>{s.algorithm}</Badge>
      </div>

      {/* 分數:相對進度條 + 小字數值 */}
      <div className="mb-3">
        <div className="mb-1 flex items-baseline justify-between">
          <span className="text-xs text-slate-400">綜合分數</span>
          <span className={`font-bold ${s.rank === 1 ? 'text-blue-700' : 'text-slate-700'}`}>
            {s.score}
            <span className="ml-0.5 text-xs font-normal text-slate-400">分</span>
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className={`h-full rounded-full transition-all duration-200 ${s.rank === 1 ? 'bg-blue-500' : 'bg-slate-300'}`}
            style={{ width: `${barPct}%` }}
          />
        </div>
      </div>

      {/* 差異化說明:只講與其他方案拉開差距的那一項 */}
      <p className="mb-3 flex-1 text-xs leading-5 text-slate-600">{highlight}</p>

      {isMock ? (
        <span className="text-sm text-slate-300">模擬資料(甘特圖待後端串接)</span>
      ) : (
        <Link to={`/gantt/${s.scenarioId}`} className="text-sm text-blue-600 hover:underline">
          查看甘特圖 →
        </Link>
      )}
    </div>
  );
}
