import React from 'react';
import { activateOnKey } from '../../lib/activateOnKey';
import type { OrderItem } from '../../types/pos';
import { formatMoney } from '../../lib/formatMoney';
import { unitShareCents } from '../../lib/orderMath';

export interface PaymentItemSplitTabProps {
  items: OrderItem[];
  selectedQuantities: Record<string, number>;
  onToggleItem: (itemId: string, maxQty: number) => void;
  onSelectAll: () => void;
}

export const PaymentItemSplitTab: React.FC<PaymentItemSplitTabProps> = ({
  items,
  selectedQuantities,
  onToggleItem,
  onSelectAll,
}) => {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="text-[var(--text-secondary)] font-medium">
          Ödenecek kalemlere dokunun (her dokunuş +1 adet seçer)
        </span>
        <button
          type="button"
          onClick={onSelectAll}
          className="min-h-12 px-2 font-semibold text-[var(--text-secondary)] hover:underline cursor-pointer"
        >
          Tümünü Seç
        </button>
      </div>

      <div className="space-y-1.5 max-h-[180px] overflow-y-auto pr-1">
        {items.map((item) => {
          const selected = selectedQuantities[item.id] || 0;
          return (
            <div
              key={item.id}
              role="button"
              tabIndex={0}
              onClick={() => onToggleItem(item.id, item.quantity)}
              onKeyDown={activateOnKey(() => onToggleItem(item.id, item.quantity))}
              className={`min-h-12 p-2.5 rounded-lg border flex items-center justify-between cursor-pointer transition-colors ${
                selected > 0
                  ? 'bg-[var(--bg-hover)] border-[var(--border-strong)] text-[var(--text-primary)]'
                  : 'bg-[var(--bg-subtle)] border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
              }`}
            >
              <div className="flex items-center gap-2">
                <div
                  className={`w-5 h-5 rounded flex items-center justify-center text-xs font-bold ${
                    selected > 0
                      ? 'bg-[var(--brand)] text-white'
                      : 'border border-[var(--border)]'
                  }`}
                >
                  {selected > 0 ? selected : ''}
                </div>
                <span className="text-xs font-bold">{item.name}</span>
                <span className="text-xs text-[var(--text-muted)]">
                  (Mevcut: {item.quantity})
                </span>
              </div>
              <span className="text-xs font-bold tabular-nums">
                {formatMoney(unitShareCents(item, selected || item.quantity))}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
