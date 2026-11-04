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
    <div
      onClick={() => onSelect(product.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(product.id);
        }
      }}
      className={`tactile-btn p-3.5 rounded-lg text-left cursor-pointer transition-all min-h-[104px] flex flex-col justify-between ${
        isSelected
          ? 'bg-[var(--bg-hover)] border-[var(--accent-blue)] shadow-[inset_0_0_0_1px_var(--accent-blue)]'
          : 'bg-[var(--bg-panel)] border-[var(--border)] hover:bg-[var(--bg-hover)]'
      } ${isOutOfStock || isInactive ? 'opacity-75' : ''}`}
    >
      <div>
        <div className="flex items-start justify-between gap-2">
          <input
            type="checkbox"
            aria-label={`${product.name} seç`}
            className="w-5 h-5 shrink-0"
            checked={isChecked}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => onCheck(event.target.checked)}
          />
          <h3 className="text-sm font-semibold text-[var(--text-primary)] line-clamp-1 leading-snug">
            {product.name}
          </h3>
        </div>

        <div className="text-base font-bold text-[var(--text-primary)] mt-1.5 tabular-nums tracking-tight tabular-nums">
          {formatMoney(product.priceCents)}
        </div>
        <div className="text-xs text-[var(--text-secondary)] mt-1 tabular-nums">
          KDV %{(product.taxRateBp ?? 1000) / 100}{station ?? product.defaultStation ? ` · ${station ?? product.defaultStation}` : ''}
        </div>
        {cost != null ? (
          <div className="text-xs text-[var(--text-secondary)] tabular-nums">
            Maliyet {formatMoney(cost)}{margin != null ? ` · Kâr %${margin}` : ''}
          </div>
        ) : null}
        {onMove ? (
          <div className="flex gap-2 mt-2">
            <button type="button" className="tactile-btn min-h-12 flex-1 rounded font-bold" onClick={(event) => { event.stopPropagation(); onMove(-1); }}>Öne</button>
            <button type="button" className="tactile-btn min-h-12 flex-1 rounded font-bold" onClick={(event) => { event.stopPropagation(); onMove(1); }}>Sona</button>
          </div>
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5 pt-1.5 border-t border-[var(--border)]">
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
      </div>
    </div>
  );
};
