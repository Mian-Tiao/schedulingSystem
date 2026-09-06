/**
 * AI 決策諮詢:對話視窗 + 快速問題按鈕。
 * AI 只根據真實排程數據解釋與建議;未設定 API Key 時顯示停用說明,核心功能不受影響。
 */
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
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

const CHAT_STORAGE_KEY = 'lean-scheduling-ai-chat-v1';
const MAX_SAVED_MESSAGES = 100;

interface ChatMessage {
  role: 'user' | 'ai' | 'error';
  text: string;
  action?: PendingAction;
  actionState?: 'pending' | 'completed' | 'cancelled' | 'expired';
  navigateTo?: string;
}

interface PendingAction {
  id: string;
  toolName: 'create_order' | 'run_scheduling' | 'update_order';
  title: string;
  description: string;
  details: { label: string; value: string }[];
  expiresAt: string;
}

interface AiReply {
  answer: string;
  pendingAction?: PendingAction;
}

function loadSavedMessages(): ChatMessage[] {
  if (typeof window === 'undefined') return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(CHAT_STORAGE_KEY) ?? '[]') as unknown;
    if (!Array.isArray(value)) return [];
    return value
      .filter((item): item is ChatMessage => {
        if (!item || typeof item !== 'object') return false;
        const message = item as Partial<ChatMessage>;
        return ['user', 'ai', 'error'].includes(message.role ?? '') && typeof message.text === 'string';
      })
      .slice(-MAX_SAVED_MESSAGES)
      .map((message) =>
        message.actionState === 'pending' &&
        message.action &&
        Date.parse(message.action.expiresAt) <= Date.now()
          ? { ...message, actionState: 'expired' as const }
          : message,
      );
  } catch {
    return [];
  }
}

