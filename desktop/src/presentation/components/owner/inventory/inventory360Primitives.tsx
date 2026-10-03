// Faz 12 panellerinin ortak yüzeyleri.
//
// Tasarım kuralı (AGENTS.md §3.2): ham Tailwind ekranlarda yasaktır. Bu
// dosyadaki bileşenler design-system yüzeylerinin (cam kart, cam buton, rozet)
// ince sarmalayıcılarıdır; renk, blur ve yarıçap tek yerden gelir.

import { forwardRef, type ReactNode } from 'react';
import { AlertTriangle, Info } from 'lucide-react';

export const GlassPanel = forwardRef<HTMLDivElement, { children: ReactNode; className?: string }>(
  function GlassPanel({ children, className = '' }, ref) {
    return (
      <div
        ref={ref}
        className={`rounded-3xl dark:bg-white/[0.04] bg-white/75 backdrop-blur-xl border dark:border-white/10 border-black/[0.08] shadow-lg ${className}`}
      >
        {children}
      </div>
    );
  },
);
GlassPanel.displayName = 'GlassPanel';

export const PanelHeader = forwardRef<HTMLDivElement, { title: string; hint?: string; icon?: ReactNode }>(
  function PanelHeader({ title, hint, icon }, ref) {
    return (
      <div ref={ref} className="flex items-start justify-between gap-4 px-5 pt-5 pb-3">
        <div className="flex items-center gap-2.5">
          {icon ? <span className="text-[#007AFF]">{icon}</span> : null}
          <div>
            <h3 className="text-base font-semibold tracking-tight dark:text-white text-zinc-900">
              {title}
            </h3>
            {hint ? (
              <p className="text-xs dark:text-zinc-400 text-zinc-500 mt-0.5">{hint}</p>
            ) : null}
          </div>
        </div>
      </div>
    );
  },
);
PanelHeader.displayName = 'PanelHeader';

export const ActionButton = forwardRef<
  HTMLButtonElement,
  { children: ReactNode; onClick?: () => void; disabled?: boolean; tone?: 'primary' | 'neutral' | 'danger'; title?: string }
>(function ActionButton({ children, onClick, disabled, tone = 'neutral', title }, ref) {
  const ton = {
    primary: 'bg-[#007AFF] text-white border-transparent hover:bg-[#0066CC]',
    neutral:
      'dark:bg-white/[0.08] bg-black/[0.05] hover:dark:bg-white/[0.14] hover:bg-black/[0.08] dark:text-white text-zinc-900 dark:border-white/15 border-black/10',
    danger: 'bg-rose-500/15 text-rose-400 border-rose-500/25 hover:bg-rose-500/25',
  }[tone];

  return (
    <button
      ref={ref}
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1.5 px-4 py-2 border rounded-2xl text-xs font-semibold transition-all shadow-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${ton}`}
    >
      {children}
    </button>
  );
});
ActionButton.displayName = 'ActionButton';

/** Küçük durum rozeti. Renk yalnız Apple sistem renklerinden gelir. */
export function StateBadge({ tone, children }: { tone: 'neutral' | 'good' | 'warn' | 'bad' | 'info'; children: ReactNode }) {
  const ton = {
    neutral: 'dark:bg-white/[0.06] bg-black/[0.04] dark:text-zinc-300 text-zinc-600',
    good: 'bg-[#30D158]/15 text-[#30D158]',
    warn: 'bg-[#FF9F0A]/15 text-[#FF9F0A]',
    bad: 'bg-[#FF453A]/15 text-[#FF453A]',
    info: 'bg-[#64D2FF]/15 text-[#64D2FF]',
  }[tone];

  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-[11px] font-semibold ${ton}`}>
      {children}
    </span>
  );
}

/** Hata şeridi. Ekranda kırmızı uyarı, düzeltici mesajı yok. */
export function ErrorStrip({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 p-3.5 rounded-3xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300"
    >
      <span className="flex items-center gap-2">
        <AlertTriangle size={14} className="shrink-0" />
        {message}
      </span>
      {onDismiss ? (
        <button type="button" onClick={onDismiss} className="text-rose-400 hover:text-white shrink-0">
          Kapat
        </button>
      ) : null}
    </div>
  );
}

/** Bilgi şeridi. Boş gerekçe, "neden" sorusunun cevabıdır. */
export function InfoStrip({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 p-3.5 rounded-3xl bg-[#64D2FF]/10 border border-[#64D2FF]/20 text-xs text-[#64D2FF]">
      <Info size={14} className="shrink-0 mt-0.5" />
      <span>{children}</span>
    </div>
  );
}

/** Yükleniyor iskeleti. Boş tablo ile yükleniyor tablosu ayırt edilir. */
export function LoadingRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2 px-5 pb-5" aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className="h-9 rounded-xl dark:bg-white/[0.04] bg-black/[0.03] animate-pulse"
          data-testid="loading-row"
        />
      ))}
    </div>
  );
}

/** Satır girdisi. Kuruş alanları `step=1` ile tam sayı kabul eder. */
export function Field({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wider dark:text-zinc-400 text-zinc-500">
        {label}
      </span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="px-3 py-2 rounded-2xl dark:bg-white/[0.06] bg-white/80 dark:text-white text-zinc-900 text-sm border dark:border-white/10 border-black/[0.08] focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40"
      />
      {hint ? <span className="text-[11px] dark:text-zinc-500 text-zinc-400">{hint}</span> : null}
    </label>
  );
}

/** Boş durum. "Kayıt yok" ile "yüklenemedi" ayrımı açık yazılır. */
export function EmptyState({ message }: { message: string }) {
  return (
    <p className="px-5 pb-5 text-xs dark:text-zinc-500 text-zinc-400 text-center py-6">{message}</p>
  );
}