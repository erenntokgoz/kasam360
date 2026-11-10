import { isEffectiveEntitlementResponse } from '../contracts/commercialChain.js';

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type EntitlementAnswer = 'yes' | 'no' | 'unknown';

export interface QrMenuEntitlement {
  /** `allowStale`: Labs ulaşılamazsa yalnız yakın zamanda doğrulanmış olumlu sonuç kullanılır (public okuma). */
  check(tenantId: string, options?: { allowStale?: boolean }): Promise<EntitlementAnswer>;
}

export const QR_MENU_FEATURE = 'feat_qr_menu';
const FRESH_MS = 60_000;
const STALE_MS = 10 * 60_000;
const MAX_ENTRIES = 5000;

export interface LabsEntitlementConfig { labsOrigin?: string; labsToken?: string; fetcher?: Fetcher; now?: () => number }

/**
 * Hak otoritesi Labs'tır. Her public istek Labs'a gitmesin diye sonuç kısa süre tutulur;
 * doğrulanamayan durum asla "var" sayılmaz (fail-closed), yalnız 10 dakikadan yeni olumlu sonuç tolere edilir.
 */
export function labsQrMenuEntitlement(config: LabsEntitlementConfig = {}): QrMenuEntitlement {
  const origin = (config.labsOrigin ?? process.env.LABS_CATALOG_ORIGIN ?? '').replace(/\/$/, '');
  const token = config.labsToken ?? process.env.LABS_CATALOG_TOKEN ?? '';
  const fetcher = config.fetcher ?? fetch;
  const now = config.now ?? Date.now;
  const cache = new Map<string, { granted: boolean; at: number }>();

  return {
    async check(tenantId, { allowStale = false } = {}) {
      const cached = cache.get(tenantId);
      if (cached && now() - cached.at < FRESH_MS) return cached.granted ? 'yes' : 'no';
      const fallback = (): EntitlementAnswer => (allowStale && cached?.granted && now() - cached.at < STALE_MS ? 'yes' : 'unknown');
      if (!origin || !token) return 'unknown';
      try {
        const response = await fetcher(`${origin}/api/v1/urunler/kasam360/kiracilar/${encodeURIComponent(tenantId)}/hak`, {
          method: 'GET', cache: 'no-store', signal: AbortSignal.timeout(5000),
          headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
        });
        let granted = false;
        if (response.ok) {
          const value: unknown = await response.json().catch(() => null);
          if (!isEffectiveEntitlementResponse(value) || value.tenantId !== tenantId) return fallback();
          const until = value.validUntil ? Date.parse(value.validUntil) : Number.NaN;
          granted = value.status === 'active' && value.featureKeys.includes(QR_MENU_FEATURE) && until > now();
        } else if (response.status !== 404) {
          return fallback();
        }
        if (cache.size >= MAX_ENTRIES) cache.clear();
        cache.set(tenantId, { granted, at: now() });
        return granted ? 'yes' : 'no';
      } catch {
        return fallback();
      }
    },
  };
}
