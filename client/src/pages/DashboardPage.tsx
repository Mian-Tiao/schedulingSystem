import { Link } from 'react-router-dom';
import { useDashboard } from '../api/hooks';
import { Badge, EmptyState, ErrorState, Loading } from '../components/ui';
import { fmtDateTime, fmtMinutes } from '../utils/time';

function StatCard({ label, value, tone }: { label: string; value: string | number; tone?: 'red' | 'amber' }) {
  const color = tone === 'red' ? 'text-red-600' : tone === 'amber' ? 'text-amber-600' : 'text-slate-800';
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${color}`}>{value}</p>
    </div>
  );
}

export function DashboardPage() {
  const { data, isLoading, error } = useDashboard();

  if (isLoading) return <Loading />;
  if (error) return <ErrorState message={(error as Error).message} />;
  if (!data) return null;

  const maxLoad = Math.max(1, ...data.machineLoad.map((m) => m.productionMinutes + m.changeoverMinutes));

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-800">總覽</h1>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <StatCard label="待排程訂單" value={data.pendingOrderCount} />
        <StatCard label="今日到期訂單" value={data.dueTodayOrders.length} tone={data.dueTodayOrders.length > 0 ? 'amber' : undefined} />
        <StatCard label="延遲風險訂單(48小時內到期)" value={data.riskOrders.length} tone={data.riskOrders.length > 0 ? 'red' : undefined} />
        <StatCard label="可用機台" value={data.availableMachineCount} />
        <StatCard label="維護中機台" value={data.maintenanceMachineCount} tone={data.maintenanceMachineCount > 0 ? 'amber' : undefined} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">最新推薦方案</h2>
          {data.latestRecommendation ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Badge tone="blue">{data.latestRecommendation.algorithm}</Badge>
                <span className="text-sm text-slate-600">分數 {data.latestRecommendation.score}</span>
                <span className="text-xs text-slate-400">{fmtDateTime(data.latestRecommendation.generatedAt)} 產生</span>
              </div>
              <p className="text-sm text-slate-600">{data.latestRecommendation.recommendationReason}</p>
              <Link to={`/gantt/${data.latestRecommendation.scenarioId}`} className="text-sm text-blue-600 hover:underline">
                查看甘特圖 →
              </Link>
            </div>
          ) : (
            <EmptyState
              text="尚未執行排程"
              action={
                <Link to="/schedule" className="text-sm text-blue-600 hover:underline">
                  前往排程中心
                </Link>
              }
            />
          )}
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">機台負載概況(排名第一方案)</h2>
          {data.machineLoad.length === 0 ? (
            <EmptyState text="尚未建立機台" />
          ) : (
            <div className="space-y-2">
              {data.machineLoad.map((m) => {
                const total = m.productionMinutes + m.changeoverMinutes;
                return (
                  <div key={m.machineId}>
                    <div className="mb-0.5 flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-700">
                        {m.machineCode} {m.machineName}
                        {m.status === 'maintenance' && <Badge tone="amber"> 維護中</Badge>}
                        {m.status === 'disabled' && <Badge tone="slate"> 停用</Badge>}
                      </span>
                      <span className="text-slate-500">
                        生產 {fmtMinutes(m.productionMinutes)}・換模清洗 {fmtMinutes(m.changeoverMinutes)}
                      </span>
                    </div>
                    <div className="h-2.5 w-full overflow-hidden rounded bg-slate-100">
                      <div className="flex h-full" style={{ width: `${(total / maxLoad) * 100}%` }}>
                        <div className="bg-production" style={{ width: `${total ? (m.productionMinutes / total) * 100 : 0}%` }} />
                        <div className="bg-setup" style={{ width: `${total ? (m.changeoverMinutes / total) * 100 : 0}%` }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">今日到期訂單</h2>
          {data.dueTodayOrders.length === 0 ? (
            <p className="text-sm text-slate-400">今天沒有到期的訂單。</p>
          ) : (
            <OrderList orders={data.dueTodayOrders} />
          )}
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">延遲風險訂單(48 小時內到期)</h2>
          {data.riskOrders.length === 0 ? (
            <p className="text-sm text-slate-400">目前沒有高風險訂單。</p>
          ) : (
            <OrderList orders={data.riskOrders} risk />
          )}
        </section>
      </div>
    </div>
  );
}

function OrderList({
  orders,
  risk,
}: {
  orders: { id: string; orderNumber: string; productName: string; dueDate: string; priority: number }[];
  risk?: boolean;
}) {
  return (
    <ul className="divide-y divide-slate-100">
      {orders.map((o) => (
        <li key={o.id} className="flex items-center justify-between py-2 text-sm">
          <div>
            <span className="font-medium text-slate-700">{o.orderNumber}</span>
            <span className="ml-2 text-slate-500">{o.productName}</span>
            {o.priority <= 2 && <Badge tone="red"> 高優先</Badge>}
          </div>
          <span className={risk ? 'text-red-600' : 'text-slate-500'}>交期 {fmtDateTime(o.dueDate)}</span>
        </li>
      ))}
    </ul>
  );
}