export function AiPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: status, isLoading: statusLoading } = useAiStatus();
  const { data: scenarios } = useScenarios();
  const [messages, setMessages] = useState<ChatMessage[]>(loadSavedMessages);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);

  useEffect(() => {
    try {
      const savedMessages = messages
        .slice(-MAX_SAVED_MESSAGES)
        .map((message) => ({ ...message, text: message.text.slice(0, 10_000) }));
      window.localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(savedMessages));
    } catch {
      // localStorage 被瀏覽器停用或容量不足時,對話仍可在目前頁面正常使用。
    }
  }, [messages]);

  const recentHistory = () =>
    messages
      .filter((message) => message.role === 'user' || message.role === 'ai')
      .slice(-12)
      .map((message) => ({
        role: message.role === 'user' ? ('user' as const) : ('assistant' as const),
        text: message.text.slice(0, 2_000),
      }));

  const ask = async (question: string) => {
    if (!question.trim() || busy) return;
    setMessages((m) => [...m, { role: 'user', text: question }]);
    setInput('');
    setBusy(true);
    try {
      const res = await apiPost<AiReply>('/api/ai/chat', { question, history: recentHistory() });
      setMessages((m) => [
        ...m,
        { role: 'ai', text: res.answer, action: res.pendingAction, actionState: res.pendingAction ? 'pending' : undefined },
      ]);
    } catch (e) {
      setMessages((m) => [
        ...m,
        { role: 'error', text: e instanceof ApiError ? e.message : 'AI 服務發生錯誤,請稍後再試。' },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const confirmAction = async (messageIndex: number, action: PendingAction) => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await apiPost<{ answer: string; navigateTo?: string }>(
        `/api/ai/actions/${action.id}/confirm`,
        {},
      );
      setMessages((current) => [
        ...current.map((message, index) =>
          index === messageIndex ? { ...message, actionState: 'completed' as const } : message,
        ),
        { role: 'ai', text: result.answer, navigateTo: result.navigateTo },
      ]);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['orders'] }),
        queryClient.invalidateQueries({ queryKey: ['schedules'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current.map((message, index) =>
          index === messageIndex && error instanceof ApiError && error.code === 'AI_ACTION_EXPIRED'
            ? { ...message, actionState: 'expired' as const }
            : message,
        ),
        {
          role: 'error',
          text: error instanceof ApiError ? error.message : '操作執行失敗,系統資料未變更。',
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const cancelAction = async (messageIndex: number, action: PendingAction) => {
    if (busy) return;
    setBusy(true);
    try {
      await apiPost<{ cancelled: boolean }>(`/api/ai/actions/${action.id}/cancel`, {});
      setMessages((current) =>
        current.map((message, index) =>
          index === messageIndex ? { ...message, actionState: 'cancelled' as const } : message,
        ),
      );
    } catch (error) {
      setMessages((current) => [
        ...current,
        { role: 'error', text: error instanceof ApiError ? error.message : '取消操作失敗,請稍後再試。' },
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
      const res = await apiPost<{ answer: string }>('/api/ai/analyze', { history: recentHistory() });
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
        description="用自然語言查詢與分析排程、預演異常情境，也能建立或修改訂單；所有寫入操作都會先讓你確認。"
        actions={status?.enabled ? <Badge tone="green">✓ Gemini 已啟用</Badge> : <Badge tone="slate">Gemini 未啟用</Badge>}
      />

      <div className="ai-workspace">
        <aside className="ai-context-panel">
          <div className="ai-status-block">
            <span className={`ai-orb ${status?.enabled ? 'is-online' : ''}`}>✦</span>
            <div>
              <small>DECISION COPILOT</small>
              <h2>{status?.enabled ? 'Gemini 已準備完成' : 'Gemini 尚未啟用'}</h2>
              <p>
                {hasSchedule
                  ? `目前有 ${scenarios?.length ?? 0} 個排程方案可供分析。`
                  : '可直接查詢資料、預演情境或請 AI 執行排程。'}
              </p>
            </div>
          </div>

          {!status?.enabled && (
            <Banner tone="warn">
              請在 server/.env 設定 GEMINI_API_KEY 後重新啟動伺服器。其他排程功能不受影響。
            </Banner>
          )}
          {status?.enabled && !hasSchedule && <Banner tone="info">目前沒有排程結果，你可以直接請 AI 執行排程。</Banner>}

          <div className="ai-context-note">
            <span aria-hidden>i</span>
            <p>AI 可分析排程與預演情境；新增、修改訂單或執行排程前一定會顯示確認卡。</p>
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
            <div className="ai-chat-actions">
              {messages.length > 0 && (
                <button
                  type="button"
                  className="ai-clear-chat"
                  onClick={() => {
                    if (window.confirm('確定要清除這個瀏覽器中的 AI 對話紀錄嗎？')) setMessages([]);
                  }}
                >
                  清除對話
                </button>
              )}
              <span className={`ai-connection ${status?.enabled ? 'is-online' : ''}`}>
                <i />
                {status?.enabled ? 'ONLINE' : 'OFFLINE'}
              </span>
            </div>
          </header>

          <div className="ai-message-area">
            {messages.length === 0 ? (
              <div className="ai-empty-conversation">
                <span aria-hidden>✦</span>
                <h3>從問題或操作指令開始</h3>
                <p>可以查詢逾期與瓶頸、預演急單或故障，也可以直接要求建立或修改訂單。</p>
              </div>
            ) : (
              <div className="space-y-4">
                {messages.map((message, index) => (
                  <div key={index} className={`ai-message-row is-${message.role}`}>
                    {message.role !== 'user' && <span className="message-avatar">{message.role === 'error' ? '!' : 'AI'}</span>}
                    <div className="ai-message-stack">
                      <div className="ai-message-bubble">{message.text}</div>
                      {message.action && (
                        <section className={`ai-action-card is-${message.actionState ?? 'pending'}`}>
                          <header>
                            <div>
                              <span>SYSTEM ACTION</span>
                              <h3>{message.action.title}</h3>
                            </div>
                            <strong>
                              {message.actionState === 'completed'
                                ? '已執行'
                                : message.actionState === 'cancelled'
                                  ? '已取消'
                                  : message.actionState === 'expired'
                                    ? '已失效'
                                  : '等待確認'}
                            </strong>
                          </header>
                          <p>{message.action.description}</p>
                          <dl>
                            {message.action.details.map((detail) => (
                              <div key={detail.label}>
                                <dt>{detail.label}</dt>
                                <dd>{detail.value}</dd>
                              </div>
                            ))}
                          </dl>
                          {message.actionState === 'pending' && (
                            <footer>
                              <Button variant="secondary" onClick={() => void cancelAction(index, message.action!)} disabled={busy}>
                                取消
                              </Button>
                              <Button onClick={() => void confirmAction(index, message.action!)} disabled={busy}>
                                確認執行 <span aria-hidden>→</span>
                              </Button>
                            </footer>
                          )}
                        </section>
                      )}
                      {message.navigateTo && (
                        <div className="ai-result-action">
                          <Button variant="secondary" onClick={() => navigate(message.navigateTo!)}>
                            查看結果 <span aria-hidden>→</span>
                          </Button>
                        </div>
                      )}
                    </div>
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
