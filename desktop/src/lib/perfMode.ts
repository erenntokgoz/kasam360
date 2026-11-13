/* Düşük donanımlı Android cihazlarda cam yüzeyi kapatmak için kök öğeye data-perf="low" yazar.
   Neden: bulanıklık düşük belleğe/çekirdeğe sahip cihazlarda her karede maliyetlidir; opak yüzey aynı
   bilgiyi taşır. Elle zorlamak için localStorage "kasam360.perf" değeri "low" yapılabilir. */

interface NavigatorWithMemory extends Navigator {
  deviceMemory?: number;
}

export function isLowPerformanceDevice(nav: NavigatorWithMemory): boolean {
  const isAndroid = /android/i.test(nav.userAgent);
  if (!isAndroid) return false;
  const lowMemory = typeof nav.deviceMemory === 'number' && nav.deviceMemory <= 2;
  const lowCores = typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency <= 2;
  return lowMemory || lowCores;
}

export function applyPerformanceMode(): void {
  if (typeof document === 'undefined' || typeof navigator === 'undefined') return;
  let forced = false;
  try {
    forced = window.localStorage.getItem('kasam360.perf') === 'low';
  } catch {
    forced = false;
  }
  if (forced || isLowPerformanceDevice(navigator as NavigatorWithMemory)) {
    document.documentElement.dataset.perf = 'low';
  }
}

/**
 * Ölçülen kare süresi: açılıştan sonra boşta 40 kare sayılır; ortanca süre 50 ms'yi (20 kare/sn altı)
 * aşarsa cihaz gerçekten zayıf sayılır. Neden: çekirdek/bellek sayısı tahmindir, gerçek akıcılık değil;
 * yalnız ölçüm kötüyse cam ve hareket kapatılır. Arka plandaki sekme ölçülmez (tarayıcı kareyi seyreltir).
 */
export function isSlowFrameSample(frameMs: number[]): boolean {
  if (frameMs.length < 20) return false;
  const sorted = [...frameMs].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] > 50;
}

export function watchFramePerformance(): void {
  if (typeof window === 'undefined' || typeof requestAnimationFrame !== 'function') return;
  window.setTimeout(() => {
    const samples: number[] = [];
    let last = 0;
    const tick = (now: number) => {
      if (document.visibilityState !== 'visible') return;
      if (last) samples.push(now - last);
      last = now;
      if (samples.length < 40) { requestAnimationFrame(tick); return; }
      if (isSlowFrameSample(samples)) document.documentElement.dataset.perf = 'low';
    };
    requestAnimationFrame(tick);
  }, 4000);
}
