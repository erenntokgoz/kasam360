import React, { useState } from 'react';
import { Send, CreditCard, Trash2, FileText } from 'lucide-react';
import { usePosStore } from '../../stores/posStore';
import { useUIStore } from '../../stores/uiStore';
import { useKdsStore } from '../../stores/kdsStore';
import { formatMoney } from '../../lib/formatMoney';
import { Button } from '../../ui/Button';
import { SmartAuthModal } from './SmartAuthModal';
import { ItemTransferModal } from './ItemTransferModal';
import { OrderTicketLineItem } from './OrderTicketLineItem';
import { useFloorStore } from '../../stores/floorStore';
import type { OrderItem } from '../../types/pos';

export const OrderTicket: React.FC = () => {
  const {
    activeTableName,
    activeTableId,
    ticketItems,
    selectedTicketItemId,
    selectTicketItem,
    updateItemQty,
    removeItem,
    setItemCourse,
    setItemNote,
    clearTicket,
    loadActiveOrder,
    sendToKitchen,
    orderError,
    isSending,
    calculateTotalCents,
  } = usePosStore();

  const { openModal } = useUIStore();
  const { playOrderBell } = useKdsStore();
  const { tables, loadFloorPlan } = useFloorStore();

  const [authModalItem, setAuthModalItem] = useState<OrderItem | null>(null);
  const [authModalMode, setAuthModalMode] = useState<'VOID' | 'COMP'>('VOID');
  const [transferModalItem, setTransferModalItem] = useState<OrderItem | null>(null);

  const total = calculateTotalCents();
  const unsentCount = ticketItems.filter((i) => !i.isSentToKitchen).length;

  const handleSendToKitchen = async () => {
    if (await sendToKitchen()) {
      playOrderBell();
      await loadFloorPlan();
    }
  };

  // Tahsilat sunucudaki adisyona yapılır: taslak önce adisyona yazılır.
  const handleOpenPayment = async () => {
    if (unsentCount > 0) {
      if (!(await sendToKitchen())) return;
      await loadFloorPlan();
    }
    openModal('payment');
  };

  const handleAuthSuccess = () => {
    if (!authModalItem) return;
    removeItem(authModalItem.id);
    void loadActiveOrder();
    void loadFloorPlan();
  };

  const handleConfirmTransfer = () => {
    if (!transferModalItem) return;
    removeItem(transferModalItem.id);
  };

  return (
    <aside className="w-[390px] shrink-0 bg-[var(--bg-panel)] border-l border-[var(--border)] flex flex-col h-full select-none">
      {/* Başlık Barı */}
      <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between shrink-0">
        <div>
          <div className="text-sm font-bold text-[var(--text-primary)]">{activeTableName}</div>
          <div className="text-xs text-[var(--text-secondary)]">Adisyon</div>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => openModal('receiptPreview')}
            className="!min-h-12 !px-2.5 text-xs"
            title="Fiş Önizleme"
          >
            <FileText className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Önizle</span>
          </Button>
          {ticketItems.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearTicket}
              className="!min-h-12 !px-2 text-xs text-[var(--accent-red)] hover:bg-[var(--accent-red-soft)]"
              title="Adisyonu Temizle"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          ) : null}
        </div>
      </div>

      {/* Kalemler Listesi */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {ticketItems.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-[var(--text-muted)]">
            <span className="text-xs">Adisyonda henüz ürün bulunmuyor.</span>
            <span className="text-[11px] mt-1">Katalogdan ürün seçerek ekleyebilirsiniz.</span>
          </div>
        ) : (
          ticketItems.map((item) => (
            <OrderTicketLineItem
              key={item.id}
              item={item}
              isSelected={selectedTicketItemId === item.id}
              onSelect={() => selectTicketItem(selectedTicketItemId === item.id ? null : item.id)}
              onUpdateQty={(delta) => updateItemQty(item.id, delta)}
              onSetCourse={(c) => setItemCourse(item.id, c)}
              onSetNote={(n) => setItemNote(item.id, n)}
              onOpenTransfer={() => setTransferModalItem(item)}
              onOpenComp={() => {
                setAuthModalItem(item);
                setAuthModalMode('COMP');
              }}
              onOpenVoid={() => {
                setAuthModalItem(item);
                setAuthModalMode('VOID');
              }}
            />
          ))
        )}
      </div>

      {orderError ? (
        <p role="alert" className="mx-4 mb-2 p-2 rounded-lg text-xs font-medium break-words bg-[var(--accent-red-soft)] text-[var(--accent-red)] border border-[var(--accent-red-border)]">
          {orderError}
        </p>
      ) : null}

      {/* Alt Toplam ve Ödeme Alanı */}
      <div className="p-4 border-t border-[var(--border)] bg-[var(--bg-subtle)] space-y-3 shrink-0">
        <div className="space-y-1 text-xs">
          <div className="flex justify-between items-baseline pt-1">
            <span className="text-xs font-semibold text-[var(--text-primary)]">Toplam Tutar</span>
            <span className="text-2xl font-bold text-[var(--accent-amber)] tabular-nums">
              {formatMoney(total)}
            </span>
          </div>
        </div>

        {/* Mutfağa Gönder Butonu */}
        <Button
          variant="primary"
          size="lg"
          onClick={handleSendToKitchen}
          disabled={unsentCount === 0 || isSending}
          isLoading={isSending}
          className="w-full justify-between"
        >
          <span className="flex items-center gap-2">
            <Send className="w-4 h-4" />
            <span>Mutfağa Gönder</span>
          </span>
          {unsentCount > 0 ? (
            <span className="text-xs px-2 py-0.5 rounded bg-black/25 font-bold tabular-nums">
              {unsentCount} Yeni
            </span>
          ) : null}
        </Button>

        {/* Hızlı Tahsilat Butonları */}
        <div className="grid grid-cols-3 gap-2">
          <Button
            variant="success"
            size="md"
            onClick={handleOpenPayment}
            disabled={total <= 0}
            className="!min-h-12 text-xs font-bold"
          >
            Nakit
          </Button>

          <Button
            variant="outline-emerald"
            size="md"
            onClick={handleOpenPayment}
            disabled={total <= 0}
            className="!min-h-12 text-xs font-bold"
          >
            <CreditCard className="w-3.5 h-3.5 mr-1" />
            Kart
          </Button>

          <Button
            variant="outline-amber"
            size="md"
            onClick={handleOpenPayment}
            disabled={total <= 0}
            className="!min-h-12 text-xs font-bold"
          >
            Böl / Cari
          </Button>
        </div>
      </div>

      {/* Yetki Onay Modalı */}
      <SmartAuthModal
        isOpen={!!authModalItem}
        item={authModalItem}
        mode={authModalMode}
        onClose={() => setAuthModalItem(null)}
        onSuccess={handleAuthSuccess}
      />

      {/* Kalem Taşıma Modalı */}
      <ItemTransferModal
        isOpen={!!transferModalItem}
        item={transferModalItem}
        tables={tables}
        currentTableId={activeTableId}
        onClose={() => setTransferModalItem(null)}
        onConfirmTransfer={handleConfirmTransfer}
      />
    </aside>
  );
};
