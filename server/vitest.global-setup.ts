import { execSync } from 'node:child_process';

/** 測試前建立獨立的 SQLite 測試資料庫 */
export default function setup() {
  execSync('npx prisma db push --skip-generate --force-reset', {
    cwd: __dirname,
    env: { ...process.env, DATABASE_URL: 'file:./test.db' },
    stdio: 'inherit',
  });
}
