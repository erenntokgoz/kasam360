import { useEffect, useState } from 'react';
import { formatDateTime } from '../../../lib/date';
import { useLicenseStore, type LicenseState } from '../../../stores/licenseStore';
import { Button } from '../../../ui/Button';

// Lisans durumu kasanın neden açılıp açılmadığını anlatır; bu yüzden kritik durumlar
// geçici toast yerine kalıcı metinle gösterilir.
const STATE_TEXT: Record<LicenseState, { title: string; detail: string; tone: 'ok' | 'warn' | 'bad' }> = {
  ACTIVE: { title: 'Lisans etkin', detail: 'Paket özellikleri bu kasada açık.', tone: 'ok' },
  GRACE: { title: 'Ek süre', detail: 'Lisans yenilenemedi; kasa ek süre bitene kadar çalışır. İnternete bağlanıp yenileyin.', tone: 'warn' },
  EXPIRED: { title: 'Lisans süresi doldu', detail: 'Yeni satış ve eşitleme kapalı. Yerel kayıtlar silinmez; lisans yenilenince kuyruk gönderilir.', tone: 'bad' },
  NO_PACKAGE: { title: 'Paket yok', detail: 'İşletmenin etkin paketi bulunmuyor. Hesabım sayfasından paket durumunu kontrol edin.', tone: 'bad' },
  BLOCKED: { title: 'Cihaz engellendi', detail: 'Bu kasa işletme sahibi tarafından iptal edildi veya engellendi.', tone: 'bad' },
  INVALID: { title: 'Lisans doğrulanamadı', detail: 'İmza veya cihaz eşleşmesi geçersiz. Lisansı yenileyin.', tone: 'bad' },
  MISSING: { title: 'Lisans yok', detail: 'Bu kasa henüz bir işletmeye bağlanmadı.', tone: 'bad' },
};

const FEATURE_NAMES: Record<string, string> = {
  feat_kds: 'Mutfak ekranı', feat_qr_menu: 'QR menü', feat_delivery: 'Paket servis',
  feat_caller_id: 'Arayan numara', feat_table_order: 'Masa siparişi', feat_seat_split: 'Sandalye bazlı bölme',
  feat_recipe_bom: 'Reçete ve stok maliyeti', feat_dynamic_pricing: 'Dinamik fiyat', feat_ledger_cari: 'Cari hesap',
  feat_multi_branch: 'Çoklu şube', feat_loss_radar: 'Fire ve iptal radarı',
};

const TONE_CLASS = {
  ok: 'border-[var(--success)] text-[var(--success)]',
  warn: 'border-[var(--warning)] text-[var(--warning)]',
  bad: 'border-[var(--danger)] text-[var(--danger)]',
} as const;

export function LicenseSettings() {
  const { status, error, load, refresh } = useLicenseStore();
  const [busy, setBusy] = useState(false);

  useEffect(() => { void load(); }, [load]);

  // Bağlı kasa belge alamadıysa durum yine MISSING'dir; "bağlanmadı" demek yanlış olur.
  // Sunucunun gerçek nedeni (ör. paket yok, cihaz sınırı) başlık altında gösterilir.
  const linkedWithoutLicense = Boolean(status?.linked && status.state === 'MISSING' && status.lastError);
  const info = status
    ? linkedWithoutLicense
      ? { title: 'Lisans alınamadı', detail: status.lastError ?? '', tone: 'bad' as const }
      : STATE_TEXT[status.state]
    : null;

  return (
    <section className="work-surface rounded-lg border border-[var(--border)] p-4 space-y-4" aria-labelledby="license-heading">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="license-heading" className="text-base font-semibold">Lisans ve Paket</h2>
        <Button disabled={busy} onClick={() => {
          setBusy(true);
          void refresh().finally(() => setBusy(false));
        }}>{busy ? 'Yenileniyor…' : 'Lisansı Yenile'}</Button>
      </header>
      {!status && !error ? <p className="text-sm text-[var(--text-secondary)]" role="status">Lisans durumu okunuyor…</p> : null}
      {error ? (
        <p role="alert" className="rounded-md border border-[var(--danger)] p-3 text-sm text-[var(--danger)]">
          {status ? `Yenileme başarısız: ${error}. Eldeki lisans korunuyor.` : `Lisans durumu okunamadı: ${error}`}
        </p>
      ) : null}
      {status && info ? (
        <>
          <div className={`rounded-md border p-3 ${TONE_CLASS[info.tone]}`} role={info.tone === 'ok' ? 'status' : 'alert'}>
            <p className="font-semibold">{info.title}</p>
            <p className="text-sm text-[var(--text-primary)]">{info.detail}</p>
          </div>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-[var(--text-secondary)]">Paket</dt><dd>{status.plan?.name ?? '—'}</dd></div>
            <div><dt className="text-[var(--text-secondary)]">Geçerlilik sonu</dt><dd className="tabular-nums">{status.validUntil ? formatDateTime(status.validUntil) : '—'}</dd></div>
            <div><dt className="text-[var(--text-secondary)]">Cihaz sınırı</dt><dd className="tabular-nums">{status.plan?.deviceLimit ?? '—'}</dd></div>
            <div><dt className="text-[var(--text-secondary)]">Son kontrol</dt><dd className="tabular-nums">{status.checkedAt ? formatDateTime(status.checkedAt) : 'Hiç kontrol edilmedi'}</dd></div>
            <div className="sm:col-span-2">
              <dt className="text-[var(--text-secondary)]">Açık özellikler</dt>
              <dd>{status.features.length ? status.features.map((key) => FEATURE_NAMES[key] ?? key).join(' · ') : 'Ek özellik yok'}</dd>
            </div>
          </dl>
          {status.lastError && !linkedWithoutLicense ? <p className="text-sm text-[var(--text-secondary)]">Son sunucu yanıtı: {status.lastError}</p> : null}
        </>
      ) : null}
    </section>
  );
}
