/**
 * AI 決策諮詢:對話視窗 + 快速問題按鈕。
 * AI 只根據真實排程數據解釋與建議;未設定 API Key 時顯示停用說明,核心功能不受影響。
 */
import { useEffect, useRef, useState } from 'react';
import { ApiError, apiPost } from '../api/client';
import { useAiStatus, useScenarios } from '../api/hooks';
import { Badge, Banner, Button, Loading, PageHeader } from '../components/ui';

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
    <div className="ai-page">
      <PageHeader
        eyebrow="DECISION COPILOT"
        title="AI 決策諮詢"
        description="用自然語言理解排程績效、延遲原因與機台瓶頸，快速形成可執行的判斷。"
        actions={status?.enabled ? <Badge tone="green">✓ 已啟用</Badge> : <Badge tone="slate">未啟用</Badge>}
      />

      <div className="ai-workspace">
        <aside className="ai-context-panel">
          <div className="ai-status-block">
            <span className={`ai-orb ${status?.enabled ? 'is-online' : ''}`}>✦</span>
            <div>
              <small>DECISION COPILOT</small>
              <h2>{status?.enabled ? 'AI 已準備完成' : 'AI 尚未啟用'}</h2>
              <p>{hasSchedule ? `目前有 ${scenarios?.length ?? 0} 個排程方案可供分析。` : '執行排程後即可開始分析。'}</p>
            </div>
          </div>

          {!status?.enabled && (
            <Banner tone="warn">
              請在 server/.env 設定 ANTHROPIC_API_KEY 後重新啟動伺服器。其他排程功能不受影響。
            </Banner>
          )}
          {status?.enabled && !hasSchedule && (
            <Banner tone="info">目前沒有排程結果，請先到排程中心執行排程。</Banner>
          )}

          <div className="ai-context-note">
            <span aria-hidden>i</span>
            <p>AI 只解讀真實排程數據，不會直接修改任何訂單或時間軸。</p>
          </div>

          <div className="quick-question-list">
            <div className="quick-question-heading">
              <span>QUICK START</span>
              <h3>常用分析問題</h3>
            </div>
            <button onClick={analyze} disabled={busy || !status?.enabled || !hasSchedule}>
              <span>00</span>
              分析目前排程結果
            </button>
            {QUICK_QUESTIONS.map((question, index) => (
              <button key={question} onClick={() => ask(question)} disabled={busy || !status?.enabled || !hasSchedule}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                {question}
              </button>
            ))}
          </div>
        </aside>

        <section className="ai-chat-panel">
          <header className="ai-chat-header">
            <div>
              <span className="ai-header-mark">AI</span>
              <div>
                <h2>排程分析對話</h2>
                <p>{status?.enabled ? '回答會引用目前系統中的排程資料' : '等待 AI 服務啟用'}</p>
              </div>
            </div>
            <span className={`ai-connection ${status?.enabled ? 'is-online' : ''}`}>
              <i />
              {status?.enabled ? 'ONLINE' : 'OFFLINE'}
            </span>
          </header>

          <div className="ai-message-area">
            {messages.length === 0 ? (
              <div className="ai-empty-conversation">
                <span aria-hidden>✦</span>
                <h3>從一個營運問題開始</h3>
                <p>你可以詢問逾期原因、機台瓶頸，或如何調整特定訂單。</p>
              </div>
            ) : (
              <div className="space-y-4">
                {messages.map((message, index) => (
                  <div key={index} className={`ai-message-row is-${message.role}`}>
                    {message.role !== 'user' && <span className="message-avatar">{message.role === 'error' ? '!' : 'AI'}</span>}
                    <div className="ai-message-bubble">{message.text}</div>
                  </div>
                ))}
                {busy && (
                  <div className="ai-message-row is-ai">
                    <span className="message-avatar">AI</span>
                    <div className="ai-message-bubble is-thinking">
                      <span className="app-spinner" />
                      正在分析排程資料…
                    </div>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>
            )}
          </div>

          <form
            className="ai-composer"
            onSubmit={(e) => {
              e.preventDefault();
              void ask(input);
            }}
          >
            <div>
              <span aria-hidden>›</span>
              <input
                placeholder={status?.enabled ? '輸入你的排程問題…' : 'AI 功能未啟用'}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={!status?.enabled || busy}
              />
            </div>
            <Button type="submit" disabled={!status?.enabled || busy || !input.trim()}>
              傳送 <span aria-hidden>→</span>
            </Button>
          </form>
        </section>
      </div>
    </div>
  );
}
