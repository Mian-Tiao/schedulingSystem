/**
 * 一致的錯誤格式:{ error: { code, message, details? } }
 * message 一律使用使用者看得懂的繁體中文。
 */
import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { logger } from './logger.js';

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export function notFound(entity: string): AppError {
  return new AppError('NOT_FOUND', `找不到${entity},請重新整理頁面後再試`, 404);
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  if (err instanceof ZodError) {
    const issues = err.issues.map((i) => `${i.path.join('.')}:${i.message}`);
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: `輸入資料格式錯誤:${issues.join(';')}`, details: err.issues },
    });
    return;
  }
  logger.error({ err }, 'unhandled error');
  const message =
    err instanceof Error && /database|prisma|sqlite/i.test(err.message)
      ? '資料庫存取失敗,請稍後再試'
      : '系統發生未預期的錯誤,請稍後再試';
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message } });
}

/** async route wrapper */
export function wrap(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
