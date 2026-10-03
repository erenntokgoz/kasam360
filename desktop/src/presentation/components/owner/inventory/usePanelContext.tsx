// Faz 12 panellerinin ortak veri bağlamı.
//
// Neden ayrı: her panel aynı oturum bağlamını (kiracı, rol, aktör) ve aynı
// hata/loading kalıbını kullanır. Tek yerde toplanınca bayrak kapısı ve rol
// kapısı panel sayısı artsa da kaçırılmaz.

import { useCallback, useEffect, useState } from 'react';
import { toast as useToast } from '@core/components/ui/toast';
import { useAuthStore } from '../../../store/useAuthStore';
import { tauriInvoke as invoke } from '../../../../data/ipc/tauriInvoke';
import { useFeatureFlags } from '../../../hooks/useFeatureFlags';

export interface PanelContext {
  tenantId: string;
  actorRole: string;
  actorId: string;
  toast: typeof useToast.add;
  /** Sahip mi? Fiyat ve reçete yazma yolları yalnız sahibe açıktır. */
  isOwner: boolean;
  isManager: boolean;
  isRecipeBomEnabled: boolean;
  isDynamicPricingEnabled: boolean;
  isLossRadarEnabled: boolean;
}

export function usePanelContext(): PanelContext {
  const user = useAuthStore((s) => s.user);
  const flags = useFeatureFlags();
  const toast = useToast.add;

  return {
    tenantId: user?.tenantId || '',
    actorRole: (user?.role || 'WAITER').toString().toUpperCase(),
    actorId: user?.userId || '',
    toast,
    isOwner: (user?.role || '').toString().toUpperCase() === 'OWNER',
    isManager: ['OWNER', 'MANAGER'].includes((user?.role || '').toString().toUpperCase()),
    isRecipeBomEnabled: flags.isRecipeBomEnabled,
    isDynamicPricingEnabled: flags.isDynamicPricingEnabled,
    isLossRadarEnabled: flags.isLossRadarEnabled,
  };
}

/** Bayrak yüzeyi. Bayrak kapalıyken komut **hiç çağrılmaz**. */
export function FeatureOffNotice({ featureName, hint }: { featureName: string; hint: string }) {
  return (
    <div
      role="status"
      className="flex flex-col items-center gap-2 py-12 px-6 text-center rounded-3xl dark:bg-white/[0.03] bg-white/60 backdrop-blur-xl border dark:border-white/10 border-black/[0.08]"
    >
      <p className="font-mono text-xs text-zinc-400">404</p>
      <p className="text-sm font-semibold dark:text-white text-zinc-900">{featureName} bu işletmede etkin değil</p>
      <p className="text-xs dark:text-zinc-500 text-zinc-500 max-w-sm">{hint}</p>
    </div>
  );
}

/** Panel seviyesinde yetki yüzeyi. Yetkisiz kullanıcı boş tablo görmez. */
export function NoPermissionNotice({ need }: { need: string }) {
  return (
    <div
      role="status"
      className="flex flex-col items-center gap-2 py-12 px-6 text-center rounded-3xl dark:bg-white/[0.03] bg-white/60 backdrop-blur-xl border dark:border-white/10 border-black/[0.08]"
    >
      <p className="text-sm font-semibold dark:text-white text-zinc-900">Bu bölüm sana açık değil</p>
      <p className="text-xs dark:text-zinc-500 text-zinc-500 max-w-sm">{need}</p>
    </div>
  );
}

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * Tek seferlik komut çağrısı.
 *
 * `enabled` verilmezse komut koşulsuz çalışır. Bayrağa bağlı komutlarda
 * `enabled: bayrakAcik` geçilir; böylece kapalı bayrak için backend'e giden
 * istek hiç oluşmaz ve 404 yüzeyi hata gibi görünmez.
 */
export function useAsyncCommand<T>(
  command: string | null,
  args: Record<string, unknown>,
  enabled = true,
): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  const argKey = JSON.stringify(args);
  useEffect(() => {
    if (!command || !enabled) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }
    let iptal = false;
    setLoading(true);
    setError(null);

    invoke<T>(command, args)
      .then((veri) => {
        if (!iptal) {
          setData(veri);
          setLoading(false);
        }
      })
      .catch((hata: unknown) => {
        if (!iptal) {
          setData(null);
          setLoading(false);
          setError(hata instanceof Error ? hata.message : String(hata));
        }
      });

    return () => {
      iptal = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command, enabled, tick, argKey]);

  return { data, loading, error, reload };
}