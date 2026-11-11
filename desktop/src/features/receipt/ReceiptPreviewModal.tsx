import { ErrorToast } from '../../ui/ErrorToast';
import React, { useState } from 'react';
import { Printer } from 'lucide-react';
import { useUIStore } from '../../stores/uiStore';
import { usePosStore } from '../../stores/posStore';
import { formatMoney } from '../../lib/formatMoney';
import { formatDateTime } from '../../lib/date';
import { invokeIPC } from '../../services/tauriClient';
import { sessionArgs } from '../../stores/cariStore';
import { errorText } from '../../lib/cariInput';
import { itemTaxCents } from '../../lib/orderMath';
import type { PaymentMethod } from '../../types/payment';
import { Modal } from '../../ui/Modal';
import { Button } from '../../ui/Button';

const METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH: 'Nakit',
  CARD: 'Kart',
  MEAL_CARD: 'Yemek Kartı',
  VERESIYE: 'Veresiye',
};

export const ReceiptPreviewModal: React.FC = () => {
  const modals = useUIStore((state) => state.modals);
  const closeModal = useUIStore((state) => state.closeModal);
  const openModal = useUIStore((state) => state.openModal);
  const setActiveModule = useUIStore((state) => state.setActiveModule);
  const { activeTableName, activeOrderId, ticketItems, lastSale, setLastSale, calculateTotalCents } = usePosStore();

  const [format, setFormat] = useState<'CUSTOMER' | 'KITCHEN'>('CUSTOMER');
  const [isPrinting, setIsPrinting] = useState(false);
  const [printSuccess, setPrintSuccess] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);

  if (!modals.receiptPreview) return null;

  // Tahsilat sonrası fiş o satışı gösterir; öncesinde açık adisyonun ön izlemesidir.
  const items = lastSale?.items ?? ticketItems;
  const leftCents = lastSale?.remainingCents ?? 0;

  // Hesap bittiyse iş salonda sürer; parça ödemede kalan aynı pencereden alınır.
  const handleClose = () => {
    closeModal('receiptPreview');
    if (!lastSale) return;
    setLastSale(null);
    if (leftCents === 0) setActiveModule('FLOOR');
  };

  const handlePayRest = () => {
    closeModal('receiptPreview');
    setLastSale(null);
    openModal('payment');
  };
  const tableName = lastSale?.tableName ?? activeTableName;
  const total = lastSale?.amountCents ?? calculateTotalCents();
  // KDV kalemlerden hesaplanır ve adisyonun tamamına aittir; parça tahsilatta tahsil edilen tutara
  // ait gibi gösterilirse iki fişte toplam KDV iki kez görünür. Parçaya bölmek kuruş yuvarlaması
  // uydurmak demek olduğundan parça fişte adisyon toplamı ile bu tahsilat ayrı satırlarda gösterilir.
  const tax = items.reduce((sum, item) => sum + itemTaxCents(item), 0);
  const orderTotal = items.reduce((sum, item) => sum + item.totalCents, 0);
  const isPartial = Boolean(lastSale) && total !== orderTotal;

  const handlePrint = async () => {
    setIsPrinting(true);
    setPrintError(null);
    try {
      const { actorRole, tenantId } = sessionArgs();
      if (lastSale) {
        await invokeIPC('print_receipt', { receiptId: lastSale.transactionId, actorRole, tenantId });
      } else if (activeOrderId) {
        await invokeIPC('print_order_slip', { orderId: activeOrderId, actorRole, tenantId });
      } else {
        throw new Error('Basılacak kayıt yok.');
      }
      // Komut yetkiyi ve kaydın varlığını doğrular; kâğıda işletim sistemi yazıcısı basar.
      window.print();
      setPrintSuccess(true);
      setTimeout(() => setPrintSuccess(false), 2500);
    } catch (caught) {
      setPrintError(errorText(caught));
    } finally {
      setIsPrinting(false);
    }
  };

  return (
    <Modal
      isOpen={modals.receiptPreview}
      onClose={handleClose}
      title={!lastSale ? 'Fiş Ön İzleme' : leftCents > 0 ? 'Parça Ödeme Alındı' : 'Ödeme Alındı'}
      surface="work"
      maxWidth="md"
    >
      <div className="space-y-4">
        {lastSale?.method === 'CASH' ? (
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-[var(--bg-subtle)] p-4">
              <span className="block text-sm text-[var(--text-secondary)]">Alınan</span>
              <span className="block text-2xl font-extrabold tabular-nums">{formatMoney(lastSale.receivedCents)}</span>
            </div>
            <div className="rounded-lg bg-[var(--accent-emerald-soft)] p-4">
              <span className="block text-sm text-[var(--text-secondary)]">Para Üstü</span>
              <span className="block text-2xl font-extrabold tabular-nums">{formatMoney(lastSale.changeCents)}</span>
            </div>
          </div>
        ) : null}
        {lastSale && leftCents > 0 ? (
          <p className="rounded-lg bg-[var(--bg-subtle)] px-3 py-2 text-sm font-semibold tabular-nums">
            {formatMoney(lastSale.amountCents)} tahsil edildi · {formatMoney(leftCents)} kaldı.
          </p>
        ) : null}

        {/* Mutfak bileti yalnız ödeme öncesi ön izlemededir: tahsilat mutfağı ilgilendirmez. */}
        {lastSale ? null : (
          <div className="grid grid-cols-2 gap-1.5">
            <Button variant={format === 'CUSTOMER' ? 'selected' : 'secondary'} onClick={() => setFormat('CUSTOMER')}>Müşteri Fişi</Button>
            <Button variant={format === 'KITCHEN' ? 'selected' : 'secondary'} onClick={() => setFormat('KITCHEN')}>Mutfak Bileti</Button>
          </div>
        )}

        {/* Fiş Kağıdı Önizlemesi */}
        <div className="receipt-scroll max-h-[42vh] overflow-y-auto">
        <div className="receipt-paper p-4 rounded-lg border text-xs">
          {lastSale || format === 'CUSTOMER' ? (
            /* Format 1: Müşteri Bilgi Fişi */
            <div className="space-y-3">
              <div className="text-center pb-2 border-b border-dashed border-[var(--edge)]">
                <div className="text-xs text-[var(--text-secondary)] mt-1">
                  {lastSale ? `İşlem: ${lastSale.transactionId.slice(0, 14)}` : 'Ön izleme'} · {formatDateTime()}
                </div>
                <div className="text-xs font-bold mt-1 uppercase">Masa: {tableName}</div>
              </div>

              {/* Kalem Dökümü */}
              <div className="space-y-1.5 py-1 border-b border-dashed border-[var(--edge)]">
                {items.map((i) => (
                  <div key={i.id} className="flex justify-between items-baseline">
                    <span>
                      {i.quantity}x {i.name}
                    </span>
                    <span className="font-bold tabular-nums">{formatMoney(i.totalCents)}</span>
                  </div>
                ))}
              </div>

              {/* Toplamlar */}
              <div className="space-y-1 pt-1 border-b border-dashed border-[var(--edge)]">
                {isPartial ? (
                  <div className="flex justify-between text-[var(--text-secondary)] text-xs">
                    <span>Adisyon Toplamı:</span>
                    <span className="tabular-nums">{formatMoney(orderTotal)}</span>
                  </div>
                ) : null}
                <div className="flex justify-between text-[var(--text-secondary)] text-xs">
                  <span>{isPartial ? 'Adisyon KDV’si:' : 'Hesaplanan KDV:'}</span>
                  <span className="tabular-nums">{formatMoney(tax)}</span>
                </div>
                <div className="flex justify-between items-baseline text-sm font-bold pt-1 border-t border-[var(--edge)]">
                  <span>{isPartial ? 'BU TAHSİLAT:' : 'TOPLAM TUTAR:'}</span>
                  <span className="tabular-nums text-base">{formatMoney(total)}</span>
                </div>
                <div className="flex justify-between text-xs text-[var(--text-secondary)] pt-0.5">
                  <span>Tahsilat Şekli:</span>
                  <span className="font-semibold uppercase">{lastSale ? METHOD_LABEL[lastSale.method] : 'Bekliyor'}</span>
                </div>
              </div>

              {lastSale?.method === 'CASH' ? (
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span>Alınan:</span>
                    <span className="tabular-nums">{formatMoney(lastSale.receivedCents)}</span>
                  </div>
                  <div className="flex justify-between font-bold">
                    <span>Para Üstü:</span>
                    <span className="tabular-nums">{formatMoney(lastSale.changeCents)}</span>
                  </div>
                </div>
              ) : null}

              {lastSale && lastSale.remainingCents > 0 ? (
                <div className="flex justify-between text-xs font-bold">
                  <span>Masada Kalan:</span>
                  <span className="tabular-nums">{formatMoney(lastSale.remainingCents)}</span>
                </div>
              ) : null}
            </div>
          ) : (
            /* Format 2: Mutfak / İstasyon Sipariş Bileti */
            <div className="space-y-3">
              <div className="text-center pb-2 border-b-2 border-dashed border-[var(--edge)]">
                <div className="text-3xl font-black tracking-tight">{tableName}</div>
                <div className="text-xs font-bold mt-1">MUTFAK SİPARİŞ BİLETİ</div>
                <div className="text-xs text-[var(--text-secondary)]">Saat: {formatDateTime()}</div>
              </div>

              <div className="space-y-3 py-2 border-b-2 border-dashed border-[var(--edge)]">
                {items.map((kItem) => (
                  <div key={kItem.id} className="flex items-start gap-3">
                    <span className="text-2xl font-black tabular-nums">{kItem.quantity}x</span>
                    <div>
                      <span className="text-sm font-black uppercase">{kItem.name}</span>
                      {kItem.cookingDegree || kItem.notes ? (
                        <span className="block text-xs font-bold text-[var(--danger)] mt-0.5">
                          *** {[kItem.cookingDegree, kItem.notes].filter(Boolean).join(' · ')}
                        </span>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>

              <div className="text-center text-xs font-black uppercase">
                ** LÜTFEN ZAMANINDA SERVİS EDİNİZ **
              </div>
            </div>
          )}
        </div>
        </div>

        {printError ? (
          <ErrorToast message={printError} />
        ) : null}
        {printSuccess ? <p className="text-xs font-semibold text-center text-[var(--accent-emerald)]">Fiş yazıcıya gönderildi.</p> : null}

        <div className="grid grid-cols-2 gap-1.5">
          <Button variant="secondary" size="lg" onClick={handlePrint} isLoading={isPrinting}>
            <Printer className="w-4 h-4" />
            <span>Fiş Yazdır</span>
          </Button>
          {lastSale ? (
            leftCents > 0 ? (
              <>
                <Button variant="secondary" size="lg" onClick={handleClose}>Adisyona Dön</Button>
                <Button variant="success" size="lg" onClick={handlePayRest}>Kalanı Al</Button>
              </>
            ) : (
              <Button variant="primary" size="lg" onClick={handleClose}>Salona Dön</Button>
            )
          ) : (
            <Button variant="primary" size="lg" onClick={handleClose}>Kapat</Button>
          )}
        </div>
      </div>
    </Modal>
  );
};
