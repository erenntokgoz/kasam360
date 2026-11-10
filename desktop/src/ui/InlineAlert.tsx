import React from 'react';
import { CircleAlert, X } from 'lucide-react';

interface InlineAlertProps {
  message: string;
  onDismiss?: () => void;
  className?: string;
}

/** Kritik hata geçici bildirimle kaybolmaz ve işlem düğmelerinin üstünü örtmez: akış içinde, kapatılana kadar durur. */
export const InlineAlert: React.FC<InlineAlertProps> = ({ message, onDismiss, className = '' }) => (
  <div
    role="alert"
    className={`flex items-start gap-2 rounded-lg border border-[var(--accent-red)] bg-[var(--accent-red-soft)] px-3 py-2 text-sm font-semibold text-[var(--text-primary)] ${className}`}
  >
    <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--accent-red)]" />
    <p className="min-w-0 flex-1 break-words">{message}</p>
    {onDismiss ? (
      <button
        type="button"
        aria-label="Hatayı kapat"
        onClick={onDismiss}
        className="flex size-12 -my-2 -mr-2 shrink-0 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
      >
        <X aria-hidden="true" className="size-4" />
      </button>
    ) : null}
  </div>
);
