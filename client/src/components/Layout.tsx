import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';

type NavItem = {
  to: string;
  label: string;
  shortLabel: string;
  icon: string;
};

const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: '營運控制',
    items: [
      { to: '/', label: '營運總覽', shortLabel: '總覽', icon: '⌂' },
      { to: '/schedule', label: '排程中心', shortLabel: '排程', icon: '≋' },
      { to: '/gantt', label: '甘特圖排程', shortLabel: '甘特圖', icon: '▥' },
    ],
  },
  {
    label: '基礎資料',
    items: [
      { to: '/orders', label: '訂單管理', shortLabel: '訂單', icon: '▣' },
      { to: '/products', label: '產品管理', shortLabel: '產品', icon: '◇' },
      { to: '/machines', label: '機台管理', shortLabel: '機台', icon: '⚙' },
    ],
  },
  {
    label: '決策支援',
    items: [
      { to: '/simulation', label: '情境模擬', shortLabel: '模擬', icon: '◫' },
      { to: '/ai', label: 'AI 決策諮詢', shortLabel: 'AI', icon: '✦' },
    ],
  },
];

const ROUTE_LABELS: Record<string, string> = {
  '/': '營運總覽',
  '/orders': '訂單管理',
  '/products': '產品管理',
  '/machines': '機台管理',
  '/schedule': '排程中心',
  '/gantt': '甘特圖排程',
  '/simulation': '情境模擬',
  '/ai': 'AI 決策諮詢',
};

export function Layout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const routeKey = location.pathname.startsWith('/gantt/') ? '/gantt' : location.pathname;
  const currentLabel = ROUTE_LABELS[routeKey] ?? '智慧排程';
  const today = new Intl.DateTimeFormat('zh-TW', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(new Date());

  return (
    <div className="app-shell">
      {menuOpen && (
        <button
          className="app-sidebar-scrim"
          aria-label="關閉導覽選單"
          onClick={() => setMenuOpen(false)}
        />
      )}

      <aside className={`app-sidebar ${menuOpen ? 'is-open' : ''}`}>
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden>
            LS
          </div>
          <div>
            <p className="brand-name">智慧排程系統</p>
            <p className="brand-subtitle">Lean Scheduling</p>
          </div>
        </div>

        <div className="plant-status">
          <span className="status-pulse" />
          <div>
            <p>排程服務運作中</p>
            <span>資料即時同步</span>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="主要導覽">
          {NAV_GROUPS.map((group) => (
            <div className="nav-group" key={group.label}>
              <p className="nav-group-label">{group.label}</p>
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  onClick={() => setMenuOpen(false)}
                  className={({ isActive }) => `nav-item ${isActive ? 'is-active' : ''}`}
                >
                  <span className="nav-icon" aria-hidden>
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                  <span className="nav-arrow" aria-hidden>
                    ›
                  </span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <span className="sidebar-footer-label">SYSTEM</span>
          <span>APS Control Center · v0.1</span>
        </div>
      </aside>

      <div className="app-workspace">
        <header className="app-topbar">
          <div className="topbar-leading">
            <button
              className="mobile-menu-button"
              aria-label="開啟導覽選單"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(true)}
            >
              ☰
            </button>
            <div>
              <p className="topbar-kicker">生產控制中心</p>
              <p className="topbar-location">{currentLabel}</p>
            </div>
          </div>
          <div className="topbar-meta">
            <div className="topbar-date">
              <span>今日</span>
              <strong>{today}</strong>
            </div>
            <div className="operator-avatar" title="系統管理員" aria-label="系統管理員">
              管
            </div>
          </div>
        </header>

        <main className="app-main">
          <div className="app-content">
            <Outlet />
          </div>
        </main>
      </div>

      <nav className="mobile-bottom-nav" aria-label="手機快速導覽">
        {NAV_GROUPS.flatMap((group) => group.items)
          .slice(0, 5)
          .map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => (isActive ? 'is-active' : '')}
            >
              <span aria-hidden>{item.icon}</span>
              <small>{item.shortLabel}</small>
            </NavLink>
          ))}
      </nav>
    </div>
  );
}
