import { useCallback, useEffect, useRef, useState } from 'react';
import { errorText } from '../../../lib/cariInput';
import { formatDateTime } from '../../../lib/date';
import { invokeIPC } from '../../../services/tauriClient';
import { useAuthStore } from '../../../stores/authStore';
import { sessionArgs } from '../../../stores/cariStore';
import { Button } from '../../../ui/Button';
import { ErrorToast } from '../../../ui/ErrorToast';

interface MenuStatus {
  slug: string | null;
  enabled: boolean;
  entitled: boolean;
  version: number | null;
  publishedAt: string | null;
}

interface PublishOutcome {
  version: number;
  changed: boolean;
  slug: string | null;
  uploadedImages: number;
  skippedImages: number;
}

const MENU_HOST = 'menu.kasam360.com.tr';

/** Yayın sonucu tek cümle: sürüm değişmediyse bunu açıkça söyler. */
export function publishSummary(outcome: PublishOutcome): string {
  const head = outcome.changed ? `Menü yayınlandı (sürüm ${outcome.version}).` : `Menü zaten güncel (sürüm ${outcome.version}).`;
  return outcome.skippedImages > 0
    ? `${head} ${outcome.skippedImages} üründe eski biçimli görsel yayınlanmadı; ürünü açıp görseli yeniden seçin.`
    : head;
}

/** QR menü adresi ve yayını. Yayın satıştan bağımsızdır; internet yoksa yalnız bu bölüm hata verir. */
export function QrMenuSettings() {
  const role = useAuthStore((state) => state.user?.role);
  const modules = useAuthStore((state) => state.user?.activeModules ?? []);
  const allowed = modules.includes('feat_qr_menu') && (role === 'OWNER' || role === 'MANAGER');
  const [status, setStatus] = useState<MenuStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    try {
      const { actorRole, tenantId } = sessionArgs();
      setStatus(await invokeIPC<MenuStatus>('qr_menu_status', { actorRole, tenantId, activeModules: modules }));
      setError(null);
    } catch (caught) {
      setError(errorText(caught));
    }
  }, [allowed]);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  if (!allowed) return null;

  const publish = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { actorRole, tenantId } = sessionArgs();
      const outcome = await invokeIPC<PublishOutcome>('qr_menu_publish', { actorRole, tenantId, activeModules: modules });
      setNotice(publishSummary(outcome));
      await load();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const address = status?.slug ? `${MENU_HOST}/${status.slug}` : null;
  const lines = status ? [
    address ? `Adres: ${address}${status.enabled ? '' : ' (kapalı)'}` : 'Adres henüz atanmadı',
    status.entitled ? 'QR menü hakkı var' : 'QR menü hakkı yok',
    status.version ? `Yayın sürümü ${status.version}${status.publishedAt ? ` · ${formatDateTime(status.publishedAt)}` : ''}` : 'Henüz yayınlanmadı',
  ] : [];

  return (
    <section className="work-surface rounded-lg border border-[var(--border)] p-4 space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">QR Menü</h2>
        <div className="flex gap-2">
          <Button disabled={busy} onClick={() => void load()}>Yenile</Button>
          <Button variant="primary" isLoading={busy} disabled={!status?.entitled} onClick={() => void publish()}>Menüyü Yayınla</Button>
        </div>
      </header>
      {lines.length ? (
        <ul className="text-sm text-[var(--text-secondary)] tabular-nums space-y-1">
          {lines.map((line) => <li key={line}>{line}</li>)}
        </ul>
      ) : null}
      {notice ? <p role="status" className="text-sm font-medium">{notice}</p> : null}
      {error ? <p role="alert" className="text-sm font-medium text-[var(--danger)]">{error}</p> : null}
      <ErrorToast message={error} />
    </section>
  );
}
