/**
 * 互動式甘特圖:
 * - Y 軸機台、X 軸時間;生產/換模/清洗/維護不同樣式
 * - 水平縮放、時間軸滑動、日/班次/小時檢視
 * - 點擊查看詳細;拖曳調整開始時間或跨機台(15 分鐘吸附 + 時間提示)
 * - 放開後由後端驗證:不合法 → 彈回並顯示原因;合法 → 重算並顯示前後差異
 * - undo / redo / 回復原始排程(與後端同步)
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import { useMachines, useOrders, useProducts, useScenarioDetail, useScenarios, useScheduleMutations } from '../api/hooks';
import { Badge, Banner, Button, EmptyState, ErrorState, Loading, Modal, PageHeader, PageMetrics } from '../components/ui';
import { useGanttStore, type AdjustmentRecord } from '../stores/ganttStore';
import type { Machine, Metrics, Task } from '../types';
import { TASK_TYPE_LABELS } from '../types';
import { fmtDateTime, fmtMinutes, fmtTime, pct } from '../utils/time';

const ROW_H = 46;
const HEADER_H = 44;
const LABEL_W = 150;
const SNAP_MIN = 15;

const SCALES = [
  { id: 'hour', label: '小時', pxPerMin: 1.6 },
  { id: 'shift', label: '班次', pxPerMin: 0.55 },
  { id: 'day', label: '日', pxPerMin: 0.16 },
] as const;

interface DragState {
  task: Task;
  startClientX: number;
  startClientY: number;
  deltaMin: number;
  rowDelta: number;
  moved: boolean;
}

export function GanttPage() {
  const { scenarioId: paramId } = useParams();
  const navigate = useNavigate();
  const { data: scenarios } = useScenarios();
  const scenarioId = paramId ?? scenarios?.find((s) => s.rank === 1)?.scenarioId ?? null;
  const { data: scenario, isLoading, error } = useScenarioDetail(scenarioId);
  const { data: machines } = useMachines();
  const { data: orders } = useOrders();
  const { data: products } = useProducts();
  const { validateAdjustment, adjust, reset } = useScheduleMutations();

  const store = useGanttStore();
  const [scaleIdx, setScaleIdx] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [selected, setSelected] = useState<Task | null>(null);
  const [message, setMessage] = useState<{ tone: 'error' | 'success' | 'warn'; text: string } | null>(null);
  const [diff, setDiff] = useState<{ before: Metrics; after: Metrics; delays: { orderNumber: string; oldTardinessMinutes: number; newTardinessMinutes: number }[] } | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [busy, setBusy] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const [nowTime, setNowTime] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowTime(Date.now()), 10000);
    return () => clearInterval(timer);
  }, []);

  // scenario 載入後初始化歷史
  useEffect(() => {
    if (scenario) {
      useGanttStore.getState().init(scenario.tasks);
      setDiff(null);
      setMessage(null);
      const starts = scenario.tasks.map((task) => Date.parse(task.startTime));
      const ends = scenario.tasks.map((task) => Date.parse(task.endTime));
      const span = starts.length > 0 ? Math.max(...ends) - Math.min(...starts) : 0;
      setScaleIdx(span > 2 * 24 * 3600_000 ? 2 : 1);
      setZoom(1);
    }
    // 依 scenarioId/generatedAt 重新初始化即可,不需監聽整個 scenario 物件
  }, [scenario?.scenarioId, scenario?.generatedAt]);

  const tasks = store.currentTasks() ?? scenario?.tasks ?? [];

  const orderById = useMemo(() => new Map((orders ?? []).map((o) => [o.id, o])), [orders]);
  const productById = useMemo(() => new Map((products ?? []).map((p) => [p.id, p])), [products]);

  const machineRows: Machine[] = useMemo(
    () => [...(machines ?? [])].sort((a, b) => a.machineCode.localeCompare(b.machineCode)),
    [machines],
  );
  const rowIndex = useMemo(() => new Map(machineRows.map((m, i) => [m.id, i])), [machineRows]);

  const pxPerMin = SCALES[scaleIdx]!.pxPerMin * zoom;

  const timeRange = useMemo(() => {
    if (tasks.length === 0) return null;
    let min = Infinity;
    let max = -Infinity;
    for (const t of tasks) {
      min = Math.min(min, Date.parse(t.startTime));
      max = Math.max(max, Date.parse(t.endTime));
    }
    // 對齊到台北時間整日
    const TZOFF = 8 * 3600_000;
    const DAY = 86400_000;
    const start = Math.floor((min + TZOFF) / DAY) * DAY - TZOFF;
    const end = Math.ceil((max + TZOFF) / DAY) * DAY - TZOFF;
    return { start, end };
  }, [tasks]);

  const showNowLine = timeRange && nowTime >= timeRange.start && nowTime <= timeRange.end;
  const nowX = showNowLine ? ((nowTime - timeRange.start) / 60_000) * pxPerMin : 0;

  if (!scenarioId)
    return (
      <div className="space-y-4">
        <PageHeader
          eyebrow="SCHEDULE TIMELINE"
          title="甘特圖排程"
          description="以機台時間軸檢視生產任務，並透過拖曳調整工作開始時間與指派機台。"
        />
        <EmptyState text="尚未產生排程方案,請先到排程中心執行排程。" />
      </div>
    );
  if (isLoading || !scenario) return <Loading text="載入排程中…" />;
  if (error) return <ErrorState message={(error as Error).message} />;
  if (!timeRange) {
    const unscheduled = scenario.unscheduledOrders ?? [];
    return (
      <div className="space-y-4">
        <PageHeader
          eyebrow="SCHEDULE TIMELINE"
          title="甘特圖排程"
          description="目前方案沒有可顯示的生產任務，請先處理未排入原因。"
          actions={
            <select
              className="app-input !w-auto min-w-44"
              value={scenario.scenarioId}
              onChange={(event) => navigate(`/gantt/${event.target.value}`)}
            >
              {(scenarios ?? []).map((item) => (
                <option key={item.scenarioId} value={item.scenarioId}>
                  {item.algorithm} 方案(第 {item.rank} 名)
                </option>
              ))}
            </select>
          }
        />
        {unscheduled.length > 0 && (
          <Banner tone="warn">
            {unscheduled.map((order) => `${order.orderNumber}:${order.reason}`).join('；')}
          </Banner>
        )}
        <EmptyState
          text="這次排程沒有產生任何任務。請檢查可加工機台、規劃期間與工作時段後重新排程。"
          action={
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => navigate('/orders')}>管理訂單</Button>
              <Button onClick={() => navigate('/schedule')}>回排程中心</Button>
            </div>
          }
        />
      </div>
    );
  }

  const totalMin = (timeRange.end - timeRange.start) / 60_000;
  const chartW = totalMin * pxPerMin;

  const xOf = (iso: string) => ((Date.parse(iso) - timeRange.start) / 60_000) * pxPerMin;
  const wOf = (t: Task) => ((Date.parse(t.endTime) - Date.parse(t.startTime)) / 60_000) * pxPerMin;

  // ---- 拖曳處理 ----
  const onPointerDown = (e: React.PointerEvent, task: Task) => {
    if (task.taskType !== 'production') return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ task, startClientX: e.clientX, startClientY: e.clientY, deltaMin: 0, rowDelta: 0, moved: false });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const dxMin = (e.clientX - drag.startClientX) / pxPerMin;
    const snapped = Math.round(dxMin / SNAP_MIN) * SNAP_MIN;
    const rowDelta = Math.round((e.clientY - drag.startClientY) / ROW_H);
    setDrag({ ...drag, deltaMin: snapped, rowDelta, moved: drag.moved || Math.abs(snapped) >= SNAP_MIN || rowDelta !== 0 });
  };

  const onPointerUp = async () => {
    if (!drag) return;
    const d = drag;
    setDrag(null);
    if (!d.moved) {
      setSelected(d.task);
      return;
    }
    const fromRow = rowIndex.get(d.task.machineId) ?? 0;
    const toRow = Math.min(machineRows.length - 1, Math.max(0, fromRow + d.rowDelta));
    const targetMachine = machineRows[toRow]!;
    const newStart = new Date(Date.parse(d.task.startTime) + d.deltaMin * 60_000).toISOString();

    setBusy(true);
    setMessage(null);
    try {
      const validation = await validateAdjustment.mutateAsync({
        scenarioId: scenario.scenarioId,
        taskId: d.task.taskId,
        machineId: targetMachine.id,
        startTime: newStart,
      });
      if (!validation.valid) {
        setMessage({ tone: 'error', text: `無法移動:${validation.errors.join(';')}` });
        return; // 任務自動回到原位(狀態未變)
      }
      const result = await adjust.mutateAsync({
        scenarioId: scenario.scenarioId,
        taskId: d.task.taskId,
        machineId: targetMachine.id,
        startTime: newStart,
      });
      const adjustment: AdjustmentRecord = { taskId: d.task.taskId, machineId: targetMachine.id, startTime: newStart };
      useGanttStore.getState().pushSnapshot(result.tasks, adjustment);
      setDiff({
        before: validation.metricsBefore!,
        after: result.metrics,
        delays: (result as unknown as { delayDiffs?: { orderNumber: string; oldTardinessMinutes: number; newTardinessMinutes: number }[] }).delayDiffs ?? [],
      });
      const warn = result.warnings.length > 0 ? `;注意:${result.warnings.join(';')}` : '';
      setMessage({ tone: result.warnings.length > 0 ? 'warn' : 'success', text: `調整成功,已重新計算後續工作與績效${warn}` });
    } catch (e2) {
      setMessage({ tone: 'error', text: e2 instanceof ApiError ? `無法移動:${e2.message}` : '調整失敗,請稍後再試' });
    } finally {
      setBusy(false);
    }
  };

  // ---- undo / redo(與後端同步:reset 後重放調整)----
  const replayTo = async (targetCursor: number) => {
    setBusy(true);
    setMessage(null);
    try {
      await reset.mutateAsync(scenario.scenarioId);
      const history = useGanttStore.getState().history;
      for (let i = 1; i <= targetCursor; i++) {
        const adj = history[i]?.adjustment;
        if (adj) await adjust.mutateAsync({ scenarioId: scenario.scenarioId, ...adj });
      }
    } finally {
      setBusy(false);
    }
  };

  const doUndo = async () => {
    if (!store.canUndo()) return;
    const target = useGanttStore.getState().cursor - 1;
    try {
      await replayTo(target);
      useGanttStore.getState().undo();
      setMessage({ tone: 'success', text: '已復原上一步調整' });
    } catch {
      setMessage({ tone: 'error', text: '復原失敗,請重新整理頁面' });
    }
  };

  const doRedo = async () => {
    if (!store.canRedo()) return;
    const history = useGanttStore.getState().history;
    const next = useGanttStore.getState().cursor + 1;
    const adj = history[next]?.adjustment;
    if (!adj) return;
    setBusy(true);
    try {
      await adjust.mutateAsync({ scenarioId: scenario.scenarioId, ...adj });
      useGanttStore.getState().redo();
      setMessage({ tone: 'success', text: '已重做調整' });
    } catch {
      setMessage({ tone: 'error', text: '重做失敗,該調整可能已不合法' });
    } finally {
      setBusy(false);
    }
  };

  const doReset = async () => {
    setBusy(true);
    try {
      const result = await reset.mutateAsync(scenario.scenarioId);
      useGanttStore.getState().reset(result.tasks);
      setDiff(null);
      setMessage({ tone: 'success', text: '已回復系統原始排程' });
    } catch {
      setMessage({ tone: 'error', text: '回復失敗,請稍後再試' });
    } finally {
      setBusy(false);
    }
  };

  // ---- 時間刻度 ----
  const ticks: { x: number; label: string; major: boolean }[] = [];
  const hourMs = 3600_000;
  const stepMs = pxPerMin >= 1 ? hourMs : pxPerMin >= 0.4 ? 4 * hourMs : 24 * hourMs;
  for (let t = timeRange.start; t <= timeRange.end; t += stepMs) {
    const isMidnight = new Date(t + 8 * hourMs).getUTCHours() === 0;
    ticks.push({
      x: ((t - timeRange.start) / 60_000) * pxPerMin,
      label: isMidnight ? fmtDateTime(t) : fmtTime(t),
      major: isMidnight,
    });
  }

  const dragTask = drag?.task ?? null;
  const dragRow = dragTask ? Math.min(machineRows.length - 1, Math.max(0, (rowIndex.get(dragTask.machineId) ?? 0) + (drag?.rowDelta ?? 0))) : 0;
  const dragNewStart = dragTask ? Date.parse(dragTask.startTime) + (drag?.deltaMin ?? 0) * 60_000 : 0;
  const productionTaskCount = tasks.filter((task) => task.taskType === 'production').length;
  const supportTaskCount = tasks.length - productionTaskCount;

  return (
    <div className="gantt-page space-y-5">
      <PageHeader
        eyebrow="SCHEDULE TIMELINE"
        title="甘特圖排程"
        description="拖曳生產區塊即可調整時間或機台，系統會即時驗證限制並重新計算績效。"
        actions={
          <>
          <select
            className="app-input !w-auto min-w-44"
            value={scenario.scenarioId}
            onChange={(e) => navigate(`/gantt/${e.target.value}`)}
          >
            {(scenarios ?? []).map((s) => (
              <option key={s.scenarioId} value={s.scenarioId}>
                {s.algorithm} 方案(第 {s.rank} 名)
              </option>
            ))}
          </select>
          {scenario.isManuallyAdjusted && <Badge tone="blue">已人工調整</Badge>}
          </>
        }
      />
      <PageMetrics
        items={[
          { label: '生產區段', value: productionTaskCount, detail: '跨班次會拆成多段', tone: 'blue' },
          { label: '換模／清洗', value: supportTaskCount, detail: '支援作業', tone: supportTaskCount > 0 ? 'amber' : 'default' },
          { label: '排程機台', value: machineRows.length, detail: '時間軸列數', tone: 'green' },
          { label: '準時交貨率', value: pct(scenario.metrics.onTimeDeliveryRate), detail: `${scenario.metrics.lateOrderCount} 張延遲`, tone: scenario.metrics.lateOrderCount > 0 ? 'red' : 'green' },
        ]}
      />
      <div className="gantt-toolbar">
        <div className="flex flex-wrap items-center gap-1.5">
          {SCALES.map((s, i) => (
            <Button key={s.id} variant={i === scaleIdx ? 'primary' : 'secondary'} onClick={() => setScaleIdx(i)}>
              {s.label}
            </Button>
          ))}
          <Button variant="secondary" onClick={() => setZoom((z) => Math.min(4, z * 1.4))} title="放大">
            🔍+
          </Button>
          <Button variant="secondary" onClick={() => setZoom((z) => Math.max(0.3, z / 1.4))} title="縮小">
            🔍−
          </Button>
          <span className="mx-1 h-5 w-px bg-slate-200" />
          <Button variant="secondary" onClick={doUndo} disabled={!store.canUndo() || busy} title="復原上一步">
            ↩ 復原
          </Button>
          <Button variant="secondary" onClick={doRedo} disabled={!store.canRedo() || busy} title="重做">
            ↪ 重做
          </Button>
          <Button variant="secondary" onClick={doReset} disabled={busy} title="回復系統原始排程">
            ⟲ 回復原始排程
          </Button>
        </div>
      </div>

      <div className="gantt-legend flex flex-wrap items-center gap-3 text-xs text-slate-500">
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm bg-production" /> 生產</span>
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm bg-setup" /> 換模</span>
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm bg-cleaning" /> 清洗</span>
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm border border-slate-400 bg-maintenance bg-[repeating-linear-gradient(45deg,transparent,transparent_3px,rgba(255,255,255,.6)_3px,rgba(255,255,255,.6)_6px)]" /> 維護/停機</span>
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm border-2 border-red-500 bg-production" /> 逾期訂單</span>
        <span className="text-slate-400">|提示:拖曳藍色生產區塊可調整開始時間或換機台(每 {SNAP_MIN} 分鐘吸附);點擊查看詳細。</span>
      </div>

      {message && <Banner tone={message.tone === 'success' ? 'success' : message.tone}>{message.text}</Banner>}
      {busy && <Banner tone="info">處理中,請稍候…</Banner>}

      {/* 甘特圖主體 */}
      <div className="gantt-canvas rounded-lg border border-slate-200 bg-white">
        <div className="overflow-x-auto" ref={containerRef}>
          <div className="relative" style={{ width: LABEL_W + chartW, minWidth: '100%' }}>
            {/* 時間紅線 */}
            {showNowLine && (
              <div
                className="absolute z-20 pointer-events-none border-l-2 border-red-500 flex flex-col items-center"
                style={{
                  left: LABEL_W + nowX,
                  top: 0,
                  bottom: 0,
                }}
              >
                <span className="absolute -top-1 bg-red-500 text-white text-[9px] px-1.5 py-0.5 rounded shadow whitespace-nowrap -translate-x-1/2 z-30">
                  現在時間 {fmtTime(new Date(nowTime).toISOString())}
                </span>
              </div>
            )}
            {/* 時間刻度列 */}
            <div className="relative border-b border-slate-200" style={{ height: HEADER_H, marginLeft: LABEL_W }}>
              {ticks.map((tk, i) => (
                <div key={i} className="absolute top-0 h-full" style={{ left: tk.x }}>
                  <span className={`absolute top-2 -translate-x-1/2 whitespace-nowrap text-[10px] ${tk.major ? 'font-semibold text-slate-700' : 'text-slate-400'}`}>
                    {tk.label}
                  </span>
                  <div className={`absolute bottom-0 h-2 w-px ${tk.major ? 'bg-slate-400' : 'bg-slate-200'}`} />
                </div>
              ))}
            </div>

            {/* 機台列 */}
            {machineRows.map((m, ri) => (
              <div key={m.id} className="relative flex border-b border-slate-100" style={{ height: ROW_H }}>
                <div
                  className="sticky left-0 z-10 flex shrink-0 items-center gap-1 border-r border-slate-200 bg-white px-2 text-xs font-medium text-slate-700"
                  style={{ width: LABEL_W }}
                >
                  {m.machineCode}
                  <span className="font-normal text-slate-400">{m.machineName}</span>
                  {m.status === 'disabled' && <Badge tone="slate">停用</Badge>}
                </div>
                <div className="relative flex-1">
                  {/* 格線 */}
                  {ticks.filter((t) => t.major).map((tk, i) => (
                    <div key={i} className="absolute inset-y-0 w-px bg-slate-100" style={{ left: tk.x }} />
                  ))}
                  {/* 任務區塊 */}
                  {tasks
                    .filter((t) => t.machineId === m.id)
                    .map((t) => {
                      const isDragging = dragTask?.taskId === t.taskId;
                      const order = t.orderId ? orderById.get(t.orderId) : null;
                      const product = order ? productById.get(order.productId) : null;
                      const late = Boolean(order && t.taskType === 'production' && Date.parse(t.endTime) > Date.parse(order.dueDate));
                      const style: React.CSSProperties = {
                        left: xOf(t.startTime),
                        width: Math.max(4, wOf(t)),
                        top: 6,
                        height: ROW_H - 12,
                        opacity: isDragging ? 0.35 : 1,
                      };
                      const base = 'absolute rounded-sm text-[10px] leading-tight text-white overflow-hidden select-none';
                      const cls =
                        t.taskType === 'production'
                          ? `${base} bg-production cursor-grab active:cursor-grabbing ${late ? 'border-2 border-red-500' : ''} ${t.isManuallyAdjusted ? 'ring-2 ring-purple-400' : ''}`
                          : t.taskType === 'setup'
                            ? `${base} bg-setup cursor-pointer`
                            : t.taskType === 'cleaning'
                              ? `${base} bg-cleaning cursor-pointer`
                              : `${base} bg-maintenance cursor-pointer bg-[repeating-linear-gradient(45deg,transparent,transparent_4px,rgba(255,255,255,.5)_4px,rgba(255,255,255,.5)_8px)]`;
                      return (
                        <div
                          key={t.taskId}
                          className={cls}
                          style={style}
                          title={`${order?.orderNumber ?? TASK_TYPE_LABELS[t.taskType]} ${fmtTime(t.startTime)}-${fmtTime(t.endTime)}`}
                          onPointerDown={(e) => onPointerDown(e, t)}
                          onPointerMove={onPointerMove}
                          onPointerUp={onPointerUp}
                          onClick={() => {
                            if (t.taskType !== 'production') setSelected(t);
                          }}
                        >
                          <div className="px-1 pt-0.5">
                            {t.taskType === 'production' ? (
                              <>
                                <span className="font-semibold">{order?.orderNumber}</span>
                                {wOf(t) > 90 && <span className="ml-1 opacity-80">{product?.productName}</span>}
                                {wOf(t) > 150 && (
                                  <span className="ml-1 opacity-70">
                                    {fmtTime(t.startTime)}-{fmtTime(t.endTime)}
                                  </span>
                                )}
                              </>
                            ) : (
                              wOf(t) > 30 && <span>{TASK_TYPE_LABELS[t.taskType]}</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  {/* 拖曳中的幽靈區塊 */}
                  {dragTask && dragRow === ri && (
                    <div
                      className="pointer-events-none absolute rounded-sm border-2 border-dashed border-blue-500 bg-blue-200/60"
                      style={{
                        left: ((dragNewStart - timeRange.start) / 60_000) * pxPerMin,
                        width: Math.max(4, wOf(dragTask)),
                        top: 6,
                        height: ROW_H - 12,
                      }}
                    >
                      <span className="absolute -top-5 left-0 whitespace-nowrap rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-white">
                        {fmtDateTime(dragNewStart)} → {machineRows[dragRow]?.machineCode}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 調整前後差異 */}
      {diff && (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">調整前後差異</h2>
          <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm md:grid-cols-4">
            <DiffItem label="準時交貨率" before={pct(diff.before.onTimeDeliveryRate)} after={pct(diff.after.onTimeDeliveryRate)} good={diff.after.onTimeDeliveryRate >= diff.before.onTimeDeliveryRate} />
            <DiffItem label="平均延遲" before={fmtMinutes(diff.before.averageTardinessMinutes)} after={fmtMinutes(diff.after.averageTardinessMinutes)} good={diff.after.averageTardinessMinutes <= diff.before.averageTardinessMinutes} />
            <DiffItem label="Makespan" before={fmtMinutes(diff.before.makespanMinutes)} after={fmtMinutes(diff.after.makespanMinutes)} good={diff.after.makespanMinutes <= diff.before.makespanMinutes} />
            <DiffItem label="延遲訂單數" before={`${diff.before.lateOrderCount} 張`} after={`${diff.after.lateOrderCount} 張`} good={diff.after.lateOrderCount <= diff.before.lateOrderCount} />
          </div>
          {diff.delays.length > 0 && (
            <div className="mt-2 text-xs text-slate-500">
              受影響訂單:
              {diff.delays.map((d) => (
                <span key={d.orderNumber} className="mr-3">
                  {d.orderNumber}(延遲 {d.oldTardinessMinutes} → {d.newTardinessMinutes} 分)
                </span>
              ))}
            </div>
          )}
        </section>
      )}

      {/* 任務詳細 */}
      <Modal title="工作詳細資訊" open={Boolean(selected)} onClose={() => setSelected(null)}>
        {selected && (
          <TaskDetail
            task={selected}
            machine={machineRows.find((m) => m.id === selected.machineId) ?? null}
            orderNumber={selected.orderId ? orderById.get(selected.orderId)?.orderNumber ?? null : null}
            productName={
              selected.orderId
                ? productById.get(orderById.get(selected.orderId)?.productId ?? '')?.productName ?? null
                : null
            }
            dueDate={selected.orderId ? orderById.get(selected.orderId)?.dueDate ?? null : null}
          />
        )}
      </Modal>
    </div>
  );
}

function DiffItem({ label, before, after, good }: { label: string; before: string; after: string; good: boolean }) {
  return (
    <div>
      <span className="text-slate-500">{label}:</span>{' '}
      <span className="text-slate-400 line-through">{before}</span>{' '}
      <span className={good ? 'font-semibold text-green-700' : 'font-semibold text-red-600'}>{after}</span>
    </div>
  );
}

function TaskDetail({
  task,
  machine,
  orderNumber,
  productName,
  dueDate,
}: {
  task: Task;
  machine: Machine | null;
  orderNumber: string | null;
  productName: string | null;
  dueDate: string | null;
}) {
  const late = dueDate && task.taskType === 'production' && Date.parse(task.endTime) > Date.parse(dueDate);
  return (
    <dl className="space-y-1.5 text-sm">
      <Row k="類型" v={<>{TASK_TYPE_LABELS[task.taskType]} {task.isManuallyAdjusted && <Badge tone="blue">已人工調整</Badge>}</>} />
      {orderNumber && <Row k="訂單編號" v={orderNumber} />}
      {productName && <Row k="產品" v={productName} />}
      <Row k="機台" v={machine ? `${machine.machineCode} ${machine.machineName}` : task.machineId} />
      <Row k="開始時間" v={fmtDateTime(task.startTime)} />
      <Row k="結束時間" v={fmtDateTime(task.endTime)} />
      <Row k="時長" v={fmtMinutes((Date.parse(task.endTime) - Date.parse(task.startTime)) / 60_000)} />
      {dueDate && (
        <Row
          k="交期"
          v={
            <>
              {fmtDateTime(dueDate)}{' '}
              {late ? <Badge tone="red">⚠ 逾期</Badge> : task.taskType === 'production' ? <Badge tone="green">✓ 準時</Badge> : null}
            </>
          }
        />
      )}
    </dl>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex">
      <dt className="w-24 shrink-0 text-slate-400">{k}</dt>
      <dd className="text-slate-700">{v}</dd>
    </div>
  );
}
