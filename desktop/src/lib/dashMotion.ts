import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
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
