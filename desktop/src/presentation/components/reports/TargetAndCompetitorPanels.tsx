/**
 * Faz 10 hedef ve rakip fiyat panelleri.
 *
 * Neden ayrı dosya: formlar kendi giriş durumunu tutar; tablo gövdesi
 * `analyticsTables` içindedir. Bu dosya yalnız "gir - doğrula - gönder" yolunu
 * ve hata mesajını yönetir.
 *
 * Yazma yetkisi: yalnız işletme sahibi (backend `require_reporting_write`).
 * Müdür okur, yazamaz; hata mesajı sunucudan gelir ve sessizce yutulmaz.
 */

import { forwardRef, useState } from 'react';
import { Save, Target, TrendingDown } from 'lucide-react';

import type { CompetitorPriceGap, MonthlyTargetStatus } from './analyticsTypes';
import { CompetitorGapTable, TargetTable, tableCellClass } from './analyticsTables';

export const panelClass =
  'rounded-2xl border border-black/[0.06] dark:border-white/10 bg-white/70 dark:bg-white/[0.04] p-4';
export const sectionTitleClass =
  'flex items-center gap-2 text-[17px] font-semibold tracking-tight text-zinc-900 dark:text-white';
export const labelClass = 'text-[13px] text-zinc-600 dark:text-zinc-400';

const inputClass =
  'rounded-xl border border-black/[0.08] dark:border-white/10 bg-white/80 dark:bg-white/[0.04] px-3 py-2 text-[13px] text-zinc-900 dark:text-zinc-100 outline-none focus:border-[#007AFF]/50';

const buttonClass =
  'flex items-center gap-1.5 rounded-xl bg-[#007AFF] px-3 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90 cursor-pointer';

/** `12.345,67` veya `12345,67` - kuruş. Geçersizse `null`. */
function parseLiraToCents(input: string): number | null {
  const normalized = input.trim().replace(/[₺\s]/g, '').replace(/\./g, '').replace(',', '.');
  if (normalized.length === 0) return null;
  const value = Number(normalized);
  if (Number.isNaN(value) || value < 0) return null;
  return Math.round(value * 100);
}

function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

interface Props {
  targets: MonthlyTargetStatus[];
  gaps: CompetitorPriceGap[];
  onSaveTarget: (month: string, category: string, targetCents: number) => Promise<void>;
  onSaveCompetitorPrice: (
    productId: string,
    competitorName: string,
    priceCents: number,
  ) => Promise<void>;
}

export const TargetAndCompetitorPanels = forwardRef<HTMLDivElement, Props>(
  function TargetAndCompetitorPanels(
    { targets, gaps, onSaveTarget, onSaveCompetitorPrice },
    ref,
  ) {
    const [month, setMonth] = useState(currentMonthKey);
    const [category, setCategory] = useState('ALL');
    const [targetLira, setTargetLira] = useState('');
    const [targetError, setTargetError] = useState<string | null>(null);
    const [savingTarget, setSavingTarget] = useState(false);

    const [productId, setProductId] = useState('');
    const [competitorName, setCompetitorName] = useState('');
    const [priceLira, setPriceLira] = useState('');
    const [priceError, setPriceError] = useState<string | null>(null);
    const [savingPrice, setSavingPrice] = useState(false);

    const handleSaveTarget = async () => {
      const cents = parseLiraToCents(targetLira);
      if (cents === null) {
        setTargetError('Hedef tutarı sayı olarak girin (örnek: 25000).');
        return;
      }
      setTargetError(null);
      setSavingTarget(true);
      try {
        await onSaveTarget(month, category, cents);
        setTargetLira('');
      } catch (err) {
        // Sunucu hatası yutulmaz: patron "kaydedildi" sanmamalı.
        setTargetError(String(err));
      } finally {
        setSavingTarget(false);
      }
    };

    const handleSavePrice = async () => {
      const cents = parseLiraToCents(priceLira);
      if (cents === null) {
        setPriceError('Rakip fiyatı sayı olarak girin.');
        return;
      }
      if (!productId.trim() || !competitorName.trim()) {
        setPriceError('Ürün ve rakip adı zorunludur.');
        return;
      }
      setPriceError(null);
      setSavingPrice(true);
      try {
        await onSaveCompetitorPrice(productId.trim(), competitorName.trim(), cents);
        setPriceLira('');
      } catch (err) {
        setPriceError(String(err));
      } finally {
        setSavingPrice(false);
      }
    };

    return (
      <div ref={ref} className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className={panelClass}>
          <h3 className={sectionTitleClass}>
            <Target size={16} className="text-[#007AFF]" />
            Aylık hedef
          </h3>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Ay</span>
              <input
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Kategori</span>
              <input
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="ALL"
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Hedef (TL)</span>
              <input
                type="text"
                inputMode="decimal"
                value={targetLira}
                onChange={(e) => setTargetLira(e.target.value)}
                className={inputClass}
              />
            </label>
          </div>
          <button
            type="button"
            onClick={handleSaveTarget}
            disabled={savingTarget}
            className={`${buttonClass} mt-3`}
          >
            <Save size={13} />
            <span>{savingTarget ? 'Kaydediliyor...' : 'Hedefi kaydet'}</span>
          </button>
          {targetError && (
            <p className="mt-2 text-[12px] text-[#FF3B30]">{targetError}</p>
          )}
          <TargetTable targets={targets} />
        </section>

        <section className={panelClass}>
          <h3 className={sectionTitleClass}>
            <TrendingDown size={16} className="text-[#007AFF]" />
            Rakip fiyat takibi
          </h3>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Ürün kimliği</span>
              <input
                type="text"
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Rakip</span>
              <input
                type="text"
                value={competitorName}
                onChange={(e) => setCompetitorName(e.target.value)}
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Rakip fiyat (TL)</span>
              <input
                type="text"
                inputMode="decimal"
                value={priceLira}
                onChange={(e) => setPriceLira(e.target.value)}
                className={inputClass}
              />
            </label>
          </div>
          <button
            type="button"
            onClick={handleSavePrice}
            disabled={savingPrice}
            className={`${buttonClass} mt-3`}
          >
            <Save size={13} />
            <span>{savingPrice ? 'Kaydediliyor...' : 'Fiyatı kaydet'}</span>
          </button>
          {priceError && <p className="mt-2 text-[12px] text-[#FF3B30]">{priceError}</p>}
          <CompetitorGapTable gaps={gaps} />
        </section>
      </div>
    );
  },
);

export { parseLiraToCents, currentMonthKey, tableCellClass };