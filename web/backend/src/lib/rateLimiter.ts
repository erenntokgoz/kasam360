export interface RateLimiter {
  allow(key: string, now?: number): boolean;
}

// Bellekte tutulur ve sunucu örneği başınadır; kötüye kullanımı yavaşlatır, kesin kota vermez.
export function createRateLimiter(limit: number, windowMs: number, maxKeys = 5000): RateLimiter {
  const hits = new Map<string, number[]>();

  return {
    allow(key, now = Date.now()) {
      const recent = (hits.get(key) ?? []).filter((time) => now - time < windowMs);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return false;
      }
      if (hits.size >= maxKeys && !hits.has(key)) hits.clear();
      hits.set(key, [...recent, now]);
      return true;
    },
  };
}
