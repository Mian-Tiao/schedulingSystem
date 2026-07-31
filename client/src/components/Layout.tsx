import { NavLink, Outlet } from 'react-router-dom';

const NAV = [
  { to: '/', label: '總覽', icon: '🏠' },
  { to: '/orders', label: '訂單管理', icon: '📦' },
  { to: '/products', label: '產品管理', icon: '🧩' },
  { to: '/machines', label: '機台管理', icon: '⚙️' },
  { to: '/schedule', label: '排程中心', icon: '🗓️' },
  { to: '/gantt', label: '甘特圖', icon: '📊' },
  { to: '/simulation', label: '情境模擬', icon: '🧪' },
  { to: '/ai', label: 'AI 諮詢', icon: '💬' },
];

export function Layout() {
  return (
    <div className="flex min-h-screen bg-slate-100">
      <aside className="fixed inset-y-0 left-0 w-52 border-r border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-4">
          <h1 className="text-base font-bold text-slate-800">智慧排程系統</h1>
          <p className="text-xs text-slate-400">Lean Scheduling Assistant</p>
        </div>
        <nav className="p-2">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `mb-0.5 flex items-center gap-2 rounded-md px-3 py-2 text-sm ${
                  isActive ? 'bg-blue-50 font-medium text-blue-700' : 'text-slate-600 hover:bg-slate-50'
                }`
              }
            >
              <span aria-hidden>{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="ml-52 min-w-0 flex-1 p-6">
        <Outlet />
      </main>
    </div>
  );
}
