import React, { useState } from 'react';
import { Send, Trash2, FileText } from 'lucide-react';
import { usePosStore } from '../../stores/posStore';
import { useUIStore } from '../../stores/uiStore';
import { useKdsStore } from '../../stores/kdsStore';
import { formatMoney } from '../../lib/formatMoney';
import { Button } from '../../ui/Button';
import { Modal } from '../../ui/Modal';
import { SmartAuthModal } from './SmartAuthModal';
import { ItemTransferModal } from './ItemTransferModal';
import { OrderTicketLineItem } from './OrderTicketLineItem';
import { useFloorStore } from '../../stores/floorStore';
import { useAuthStore } from '../../stores/authStore';
import { canCollectPayment } from '../../lib/roleAccess';
import type { OrderItem } from '../../types/pos';

export const OrderTicket: React.FC = () => {
  const canCollect = canCollectPayment(useAuthStore((state) => state.user?.role));
  const {
    activeTableName,
    activeTableId,
    ticketItems,
    balance,
    selectedTicketItemId,
    selectTicketItem,
    updateItemQty,
    removeItem,
    setItemNote,
    clearTicket,
    loadActiveOrder,
    sendToKitchen,
    orderError,
    isSending,
    calculateTotalCents,
  } = usePosStore();

  const openModal = useUIStore((state) => state.openModal);
  const { playOrderBell } = useKdsStore();
  const { tables, loadFloorPlan } = useFloorStore();

  const [authModalItem, setAuthModalItem] = useState<OrderItem | null>(null);
  const [authModalMode, setAuthModalMode] = useState<'VOID' | 'COMP'>('VOID');
  const [transferModalItem, setTransferModalItem] = useState<OrderItem | null>(null);
  const [askClear, setAskClear] = useState(false);

  const total = calculateTotalCents();
  const unsentCount = ticketItems.filter((i) => !i.isSentToKitchen).length;

  const handleSendToKitchen = async () => {
    if (await sendToKitchen()) {
      playOrderBell();
      await loadFloorPlan();
    }
  };

  // Tahsilat sunucudaki adisyona yapılır; bekleyen kalemler düğme yazısıyla belli olarak gider.
  const handlePay = async () => {
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
    <aside className="w-[390px] shrink-0 work-surface !rounded-none border-l border-[var(--border)] flex flex-col h-full select-none">
      {/* Başlık Barı */}
      <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between shrink-0">
        <div>
          <div className="text-lg font-bold text-[var(--text-primary)]">{activeTableName}</div>
          <div className="text-xs text-[var(--text-secondary)]">Adisyon</div>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => openModal('receiptPreview')}
            className="!min-h-12 !px-2.5 text-sm"
            title="Fiş Önizleme"
          >
            <FileText className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Önizle</span>
          </Button>
          {unsentCount > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAskClear(true)}
              className="!min-h-12 !w-12 !px-0 text-[var(--accent-red)] hover:bg-[var(--accent-red-soft)]"
              aria-label="Gönderilmemiş kalemleri sil"
              title="Gönderilmemiş kalemleri sil"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          ) : null}
        </div>
      </div>

      {/* Kalemler Listesi */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {ticketItems.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-[var(--text-muted)]">
            <span className="text-xs">Adisyonda henüz ürün bulunmuyor.</span>
            <span className="text-xs mt-1">Katalogdan ürün seçerek ekleyebilirsiniz.</span>
          </div>
        ) : (
          ticketItems.map((item) => (
            <OrderTicketLineItem
              key={item.id}
              item={item}
              isSelected={selectedTicketItemId === item.id}
              onSelect={() => selectTicketItem(selectedTicketItemId === item.id ? null : item.id)}
              onUpdateQty={(delta) => updateItemQty(item.id, delta)}
              // Mutfağa gitmiş kaleme yazılan not mutfağa ulaşmaz; alan yalnız taslakta açılır.
              onSetNote={item.isSentToKitchen ? undefined : (n) => setItemNote(item.id, n)}
              onOpenTransfer={() => setTransferModalItem(item)}
              onOpenComp={() => {
                setAuthModalItem(item);
                setAuthModalMode('COMP');
              }}
              onOpenVoid={() => {
                // Mutfağa gitmemiş kalem onaysız silinir: ortada iptal edilecek sipariş yok.
                if (!item.isSentToKitchen) {
                  removeItem(item.id);
                  return;
                }
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
          {balance && balance.paidCents > 0 ? (
            <div className="flex justify-between items-baseline tabular-nums">
              <span>Tahsil Edilen</span>
              <span>{formatMoney(balance.paidCents)}</span>
            </div>
          ) : null}
          <div className="flex justify-between items-baseline pt-1">
            <span className="text-sm font-semibold text-[var(--text-primary)]">{balance && balance.paidCents > 0 ? 'Kalan Tutar' : 'Toplam Tutar'}</span>
            <span className="hand text-4xl tabular-nums">
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

        {canCollect ? (
          <Button variant="success" size="lg" onClick={() => void handlePay()} disabled={total <= 0 || isSending} className="w-full">
            {unsentCount > 0 ? 'Gönder ve Ödeme Al' : 'Ödeme Al'}
          </Button>
        ) : null}
      </div>

      <Modal isOpen={askClear} onClose={() => setAskClear(false)} title="Kalemler silinsin mi?" subtitle={`${unsentCount} kalem henüz mutfağa gitmedi.`} maxWidth="sm">
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" size="lg" onClick={() => setAskClear(false)}>Vazgeç</Button>
          <Button
            variant="danger"
            size="lg"
            onClick={() => {
              clearTicket();
              setAskClear(false);
            }}
          >
            Sil
          </Button>
        </div>
      </Modal>

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
