import { useEffect } from 'react';
import { useUIStore } from '../stores/uiStore';

export function OperationNotice() {
  const notice = useUIStore((state) => state.notice);
  const clear = useUIStore((state) => state.clearNotice);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(clear, 5000);
    return () => window.clearTimeout(timer);
  }, [notice, clear]);

  return (
    <div role="status" className="fixed bottom-5 right-5 z-40 pointer-events-none max-w-[min(24rem,calc(100vw-2.5rem))]">
      {notice ? <p className="paper border border-[var(--border)] px-5 pb-3 pt-5 text-sm font-semibold break-words">{notice.message}</p> : null}
    </div>
  );
}
