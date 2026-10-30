import React, { useEffect, useState } from 'react';
import { ShoppingBag, CreditCard, ArrowRight, Merge, Users, Clock } from 'lucide-react';
import type { FloorTable } from '../../types/floor';
import { formatMoney } from '../../lib/formatMoney';
import { minutesElapsed } from '../../lib/date';
import { Drawer } from '../../ui/Drawer';
import { Button } from '../../ui/Button';
import { Badge } from '../../ui/Badge';
import { invokeIPC } from '../../services/tauriClient';
import { sessionArgs } from '../../stores/cariStore';
import { mapServerItem, type CartItemWire } from '../../lib/orderMath';
import type { OrderItem } from '../../types/pos';

export interface TableSlideOverProps {
  isOpen: boolean;
  table: FloorTable | null;
  allTables: FloorTable[];
  onClose: () => void;
  onGoToPos: (table: FloorTable) => void;
  onPayTable: (table: FloorTable) => void;
  onMoveTable: (sourceId: string, targetId: string) => void;
  onMergeTable: (sourceId: string, targetId: string) => void;
  onCloseReservation: (reservationId: string, action: 'ARRIVED' | 'CANCELLED') => Promise<void>;
}

export const TableSlideOver: React.FC<TableSlideOverProps> = ({
  isOpen,
  table,
  allTables,
  onClose,
  onGoToPos,
  onPayTable,
  onMoveTable,
  onMergeTable,
  onCloseReservation,
}) => {
  const [moveTargetId, setMoveTargetId] = useState<string>('');
  const [mergeTargetId, setMergeTargetId] = useState<string>('');
  const [showMoveBox, setShowMoveBox] = useState(false);
  const [showMergeBox, setShowMergeBox] = useState(false);

  if (!table) return null;

  const isOccupied = table.status === 'OCCUPIED';
  const elapsed = isOccupied ? minutesElapsed(table.openedAt) : 0;
  const emptyTables = allTables.filter((t) => t.id !== table.id && t.status === 'EMPTY');
  const occupiedTables = allTables.filter((t) => t.id !== table.id && t.status === 'OCCUPIED');

  const handleConfirmMove = () => {
    if (!moveTargetId) return;
    onMoveTable(table.id, moveTargetId);
    setShowMoveBox(false);
  };

  const handleConfirmMerge = () => {
    if (!mergeTargetId) return;
    onMergeTable(table.id, mergeTargetId);
    setShowMergeBox(false);
  };

  const [tableItems, setTableItems] = useState<OrderItem[]>([]);
  useEffect(() => {
    if (!isOpen || !isOccupied) {
      setTableItems([]);
      return;
    }
    const { tenantId } = sessionArgs();
    void invokeIPC<CartItemWire[]>('get_order_items', { tableId: table.id, tenantId })
      .then((wire) => setTableItems(wire.map(mapServerItem).filter((item): item is OrderItem => item !== null)))
      .catch(() => setTableItems([]));
  }, [isOpen, isOccupied, table.id]);

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title={table.tableNumber}
      subtitle={`${table.zoneName} · ${table.capacity} Kişilik Kapasite`}
      footer={
        <div className="space-y-2">
          <div className="flex items-center justify-between pb-2 border-b border-[var(--border)]">
            <span className="text-xs text-[var(--text-secondary)]">Toplam Tutar</span>
            <span className="text-xl font-bold text-[var(--accent-amber)] tabular-nums">
              {formatMoney(table.totalCents)}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="secondary"
              size="lg"
              onClick={() => onGoToPos(table)}
              className="w-full text-xs"
            >
              <ShoppingBag className="w-4 h-4" />
              <span>Siparişe Git</span>
            </Button>

            <Button
              variant="success"
              size="lg"
              onClick={() => onPayTable(table)}
              className="w-full text-xs"
              disabled={table.totalCents <= 0}
            >
              <CreditCard className="w-4 h-4" />
              <span>Hesap Al</span>
            </Button>
          </div>
        </div>
      }
    >
      {/* Durum Özeti */}
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-3.5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-[var(--text-secondary)]">Masa Durumu:</span>
            {isOccupied ? (
              <Badge variant="amber">Dolu</Badge>
            ) : table.status === 'RESERVED' ? (
              <Badge variant="blue">Rezerve</Badge>
            ) : (
              <Badge variant="emerald">Boş</Badge>
            )}
          </div>

          {isOccupied ? (
            <span className="text-xs text-[var(--text-muted)] flex items-center gap-1 tabular-nums">
              <Clock className="w-3.5 h-3.5 text-[var(--accent-amber)]" />
              <span>{elapsed} dakikadır açık</span>
            </span>
          ) : null}
        </div>

        {isOccupied ? (
          <div className="grid grid-cols-2 gap-2 pt-1 border-t border-[var(--border)] text-xs text-[var(--text-secondary)]">
            <div className="flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-[var(--text-muted)]" />
              <span>{table.occupiedSeats || 2} Kişi Oturuyor</span>
            </div>
            <div>
              <span className="text-[var(--text-muted)]">Garson: </span>
              <span className="font-semibold text-[var(--text-primary)]">
                {table.waiterName || 'Mehmet K.'}
              </span>
            </div>
          </div>
        ) : null}
      </div>

      {/* Sipariş Kalemleri Önizleme */}
      <div className="space-y-2">
        <span className="text-xs font-bold text-[var(--text-secondary)] block">
          Açık Adisyon Kalemleri
        </span>

        {isOccupied && tableItems.length > 0 ? (
          <div className="bg-[var(--bg-subtle)] border border-[var(--border)] rounded-xl p-3 divide-y divide-[var(--border)] text-xs max-h-60 overflow-y-auto">
            {tableItems.map((item) => (
              <div key={item.id} className="py-2 first:pt-0 last:pb-0 flex justify-between items-center">
                <div>
                  <span className="font-bold text-[var(--text-primary)]">
                    {item.quantity}x {item.name}
                  </span>
                  {item.cookingDegree || item.notes || (item.selectedModifiers && item.selectedModifiers.length > 0) ? (
                    <span className="block text-[11px] text-[var(--text-muted)] mt-0.5">
                      {[
                        item.cookingDegree,
                        item.selectedModifiers?.map((m) => m.name).join(', '),
                        item.notes ? `Not: ${item.notes}` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  ) : null}
                </div>
                <span className="font-bold tabular-nums text-[var(--text-primary)]">
                  {formatMoney(item.totalCents)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-4 text-center rounded-xl border border-[var(--border)] bg-[var(--bg-subtle)] text-xs text-[var(--text-muted)]">
            Masada açık sipariş bulunmuyor
          </div>
        )}
      </div>

      {table.status === 'RESERVED' && table.reservationId ? (
        <div className="space-y-2 pt-2 border-t border-[var(--border)]">
          <span className="text-xs font-bold text-[var(--text-secondary)] block">
            Rezervasyon: {table.customerName}
          </span>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="primary" className="min-h-12" onClick={() => void onCloseReservation(table.reservationId!, 'ARRIVED')}>
              Müşteri Geldi
            </Button>
            <Button variant="secondary" className="min-h-12" onClick={() => void onCloseReservation(table.reservationId!, 'CANCELLED')}>
              İptal Et
            </Button>
          </div>
        </div>
      ) : null}

      {/* Operasyonlar: Masa Taşı ve Masa Birleştir */}
      {isOccupied ? (
        <div className="space-y-2 pt-2 border-t border-[var(--border)]">
          <span className="text-xs font-bold text-[var(--text-secondary)] block">
            Masa Operasyonları
          </span>

          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setShowMoveBox(!showMoveBox);
                setShowMergeBox(false);
              }}
              className="text-xs"
            >
              <ArrowRight className="w-3.5 h-3.5" />
              <span>Masa Taşı</span>
            </Button>

            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setShowMergeBox(!showMergeBox);
                setShowMoveBox(false);
              }}
              className="text-xs"
            >
              <Merge className="w-3.5 h-3.5" />
              <span>Masa Birleştir</span>
            </Button>
          </div>

          {/* Masa Taşı Kutusu */}
          {showMoveBox ? (
            <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-3 space-y-2.5">
              <span className="text-xs font-semibold text-[var(--text-primary)] block">
                Hedef Boş Masa Seçin
              </span>
              <select
                value={moveTargetId}
                onChange={(e) => setMoveTargetId(e.target.value)}
                className="w-full min-h-12 px-3 rounded-lg bg-[var(--bg-subtle)] text-[var(--text-primary)] border border-[var(--border)] text-xs outline-none"
              >
                <option value="">Hedef masa seçin...</option>
                {emptyTables.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.tableNumber} ({t.zoneName} · {t.capacity} Kişilik)
                  </option>
                ))}
              </select>
              <Button
                variant="primary"
                size="sm"
                className="w-full"
                onClick={handleConfirmMove}
                disabled={!moveTargetId}
              >
                Masayı Aktar
              </Button>
            </div>
          ) : null}

          {/* Masa Birleştir Kutusu */}
          {showMergeBox ? (
            <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-3 space-y-2.5">
              <span className="text-xs font-semibold text-[var(--text-primary)] block">
                Birleştirilecek Dolu Masayı Seçin
              </span>
              <select
                value={mergeTargetId}
                onChange={(e) => setMergeTargetId(e.target.value)}
                className="w-full min-h-12 px-3 rounded-lg bg-[var(--bg-subtle)] text-[var(--text-primary)] border border-[var(--border)] text-xs outline-none"
              >
                <option value="">Dolu masa seçin...</option>
                {occupiedTables.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.tableNumber} ({formatMoney(t.totalCents)})
                  </option>
                ))}
              </select>
              <Button
                variant="primary"
                size="sm"
                className="w-full"
                onClick={handleConfirmMerge}
                disabled={!mergeTargetId}
              >
                Adisyonları Birleştir
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </Drawer>
  );
};
