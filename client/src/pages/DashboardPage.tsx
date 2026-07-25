import { Link } from 'react-router-dom';
import { useDashboard } from '../api/hooks';
import { Badge, EmptyState, ErrorState, Loading } from '../components/ui';
import { fmtDateTime, fmtMinutes } from '../utils/time';

function MetricItem({
  label,
  value,
  detail,
  tone = 'default',
  symbol,
}: {
  label: string;
  value: string | number;
  detail: string;
  tone?: 'default' | 'amber' | 'red';
  symbol: string;
}) {
  return (
    <div className={`metric-item is-${tone}`}>
      <div className="metric-symbol" aria-hidden>
        {symbol}
      </div>
      <div>
        <p className="metric-label">{label}</p>
        <p className="metric-value">{value}</p>
        <p className="metric-detail">{detail}</p>
      </div>
    </div>
  );
}

export function DashboardPage() {
  const { data, isLoading, error } = useDashboard();

  if (isLoading) return <Loading />;
  if (error) return <ErrorState message={(error as Error).message} />;
  if (!data) return null;

  const maxLoad = Math.max(1, ...data.machineLoad.map((m) => m.productionMinutes + m.changeoverMinutes));
  const riskCount = data.riskOrders.length;
  const recommendation = data.latestRecommendation;
  const totalMachines = data.availableMachineCount + data.maintenanceMachineCount + data.disabledMachineCount;
  const availabilityRate = totalMachines === 0 ? 0 : Math.round((data.availableMachineCount / totalMachines) * 100);

  return (
    <div className="dashboard-page">
      <header className="dashboard-titlebar">
        <div>
          <p className="dashboard-kicker">
            <span />
            LIVE OPERATIONS
          </p>
          <h1>今日生產中控</h1>
          <p>把訂單、產能與交期風險放在同一個畫面，直接看現在該處理什麼。</p>
        </div>
        <div className="dashboard-title-actions">
          <span className="live-chip">
            <i />
            資料即時同步
          </span>
          <Link to="/schedule" className="command-button">
            開始新排程
            <span aria-hidden>→</span>
          </Link>
        </div>
      </header>

      <section className={`shift-brief ${riskCount > 0 ? 'has-risk' : ''}`}>
        <div className="shift-brief-copy">
          <p className="brief-label">SHIFT BRIEFING / 班次摘要</p>
          <h2>{riskCount > 0 ? `${riskCount} 張訂單進入交期警戒` : '目前生產節奏穩定'}</h2>
          <p>
            {riskCount > 0
              ? `未來 48 小時內有訂單需要優先確認；目前 ${data.availableMachineCount} 台機台可投入生產。`
              : `未來 48 小時沒有高風險訂單，目前 ${data.availableMachineCount} 台機台可投入生產。`}
          </p>
          <div className="brief-actions">
            <Link to={riskCount > 0 ? '/orders' : '/gantt'}>
              {riskCount > 0 ? '查看風險訂單' : '查看目前排程'}
              <span aria-hidden>↗</span>
            </Link>
            {recommendation && (
              <span>
                最新方案 {recommendation.algorithm} · {fmtDateTime(recommendation.generatedAt)}
              </span>
            )}
          </div>
        </div>

        <div className="shift-scoreboard">
          <div className="score-ring" style={{ '--score': `${recommendation?.score ?? availabilityRate}%` } as React.CSSProperties}>
            <div>
              <strong>{recommendation?.score ?? availabilityRate}</strong>
              <span>{recommendation ? '方案評分' : '機台可用率'}</span>
            </div>
          </div>
          <div className="score-status">
            <span className={riskCount > 0 ? 'is-alert' : 'is-good'} />
            <div>
              <small>系統判定</small>
              <strong>{riskCount > 0 ? '需要關注' : '運行穩定'}</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="metric-strip" aria-label="營運關鍵指標">
        <MetricItem label="待排程訂單" value={data.pendingOrderCount} detail="等待進入排程" symbol="01" />
        <MetricItem
          label="今日到期"
          value={data.dueTodayOrders.length}
          detail="今天需要完成"
          tone={data.dueTodayOrders.length > 0 ? 'amber' : 'default'}
          symbol="02"
        />
        <MetricItem
          label="交期風險"
          value={riskCount}
          detail="未來 48 小時"
          tone={riskCount > 0 ? 'red' : 'default'}
          symbol="03"
        />
        <MetricItem label="可用機台" value={data.availableMachineCount} detail={`共 ${totalMachines} 台機台`} symbol="04" />
        <MetricItem
          label="維護中"
          value={data.maintenanceMachineCount}
          detail="暫不可排產"
          tone={data.maintenanceMachineCount > 0 ? 'amber' : 'default'}
          symbol="05"
        />
      </section>

      <div className="dashboard-grid">
        <section className="control-panel recommendation-card">
          <PanelTitle index="01" eyebrow="RECOMMENDATION" title="排程建議" link="/schedule" linkLabel="比較所有方案" />
          {recommendation ? (
            <div className="recommendation-body">
              <div className="algorithm-block">
                <span>最佳演算法</span>
                <strong>{recommendation.algorithm}</strong>
                <Badge tone="green">系統推薦</Badge>
              </div>
              <div className="recommendation-copy">
                <p>{recommendation.recommendationReason}</p>
                <Link to={`/gantt/${recommendation.scenarioId}`} className="inline-command-link">
                  開啟甘特圖 <span aria-hidden>→</span>
                </Link>
              </div>
            </div>
          ) : (
            <EmptyState
              text="尚未執行排程"
              action={
                <Link to="/schedule" className="inline-command-link">
                  建立第一個排程方案 →
                </Link>
              }
            />
          )}
        </section>

        <section className="control-panel machine-load-card">
          <PanelTitle index="02" eyebrow="CAPACITY" title="機台負載" link="/machines" linkLabel="管理機台" />
          {data.machineLoad.length === 0 ? (
            <EmptyState text="尚未建立機台" />
          ) : (
            <div className="machine-load-list">
              {data.machineLoad.map((machine) => {
                const total = machine.productionMinutes + machine.changeoverMinutes;
                const width = Math.max(4, (total / maxLoad) * 100);
                const setupWidth = total ? (machine.changeoverMinutes / total) * 100 : 0;
                return (
                  <div className="machine-load-row" key={machine.machineId}>
                    <div className="machine-identity">
                      <span className={`machine-state is-${machine.status}`} />
                      <div>
                        <strong>{machine.machineCode}</strong>
                        <small>{machine.machineName}</small>
                      </div>
                    </div>
                    <div className="machine-bar-area">
                      <div className="machine-duration">
                        <span>生產 {fmtMinutes(machine.productionMinutes)}</span>
                        <span>換模清洗 {fmtMinutes(machine.changeoverMinutes)}</span>
                      </div>
                      <div className="machine-track">
                        <div className="machine-fill" style={{ width: `${width}%` }}>
                          <span className="machine-setup" style={{ width: `${setupWidth}%` }} />
                        </div>
                      </div>
                    </div>
                    <strong className="machine-total">{fmtMinutes(total)}</strong>
                  </div>
                );
              })}
              <div className="machine-legend">
                <span><i className="production-key" />生產</span>
                <span><i className="setup-key" />換模／清洗</span>
              </div>
            </div>
          )}
        </section>

        <section className="control-panel due-card">
          <PanelTitle index="03" eyebrow="DUE TODAY" title="今日交付" link="/orders" linkLabel="全部訂單" />
          {data.dueTodayOrders.length === 0 ? (
            <EmptyState text="今天沒有到期訂單，可以專注處理後續排程。" />
          ) : (
            <OrderList orders={data.dueTodayOrders} />
          )}
        </section>

        <section className="control-panel risk-card">
          <PanelTitle index="04" eyebrow="RISK WATCH" title="交期警戒" link="/orders" linkLabel="檢視風險" risk />
          {riskCount === 0 ? (
            <EmptyState text="目前沒有 48 小時內到期的高風險訂單。" />
          ) : (
            <OrderList orders={data.riskOrders} risk />
          )}
        </section>
      </div>
    </div>
  );
}

function PanelTitle({
  index,
  eyebrow,
  title,
  link,
  linkLabel,
  risk,
}: {
  index: string;
  eyebrow: string;
  title: string;
  link: string;
  linkLabel: string;
  risk?: boolean;
}) {
  return (
    <div className="control-panel-heading">
      <div className={`panel-number ${risk ? 'is-risk' : ''}`}>{index}</div>
      <div>
        <span>{eyebrow}</span>
        <h2>{title}</h2>
      </div>
      <Link to={link}>
        {linkLabel} <span aria-hidden>↗</span>
      </Link>
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
    <ul className="order-watch-list">
      {orders.map((order) => (
        <li key={order.id}>
          <div className="order-mark">
            <span>{order.orderNumber.slice(-2)}</span>
          </div>
          <div className="order-info">
            <strong>{order.orderNumber}</strong>
            <span>{order.productName}</span>
          </div>
          {order.priority <= 2 && <Badge tone="red">高優先</Badge>}
          <div className={`order-due ${risk ? 'is-risk' : ''}`}>
            <small>交期</small>
            <strong>{fmtDateTime(order.dueDate)}</strong>
          </div>
        </li>
      ))}
    </ul>
  );
}
