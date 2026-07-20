import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { Layout } from './components/Layout';
import './index.css';
import { AiPage } from './pages/AiPage';
import { DashboardPage } from './pages/DashboardPage';
import { GanttPage } from './pages/GanttPage';
import { MachinesPage } from './pages/MachinesPage';
import { OrdersPage } from './pages/OrdersPage';
import { ProductsPage } from './pages/ProductsPage';
import { SchedulePage } from './pages/SchedulePage';
import { SimulationPage } from './pages/SimulationPage';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <DashboardPage /> },
      { path: '/orders', element: <OrdersPage /> },
      { path: '/products', element: <ProductsPage /> },
      { path: '/machines', element: <MachinesPage /> },
      { path: '/schedule', element: <SchedulePage /> },
      { path: '/gantt', element: <GanttPage /> },
      { path: '/gantt/:scenarioId', element: <GanttPage /> },
      { path: '/simulation', element: <SimulationPage /> },
      { path: '/ai', element: <AiPage /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
);
