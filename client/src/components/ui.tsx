import { type ReactNode, useEffect } from 'react';

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        {eyebrow && <p className="page-eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p className="page-description">{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function PageMetrics({
  items,
}: {
  items: {
    label: string;
    value: ReactNode;
    detail?: string;
    tone?: 'default' | 'green' | 'amber' | 'red' | 'blue';
  }[];
}) {
  return (
    <section className="page-metrics" aria-label="頁面摘要">
      {items.map((item) => (
        <div className={`page-metric is-${item.tone ?? 'default'}`} key={item.label}>
          <span className="page-metric-dot" />
          <div>
            <p>{item.label}</p>
            <strong>{item.value}</strong>
            {item.detail && <small>{item.detail}</small>}
          </div>
        </div>
      ))}
    </section>
  );
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  disabled,
  type = 'button',
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  type?: 'button' | 'submit';
  title?: string;
}) {
  const styles = {
    primary: 'app-button app-button-primary',
    secondary: 'app-button app-button-secondary',
    danger: 'app-button app-button-danger',
    ghost: 'app-button app-button-ghost',
  };
  return (
    <button type={type} title={title} className={styles[variant]} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="app-field">
      <span className="app-field-label">
        {label}
        {required && <span className="app-required">*</span>}
      </span>
      {children}
      {hint && <span className="app-field-hint">{hint}</span>}
    </label>
  );
}

export const inputCls = 'app-input';

export function Modal({
  title,
  open,
  onClose,
  children,
  wide,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={`modal-panel ${wide ? 'is-wide' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <p className="modal-eyebrow">資料設定</p>
            <h2>{title}</h2>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="關閉">
            ×
          </button>
        </div>
        <div className="modal-content">{children}</div>
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal title={title} open={open} onClose={onCancel}>
      <p className="mb-5 text-sm leading-6 text-slate-600">{message}</p>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          取消
        </Button>
        <Button variant="danger" onClick={onConfirm}>
          確認刪除
        </Button>
      </div>
    </Modal>
  );
}

export function Loading({ text = '資料載入中…' }: { text?: string }) {
  return (
    <div className="app-loading">
      <span className="app-spinner" />
      <div>
        <strong>{text}</strong>
        <span>正在同步最新排程資料</span>
      </div>
    </div>
  );
}

export function EmptyState({ text, action }: { text: string; action?: ReactNode }) {
  return (
    <div className="app-empty-state">
      <span className="empty-state-icon" aria-hidden>
        ◌
      </span>
      <p>{text}</p>
      {action}
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="app-error-state">
      <span aria-hidden>!</span>
      <div>
        <strong>資料載入失敗</strong>
        <p>{message}</p>
      </div>
    </div>
  );
}

export function Badge({
  tone,
  children,
}: {
  tone: 'green' | 'amber' | 'red' | 'slate' | 'blue';
  children: ReactNode;
}) {
  return <span className={`app-badge app-badge-${tone}`}>{children}</span>;
}

export function Banner({
  tone,
  children,
}: {
  tone: 'info' | 'warn' | 'error' | 'success';
  children: ReactNode;
}) {
  const icons = { info: 'i', warn: '!', error: '×', success: '✓' };
  return (
    <div className={`app-banner app-banner-${tone}`}>
      <span className="banner-icon" aria-hidden>
        {icons[tone]}
      </span>
      <div>{children}</div>
    </div>
  );
}
