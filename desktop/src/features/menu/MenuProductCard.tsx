// Menü Ürün Kartı
// Dokunsal mat donanım estetiği, kuruş formatlama ve anında durum göstergesi.
// Açık ve koyu tema tam uyumlu, CSS tema değişkenleriyle desteklenir.

import React from 'react';
import type { ProductDto } from '../../types/menu';
import { formatMoney } from '../../lib/formatMoney';
import { useProductCost } from './useProductCost';

interface MenuProductCardProps {
  product: ProductDto;
  isSelected: boolean;
  onSelect: (productId: string) => void;
  station: string | null;
  isChecked: boolean;
  onCheck: (isOn: boolean) => void;
  onMove?: (step: number) => void;
}

export const MenuProductCard: React.FC<MenuProductCardProps> = ({
  product,
  isSelected,
  onSelect,
  station,
  isChecked,
  onCheck,
  onMove,
}) => {
  const cost = useProductCost(product.id);
  const margin = cost != null && product.priceCents > 0 ? Math.round(((product.priceCents - cost) * 100) / product.priceCents) : null;
  const isOutOfStock = product.is86;
  const isInactive = !product.isActive;

  return (
    <article className={`min-w-0 h-full rounded-lg border bg-[var(--bg-panel)] ${isSelected ? 'border-[var(--accent-blue)]' : 'border-[var(--border)]'}`}>
      <div className="flex items-start">
        <button type="button" onClick={() => onSelect(product.id)} aria-label={`${product.name} işlemleri`}
          className="flex-1 min-w-0 p-3 text-left rounded-lg hover:bg-[var(--bg-hover)] cursor-pointer">
          <span className="block truncate text-sm font-bold">{product.name}</span>
          <span className="block text-base font-bold mt-1 tabular-nums">{formatMoney(product.priceCents)}</span>
          <span className="block text-xs text-[var(--text-secondary)] mt-1 tabular-nums">
            KDV %{(product.taxRateBp ?? 1000) / 100}{station ?? product.defaultStation ? ` · ${station ?? product.defaultStation}` : ''}
          </span>
          {cost != null ? (
            <span className="block text-xs text-[var(--text-secondary)] tabular-nums">
              Maliyet {formatMoney(cost)}{margin != null ? ` · Kâr %${margin}` : ''}
            </span>
          ) : null}
          <span className="mt-2 flex flex-wrap items-center gap-1.5 pt-1.5 border-t border-[var(--border)]">
            {/* İki durum birlikte olabilir: satış dışı bir ürün ayrıca tükenmiş işaretli kalabilir. */}
            {isOutOfStock ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold bg-[var(--accent-red-soft)] text-[var(--accent-red)] border border-[var(--accent-red-border)]">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-red)]" />
                Tükendi
              </span>
            ) : null}
            {isInactive ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-[var(--bg-subtle)] text-[var(--text-muted)] border border-[var(--border)]">
                Satış Dışı
              </span>
            ) : null}
            {isOutOfStock || isInactive ? null : (
              <span className="inline-flex items-center gap-1 text-xs text-[var(--accent-emerald)] font-semibold">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-emerald)]" />
                Satışta
              </span>
            )}
          </span>
        </button>
        <label className="w-12 h-12 shrink-0 flex items-center justify-center cursor-pointer">
          <input type="checkbox" aria-label={`${product.name} seç`} checked={isChecked}
            onChange={(event) => onCheck(event.target.checked)} />
        </label>
      </div>
      {onMove ? (
        <div className="flex gap-2 px-3 pb-3">
          <button type="button" className="tactile-btn min-h-12 flex-1 rounded font-bold" onClick={() => onMove(-1)}>Öne</button>
          <button type="button" className="tactile-btn min-h-12 flex-1 rounded font-bold" onClick={() => onMove(1)}>Sona</button>
        </div>
      ) : null}
    </article>
  );
};
