import React from 'react';
import { Plus, Minus, ArrowRight, Gift, Trash2 } from 'lucide-react';
import type { OrderItem } from '../../types/pos';
import { formatMoney } from '../../lib/formatMoney';
import { Button } from '../../ui/Button';
import { Badge } from '../../ui/Badge';

export interface OrderTicketLineItemProps {
  item: OrderItem;
  isSelected: boolean;
  onSelect: () => void;
  onUpdateQty: (delta: number) => void;
  onSetCourse: (course: 1 | 2 | 3) => void;
  onSetNote?: (notes: string) => void;
  onOpenTransfer: () => void;
  onOpenComp: () => void;
  onOpenVoid: () => void;
}

export const OrderTicketLineItem: React.FC<OrderTicketLineItemProps> = ({
  item,
  isSelected,
  onSelect,
  onUpdateQty,
  onSetCourse,
  onSetNote,
  onOpenTransfer,
  onOpenComp,
  onOpenVoid,
}) => {
  return (
    <div
      onClick={onSelect}
      className={`rounded-xl border p-3 transition-colors cursor-pointer ${
        isSelected
          ? 'bg-[var(--bg-card)] border-[var(--accent-amber-border)] shadow-sm'
          : 'bg-[var(--bg-card)] border-[var(--border)] hover:bg-[var(--bg-hover)]'
      }`}
    >
      {/* Kalem Üstü: Adet, İsim ve Fiyat */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-md bg-[var(--bg-subtle)] border border-[var(--border)] flex items-center justify-center font-bold text-xs text-[var(--accent-amber)] tabular-nums">
            {item.quantity}
          </span>
          <div>
            <span className="hand text-base leading-4 block">
              {item.name}
            </span>
            {item.cookingDegree ? (
              <span className="text-[11px] text-[var(--accent-amber)] block">
                {item.cookingDegree}
              </span>
            ) : null}
            {item.notes ? (
              <span className="text-[11px] text-[var(--text-secondary)] italic block">
                Not: {item.notes}
              </span>
            ) : null}
          </div>
        </div>

        <div className="text-right">
          <span className="hand text-base leading-4 tabular-nums block">
            {formatMoney(item.totalCents)}
          </span>
          <Badge variant={item.course === 1 ? 'emerald' : item.course === 2 ? 'amber' : 'blue'}>
            {item.course}. Servis
          </Badge>
        </div>
      </div>

      {/* Tıklanınca Açılan Satır Altı Kontrolleri */}
      {isSelected ? (
        <div
          className="mt-3 pt-2.5 border-t border-[var(--border)] space-y-2.5"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Kurs Seçici */}
          <div className="flex items-center justify-between text-xs">
            <span className="text-[var(--text-secondary)] font-medium">Servis Sırası:</span>
            <div className="flex gap-1">
              {[1, 2, 3].map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => onSetCourse(c as 1 | 2 | 3)}
                  className={`px-2 py-1 rounded text-[11px] font-semibold border cursor-pointer ${
                    item.course === c
                      ? 'bg-[var(--accent-amber)] text-[var(--ink)] border-transparent'
                      : 'bg-[var(--bg-subtle)] text-[var(--text-secondary)] border-[var(--border)]'
                  }`}
                >
                  {c}. Kurs
                </button>
              ))}
            </div>
          </div>

          {/* Not Düzenleme */}
          {onSetNote ? (
            <div className="flex items-center gap-1.5 pt-1">
              <input
                type="text"
                defaultValue={item.notes || ''}
                placeholder="Özel istek / pişme / mutfak notu..."
                onBlur={(e) => onSetNote(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    onSetNote((e.target as HTMLInputElement).value);
                  }
                }}
                className="w-full min-h-12 px-2.5 rounded-lg bg-[var(--bg-subtle)] text-[var(--text-primary)] border border-[var(--border)] text-xs outline-none focus:border-[var(--accent-amber)]"
              />
            </div>
          ) : null}

          {/* Miktar Artır/Azalt ve Satır İşlemleri */}
          <div className="flex items-center justify-between gap-2 pt-1">
            <div className="flex items-center gap-1">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onUpdateQty(-1)}
                className="!min-h-12 !w-12 !p-0"
                title="1 Azalt"
              >
                <Minus className="w-3.5 h-3.5" />
              </Button>
              <span className="w-8 text-center text-xs font-bold tabular-nums">
                {item.quantity}
              </span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onUpdateQty(1)}
                className="!min-h-12 !w-12 !p-0"
                title="1 Artır"
              >
                <Plus className="w-3.5 h-3.5" />
              </Button>
            </div>

            <div className="flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                onClick={onOpenTransfer}
                className="!min-h-12 !px-2 text-[11px]"
                title="Masaya Taşı"
              >
                <ArrowRight className="w-3 h-3 text-[var(--accent-blue)] mr-1" />
                <span>Taşı</span>
              </Button>

              <Button
                variant="ghost"
                size="sm"
                onClick={onOpenComp}
                className="!min-h-12 !px-2 text-[11px]"
                title="Müdür İkramı"
              >
                <Gift className="w-3 h-3 text-[var(--accent-emerald)] mr-1" />
                <span>İkram</span>
              </Button>

              <Button
                variant="ghost"
                size="sm"
                onClick={onOpenVoid}
                className="!min-h-12 !px-2 text-[11px] text-[var(--accent-red)]"
                title="İptal Et"
              >
                <Trash2 className="w-3 h-3 mr-1" />
                <span>İptal</span>
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
