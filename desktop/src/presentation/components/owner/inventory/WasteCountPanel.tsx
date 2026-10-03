// Faz 12 · Fire ve kör sayım paneli.
//
// İki ayrı işlem, tek panel:
//   * Fire → tek ürün, miktar + gerekçe; FIFO partilerden düşer.
//   * Kör sayım → aç/kapat; beklenen miktar satırda tutulmaz, kapanışta hesaplanır.
//
// Fark maliyeti bilinmiyorsa `—` yazılır. Fark `0` yazılırsa patron "sayım
// tutmuş" sanır; oysa maliyet bilgisi eksik (AGENTS.md §3.4).

import { useState } from 'react';
import { ClipboardList, Trash2 } from 'lucide-react';
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
  WASTE_REASONS,
  money,
  quantity,
  shortDate,
  wasteReasonLabel,
  type StockCount,
  type WasteRecord,
} from './inventory360Types';
import { NoPermissionNotice, useAsyncCommand, usePanelContext } from './usePanelContext';

export function WasteCountPanel() {
  const ctx = usePanelContext();
  const [error, setError] = useState<string | null>(null);
  const [fireUrun, setFireUrun] = useState('');
  const [fireMiktar, setFireMiktar] = useState('');
  const [fireGerekce, setFireGerekce] = useState('BOZULMA');
  const [sayimUrun, setSayimUrun] = useState('');
  const [sayimMiktar, setSayimMiktar] = useState('');
  const [acikSayim, setAcikSayim] = useState<StockCount | null>(null);
  const [kapananSayim, setKapananSayim] = useState<StockCount | null>(null);

  const fireKayitlari = useAsyncCommand<WasteRecord[]>(
    'list_waste_records_command',
    { tenantId: ctx.tenantId },
    ctx.tenantId !== '',
  );
  const sayimlar = useAsyncCommand<StockCount[]>(
    'list_stock_counts_command',
    { tenantId: ctx.tenantId },
    ctx.tenantId !== '',
  );

  if (!ctx.isManager) {
    return (
      <NoPermissionNotice need="Fire kaydı ve kör sayım işletme sahibinin yetkisindedir. Müdür sonuçları görebilir." />
    );
  }

  async function fireKaydet() {
    setError(null);
    try {
      await invoke('record_waste_command', {
        tenantId: ctx.tenantId,
        args: {
          product_id: fireUrun.trim(),
          quantity: Number(fireMiktar),
          reason: fireGerekce,
        },
      });
      setFireUrun('');
      setFireMiktar('');
      fireKayitlari.reload();
      ctx.toast({ title: 'Fire kaydı açıldı', type: 'success' });
    } catch (hata) {
      setError(hata instanceof Error ? hata.message : String(hata));
    }
  }

  async function sayimAc() {
    setError(null);
    try {
      const sayim = await invoke<StockCount>('open_stock_count_command', {
        tenantId: ctx.tenantId,
        args: {},
      });
      setAcikSayim(sayim);
      setKapananSayim(null);
      sayimlar.reload();
      ctx.toast({ title: 'Sayım açıldı', type: 'success' });
    } catch (hata) {
      setError(hata instanceof Error ? hata.message : String(hata));
    }
  }

  async function sayimSatiriEkle() {
    if (!acikSayim) return;
    setError(null);
    try {
      await invoke('record_count_line_command', {
        tenantId: ctx.tenantId,
        args: {
          stock_count_id: acikSayim.id,
          product_id: sayimUrun.trim(),
          counted_quantity: Number(sayimMiktar),
        },
      });
      setSayimUrun('');
      setSayimMiktar('');
      const tazelenmis = await invoke<StockCount>('get_stock_count_command', {
        tenantId: ctx.tenantId,
        stockCountId: acikSayim.id,
      });
      setAcikSayim(tazelenmis);
    } catch (hata) {
      setError(hata instanceof Error ? hata.message : String(hata));
    }
  }

  async function sayimKapat() {
    if (!acikSayim) return;
    setError(null);
    try {
      const sonuc = await invoke<StockCount>('close_stock_count_command', {
        tenantId: ctx.tenantId,
        args: { stock_count_id: acikSayim.id, apply_adjustment: true },
      });
      setKapananSayim(sonuc);
      setAcikSayim(null);
      sayimlar.reload();
      ctx.toast({ title: 'Sayım kapatıldı ve düzeltme uygulandı', type: 'success' });
    } catch (hata) {
      setError(hata instanceof Error ? hata.message : String(hata));
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {error ? <ErrorStrip message={error} onDismiss={() => setError(null)} /> : null}
      {(fireKayitlari.error || sayimlar.error) && (
        <ErrorStrip
          message={[fireKayitlari.error, sayimlar.error].filter(Boolean).join(' · ')}
          onDismiss={() => {
            fireKayitlari.reload();
            sayimlar.reload();
          }}
        />
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <GlassPanel>
          <PanelHeader
            title="Fire kaydı"
            hint="FIFO partilerden düşer, maliyeti rapora yazar"
            icon={<Trash2 size={18} strokeWidth={1.6} />}
          />
          <div className="px-5 pb-4 space-y-3">
            <Field label="Ürün kimliği" value={fireUrun} onChange={setFireUrun} placeholder="prd_..." />
            <div className="grid grid-cols-2 gap-2.5">
              <Field label="Miktar" value={fireMiktar} onChange={setFireMiktar} type="number" hint="Birim" />
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider dark:text-zinc-400 text-zinc-500">
                  Gerekçe
                </span>
                <select
                  value={fireGerekce}
                  onChange={(event) => setFireGerekce(event.target.value)}
                  className="px-3 py-2 rounded-2xl dark:bg-white/[0.06] bg-white/80 dark:text-white text-zinc-900 text-sm border dark:border-white/10 border-black/[0.08] focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40"
                >
                  {WASTE_REASONS.map((gerekce) => (
                    <option key={gerekce.id} value={gerekce.id}>
                      {gerekce.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <ActionButton
              tone="primary"
              onClick={fireKaydet}
              disabled={!fireUrun.trim() || !(Number(fireMiktar) > 0)}
            >
              Fireyi kaydet
            </ActionButton>
            {fireKayitlari.loading ? (
              <LoadingRows rows={2} />
            ) : !fireKayitlari.data || fireKayitlari.data.length === 0 ? (
              <EmptyState message="Bu işletmede fire kaydı yok." />
            ) : (
              <ul className="space-y-1.5">
                {fireKayitlari.data.slice(0, 6).map((kayit) => (
                  <li
                    key={kayit.id}
                    className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-2xl dark:bg-white/[0.03] bg-black/[0.02] border dark:border-white/5 border-black/[0.05] text-xs"
                  >
                    <div className="min-w-0">
                      <p className="dark:text-white text-zinc-900 truncate">{kayit.product_name}</p>
                      <p className="dark:text-zinc-500 text-zinc-500 truncate">
                        {wasteReasonLabel(kayit.reason)} · {quantity(kayit.quantity)} ·{' '}
                        {shortDate(kayit.occurred_at)}
                      </p>
                    </div>
                    <span className="font-mono text-rose-400 shrink-0">
                      {money(kayit.total_cost_cents)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </GlassPanel>

        <GlassPanel>
          <PanelHeader
            title="Kör sayım"
            hint="Beklenen miktar kapanışta hesaplanır, satırda tutulmaz"
            icon={<ClipboardList size={18} strokeWidth={1.6} />}
          />
          <div className="px-5 pb-4 space-y-3">
            {!acikSayim ? (
              <ActionButton tone="primary" onClick={sayimAc}>
                Sayım aç
              </ActionButton>
            ) : (
              <>
                <InfoStrip>
                  Sayım {acikSayim.id} açık. Miktarı yaz, kapanışta beklenen değerle fark hesaplanır.
                </InfoStrip>
                <div className="grid grid-cols-[2fr_1fr_auto] gap-2.5 items-end">
                  <Field label="Ürün kimliği" value={sayimUrun} onChange={setSayimUrun} placeholder="prd_..." />
                  <Field label="Sayılan" value={sayimMiktar} onChange={setSayimMiktar} type="number" hint="Birim" />
                  <ActionButton onClick={sayimSatiriEkle} disabled={!sayimUrun.trim()}>
                    Ekle
                  </ActionButton>
                </div>
                <ul className="space-y-1.5">
                  {(acikSayim.lines ?? []).map((satir) => (
                    <li
                      key={satir.product_id}
                      className="flex items-center justify-between gap-3 px-3.5 py-2 rounded-xl dark:bg-white/[0.03] bg-black/[0.02] border dark:border-white/5 border-black/[0.05] text-xs"
                    >
                      <span className="dark:text-white text-zinc-900 truncate">{satir.product_name}</span>
                      <span className="font-mono dark:text-zinc-300 text-zinc-700 shrink-0">
                        {quantity(satir.counted_quantity)}
                      </span>
                    </li>
                  ))}
                </ul>
                <ActionButton tone="primary" onClick={sayimKapat} disabled={(acikSayim.lines ?? []).length === 0}>
                  Sayımı kapat ve düzelt
                </ActionButton>
              </>
            )}

            {kapananSayim && (
              <>
                <InfoStrip>Sayım kapatıldı. Fark dökümü:</InfoStrip>
                <ul className="space-y-1.5">
                  {(kapananSayim.lines ?? []).map((satir) => (
                    <li
                      key={satir.product_id}
                      className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-2xl dark:bg-white/[0.03] bg-black/[0.02] border dark:border-white/5 border-black/[0.05] text-xs"
                    >
                      <span className="dark:text-white text-zinc-900 truncate">{satir.product_name}</span>
                      <span className="flex items-center gap-2 shrink-0">
                        <StateBadge tone={varianceTone(satir.variance_quantity)}>
                          fark {quantity(satir.variance_quantity)}
                        </StateBadge>
                        <span className="font-mono dark:text-zinc-300 text-zinc-700">
                          {money(satir.variance_cost_cents)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
                {kapananSayim.lines?.some((satir) => satir.variance_cost_cents === null) && (
                  <InfoStrip>
                    Fark maliyeti bilinmeyen satırlar var: o satırlarda fark miktarı yazdı ama maliyeti{' '}
                    <strong>bilinmiyor</strong>, sıfır yazılmadı.
                  </InfoStrip>
                )}
              </>
            )}

            {sayimlar.loading ? (
              <LoadingRows rows={2} />
            ) : sayimlar.data && sayimlar.data.length > 0 ? (
              <ul className="space-y-1.5">
                {sayimlar.data.slice(0, 4).map((sayim) => (
                  <li
                    key={sayim.id}
                    className="flex items-center justify-between gap-3 px-3.5 py-2 rounded-xl dark:bg-white/[0.03] bg-black/[0.02] border dark:border-white/5 border-black/[0.05] text-[11px]"
                  >
                    <span className="dark:text-zinc-400 text-zinc-500 font-mono truncate">{sayim.id}</span>
                    <span className="flex items-center gap-2 shrink-0">
                      <span className="dark:text-zinc-500 text-zinc-500">{shortDate(sayim.started_at)}</span>
                      <StateBadge tone={sayim.status === 'ACIK' ? 'info' : sayim.status === 'UYGULANDI' ? 'good' : 'neutral'}>
                        {sayim.status === 'ACIK' ? 'Açık' : sayim.status === 'UYGULANDI' ? 'Uygulandı' : 'Kapalı'}
                      </StateBadge>
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </GlassPanel>
      </div>
    </div>
  );
}

function varianceTone(variance: number | null): 'good' | 'bad' | 'neutral' {
  if (variance === null) return 'neutral';
  if (variance > 0) return 'good';
  if (variance < 0) return 'bad';
  return 'neutral';
}