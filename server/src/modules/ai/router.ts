import { ApiError as GeminiApiError, GoogleGenAI, ThinkingLevel } from '@google/genai';
import { Router } from 'express';
import { z } from 'zod';
import { AppError, wrap } from '../../shared/errors.js';
import { logger } from '../../shared/logger.js';
import {
  buildAiContext,
  buildUserMessage,
  SYSTEM_PROMPT,
  type ConversationTurn,
} from './promptBuilder.js';
import {
  AI_TOOL_DECLARATIONS,
  cancelPendingAction,
  confirmPendingAction,
  executeReadTool,
  isMutationTool,
  preparePendingAction,
  type PendingActionView,
} from './tools.js';

export const aiRouter = Router();

function getApiKey(): string | undefined {
  return process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
}

function getClient(): GoogleGenAI | null {
  const apiKey = getApiKey();
  if (!apiKey) return null;
  return new GoogleGenAI({ apiKey });
}

const MODEL = () => process.env.GEMINI_MODEL || 'gemini-3.6-flash';

aiRouter.get(
  '/status',
  wrap(async (_req, res) => {
    res.json({ enabled: Boolean(getApiKey()), provider: 'gemini', model: MODEL() });
  }),
);

interface AiReply {
  answer: string;
  pendingAction?: PendingActionView;
}

async function askAi(
  question: string,
  extraContext?: unknown,
  options: {
    allowActions?: boolean;
    requireSchedule?: boolean;
    history?: ConversationTurn[];
  } = {},
): Promise<AiReply> {
  const client = getClient();
  if (!client) {
    throw new AppError(
      'AI_DISABLED',
      'Gemini 尚未啟用:請在 server/.env 設定 GEMINI_API_KEY。核心排程功能不受影響。',
      503,
    );
  }
  const context = await buildAiContext();
  if (!context && options.requireSchedule) {
    throw new AppError('NO_SCHEDULE', '目前沒有排程結果可以分析,請先到「排程中心」執行排程。', 422);
  }
  try {
    const availableTools = options.allowActions === false
      ? AI_TOOL_DECLARATIONS.filter((tool) => tool.name?.startsWith('list_'))
      : AI_TOOL_DECLARATIONS;
    const chat = client.chats.create({
      model: MODEL(),
      config: {
        systemInstruction: SYSTEM_PROMPT,
        maxOutputTokens: 4096,
        temperature: 0.2,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        tools: [{ functionDeclarations: availableTools }],
      },
    });

    let response = await chat.sendMessage({
      message: buildUserMessage(context, question, extraContext, options.history),
    });
    for (let round = 0; round < 4; round++) {
      if (response.promptFeedback?.blockReason) {
        throw new AppError('AI_REFUSED', 'AI 無法回答此問題,請換個方式詢問。', 422);
      }

      const calls = response.functionCalls ?? [];
      if (calls.length === 0) {
        return { answer: response.text?.trim() || 'AI 沒有回傳內容,請稍後再試。' };
      }

      const mutationCalls = calls.filter(isMutationTool);
      if (mutationCalls.length > 0) {
        if (options.allowActions === false) {
          throw new AppError('AI_ACTION_NOT_ALLOWED', '此分析功能不可修改系統資料。', 422);
        }
        if (mutationCalls.length > 1) {
          throw new AppError('AI_TOOL_MULTIPLE_ACTIONS', '一次只能確認一個系統操作,請分開下指令。', 422);
        }
        const pendingAction = await preparePendingAction(mutationCalls[0]!);
        return { answer: '我已整理好要執行的操作,請確認以下資料。', pendingAction };
      }

      const functionResponses = await Promise.all(
        calls.map(async (call) => ({
          functionResponse: {
            id: call.id,
            name: call.name,
            response: { output: await executeReadTool(call) },
          },
        })),
      );
      response = await chat.sendMessage({ message: functionResponses });
    }
    throw new AppError('AI_TOOL_LOOP_LIMIT', 'AI 工具呼叫次數過多,請把問題拆小後再試。', 422);
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err instanceof z.ZodError) {
      throw new AppError(
        'AI_TOOL_INVALID_ARGS',
        `AI 產生的工具參數不完整:${err.issues.map((issue) => issue.message).join('、')}`,
        422,
        err.issues,
      );
    }
    if (err instanceof GeminiApiError) {
      if (err.status === 401 || err.status === 403) {
        throw new AppError('AI_AUTH_FAILED', 'Gemini 驗證失敗:API Key 無效或沒有權限。核心排程功能不受影響。', 503);
      }
      if (err.status === 429) {
        throw new AppError('AI_RATE_LIMITED', 'Gemini 配額已用完或服務繁忙,請稍後再試。', 503);
      }
      if (err.status === 404) {
        throw new AppError(
          'AI_MODEL_UNAVAILABLE',
          `Gemini 模型「${MODEL()}」目前不可用,請檢查 GEMINI_MODEL 設定。`,
          503,
        );
      }
      logger.error({ err, status: err.status }, 'gemini api error');
      throw new AppError('AI_UNAVAILABLE', 'AI 服務暫時無法使用,請稍後再試。核心排程功能不受影響。', 503);
    }
    logger.error({ err }, 'ai request failed');
    throw new AppError('AI_UNAVAILABLE', 'AI 服務連線失敗,請稍後再試。核心排程功能不受影響。', 503);
  }
}

const conversationHistorySchema = z
  .array(
    z.object({
      role: z.enum(['user', 'assistant']),
      text: z.string().min(1).max(2_000),
    }),
  )
  .max(12)
  .optional();

// 排程結果分析
aiRouter.post(
  '/analyze',
  wrap(async (req, res) => {
    const body = z
      .object({ focus: z.string().optional(), history: conversationHistorySchema })
      .parse(req.body ?? {});
    const question =
      body.focus ??
      '請分析目前的排程方案:為什麼排名第一的方案被推薦?各方案的優缺點是什麼?有哪些需要注意的風險(延遲訂單、瓶頸機台)?';
    const reply = await askAi(question, undefined, {
      allowActions: false,
      requireSchedule: true,
      history: body.history,
    });
    res.json(reply);
  }),
);

// 對話
aiRouter.post(
  '/chat',
  wrap(async (req, res) => {
    const body = z
      .object({
        question: z.string().min(1, '請輸入問題'),
        history: conversationHistorySchema,
        /** 前端可附上情境模擬結果(急單/故障)供 AI 參考 */
        extraContext: z.unknown().optional(),
      })
      .parse(req.body);
    const reply = await askAi(body.question, body.extraContext, { history: body.history });
    res.json(reply);
  }),
);

aiRouter.post(
  '/actions/:actionId/confirm',
  wrap(async (req, res) => {
    const result = await confirmPendingAction(req.params.actionId!);
    res.json(result);
  }),
);

aiRouter.post(
  '/actions/:actionId/cancel',
  wrap(async (req, res) => {
    cancelPendingAction(req.params.actionId!);
    res.json({ cancelled: true });
  }),
);
