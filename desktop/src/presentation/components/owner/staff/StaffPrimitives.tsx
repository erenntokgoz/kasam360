import { forwardRef, useCallback, useEffect, useMemo, useState } from 'react';
import { tauriInvoke as invoke } from '../../../../data/ipc/tauriInvoke';
import { useAuthStore } from '../../../store/useAuthStore';
import { toast as useToast } from '@core/components/ui/toast';
import { Cake, RefreshCw, X } from 'lucide-react';
import type { BirthdayRow } from './staff360Types';
import { formatDate } from './staff360Types';

/** Faz 11 ortak kabuk: her sekme bu sarmalayıcıyı kullanır. */
export type StaffTabShellProps = {
  tenantId: string;
  actorRole: string;
  actorId: string;
};

/** Panel başlığı: ikon + başlık + açıklama + sağdaki eylemler. */
export function StaffPanelHeader({
  icon,
  title,
  description,
  onRefresh,
  refreshing = false,
  actions,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  onRefresh?: () => void;
  refreshing?: boolean;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-black/[0.08] bg-white/75 p-5 shadow-lg backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.04]">
      <div className="flex items-start gap-2.5">
        <span className="text-[#007AFF]">{icon}</span>
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-white">
            {title}
          </h2>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{description}</p>
        </div>
      </div>
      <div className="flex items-center gap-2.5">
        {actions}
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={refreshing}
            aria-label="Yenile"
            className="flex cursor-pointer items-center gap-2 rounded-2xl border border-black/10 bg-black/[0.05] px-4 py-2 text-xs font-medium text-zinc-900 shadow-sm transition-all hover:bg-black/[0.08] disabled:opacity-50 dark:border-white/15 dark:bg-white/[0.08] dark:text-white dark:hover:bg-white/[0.14]"
          >
            <RefreshCw size={13} className={refreshing ? 'animate-spin text-zinc-400' : ''} />
            <span>Yenile</span>
          </button>
        )}
      </div>
    </div>
  );
}

/** Hata bandı: kapatılabilir. Sessiz hata gösterilmez. */
export function StaffErrorBar({ message, onClose }: { message: string | null; onClose: () => void }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="flex items-center justify-between rounded-3xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-xs text-rose-700 dark:text-rose-300"
    >
      <span>{message}</span>
      <button onClick={onClose} aria-label="Kapat" className="cursor-pointer hover:text-white">
        <X size={14} />
      </button>
    </div>
  );
}

/** Yükleniyor durumu. */
export function StaffLoading({ label = 'Yükleniyor' }: { label?: string }) {
  return (
    <div className="flex h-40 items-center justify-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
      <RefreshCw size={16} className="animate-spin text-[#007AFF]" />
      <span>{label}</span>
    </div>
  );
}

/**
 * Boş durum.
 *
 * Neden "veri yok" yazıyoruz: boş tabloyu "0 kayıt" gibi göstermek, kaydın
 * gerçekten olmadığı ile sorgunun boş döndüğünü ayırt edilemez kılar.
 */
export function StaffEmptyState({ message, hint }: { message: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 rounded-3xl border border-dashed border-black/10 bg-white/40 px-6 py-10 text-center backdrop-blur-md dark:border-white/10 dark:bg-white/[0.02]">
      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">{message}</p>
      {hint && <p className="text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>}
    </div>
  );
}

/**
 * Yaklaşan doğum günleri şeridi.
 *
 * Veri bilinmiyse **boş** şerit gösterilir; "1 kişi doğum günü" gibi
 * uydurma bir sayaç ikrami planını yanlış kurdurur.
 */
export const BirthdayStrip = forwardRef<
  HTMLDivElement,
  {
    tenantId: string;
    actorRole: string;
    daysAhead?: number;
  }
>(function BirthdayStrip({ tenantId, actorRole, daysAhead = 30 }, ref) {
  const [rows, setRows] = useState<BirthdayRow[]>([]);
  const [loading, setLoading] = useState(true);

  const yukle = useCallback(async () => {
    setLoading(true);
    try {
      const veri = await invoke<BirthdayRow[]>('get_upcoming_birthdays', {
        tenantId,
        tenant_id: tenantId,
        actorRole,
        actor_role: actorRole,
        daysAhead,
        days_ahead: daysAhead,
      });
      setRows(Array.isArray(veri) ? veri : []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [tenantId, actorRole, daysAhead]);

  useEffect(() => {
    yukle();
  }, [yukle]);

  if (loading) return <div className="text-xs text-zinc-500">Doğum günleri kontrol ediliyor...</div>;
  if (rows.length === 0) {
    return (
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Önümüzdeki {daysAhead} günde kayıtlı doğum günü yok.
      </p>
    );
  }
  return (
    <div
      ref={ref}
      className="flex flex-wrap items-center gap-2"
      data-testid="birthday-strip"
    >
      <Cake size={14} className="text-[#FF375F]" />
      {rows.map((r) => (
        <span
          key={r.userId}
          className="rounded-2xl border border-black/10 bg-white/80 px-3 py-1.5 text-xs text-zinc-700 backdrop-blur-md dark:border-white/15 dark:bg-white/[0.06] dark:text-zinc-200"
        >
          {r.fullName} · {formatDate(r.date)}
        </span>
      ))}
    </div>
  );
});

/** Sekme kabuğunu sağlayan kanca: tenant, rol ve kimlik tek noktadan gelir. */
export function useStaffContext(): StaffTabShellProps & { toast: typeof useToast.add } {
  const user = useAuthStore((s) => s.user);
  const tenantId = user?.tenantId || 'DEFAULT_TENANT';
  const actorRole = (user?.role || 'OWNER').toString().toUpperCase();
  const actorId = user?.userId || 'usr_owner';
  const toast = useToast.add;
  return useMemo(
    () => ({ tenantId, actorRole, actorId, toast }),
    [tenantId, actorRole, actorId, toast]
  );
}

/** Yetki kontrolü: maaş tutarını yalnız sahibi görebilir. */
export function canSeePayrollAmounts(actorRole: string): boolean {
  return actorRole === 'OWNER';
}