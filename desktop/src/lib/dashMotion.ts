import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { useEffect, useState, type RefObject } from 'react';
import { prefersReducedMotion } from './motion';

gsap.registerPlugin(useGSAP);

export { gsap, useGSAP };

/**
 * Pano animasyonları yalnız transform, opacity ve stroke-dashoffset oynatır. Hareket azaltma
 * isteyen kullanıcıda ve düşük donanım algısında (data-perf="low") hiç çalışmaz; son durum
 * zaten CSS'te yazılıdır, yani animasyon kapalıyken ekran eksik kalmaz.
 */
export function canAnimate(): boolean {
  if (prefersReducedMotion()) return false;
  return document.documentElement.dataset.perf !== 'low';
}

/**
 * Modüller sekmeler arası geçişte unmount edilmez, `display:none` ile saklanır. Saklı öğede
 * boyut sıfırdır; çizgi uzunluğu ve sekme çizgisi ölçülemez, gsap.from görünmeden oynayıp biter.
 * Bu kanca öğe her görünür olduğunda sayacı artırır; animasyon bağımlılığına eklenince kart
 * ekrana geldiği anda yeniden oynar. IntersectionObserver yoksa (test, sunucu çizimi) sayaç 1 kalır.
 */
export function useRevealKey(ref: RefObject<HTMLElement | null>): number {
  const [key, setKey] = useState(1);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') return undefined;
    let visible = false;
    const observer = new IntersectionObserver((entries) => {
      const now = entries.some((entry) => entry.isIntersecting);
      if (now && !visible) setKey((value) => value + 1);
      visible = now;
    }, { threshold: 0.05 });
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
  return key;
}
