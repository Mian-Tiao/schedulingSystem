process.env.DATABASE_URL = 'file:./test.db';
delete process.env.ANTHROPIC_API_KEY; // 測試時停用 AI,驗證核心功能不受影響
