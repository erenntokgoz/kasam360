import { useLayoutEffect, type RefObject } from 'react';
import { prefersReducedMotion, spawnExitGhost } from '../lib/motion';

/**
 * Pencere kapanınca kopyası söner; asıl öğe hemen DOM'dan çıkar.
 * Kapanış animasyonu için bileşeni açık tutmak, kapanmış verinin (seçili kalem, masa) yeniden
 * çizilmesini ve arkadaki ekranın beklemesini gerektirirdi; kopya ikisini de önler.
 */
export function useExitGhost(rootRef: RefObject<HTMLElement | null>, isOpen: boolean) {
  useLayoutEffect(() => {
    if (!isOpen) return undefined;
    const root = rootRef.current;
    if (!root) return undefined;

    // Ayrılmış öğe kaydırma konumunu kaybeder; kopya aynı yerden sönsün diye konum burada tutulur.
    const scrolled = new Map<Element, number>();
    const trackScroll = (event: Event) => {
      if (event.target instanceof Element) scrolled.set(event.target, event.target.scrollTop);
    };
    root.addEventListener('scroll', trackScroll, { capture: true, passive: true });

    return () => {
      root.removeEventListener('scroll', trackScroll, { capture: true });
      if (prefersReducedMotion()) return;
      const scrolls: Array<[number, number]> = [];
      if (scrolled.size > 0) {
        [root, ...root.querySelectorAll('*')].forEach((node, index) => {
          const top = scrolled.get(node);
          if (top) scrolls.push([index, top]);
        });
      }
      const ghost = root.cloneNode(true);
      // StrictMode deneme sökümünde öğe yerinde kalır; yalnız gerçekten kalkan pencere söner.
      queueMicrotask(() => {
        if (!root.isConnected && ghost instanceof HTMLElement) spawnExitGhost(ghost, scrolls);
      });
    };
  }, [rootRef, isOpen]);
}
