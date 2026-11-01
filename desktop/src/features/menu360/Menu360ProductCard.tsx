// Menü Ürün Kartı
// Dokunsal mat donanım estetiği, kuruş formatlama ve anında durum göstergesi.

import React from 'react';
import type { ProductDto } from '../../types/menu360';
import { formatMoney } from '../../lib/formatMoney';

interface Menu360ProductCardProps {
  product: ProductDto;
  isSelected: boolean;
  onSelect: (productId: string) => void;
}

export const Menu360ProductCard: React.FC<Menu360ProductCardProps> = ({
  product,
  isSelected,
  onSelect,
}) => {
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
          <h3 className="text-sm font-semibold text-[var(--text-primary)] line-clamp-1 leading-snug">
            {product.name}
          </h3>
        </div>

        <div className="text-base font-bold text-[var(--text-primary)] mt-1.5 tabular-nums tracking-tight tabular-nums">
          {formatMoney(product.priceCents)}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5 pt-1.5 border-t border-[var(--border)]">
        {isOutOfStock ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold bg-[var(--accent-red-soft)] text-[var(--accent-red)] border border-[var(--accent-red-border)]">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-red)]" />
            Tükendi
          </span>
        ) : isInactive ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-[var(--bg-subtle)] text-[var(--text-muted)] border border-[var(--border)]">
            Satışta değil
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs text-[var(--accent-emerald)] font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-emerald)]" />
            Satışta
          </span>
        )}
      </div>
    </div>
  );
};
