import { useEffect, useRef } from 'react';
import { useAuthStore } from '../store/useAuthStore';

// 2 dakika (120.000 ms) boyunca etkileşim olmaması durumunda otomatik kilit süresi
export const DEFAULT_AUTO_LOCK_TIMEOUT_MS = 2 * 60 * 1000;

/**
 * Kullanıcı etkileşimlerini (fare, klavye, dokunma, kaydırma) dinleyerek
 * 2 dakika boyunca işlem yapılmadığında terminali otomatik kilitleyen hook.
 * Ortak terminal güvenliği için MASTER dışındaki tüm operasyonel ekranlarda aktiftir.
 */
export function useAutoLock(timeoutMs: number = DEFAULT_AUTO_LOCK_TIMEOUT_MS): void {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isLocked = useAuthStore((state) => state.isLocked);
  const user = useAuthStore((state) => state.user);
  const lock = useAuthStore((state) => state.lock);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActivityRef = useRef<number>(Date.now());

  useEffect(() => {
    // MASTER rolü platform yönetiminde olduğu için ve Canlı Gözlemci modundayken kilit devre dışı bırakılır
    const isMaster = user?.role === 'MASTER';
    const isImpersonating = Boolean(user?.userId?.startsWith('impersonate_'));
    if (!isAuthenticated || isLocked || isMaster || isImpersonating) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    const startTimer = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(() => {
        // Otomatik kilidi devreye al
        lock();
      }, timeoutMs);
    };

    // Yüksek frekanslı olaylarda gereksiz timer reset'lerini engellemek için 1 saniyelik throttle
    const handleUserActivity = () => {
      const now = Date.now();
      if (now - lastActivityRef.current > 1000) {
        lastActivityRef.current = now;
        startTimer();
      }
    };

    // İlk zamanlayıcıyı başlat
    startTimer();

    // Dinlenecek kullanıcı etkileşim olayları
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'] as const;
    events.forEach((eventName) => {
      window.addEventListener(eventName, handleUserActivity, { passive: true });
    });

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      events.forEach((eventName) => {
        window.removeEventListener(eventName, handleUserActivity);
      });
    };
  }, [isAuthenticated, isLocked, user, lock, timeoutMs]);
}
