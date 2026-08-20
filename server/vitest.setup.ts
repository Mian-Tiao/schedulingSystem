process.env.DATABASE_URL = 'file:./test.db';
// 用空字串覆蓋本機 .env，避免 Prisma 載入 dotenv 後讓測試誤呼叫外部 AI、消耗額度。
process.env.GEMINI_API_KEY = '';
process.env.GOOGLE_API_KEY = '';
process.env.GEMINI_MODEL = 'gemini-3.6-flash';
