// Faz 12 · Fiyatlandırma paneli.
//
// Kapsam: fiyat listeleri, 86'd, menü pencereleri, toplu fiyat güncelleme ve
// fiyat dondurma. Dinamik tarife (happy hour) ayrı bir blok içinde yaşar ve
// `feat_dynamic_pricing` kapalıyken **hiç render edilmez**.
//
// Kritik kural: donmuş fiyatlı ürün toplu güncellemede atlanır. Panel bunu
// "yapıldı" gibi göstermez, `skipped` listesini ayrı satır olarak gösterir.

import { useState } from 'react';
import { Lock, Percent, Snowflake, Tag, Sun, Sunset } from 'lucide-react';
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
import {
  money,
  priceSourceLabel,
  type BulkPriceResult,
  type PriceList,
  type PricingRule,
  type ServiceWindow,
} from './inventory360Types';
import {
  FeatureOffNotice,
  NoPermissionNotice,
  useAsyncCommand,
  usePanelContext,
} from './usePanelContext';
import type { EffectivePrice } from './inventory360Types';

export function PricingPanel() {
  const ctx = usePanelContext();
  const [error, setError] = useState<string | null>(null);
  const [priceListName, setPriceListName] = useState('');
  const [bulkPercent, setBulkPercent] = useState('10');
  const [bulkResult, setBulkResult] = useState<BulkPriceResult | null>(null);
  const [probeProductId, setProbeProductId] = useState('');
  const [probe, setProbe] = useState<EffectivePrice | null>(null);

  const listeler = useAsyncCommand<PriceList[]>('list_price_lists', { tenantId: ctx.tenantId }, ctx.tenantId !== '');
  const pencereler = useAsyncCommand<ServiceWindow[]>(
    'get_service_windows',
    { tenantId: ctx.tenantId },
    ctx.tenantId !== '',
  );
  const kurallar = useAsyncCommand<PricingRule[]>(
    'get_pricing_rules',
    { tenantId: ctx.tenantId },
    ctx.tenantId !== '' && ctx.isDynamicPricingEnabled,
  );

  if (!ctx.isManager) {
    return (
      <NoPermissionNotice need="Fiyat yönetimi işletme sahibinin yetkisindedir. Kasa ekranında fiyat çözümlemesini görebilirsin." />
    );
  }

  async function fiyatiCozumle() {
    setError(null);
    try {
      const sonuc = await invoke<EffectivePrice>('get_effective_price', {
        tenantId: ctx.tenantId,
        args: { product_id: probeProductId.trim() },
      });
      setProbe(sonuc);
    } catch (hata) {
      setProbe(null);
      setError(hata instanceof Error ? hata.message : String(hata));
    }
  }

  async function fiyatListesiOlustur() {
    setError(null);
    try {
      await invoke('create_price_list_command', {
        tenantId: ctx.tenantId,
        args: { name: priceListName.trim(), kind: 'PERAKENDE' },
      });
      setPriceListName('');
      listeler.reload();
      ctx.toast({ title: 'Fiyat listesi oluşturuldu', type: 'success' });
    } catch (hata) {
      setError(hata instanceof Error ? hata.message : String(hata));
    }
  }

  async function topluZam() {
    setError(null);
    try {
      const sonuc = await invoke<BulkPriceResult>('bulk_update_product_prices', {
        tenantId: ctx.tenantId,
        args: { percent: Number(bulkPercent), roundToTens: true },
      });
      setBulkResult(sonuc);
      ctx.toast({
        title: `${sonuc.changed.length} ürün güncellendi`,
        type: sonuc.skipped.length > 0 ? 'warning' : 'success',
      });
    } catch (hata) {
      setError(hata instanceof Error ? hata.message : String(hata));
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {error ? <ErrorStrip message={error} onDismiss={() => setError(null)} /> : null}
      {(listeler.error || pencereler.error) && (
        <ErrorStrip
          message={[listeler.error, pencereler.error].filter(Boolean).join(' · ')}
          onDismiss={() => {
            listeler.reload();
            pencereler.reload();
          }}
        />
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <GlassPanel>
          <PanelHeader
            title="Fiyat listeleri"
            hint="Toptan ve kampanya fiyatları ürün fiyatını eğer"
            icon={<Tag size={18} strokeWidth={1.6} />}
          />
          {listeler.loading ? (
            <LoadingRows />
          ) : !listeler.data || listeler.data.length === 0 ? (
            <EmptyState message="Henüz fiyat listesi yok. Bir liste oluşturup ürün fiyatlarını topluca gir." />
          ) : (
            <ul className="px-5 pb-4 space-y-2">
              {listeler.data.map((liste) => (
                <li
                  key={liste.id}
                  className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-2xl dark:bg-white/[0.03] bg-black/[0.02] border dark:border-white/5 border-black/[0.05]"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium dark:text-white text-zinc-900 truncate">{liste.name}</p>
                    <p className="text-[11px] dark:text-zinc-500 text-zinc-500">
                      {liste.kind} · {liste.items.length} ürün
                    </p>
                  </div>
                  <StateBadge tone={liste.is_active ? 'good' : 'neutral'}>
                    {liste.is_active ? 'Etkin' : 'Kapalı'}
                  </StateBadge>
                </li>
              ))}
            </ul>
          )}
          {ctx.isOwner && (
            <div className="px-5 pb-5 flex items-end gap-2.5">
              <div className="flex-1">
                <Field label="Yeni liste adı" value={priceListName} onChange={setPriceListName} placeholder="Toptan" />
              </div>
              <ActionButton tone="primary" onClick={fiyatListesiOlustur} disabled={!priceListName.trim()}>
                Oluştur
              </ActionButton>
            </div>
          )}
        </GlassPanel>

        <GlassPanel>
          <PanelHeader
            title="Toplu fiyat güncelleme"
            hint="Yüzde zam; on kuruşa yuvarlanır"
            icon={<Percent size={18} strokeWidth={1.6} />}
          />
          <div className="px-5 pb-4 space-y-3">
            <div className="flex items-end gap-2.5">
              <div className="flex-1">
                <Field
                  label="Yüzde değişim"
                  value={bulkPercent}
                  onChange={setBulkPercent}
                  type="number"
                  hint="Zam için pozitif, indirim için negatif. Negatif fiyat sonucu reddedilir."
                />
              </div>
              <ActionButton tone="primary" onClick={topluZam} disabled={ctx.isOwner === false}>
                Uygula
              </ActionButton>
            </div>

            {bulkResult && (
              <>
                <InfoStrip>
                  {bulkResult.changed.length} ürünün fiyatı güncellendi
                  {bulkResult.skipped.length > 0
                    ? `, ${bulkResult.skipped.length} ürün fiyat dondurması nedeniyle atlandı.`
                    : '.'}
                </InfoStrip>
                {bulkResult.skipped.length > 0 && (
                  <ul className="space-y-1.5">
                    {bulkResult.skipped.map((satir) => (
                      <li
                        key={satir.product_id}
                        className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-[#FF9F0A]/10 border border-[#FF9F0A]/20 text-[11px] text-[#FF9F0A]"
                      >
                        <span className="truncate">{satir.product_name}</span>
                        <span className="flex items-center gap-1 shrink-0">
                          <Snowflake size={11} />
                          {satir.skipped ?? 'dondurulmuş fiyat'}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        </GlassPanel>
      </div>

      <GlassPanel>
        <PanelHeader
          title="Menü pencereleri"
          hint="Öğle ve akşam menüsü saat aralığıyla açılır"
          icon={ctx.isDynamicPricingEnabled ? <Sunset size={18} strokeWidth={1.6} /> : <Sun size={18} strokeWidth={1.6} />}
        />
        {pencereler.loading ? (
          <LoadingRows />
        ) : !pencereler.data || pencereler.data.length === 0 ? (
          <EmptyState message="Menü penceresi tanımlanmamış. Ürünler tüm gün görünür." />
        ) : (
          <ul className="px-5 pb-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {pencereler.data.map((pencere) => (
              <li
                key={pencere.id}
                className="px-3.5 py-2.5 rounded-2xl dark:bg-white/[0.03] bg-black/[0.02] border dark:border-white/5 border-black/[0.05]"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium dark:text-white text-zinc-900">{pencere.name}</p>
                  <StateBadge tone={pencere.is_active ? 'good' : 'neutral'}>
                    {pencere.is_active ? 'Etkin' : 'Kapalı'}
                  </StateBadge>
                </div>
                <p className="text-[11px] dark:text-zinc-500 text-zinc-500 mt-0.5 font-mono">
                  {pencere.start_time} – {pencere.end_time} · {pencere.product_count} ürün
                </p>
              </li>
            ))}
          </ul>
        )}
      </GlassPanel>

      <GlassPanel>
        <PanelHeader
          title="Fiyat çözümleme"
          hint="Kasada hangi fiyatın uygulanacağını ürün kimliğiyle doğrula"
          icon={<Lock size={18} strokeWidth={1.6} />}
        />
        <div className="px-5 pb-5 space-y-3">
          <div className="flex items-end gap-2.5">
            <div className="flex-1">
              <Field
                label="Ürün kimliği"
                value={probeProductId}
                onChange={setProbeProductId}
                placeholder="prd_..."
                hint="Kasada görünen ürün kodunu yaz. Fiyat kaynağı ve indirim tutarı burada görünür."
              />
            </div>
            <ActionButton tone="primary" onClick={fiyatiCozumle} disabled={!probeProductId.trim()}>
              Çöz
            </ActionButton>
          </div>
          {probe && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="px-3.5 py-3 rounded-2xl dark:bg-white/[0.03] bg-black/[0.02] border dark:border-white/5 border-black/[0.05]">
                <p className="text-[11px] uppercase tracking-wider dark:text-zinc-500 text-zinc-500">Liste fiyatı</p>
                <p className="text-sm font-mono dark:text-white text-zinc-900 mt-1">
                  {money(probe.base_price_cents)}
                </p>
              </div>
              <div className="px-3.5 py-3 rounded-2xl dark:bg-white/[0.03] bg-black/[0.02] border dark:border-white/5 border-black/[0.05]">
                <p className="text-[11px] uppercase tracking-wider dark:text-zinc-500 text-zinc-500">Kasadaki fiyat</p>
                <p className="text-sm font-mono dark:text-white text-zinc-900 mt-1">
                  {money(probe.final_price_cents)}
                </p>
              </div>
              <div className="px-3.5 py-3 rounded-2xl dark:bg-white/[0.03] bg-black/[0.02] border dark:border-white/5 border-black/[0.05]">
                <p className="text-[11px] uppercase tracking-wider dark:text-zinc-500 text-zinc-500">İndirim</p>
                <p className="text-sm font-mono dark:text-white text-zinc-900 mt-1">
                  {money(probe.discount_cents)}
                </p>
              </div>
              <div className="px-3.5 py-3 rounded-2xl dark:bg-white/[0.03] bg-black/[0.02] border dark:border-white/5 border-black/[0.05]">
                <p className="text-[11px] uppercase tracking-wider dark:text-zinc-500 text-zinc-500">Kaynak</p>
                <p className="text-sm dark:text-white text-zinc-900 mt-1">
                  {priceSourceLabel(probe.source)}
                </p>
              </div>
            </div>
          )}
        </div>
      </GlassPanel>

      {ctx.isDynamicPricingEnabled ? (
        <GlassPanel>
          <PanelHeader
            title="Dinamik tarife kuralları"
            hint="Happy hour ve zamanlı indirim"
            icon={<Lock size={18} strokeWidth={1.6} />}
          />
          {kurallar.loading ? (
            <LoadingRows />
          ) : !kurallar.data || kurallar.data.length === 0 ? (
            <EmptyState message="Aktif dinamik kural yok. Ürün fiyatları olduğu gibi uygulanır." />
          ) : (
            <ul className="px-5 pb-5 space-y-2">
              {kurallar.data.map((kural) => (
                <li
                  key={kural.id}
                  className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-2xl dark:bg-white/[0.03] bg-black/[0.02] border dark:border-white/5 border-black/[0.05]"
                >
                  <div>
                    <p className="text-sm font-medium dark:text-white text-zinc-900">{kural.name}</p>
                    <p className="text-[11px] dark:text-zinc-500 text-zinc-500 font-mono">
                      {kural.start_time} – {kural.end_time} · %{kural.discount_percent} indirim
                    </p>
                  </div>
                  <StateBadge tone={kural.is_active ? 'info' : 'neutral'}>
                    {kural.is_active ? 'Etkin' : 'Kapalı'}
                  </StateBadge>
                </li>
              ))}
            </ul>
          )}
        </GlassPanel>
      ) : (
        <FeatureOffNotice
          featureName="Dinamik tarife"
          hint="Bu işletmede happy hour ve zamanlı indirim kapalı. Fiyat listesi, dondurma ve 86'd çalışmaya devam eder."
        />
      )}
    </div>
  );
}