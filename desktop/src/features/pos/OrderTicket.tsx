import React, { useState } from 'react';
import { Send } from 'lucide-react';
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
  const [askClear, setAskClear] = useState(false);

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
    <aside className="paper slip !rounded-b-none w-[400px] max-w-[42vw] shrink-0 mt-3 mr-4 mb-5 flex flex-col min-h-0 select-none">
      <div className="px-4 pb-2 flex items-start justify-between gap-2 border-b-2 border-[var(--print)] shrink-0">
        <div className="min-w-0">
          <h2 className="print-title text-3xl leading-tight truncate">{activeTableName}</h2>
          <p className="text-sm text-[var(--text-secondary)]">{ticketItems.length} kalem</p>
        </div>
        <Button variant="ghost" size="sm" className="!px-2" onClick={() => openModal('receiptPreview')}>
          Fiş
        </Button>
      </div>

      <div className="ruled flex-1 min-h-0 overflow-y-auto px-4">
        {ticketItems.length === 0 ? (
          <p className="pt-3 text-[var(--text-secondary)]">Soldan ürün seçin. Dokunduğunuz ürün buraya yazılır.</p>
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
        <p role="alert" className="mx-4 mb-2 p-2 rounded-md text-sm font-semibold break-words bg-[var(--accent-red-soft)] text-[var(--accent-red)]">
          {orderError}
        </p>
      ) : null}

      <div className="px-4 pt-2 pb-3 border-t-2 border-[var(--print)] space-y-2 shrink-0">
        <div className="flex justify-between items-baseline">
          <span className="font-bold text-[var(--print)]">Toplam</span>
          <span className="hand text-4xl tabular-nums">{formatMoney(total)}</span>
        </div>

        <div className={canCollect ? 'grid grid-cols-2 gap-2' : ''}>
          <Button
            variant="primary"
            size="lg"
            onClick={handleSendToKitchen}
            disabled={unsentCount === 0 || isSending}
            isLoading={isSending}
            className="w-full"
          >
            <Send className="w-4 h-4" />
            <span>Mutfağa{unsentCount > 0 ? ` (${unsentCount})` : ''}</span>
          </Button>
          {canCollect ? (
            <Button variant="success" size="lg" onClick={handleOpenPayment} disabled={total <= 0} className="w-full">
              Ödeme Al
            </Button>
          ) : null}
        </div>
        {unsentCount > 0 ? (
          <Button variant="ghost" size="sm" className="w-full !text-[var(--accent-red)]" onClick={() => setAskClear(true)}>
            Gönderilmemiş Kalemleri Sil
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
