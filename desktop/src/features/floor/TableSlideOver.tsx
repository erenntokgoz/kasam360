import { ErrorToast } from '../../ui/ErrorToast';
import React, { useEffect, useState } from 'react';
import { ShoppingBag, CreditCard, ArrowRight, Merge, Users, Clock } from 'lucide-react';
import type { FloorTable } from '../../types/floor';
import { formatMoney } from '../../lib/formatMoney';
import { formatTime, minutesElapsed } from '../../lib/date';
import { Drawer } from '../../ui/Drawer';
import { Button } from '../../ui/Button';
import { Badge } from '../../ui/Badge';
import { invokeIPC } from '../../services/tauriClient';
import { sessionArgs } from '../../stores/cariStore';
import { mapServerItem, type CartItemWire } from '../../lib/orderMath';
import type { OrderItem } from '../../types/pos';
import type { OrderBalance } from '../../stores/posStore';
import { useAuthStore } from '../../stores/authStore';
import { useFloorStore } from '../../stores/floorStore';
import { errorText } from '../../lib/cariInput';
import { canCollectPayment } from '../../lib/roleAccess';

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
  /** Rezervasyon sahibi gelince masa rezervasyondaki kişi sayısıyla siparişe açılır. */
  onSeatReservation: (table: FloorTable, guestCount: number) => void;
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
  onSeatReservation,
}) => {
  const [moveTargetId, setMoveTargetId] = useState<string>('');
  const [mergeTargetId, setMergeTargetId] = useState<string>('');
  const [showMoveBox, setShowMoveBox] = useState(false);
  const [showMergeBox, setShowMergeBox] = useState(false);
  const [tableItems, setTableItems] = useState<OrderItem[]>([]);
  const [balance, setBalance] = useState<OrderBalance | null>(null);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [isClosing, setIsClosing] = useState(false);
  const canSettle = canCollectPayment(useAuthStore((state) => state.user?.role));
  const loadFloorPlan = useFloorStore((state) => state.loadFloorPlan);
  const tableId = table?.id;
  const activeOrderId = table?.activeOrderId;
  const isOccupied = table?.status === 'OCCUPIED';

  // Kanca erken dönüşten önce durmalıdır: masa seçilince kanca sayısı değişir ve
  // React tüm uygulamayı boş ekrana düşürür.
  useEffect(() => {
    if (!isOpen || !isOccupied || !tableId) {
      setTableItems([]);
      setBalance(null);
      return;
    }
    const { tenantId } = sessionArgs();
    if (activeOrderId) {
      void invokeIPC<OrderBalance>('get_order_balance', { orderId: activeOrderId, tenantId })
        .then(setBalance)
        .catch(() => setBalance(null));
    }
    void invokeIPC<CartItemWire[]>('get_order_items', { tableId, tenantId })
      .then((wire) => setTableItems(wire.map(mapServerItem).filter((item): item is OrderItem => item !== null)))
      .catch(() => setTableItems([]));
  }, [isOpen, isOccupied, tableId, activeOrderId]);

  if (!table) return null;

  const elapsed = isOccupied ? minutesElapsed(table.openedAt) : 0;
  const emptyTables = allTables.filter((t) => t.id !== table.id && t.status === 'EMPTY');
  const occupiedTables = allTables.filter((t) => t.id !== table.id && t.status === 'OCCUPIED');

  const handleConfirmMove = () => {
    if (!moveTargetId) return;
    onMoveTable(table.id, moveTargetId);
    setShowMoveBox(false);
  };

  const remainingCents = balance?.remainingCents ?? table.remainingCents ?? table.totalCents;
  // Tamamı ikram ya da iptal edilen adisyonda tahsilat kalmaz; masa yine de kapanabilmelidir.
  const isZeroBalance = balance !== null && remainingCents <= 0;

  const handleCloseZero = async () => {
    const { actorId, actorRole, tenantId } = sessionArgs();
    setIsClosing(true);
    setCloseError(null);
    try {
      await invokeIPC('close_zero_balance_table', { tableId: table.id, tenantId, actorId, actorRole });
      await loadFloorPlan();
      onClose();
    } catch (caught) {
      setCloseError(errorText(caught));
    } finally {
      setIsClosing(false);
    }
  };

  const handleConfirmMerge = () => {
    if (!mergeTargetId) return;
    onMergeTable(table.id, mergeTargetId);
    setShowMergeBox(false);
  };

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title={table.tableNumber}
      subtitle={`${table.zoneName} · ${table.capacity} Kişilik Kapasite`}
      footer={isOccupied ? (
        <div className="space-y-2">
          <div className="pb-2 border-b border-[var(--border)] space-y-0.5">
            {balance && balance.paidCents > 0 ? (
              <div className="flex items-center justify-between text-sm text-[var(--text-secondary)] tabular-nums">
                <span>Toplam {formatMoney(balance.totalCents)}</span>
                <span>Ödenen {formatMoney(balance.paidCents)}</span>
              </div>
            ) : null}
            <div className="flex items-center justify-between">
              <span className="text-sm text-[var(--text-secondary)]">{balance ? 'Kalan Tutar' : 'Toplam Tutar'}</span>
              <span className="text-xl font-bold text-[var(--text-primary)] tabular-nums">
                {formatMoney(balance?.remainingCents ?? table.totalCents)}
              </span>
            </div>
          </div>

          <div className={canSettle ? 'grid grid-cols-2 gap-2' : 'grid grid-cols-1 gap-2'}>
            <Button
              variant="secondary"
              size="lg"
              onClick={() => onGoToPos(table)}
              className="w-full text-sm"
            >
              <ShoppingBag className="w-4 h-4" />
              <span>Siparişe Git</span>
            </Button>

            {!canSettle ? null : isZeroBalance ? (
              <Button variant="primary" size="lg" className="w-full text-sm" isLoading={isClosing} onClick={() => void handleCloseZero()}>
                <span>Masayı Kapat</span>
              </Button>
            ) : (
              <Button
                variant="success"
                size="lg"
                onClick={() => onPayTable(table)}
                className="w-full text-sm"
                disabled={remainingCents <= 0}
              >
                <CreditCard className="w-4 h-4" />
                <span>Hesap Al</span>
              </Button>
            )}
          </div>
          {closeError ? <ErrorToast message={closeError} /> : null}
        </div>
      ) : undefined}
    >
      {/* Durum Özeti */}
      <div className="paper border border-[var(--border)] rounded-xl p-4.5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-[var(--text-secondary)]">Masa Durumu:</span>
            {isOccupied ? (
              <Badge variant="amber">Dolu</Badge>
            ) : table.reservationId ? (
              <Badge variant="blue">Rezerve</Badge>
            ) : (
              <Badge variant="emerald">Boş</Badge>
            )}
          </div>

          {isOccupied ? (
            <span className="text-xs text-[var(--text-muted)] flex items-center gap-1 tabular-nums">
              <Clock className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
              <span>{elapsed} dakikadır açık</span>
            </span>
          ) : null}
        </div>

        {isOccupied ? (
          <div className="grid grid-cols-2 gap-2 pt-1 border-t border-[var(--border)] text-xs text-[var(--text-secondary)]">
            <div className="flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-[var(--text-muted)]" />
              <span>{table.occupiedSeats ? `${table.occupiedSeats} kişi` : 'Kişi girilmedi'}</span>
            </div>
            {table.waiterName ? (
              <div>
                <span className="text-[var(--text-muted)]">Garson: </span>
                <span className="font-semibold text-[var(--text-primary)]">{table.waiterName}</span>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {isOccupied && (table.trail || table.merged) ? (
        <div role="note" className="sheet rounded-lg p-3 text-sm space-y-1">
          {table.trail ? <p className="font-semibold">{table.trail} ➭ {table.tableNumber}</p> : null}
          {table.merged ? <p>{table.merged} bu masaya birleşti</p> : null}
        </div>
      ) : null}

      {/* Sipariş Kalemleri Önizleme */}
      {isOccupied ? (
      <div className="space-y-2">
        <span className="text-xs font-bold text-[var(--text-secondary)] block">
          Açık Adisyon Kalemleri
        </span>

        {tableItems.length > 0 ? (
          <div className="bg-[var(--bg-subtle)] border border-[var(--border)] rounded-xl p-3 divide-y divide-[var(--border)] text-xs max-h-60 overflow-y-auto">
            {tableItems.map((item) => (
              <div key={item.id} className="py-2 first:pt-0 last:pb-0 flex justify-between items-center">
                <div>
                  <span className="font-bold text-[var(--text-primary)]">
                    {item.quantity}x {item.name}
                  </span>
                  {item.cookingDegree || item.notes || (item.selectedModifiers && item.selectedModifiers.length > 0) ? (
                    <span className="block text-xs text-[var(--text-muted)] mt-0.5">
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
      ) : null}

      {!isOccupied && table.reservationId ? (
        <div className="space-y-2 pt-2 border-t border-[var(--border)]">
          <span className="text-sm font-bold text-[var(--text-primary)] block">
            {table.customerName}
            {table.reservedAt ? ` · ${formatTime(table.reservedAt)}` : ''}
            {table.reservationPartySize ? ` · ${table.reservationPartySize} kişi` : ''}
          </span>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="primary"
              className="min-h-12"
              onClick={() => {
                const reservationId = table.reservationId;
                if (!reservationId) return;
                void onCloseReservation(reservationId, 'ARRIVED').then(() =>
                  onSeatReservation(table, table.reservationPartySize ?? table.capacity),
                );
              }}
            >
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
            <div className="paper border border-[var(--border)] rounded-xl p-4 space-y-2.5">
              <span className="text-xs font-semibold text-[var(--text-primary)] block">
                Hedef Boş Masa Seçin
              </span>
              <select
                value={moveTargetId}
                onChange={(e) => setMoveTargetId(e.target.value)}
                className="w-full min-h-12 px-3 rounded-lg bg-[var(--bg-subtle)] text-[var(--text-primary)] border border-[var(--border)] text-sm outline-none"
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
                {moveTargetId
                  ? `${table.tableNumber} → ${emptyTables.find((t) => t.id === moveTargetId)?.tableNumber ?? ''} masasına taşınsın`
                  : 'Masayı Aktar'}
              </Button>
            </div>
          ) : null}

          {/* Masa Birleştir Kutusu */}
          {showMergeBox ? (
            <div className="paper border border-[var(--border)] rounded-xl p-4 space-y-2.5">
              <span className="text-xs font-semibold text-[var(--text-primary)] block">
                Birleştirilecek Dolu Masayı Seçin
              </span>
              <select
                value={mergeTargetId}
                onChange={(e) => setMergeTargetId(e.target.value)}
                className="w-full min-h-12 px-3 rounded-lg bg-[var(--bg-subtle)] text-[var(--text-primary)] border border-[var(--border)] text-sm outline-none"
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
                {/* Birleşme geri alınmaz; hangi masanın boşalacağı düğmede yazar. */}
                {mergeTargetId
                  ? `${table.tableNumber} → ${occupiedTables.find((t) => t.id === mergeTargetId)?.tableNumber ?? ''} masasına katılsın`
                  : 'Adisyonları Birleştir'}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </Drawer>
  );
};
