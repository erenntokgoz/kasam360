/* Düşük donanımlı Android cihazlarda cam yüzeyi kapatmak için kök öğeye data-perf="low" yazar.
   Neden: bulanıklık düşük belleğe/çekirdeğe sahip cihazlarda her karede maliyetlidir; opak yüzey aynı
   bilgiyi taşır. Elle zorlamak için localStorage "kasam360.perf" değeri "low" yapılabilir. */

interface NavigatorWithMemory extends Navigator {
  deviceMemory?: number;
}

export function isLowPerformanceDevice(nav: NavigatorWithMemory): boolean {
  const isAndroid = /android/i.test(nav.userAgent);
  if (!isAndroid) return false;
  const lowMemory = typeof nav.deviceMemory === 'number' && nav.deviceMemory <= 4;
  const lowCores = typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency <= 4;
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
