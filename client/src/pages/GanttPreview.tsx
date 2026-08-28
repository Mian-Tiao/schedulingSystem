/**
 * 唯讀甘特圖預覽:嵌在排程中心,讓使用者排完程當頁就能看到推薦方案的時間軸,
 * 不必跳到完整甘特圖頁。只呈現、不可拖曳;要調整時再進 /gantt 互動編輯。
 */
import { useMemo } from 'react';
import { useMachines, useOrders, useProducts, useScenarioDetail } from '../api/hooks';
import { Badge, Loading } from '../components/ui';
import type { Machine, Task } from '../types';
import { TASK_TYPE_LABELS } from '../types';
import { fmtDateTime, fmtMinutes, fmtTime } from '../utils/time';

const ROW_H = 34;
const HEADER_H = 34;
const LABEL_W = 128;
const HOUR_MS = 3600_000;

export function GanttPreview({ scenarioId }: { scenarioId: string }) {
  const { data: scenario, isLoading } = useScenarioDetail(scenarioId);
  const { data: machines } = useMachines();
  const { data: orders } = useOrders();
  const { data: products } = useProducts();

  const orderById = useMemo(() => new Map((orders ?? []).map((o) => [o.id, o])), [orders]);
  const productById = useMemo(() => new Map((products ?? []).map((p) => [p.id, p])), [products]);
  const machineRows: Machine[] = useMemo(
    () => [...(machines ?? [])].sort((a, b) => a.machineCode.localeCompare(b.machineCode)),
    [machines],
  );

  const tasks = scenario?.tasks ?? [];

  const timeRange = useMemo(() => {
    if (tasks.length === 0) return null;
    let min = Infinity;
    let max = -Infinity;
    for (const t of tasks) {
      min = Math.min(min, Date.parse(t.startTime));
      max = Math.max(max, Date.parse(t.endTime));
    }
    const TZOFF = 8 * HOUR_MS;
    const DAY = 86400_000;
    const start = Math.floor((min + TZOFF) / DAY) * DAY - TZOFF;
    const end = Math.ceil((max + TZOFF) / DAY) * DAY - TZOFF;
    return { start, end };
  }, [tasks]);

  // 交期風險:本方案中完工晚於交期的訂單
  const lateOrders = useMemo(() => {
    const completion = new Map<string, number>();
    for (const t of tasks) {
      if (t.taskType !== 'production' || !t.orderId) continue;
      completion.set(t.orderId, Math.max(completion.get(t.orderId) ?? 0, Date.parse(t.endTime)));
    }
    const result: { orderNumber: string; productName: string; tardinessMinutes: number; dueDate: string }[] = [];
    for (const [orderId, end] of completion) {
      const order = orderById.get(orderId);
      if (!order) continue;
      const tardy = (end - Date.parse(order.dueDate)) / 60_000;
      if (tardy > 0) {
        result.push({
          orderNumber: order.orderNumber,
          productName: productById.get(order.productId)?.productName ?? '',
          tardinessMinutes: tardy,
          dueDate: order.dueDate,
        });
      }
    }
    return result.sort((a, b) => b.tardinessMinutes - a.tardinessMinutes);
  }, [tasks, orderById, productById]);

  if (isLoading || !scenario) return <Loading text="載入甘特圖預覽…" />;
  if (!timeRange) {
    return (
      <p className="rounded-md bg-slate-50 p-4 text-sm text-slate-400">
        此方案沒有可顯示的生產任務(可能所有訂單都無法排入)。
      </p>
    );
  }

  const totalMin = (timeRange.end - timeRange.start) / 60_000;
  const spanDays = totalMin / (24 * 60);
  const pxPerMin = spanDays > 2 ? 0.16 : 0.5;
  const chartW = totalMin * pxPerMin;
  const xOf = (iso: string | number) => ((Number(new Date(iso)) - timeRange.start) / 60_000) * pxPerMin;
  const wOf = (t: Task) => ((Date.parse(t.endTime) - Date.parse(t.startTime)) / 60_000) * pxPerMin;

  const now = Date.now();
  const showNow = now >= timeRange.start && now <= timeRange.end;

  // 時間刻度
  const ticks: { x: number; label: string; major: boolean }[] = [];
  const stepMs = pxPerMin >= 0.4 ? 4 * HOUR_MS : 24 * HOUR_MS;
  for (let t = timeRange.start; t <= timeRange.end; t += stepMs) {
    const isMidnight = new Date(t + 8 * HOUR_MS).getUTCHours() === 0;
    ticks.push({ x: xOf(t), label: isMidnight ? fmtDateTime(t) : fmtTime(t), major: isMidnight });
  }

  return (
    <div className="space-y-3">
      {/* 圖例 */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm bg-production" /> 生產</span>
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm bg-setup" /> 換模</span>
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm bg-cleaning" /> 清洗</span>
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm bg-maintenance bg-[repeating-linear-gradient(45deg,transparent,transparent_3px,rgba(255,255,255,.6)_3px,rgba(255,255,255,.6)_6px)]" /> 維護/停機</span>
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm border-2 border-red-500 bg-production" /> 逾期</span>
      </div>

      {/* 甘特圖主體(唯讀) */}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <div className="relative" style={{ width: LABEL_W + chartW, minWidth: '100%' }}>
          {showNow && (
            <div
              className="pointer-events-none absolute z-20 border-l-2 border-red-500"
              style={{ left: LABEL_W + xOf(now), top: 0, bottom: 0 }}
            >
              <span className="absolute -top-0.5 -translate-x-1/2 whitespace-nowrap rounded bg-red-500 px-1 py-0.5 text-[9px] text-white">
                現在
              </span>
            </div>
          )}
          {/* 時間刻度 */}
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
          {machineRows.map((m) => (
            <div key={m.id} className="relative flex border-b border-slate-100" style={{ height: ROW_H }}>
              <div
                className="sticky left-0 z-10 flex shrink-0 items-center gap-1 border-r border-slate-200 bg-white px-2 text-xs font-medium text-slate-700"
                style={{ width: LABEL_W }}
              >
                {m.machineCode}
                <span className="truncate font-normal text-slate-400">{m.machineName}</span>
              </div>
              <div className="relative flex-1">
                {ticks.filter((t) => t.major).map((tk, i) => (
                  <div key={i} className="absolute inset-y-0 w-px bg-slate-100" style={{ left: tk.x }} />
                ))}
                {tasks
                  .filter((t) => t.machineId === m.id)
                  .map((t) => {
                    const order = t.orderId ? orderById.get(t.orderId) : null;
                    const product = order ? productById.get(order.productId) : null;
                    const late = Boolean(order && t.taskType === 'production' && Date.parse(t.endTime) > Date.parse(order.dueDate));
                    const base = 'absolute rounded-sm text-[10px] leading-tight text-white overflow-hidden';
                    const cls =
                      t.taskType === 'production'
                        ? `${base} bg-production ${late ? 'border-2 border-red-500' : ''}`
                        : t.taskType === 'setup'
                          ? `${base} bg-setup`
                          : t.taskType === 'cleaning'
                            ? `${base} bg-cleaning`
                            : `${base} bg-maintenance bg-[repeating-linear-gradient(45deg,transparent,transparent_4px,rgba(255,255,255,.5)_4px,rgba(255,255,255,.5)_8px)]`;
                    return (
                      <div
                        key={t.taskId}
                        className={cls}
                        style={{ left: xOf(t.startTime), width: Math.max(3, wOf(t)), top: 5, height: ROW_H - 10 }}
                        title={`${order?.orderNumber ?? TASK_TYPE_LABELS[t.taskType]} ${fmtTime(t.startTime)}-${fmtTime(t.endTime)}`}
                      >
                        {t.taskType === 'production' && wOf(t) > 40 && (
                          <span className="px-1 font-semibold">
                            {order?.orderNumber}
                            {wOf(t) > 110 && product && <span className="ml-1 font-normal opacity-80">{product.productName}</span>}
                          </span>
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 交期風險摘要 */}
      {lateOrders.length > 0 ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm">
          <span className="font-semibold text-red-700">⚠ 本方案有 {lateOrders.length} 張訂單會延遲:</span>
          {lateOrders.map((o) => (
            <span key={o.orderNumber} className="ml-2 text-red-600">
              {o.orderNumber}{o.productName && `(${o.productName})`} 逾期 {fmtMinutes(o.tardinessMinutes)}
            </span>
          ))}
        </div>
      ) : (
        <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm font-medium text-green-700">
          ✓ 本方案所有訂單都能準時交貨,無交期風險。
          <Badge tone="green">準時率 100%</Badge>
        </div>
      )}
    </div>
  );
}
