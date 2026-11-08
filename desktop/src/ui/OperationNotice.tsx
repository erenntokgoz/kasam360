import { CheckCircle2, CircleAlert, Info, TriangleAlert, X, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useDeviceSessionStore } from '../stores/deviceSessionStore';
import { useUIStore, type Notice, type NoticeKind } from '../stores/uiStore';
import { EXIT_MS, prefersReducedMotion } from '../lib/motion';

/** Hata ve uyarı okunmadan kaybolmamalı; başarı bildirimi işi bölmeden çekilir. */
const LIFETIME_MS: Record<NoticeKind, number> = { success: 4500, info: 6000, warning: 8000, error: 12000 };
/** Fare çekilince kalan süre çok kısaysa kart göz açıp kapayınca kaybolmasın. */
const MIN_RESUME_MS = 1500;

const ICONS: Record<NoticeKind, LucideIcon> = { success: CheckCircle2, error: CircleAlert, warning: TriangleAlert, info: Info };

function NoticeCard({ notice }: { notice: Notice }) {
  const clearNotice = useUIStore((state) => state.clearNotice);
  const [paused, setPaused] = useState(false);
  // Kapanış hangi kimlik için başladıysa onu taşır; aynı mesaj yeniden gelirse kart geri açılır.
  const [leavingId, setLeavingId] = useState<number | null>(null);
  const remaining = useRef(LIFETIME_MS[notice.kind]);
  const startedAt = useRef(0);
  const leaving = leavingId === notice.id;
  const urgent = notice.kind === 'error' || notice.kind === 'warning';
  const Icon = ICONS[notice.kind];

  useEffect(() => { remaining.current = LIFETIME_MS[notice.kind]; }, [notice.id, notice.kind]);

  const dismiss = () => {
    if (prefersReducedMotion()) clearNotice(notice.id);
    else setLeavingId(notice.id);
  };

  useEffect(() => {
    if (paused || leaving) return undefined;
    startedAt.current = Date.now();
    const timer = window.setTimeout(dismiss, remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(MIN_RESUME_MS, remaining.current - (Date.now() - startedAt.current));
    };
    // dismiss yalnız kimliğe bağlıdır; kimlik değişince süre baştan kurulur.
  }, [notice.id, paused, leaving]);

  useEffect(() => {
    if (!leaving) return undefined;
    // Animasyon olayı gelmezse kart yine de kalkar.
    const timer = window.setTimeout(() => clearNotice(notice.id), EXIT_MS + 80);
    return () => window.clearTimeout(timer);
  }, [clearNotice, leaving, notice.id]);

  return (
    <div
      data-kind={notice.kind}
      data-leaving={leaving || undefined}
      className="notice-slip"
      onAnimationEnd={(event) => { if (leaving && event.target === event.currentTarget) clearNotice(notice.id); }}
      onPointerEnter={() => setPaused(true)} onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}
    >
      <Icon aria-hidden="true" className="notice-slip-icon" />
      <p role={urgent ? 'alert' : 'status'} className="notice-slip-text">{notice.message}</p>
      {notice.count > 1 ? (
        <span key={notice.count} className="notice-slip-count" aria-hidden="true">×{notice.count}</span>
      ) : null}
      <button type="button" aria-label="Bildirimi kapat" onClick={dismiss} className="notice-slip-close">
        <X aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}

export function OperationNotice() {
  const notices = useUIStore((state) => state.notices);
  const isLocked = useAuthStore((state) => state.isLocked);

  useEffect(() => {
    const clear = () => useUIStore.getState().clearNotice();
    const unsubscribeAuth = useAuthStore.subscribe((state, previous) => {
      if (state.isLocked !== previous.isLocked || state.user?.userId !== previous.user?.userId) clear();
    });
    const unsubscribeDevice = useDeviceSessionStore.subscribe((state, previous) => {
      if (state.session?.signedIn !== previous.session?.signedIn) clear();
    });
    return () => { unsubscribeAuth(); unsubscribeDevice(); };
  }, []);

  return (
    <div className="notice-stack print:hidden">
      {notices.map((notice) => !isLocked || notice.kind === 'error'
        // Anahtar mesaja bağlıdır: tekrar eden bildirim kartı yeniden çizilmez, yerinde sayı artar.
        ? <NoticeCard key={`${notice.kind}:${notice.message}`} notice={notice} />
        : null)}
    </div>
  );
}
