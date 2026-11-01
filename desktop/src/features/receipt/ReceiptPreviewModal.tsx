import React, { useState } from 'react';
import { Printer, Check } from 'lucide-react';
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
  const { modals, closeModal } = useUIStore();
  const { activeTableName, activeOrderId, ticketItems, lastSale, calculateTotalCents } = usePosStore();

  const [format, setFormat] = useState<'CUSTOMER' | 'KITCHEN'>('CUSTOMER');
  const [isPrinting, setIsPrinting] = useState(false);
  const [printSuccess, setPrintSuccess] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);

  if (!modals.receiptPreview) return null;

  // Tahsilat sonrası fiş o satışı gösterir; öncesinde açık adisyonun ön izlemesidir.
  const items = lastSale?.items ?? ticketItems;
  const tableName = lastSale?.tableName ?? activeTableName;
  const total = lastSale?.amountCents ?? calculateTotalCents();
  const tax = items.reduce((sum, item) => sum + itemTaxCents(item), 0);

  const handlePrint = async () => {
    setIsPrinting(true);
    setPrintError(null);
    try {
      const { actorRole, tenantId } = sessionArgs();
      if (format === 'CUSTOMER' && lastSale) {
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
      onClose={() => closeModal('receiptPreview')}
      title="Termal Fiş Önizleme"
      subtitle="Termal rulo çıktısı için çift format desteği"
      maxWidth="md"
    >
      <div className="space-y-4">
        {/* Çift Format Seçici */}
        <div className="grid grid-cols-2 p-1 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border)]">
          <button
            type="button"
            onClick={() => setFormat('CUSTOMER')}
            className={`min-h-12 rounded-md text-sm font-semibold cursor-pointer transition-colors ${
              format === 'CUSTOMER'
                ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            Müşteri Bilgi Fişi
          </button>
          <button
            type="button"
            onClick={() => setFormat('KITCHEN')}
            className={`min-h-12 rounded-md text-sm font-semibold cursor-pointer transition-colors ${
              format === 'KITCHEN'
                ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            Mutfak / Bar Sipariş Bileti
          </button>
        </div>

        {/* Fiş Kağıdı Önizlemesi */}
        <div className="receipt-paper p-5 rounded-lg border text-xs shadow-inner">
          {format === 'CUSTOMER' ? (
            /* Format 1: Müşteri Bilgi Fişi */
            <div className="space-y-3">
              <div className="text-center pb-2 border-b border-dashed border-gray-400">
                <div className="text-xs text-gray-600 mt-1">
                  {lastSale ? `İşlem: ${lastSale.transactionId.slice(0, 14)}` : 'Ön izleme'} · {formatDateTime()}
                </div>
                <div className="text-xs font-bold mt-1 uppercase">Masa: {tableName}</div>
              </div>

              {/* Kalem Dökümü */}
              <div className="space-y-1.5 py-1 border-b border-dashed border-gray-400">
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
              <div className="space-y-1 pt-1 border-b border-dashed border-gray-400">
                <div className="flex justify-between text-gray-600 text-xs">
                  <span>Hesaplanan KDV:</span>
                  <span className="tabular-nums">{formatMoney(tax)}</span>
                </div>
                <div className="flex justify-between items-baseline text-sm font-bold pt-1 border-t border-gray-300">
                  <span>TOPLAM TUTAR:</span>
                  <span className="tabular-nums text-base">{formatMoney(total)}</span>
                </div>
                <div className="flex justify-between text-xs text-gray-600 pt-0.5">
                  <span>Tahsilat Şekli:</span>
                  <span className="font-semibold uppercase">{lastSale ? METHOD_LABEL[lastSale.method] : 'Bekliyor'}</span>
                </div>
              </div>

              {lastSale && lastSale.remainingCents > 0 ? (
                <div className="flex justify-between text-xs font-bold">
                  <span>Kalan Bakiye:</span>
                  <span className="tabular-nums">{formatMoney(lastSale.remainingCents)}</span>
                </div>
              ) : null}
            </div>
          ) : (
            /* Format 2: Mutfak / İstasyon Sipariş Bileti */
            <div className="space-y-3">
              <div className="text-center pb-2 border-b-2 border-dashed border-gray-700">
                <div className="text-3xl font-black tracking-tight">{tableName}</div>
                <div className="text-xs font-bold mt-1">MUTFAK SİPARİŞ BİLETİ</div>
                <div className="text-xs text-gray-600">Saat: {formatDateTime()}</div>
              </div>

              <div className="space-y-3 py-2 border-b-2 border-dashed border-gray-700">
                {items.map((kItem) => (
                  <div key={kItem.id} className="flex items-start gap-3">
                    <span className="text-2xl font-black tabular-nums">{kItem.quantity}x</span>
                    <div>
                      <span className="text-sm font-black uppercase">{kItem.name}</span>
                      {kItem.cookingDegree || kItem.notes ? (
                        <span className="block text-xs font-bold text-red-700 mt-0.5">
                          *** {[kItem.cookingDegree, kItem.notes].filter(Boolean).join(' · ')}
                        </span>
                      ) : null}
                      <span className="block text-xs text-gray-600 font-bold uppercase">
                        [{kItem.course}. {kItem.course === 1 ? 'BAŞLANGIÇ' : kItem.course === 2 ? 'ANA YEMEK' : 'TATLI / KAHVE'}]
                      </span>
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

        {printSuccess ? (
          <div className="p-2.5 rounded-lg bg-[var(--accent-emerald-soft)] text-[var(--accent-emerald)] border border-[var(--accent-emerald-border)] text-xs font-bold text-center flex items-center justify-center gap-1.5">
            <Check className="w-4 h-4" />
            <span>Fiş yazıcı kuyruğuna iletildi.</span>
          </div>
        ) : null}

        {printError ? (
          <p role="alert" className="text-xs font-semibold text-center text-[var(--accent-red)]">{printError}</p>
        ) : null}

        <Button
          type="button"
          variant="primary"
          size="lg"
          className="w-full font-bold"
          onClick={handlePrint}
          isLoading={isPrinting}
        >
          <Printer className="w-4 h-4 mr-2" />
          <span>Termal Yazıcıdan Bas</span>
        </Button>
      </div>
    </Modal>
  );
};
