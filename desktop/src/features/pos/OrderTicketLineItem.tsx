import React from 'react';
import { Plus, Minus } from 'lucide-react';
import type { OrderItem } from '../../types/pos';
import { formatMoney } from '../../lib/formatMoney';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';

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

/** Gönderilmemiş satır kırmızı, mutfağa giden satır mavi kalemle yazılmış gibi durur. */
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
    <div>
      <button
        type="button"
        onClick={onSelect}
        aria-expanded={isSelected}
        className={`hand w-full min-h-12 grid grid-cols-[28px_minmax(0,1fr)_auto] gap-1.5 items-end pb-1 text-left text-2xl leading-tight cursor-pointer ${
          item.isSentToKitchen ? '' : '!text-[var(--serial)]'
        }`}
      >
        <span className="tabular-nums">{item.quantity}</span>
        <span className="truncate">{item.name}</span>
        <span className="tabular-nums">{formatMoney(item.totalCents).replace(' ₺', '')}</span>
      </button>
      {item.cookingDegree || item.notes ? (
        <p className="pl-[34px] text-sm text-[var(--text-secondary)]">
          {[item.cookingDegree, item.notes].filter(Boolean).join(' · ')}
        </p>
      ) : null}

      {isSelected ? (
        <div className="my-2 p-3 rounded-md bg-[var(--bg-subtle)] space-y-2">
          <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Servis sırası">
            {([1, 2, 3] as const).map((course) => (
              <Button
                key={course}
                variant={item.course === course ? 'primary' : 'secondary'}
                size="sm"
                aria-pressed={item.course === course}
                onClick={() => onSetCourse(course)}
              >
                {course}. Servis
              </Button>
            ))}
          </div>

          {onSetNote ? (
            <Input
              type="text"
              aria-label="Mutfak notu"
              defaultValue={item.notes || ''}
              placeholder="Mutfak notu"
              className="!min-h-12"
              onBlur={(e) => onSetNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSetNote((e.target as HTMLInputElement).value);
              }}
            />
          ) : null}

          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <Button variant="secondary" size="sm" onClick={() => onUpdateQty(-1)} className="!w-12 !p-0" aria-label="Bir azalt">
                <Minus className="w-4 h-4" />
              </Button>
              <span className="w-8 text-center font-bold tabular-nums">{item.quantity}</span>
              <Button variant="secondary" size="sm" onClick={() => onUpdateQty(1)} className="!w-12 !p-0" aria-label="Bir artır">
                <Plus className="w-4 h-4" />
              </Button>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" className="!px-2" onClick={onOpenTransfer}>Taşı</Button>
              <Button variant="ghost" size="sm" className="!px-2" onClick={onOpenComp}>İkram</Button>
              <Button variant="ghost" size="sm" className="!px-2 !text-[var(--accent-red)]" onClick={onOpenVoid}>İptal</Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
