import 'dotenv/config';
import { createApp } from './app.js';
import { logger } from './shared/logger.js';

const port = Number(process.env.PORT ?? 3001);
const app = createApp();

app.listen(port, () => {
  logger.info(`Lean Scheduling Assistant API 啟動於 http://localhost:${port}`);
});
