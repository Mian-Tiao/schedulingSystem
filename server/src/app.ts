import cors from 'cors';
import express from 'express';
import { aiRouter } from './modules/ai/router.js';
import { dashboardRouter } from './modules/dashboard/router.js';
import { changeoverRouter, machinesRouter } from './modules/machines/router.js';
import { ordersRouter } from './modules/orders/router.js';
import { productsRouter } from './modules/products/router.js';
import { schedulesRouter } from './modules/scenarios/router.js';
import { simulationsRouter } from './modules/simulations/router.js';
import { errorHandler } from './shared/errors.js';
import { logger } from './shared/logger.js';

export function createApp(): express.Express {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '5mb' }));

  app.use((req, _res, next) => {
    logger.debug({ method: req.method, url: req.url }, 'request');
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use('/api/orders', ordersRouter);
  app.use('/api/products', productsRouter);
  app.use('/api/machines', machinesRouter);
  app.use('/api/changeover-rules', changeoverRouter);
  app.use('/api/schedules', schedulesRouter);
  app.use('/api/simulations', simulationsRouter);
  app.use('/api/ai', aiRouter);
  app.use('/api/dashboard', dashboardRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: '找不到此 API 路徑' } });
  });
  app.use(errorHandler);
  return app;
}
