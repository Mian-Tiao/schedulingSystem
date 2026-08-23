/**
 * 部署到 Render 時,把 Prisma schema 的 provider 從 sqlite 切換成 postgresql。
 * 本機開發 / 測試維持 sqlite(不需安裝 PostgreSQL);只有雲端部署會執行這個腳本。
 * 由 package.json 的 "render:build" 呼叫。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const schemaPath = fileURLToPath(new URL('../prisma/schema.prisma', import.meta.url));
const original = readFileSync(schemaPath, 'utf8');

if (original.includes('provider = "postgresql"')) {
  console.log('schema 已是 postgresql,略過切換');
} else {
  const switched = original.replace('provider = "sqlite"', 'provider = "postgresql"');
  writeFileSync(schemaPath, switched);
  console.log('已將 Prisma provider 切換為 postgresql(僅在此次建置環境生效)');
}
