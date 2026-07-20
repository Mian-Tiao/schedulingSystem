import Anthropic from '@anthropic-ai/sdk';
import { Router } from 'express';
import { z } from 'zod';
import { AppError, wrap } from '../../shared/errors.js';
import { logger } from '../../shared/logger.js';
import { buildAiContext, buildUserMessage, SYSTEM_PROMPT } from './promptBuilder.js';

export const aiRouter = Router();

function getClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return new Anthropic({ apiKey });
}

const MODEL = () => process.env.AI_MODEL || 'claude-opus-4-8';

aiRouter.get(
  '/status',
  wrap(async (_req, res) => {
    res.json({ enabled: Boolean(process.env.ANTHROPIC_API_KEY) });
  }),
);

async function askAi(question: string, extraContext?: unknown): Promise<string> {
  const client = getClient();
  if (!client) {
    throw new AppError(
      'AI_DISABLED',
      'AI 功能未啟用:請在 server/.env 設定 ANTHROPIC_API_KEY。核心排程功能不受影響。',
      503,
    );
  }
  const context = await buildAiContext();
  if (!context) {
    throw new AppError('NO_SCHEDULE', '目前沒有排程結果可以分析,請先到「排程中心」執行排程。', 422);
  }
  try {
    const response = await client.messages.create({
      model: MODEL(),
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserMessage(context, question, extraContext) }],
    });
    if ((response.stop_reason as string) === 'refusal') {
      throw new AppError('AI_REFUSED', 'AI 無法回答此問題,請換個方式詢問。', 422);
    }
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    return text || 'AI 沒有回傳內容,請稍後再試。';
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err instanceof Anthropic.AuthenticationError) {
      throw new AppError('AI_AUTH_FAILED', 'AI 服務驗證失敗:API Key 無效。核心排程功能不受影響。', 503);
    }
    if (err instanceof Anthropic.RateLimitError) {
      throw new AppError('AI_RATE_LIMITED', 'AI 服務暫時繁忙,請稍後再試。', 503);
    }
    if (err instanceof Anthropic.APIError) {
      logger.error({ err }, 'anthropic api error');
      throw new AppError('AI_UNAVAILABLE', 'AI 服務暫時無法使用,請稍後再試。核心排程功能不受影響。', 503);
    }
    logger.error({ err }, 'ai request failed');
    throw new AppError('AI_UNAVAILABLE', 'AI 服務連線失敗,請稍後再試。核心排程功能不受影響。', 503);
  }
}

// 排程結果分析
aiRouter.post(
  '/analyze',
  wrap(async (req, res) => {
    const body = z.object({ focus: z.string().optional() }).parse(req.body ?? {});
    const question =
      body.focus ??
      '請分析目前的排程方案:為什麼排名第一的方案被推薦?各方案的優缺點是什麼?有哪些需要注意的風險(延遲訂單、瓶頸機台)?';
    const answer = await askAi(question);
    res.json({ answer });
  }),
);

// 對話
aiRouter.post(
  '/chat',
  wrap(async (req, res) => {
    const body = z
      .object({
        question: z.string().min(1, '請輸入問題'),
        /** 前端可附上情境模擬結果(急單/故障)供 AI 參考 */
        extraContext: z.unknown().optional(),
      })
      .parse(req.body);
    const answer = await askAi(body.question, body.extraContext);
    res.json({ answer });
  }),
);
