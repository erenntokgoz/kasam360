import { useEffect, useRef } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useUIStore } from '../stores/uiStore';

/** Kapalı sekmeler de bağlı kalır; hata yalnız kaynağın ekranda olduğu anda bildirilir. */
export function ErrorToast({ message }: { message?: string | null }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const previous = useRef<string | null>(null);
  const activeModule = useUIStore((state) => state.activeModule);
  const isLocked = useAuthStore((state) => state.isLocked);

  useEffect(() => {
    if (!message) { previous.current = null; return; }
    const node = anchor.current;
    if (previous.current === message || !node?.getClientRects().length || node.closest('[inert]')) return;
    previous.current = message;
    useUIStore.getState().showErrorNotice(message);
  }, [activeModule, isLocked, message]);

  return message ? <span ref={anchor} aria-hidden="true" className="sr-only" /> : null;
}
