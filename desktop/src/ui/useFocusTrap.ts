import { useEffect, type RefObject } from 'react';

const FOCUSABLE =
  'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Açık pencere odağı içinde tutar: klavyeyle arkadaki ekrana basılamaz. */
export function useFocusTrap(panelRef: RefObject<HTMLElement | null>, isOpen: boolean) {
  useEffect(() => {
    if (!isOpen) return undefined;
    const panel = panelRef.current;
    if (!panel) return undefined;
    const previous = document.activeElement as HTMLElement | null;
    if (!panel.contains(document.activeElement)) panel.focus();

    const keepInside = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((item) => item.offsetParent !== null);
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', keepInside);
    return () => {
      window.removeEventListener('keydown', keepInside);
      previous?.focus?.();
    };
  }, [panelRef, isOpen]);
}
