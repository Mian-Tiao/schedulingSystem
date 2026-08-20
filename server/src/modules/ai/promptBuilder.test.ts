import { describe, expect, it } from 'vitest';
import { buildUserMessage } from './promptBuilder.js';

describe('buildUserMessage conversation history', () => {
  it('將最近問答與目前問題一起交給 AI', () => {
    const message = buildUserMessage(null, '那第二個方案呢？', undefined, [
      { role: 'user', text: '哪個方案最好？' },
      { role: 'assistant', text: '目前第一名是 CR。' },
    ]);

    expect(message).toContain('最近對話');
    expect(message).toContain('哪個方案最好？');
    expect(message).toContain('目前第一名是 CR。');
    expect(message).toContain('使用者的問題:那第二個方案呢？');
  });

  it('沒有歷史時不加入空的對話欄位', () => {
    expect(buildUserMessage(null, '目前有排程嗎？')).not.toContain('最近對話');
  });
});
