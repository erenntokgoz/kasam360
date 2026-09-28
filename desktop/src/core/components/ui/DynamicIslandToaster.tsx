import { useState, useEffect, useCallback } from 'react';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';
import { soundService } from '../../services/soundService';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
}

type ToastListener = (toast: ToastItem) => void;
const listeners = new Set<ToastListener>();

export const toast = {
  success: (message: string, duration = 3500) => {
    soundService.playPaymentSuccess();
    notify({ id: `t_${Date.now()}_${Math.random()}`, message, type: 'success', duration });
  },
  error: (message: string, duration = 4500) => {
    soundService.playError();
    notify({ id: `t_${Date.now()}_${Math.random()}`, message, type: 'error', duration });
  },
  warning: (message: string, duration = 4000) => {
    soundService.playWarning();
    notify({ id: `t_${Date.now()}_${Math.random()}`, message, type: 'warning', duration });
  },
  info: (message: string, duration = 3000) => {
    notify({ id: `t_${Date.now()}_${Math.random()}`, message, type: 'info', duration });
  },
};

function notify(toastItem: ToastItem) {
  listeners.forEach((l) => l(toastItem));
}

/**
 * Saf Apple visionOS / iOS 18 Dynamic Island Frosted Glass Toaster
 * Ekranın üst-ortasında bağımsız yüzer, fiziksel ışık kırılma pahına sahiptir.
 */
export function DynamicIslandToaster() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    const handleNewToast: ToastListener = (newToast) => {
      setToasts((prev) => [...prev.slice(-2), newToast]); // En fazla son 3 toast görünür

      const timer = setTimeout(() => {
        removeToast(newToast.id);
      }, newToast.duration || 3500);

      return () => clearTimeout(timer);
    };

    listeners.add(handleNewToast);
    return () => {
      listeners.delete(handleNewToast);
    };
  }, [removeToast]);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-5 left-1/2 -translate-x-1/2 z-[9999] flex flex-col items-center gap-2 pointer-events-none select-none max-w-[92vw] sm:max-w-md w-full">
      {toasts.map((t) => {
        const isSuccess = t.type === 'success';
        const isError = t.type === 'error';
        const isWarning = t.type === 'warning';

        return (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-center gap-3 px-4 py-2.5 rounded-full shadow-[0_12px_36px_rgba(0,0,0,0.4)] backdrop-blur-2xl border transition-all duration-300 animate-in fade-in slide-in-from-top-3 ${
              isSuccess
                ? 'bg-zinc-950/85 dark:bg-black/90 border-emerald-500/30 text-white shadow-[inset_0_1px_1px_0_rgba(52,211,153,0.3)]'
                : isError
                ? 'bg-zinc-950/85 dark:bg-black/90 border-rose-500/30 text-white shadow-[inset_0_1px_1px_0_rgba(244,63,94,0.3)]'
                : isWarning
                ? 'bg-zinc-950/85 dark:bg-black/90 border-amber-500/30 text-white shadow-[inset_0_1px_1px_0_rgba(245,158,11,0.3)]'
                : 'bg-zinc-950/85 dark:bg-black/90 border-white/20 text-white shadow-[inset_0_1px_1px_0_rgba(255,255,255,0.2)]'
            }`}
          >
            <div className="shrink-0">
              {isSuccess && <CheckCircle2 size={16} className="text-emerald-400 stroke-[2.2]" />}
              {isError && <AlertCircle size={16} className="text-rose-400 stroke-[2.2]" />}
              {isWarning && <AlertTriangle size={16} className="text-amber-400 stroke-[2.2]" />}
              {!isSuccess && !isError && !isWarning && <Info size={16} className="text-blue-400 stroke-[2.2]" />}
            </div>

            <span className="text-xs font-medium tracking-tight text-white/95 truncate">
              {t.message}
            </span>

            <button
              onClick={() => removeToast(t.id)}
              className="ml-auto p-0.5 rounded-full hover:bg-white/10 text-white/50 hover:text-white transition-colors"
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
