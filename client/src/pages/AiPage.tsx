/**
 * AI 決策諮詢:對話視窗 + 快速問題按鈕。
 * AI 只根據真實排程數據解釋與建議;未設定 API Key 時顯示停用說明,核心功能不受影響。
 */
import { useEffect, useRef, useState } from 'react';
import { ApiError, apiPost } from '../api/client';
import { useAiStatus, useScenarios } from '../api/hooks';
import { Badge, Banner, Button, EmptyState, Loading } from '../components/ui';

const QUICK_QUESTIONS = [
  '為什麼這個方案排名第一?',
  '哪些訂單最容易逾期?',
  '哪台機台是目前瓶頸?',
  '哪些工作適合改到其他機台?',
  '為什麼機台利用率高,但準時交貨率反而下降?',
];

interface ChatMessage {
  role: 'user' | 'ai' | 'error';
  text: string;
}

export function AiPage() {
  const { data: status, isLoading: statusLoading } = useAiStatus();
  const { data: scenarios } = useScenarios();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);

  const ask = async (question: string) => {
    if (!question.trim() || busy) return;
    setMessages((m) => [...m, { role: 'user', text: question }]);
    setInput('');
    setBusy(true);
    try {
      const res = await apiPost<{ answer: string }>('/api/ai/chat', { question });
      setMessages((m) => [...m, { role: 'ai', text: res.answer }]);
    } catch (e) {
      setMessages((m) => [
        ...m,
        { role: 'error', text: e instanceof ApiError ? e.message : 'AI 服務發生錯誤,請稍後再試。' },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const analyze = async () => {
    if (busy) return;
    setMessages((m) => [...m, { role: 'user', text: '(請 AI 分析目前排程結果)' }]);
    setBusy(true);
    try {
      const res = await apiPost<{ answer: string }>('/api/ai/analyze', {});
      setMessages((m) => [...m, { role: 'ai', text: res.answer }]);
    } catch (e) {
      setMessages((m) => [
        ...m,
        { role: 'error', text: e instanceof ApiError ? e.message : 'AI 服務發生錯誤,請稍後再試。' },
      ]);
    } finally {
      setBusy(false);
    }
  };

  if (statusLoading) return <Loading />;

  const hasSchedule = (scenarios ?? []).length > 0;

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col space-y-3">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold text-slate-800">AI 決策諮詢</h1>
        {status?.enabled ? <Badge tone="green">✓ 已啟用</Badge> : <Badge tone="slate">未啟用</Badge>}
      </div>

      {!status?.enabled && (
        <Banner tone="warn">
          AI 功能未啟用:請在 server/.env 設定 ANTHROPIC_API_KEY 後重新啟動伺服器。排程、甘特圖等核心功能不受影響,可正常使用。
        </Banner>
      )}
      {status?.enabled && !hasSchedule && (
        <Banner tone="info">目前沒有排程結果。請先到「排程中心」執行排程,AI 才有數據可以分析。</Banner>
      )}
      <Banner tone="info">
        AI 只會根據系統的真實排程數據(績效指標、延遲訂單、機台負載)解釋與建議,不會直接修改排程;建議經你確認後才需自行套用。
      </Banner>

      {/* 對話區 */}
      <div className="flex-1 overflow-y-auto rounded-lg border border-slate-200 bg-white p-4">
        {messages.length === 0 ? (
          <EmptyState text="從下方快速問題開始,或輸入你想了解的排程問題。" />
        ) : (
          <div className="space-y-3">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[75%] whitespace-pre-wrap rounded-lg px-3.5 py-2 text-sm leading-6 ${
                    m.role === 'user'
                      ? 'bg-blue-600 text-white'
                      : m.role === 'error'
                        ? 'border border-red-200 bg-red-50 text-red-700'
                        : 'border border-slate-200 bg-slate-50 text-slate-700'
                  }`}
                >
                  {m.text}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2 text-sm text-slate-400">
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-blue-500" />
                  AI 分析中…
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* 快速問題 */}
      <div className="flex flex-wrap gap-1.5">
        <Button variant="secondary" onClick={analyze} disabled={busy || !status?.enabled || !hasSchedule}>
          📊 分析目前排程結果
        </Button>
        {QUICK_QUESTIONS.map((q) => (
          <Button key={q} variant="secondary" onClick={() => ask(q)} disabled={busy || !status?.enabled || !hasSchedule}>
            {q}
          </Button>
        ))}
      </div>

      {/* 輸入列 */}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(input);
        }}
      >
        <input
          className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          placeholder={status?.enabled ? '輸入問題,例如:若要讓訂單 PO-006 準時完成,可以怎麼調整?' : 'AI 功能未啟用'}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={!status?.enabled || busy}
        />
        <Button type="submit" disabled={!status?.enabled || busy || !input.trim()}>
          送出
        </Button>
      </form>
    </div>
  );
}
