// Faz 12 · Tedarikçi ve satın alma paneli.
//
// Fiyat karşılaştırması yıllık hacimle çalışır: en ucuz tedarikçi tek seferde
// daha pahalı görünse bile yıllık alımda daha avantajlı olabilir. Panel her iki
// rakamı da gösterir ve "daha pahalı ama uzun vadeli ucuz" yanılgısını kapatır.

import { useState } from 'react';
import { Truck } from 'lucide-react';
import { tauriInvoke as invoke } from '../../../../data/ipc/tauriInvoke';
import {
  ActionButton,
  EmptyState,
  ErrorStrip,
  Field,
  GlassPanel,
  InfoStrip,
  LoadingRows,
  PanelHeader,
  StateBadge,
} from './inventory360Primitives';
import { money, quantity, type PriceGap, type Supplier } from './inventory360Types';
import { NoPermissionNotice, useAsyncCommand, usePanelContext } from './usePanelContext';

export function SupplierPanel() {
  const ctx = usePanelContext();
  const [error, setError] = useState<string | null>(null);
  const [tedarikciAdi, setTedarikciAdi] = useState('');
  const [karsilastirilanUrun, setKarsilastirilanUrun] = useState('');
  const [yillikHacim, setYillikHacim] = useState('1000');
  const [gap, setGap] = useState<PriceGap | null>(null);

  const tedarikciler = useAsyncCommand<Supplier[]>(
    'get_inventory_suppliers',
    { tenantId: ctx.tenantId },
    ctx.tenantId !== '',
  );

  if (!ctx.isManager) {
    return <NoPermissionNotice need="Tedarikçi bilgileri ve alış fiyatları işletme sahibinin yetkisindedir." />;
  }

  async function tedarikciEkle() {
    setError(null);
    try {
      await invoke('upsert_supplier_command', {
        tenantId: ctx.tenantId,
        args: { name: tedarikciAdi.trim(), payment_term_days: 0, lead_time_days: 0 },
      });
      setTedarikciAdi('');
      tedarikciler.reload();
      ctx.toast({ title: 'Tedarikçi kaydedildi', type: 'success' });
    } catch (hata) {
      setError(hata instanceof Error ? hata.message : String(hata));
    }
  }

  async function fiyatlariKarsilastir() {
    setError(null);
    try {
      const sonuc = await invoke<PriceGap>('compare_supplier_prices_command', {
        tenantId: ctx.tenantId,
        args: { product_id: karsilastirilanUrun.trim(), annual_volume: Number(yillikHacim) || null },
      });
      setGap(sonuc);
    } catch (hata) {
      setGap(null);
      setError(hata instanceof Error ? hata.message : String(hata));
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {error ? <ErrorStrip message={error} onDismiss={() => setError(null)} /> : null}
      {tedarikciler.error ? <ErrorStrip message={tedarikciler.error} onDismiss={tedarikciler.reload} /> : null}

      <GlassPanel>
        <PanelHeader
          title="Tedarikçiler"
          hint="Vade ve teslim süresi sipariş planlamasını belirler"
          icon={<Truck size={18} strokeWidth={1.6} />}
        />
        {tedarikciler.loading ? (
          <LoadingRows />
        ) : !tedarikciler.data || tedarikciler.data.length === 0 ? (
          <EmptyState message="Tedarikçi kayıtlı değil. Alış fiyatı girilmeden maliyet hesaplanamaz." />
        ) : (
          <ul className="px-5 pb-4 space-y-2">
            {tedarikciler.data.map((tedarikci) => (
              <li
                key={tedarikci.id}
                className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-2xl dark:bg-white/[0.03] bg-black/[0.02] border dark:border-white/5 border-black/[0.05]"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium dark:text-white text-zinc-900 truncate">{tedarikci.name}</p>
                  <p className="text-[11px] dark:text-zinc-500 text-zinc-500 truncate">
                    {tedarikci.contact_person ?? 'Yetkili girilmemiş'} · vade {tedarikci.payment_term_days} gün ·
                    teslim {tedarikci.lead_time_days} gün
                  </p>
                </div>
                <StateBadge tone={tedarikci.is_active ? 'good' : 'neutral'}>
                  {tedarikci.is_active ? 'Aktif' : 'Pasif'}
                </StateBadge>
              </li>
            ))}
          </ul>
        )}
        {ctx.isOwner && (
          <div className="px-5 pb-5 flex items-end gap-2.5">
            <div className="flex-1">
              <Field label="Yeni tedarikçi" value={tedarikciAdi} onChange={setTedarikciAdi} placeholder="Toptancı Ltd." />
            </div>
            <ActionButton tone="primary" onClick={tedarikciEkle} disabled={!tedarikciAdi.trim()}>
              Kaydet
            </ActionButton>
          </div>
        )}
      </GlassPanel>

      <GlassPanel>
        <PanelHeader
          title="Tedarikçi fiyat karşılaştırması"
          hint="En ucuz tek seferde mi, yıllıkta mı?"
          icon={<Truck size={18} strokeWidth={1.6} />}
        />
        <div className="px-5 pb-5 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_auto] gap-2.5 items-end">
            <Field
              label="Ürün kimliği"
              value={karsilastirilanUrun}
              onChange={setKarsilastirilanUrun}
              placeholder="prd_..."
            />
            <Field
              label="Yıllık hacim"
              value={yillikHacim}
              onChange={setYillikHacim}
              type="number"
              hint="Birim"
            />
            <ActionButton tone="primary" onClick={fiyatlariKarsilastir} disabled={!karsilastirilanUrun.trim()}>
              Karşılaştır
            </ActionButton>
          </div>

          {gap && gap.rows.length === 0 ? (
            <EmptyState message="Bu ürün için birden fazla tedarikçi fiyatı girilmemiş. Karşılaştırma yapılamaz." />
          ) : null}

          {gap && gap.rows.length > 0 && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Metric label="En düşük" value={money(gap.lowest_cents)} />
                <Metric label="En yüksek" value={money(gap.highest_cents)} />
                <Metric label="Fark" value={money(gap.gap_cents)} />
                <Metric
                  label="Yıllık tasarruf"
                  value={gap.annual_saving_cents === null ? '—' : money(gap.annual_saving_cents)}
                />
              </div>
              {gap.gap_percent !== null && (
                <InfoStrip>
                  Fiyat farkı %{gap.gap_percent.toFixed(1)}. Yıllık hacim{' '}
                  {quantity(Number(yillikHacim))} birim olduğunda en ucuz tedarikçiye geçişin yıllık etkisi
                  {' '}
                  {gap.annual_saving_cents === null ? 'hesaplanamadı' : money(gap.annual_saving_cents)}
                  {gap.annual_saving_cents !== null && gap.annual_saving_cents > 0 ? ' tasarruf sağlar' : ' sağlamaz'}
                  .
                </InfoStrip>
              )}
              <ul className="space-y-1.5">
                {gap.rows.map((satir) => (
                  <li
                    key={satir.supplier_id}
                    className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-2xl dark:bg-white/[0.03] bg-black/[0.02] border dark:border-white/5 border-black/[0.05] text-xs"
                  >
                    <span className="dark:text-white text-zinc-900 truncate">{satir.supplier_name}</span>
                    <span className="flex items-center gap-2 shrink-0">
                      {satir.is_preferred ? <StateBadge tone="info">Tercih edilen</StateBadge> : null}
                      <span className="font-mono dark:text-zinc-300 text-zinc-700">
                        {money(satir.unit_cost_cents)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </GlassPanel>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-3.5 py-3 rounded-2xl dark:bg-white/[0.03] bg-black/[0.02] border dark:border-white/5 border-black/[0.05]">
      <p className="text-[11px] uppercase tracking-wider dark:text-zinc-500 text-zinc-500">{label}</p>
      <p className="text-sm font-mono dark:text-white text-zinc-900 mt-1">{value}</p>
    </div>
  );
}