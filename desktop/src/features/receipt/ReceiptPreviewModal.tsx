import React, { useState } from 'react';
import { Printer, Check } from 'lucide-react';
import { useUIStore } from '../../stores/uiStore';
import { usePosStore } from '../../stores/posStore';
import { formatMoney } from '../../lib/formatMoney';
import { formatDateTime } from '../../lib/date';
import { invokeIPC } from '../../services/tauriClient';
import { Modal } from '../../ui/Modal';
import { Button } from '../../ui/Button';

export const ReceiptPreviewModal: React.FC = () => {
  const { modals, closeModal } = useUIStore();
  const { activeTableName, ticketItems, calculateSubtotalCents, calculateTaxCents, calculateTotalCents } =
    usePosStore();

  const [format, setFormat] = useState<'CUSTOMER' | 'KITCHEN'>('CUSTOMER');
  const [isPrinting, setIsPrinting] = useState(false);
  const [printSuccess, setPrintSuccess] = useState(false);

  if (!modals.receiptPreview) return null;

  const subtotal = calculateSubtotalCents();
  const tax = calculateTaxCents();
  const total = calculateTotalCents() || 148500; // Fallback to demo amount if empty

  const handlePrint = async () => {
    setIsPrinting(true);
    try {
      if (format === 'CUSTOMER') {
        await invokeIPC('print_receipt', { orderId: 'ord_active' });
      } else {
        await invokeIPC('print_order_slip', { orderId: 'ord_active', station: 'MUTFAK' });
      }
      setPrintSuccess(true);
      setTimeout(() => setPrintSuccess(false), 2500);
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
            className={`py-2 rounded-md text-xs font-semibold cursor-pointer transition-colors ${
              format === 'CUSTOMER'
                ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            Müşteri Mali Fişi
          </button>
          <button
            type="button"
            onClick={() => setFormat('KITCHEN')}
            className={`py-2 rounded-md text-xs font-semibold cursor-pointer transition-colors ${
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
            /* Format 1: Müşteri Mali Fişi */
            <div className="space-y-3">
              <div className="text-center pb-2 border-b border-dashed border-gray-400">
                <div className="font-bold text-sm tracking-tight">KASAM360 DEMO RESTORAN</div>
                <div className="text-[11px] text-gray-600">Bağdat Caddesi No: 42 Kadıköy / İSTANBUL</div>
                <div className="text-[11px] text-gray-600">VKN: 9028374615 · MERSİS: 090283746150001</div>
                <div className="text-[10px] text-gray-600 mt-1">
                  Fiş No: 004819 · Tarih: {formatDateTime()}
                </div>
                <div className="text-xs font-bold mt-1 uppercase">Masa: {activeTableName}</div>
              </div>

              {/* Kalem Dökümü */}
              <div className="space-y-1.5 py-1 border-b border-dashed border-gray-400">
                {(ticketItems.length > 0 ? ticketItems : [
                  { id: '1', name: 'Antrikot Izgara (220g)', quantity: 2, unitPriceCents: 48000, totalCents: 96000 },
                  { id: '2', name: '360 Smash Burger', quantity: 1, unitPriceCents: 26000, totalCents: 26000 },
                  { id: '3', name: 'Kola (Kutu 330ml)', quantity: 2, unitPriceCents: 5500, totalCents: 11000 },
                  { id: '4', name: 'San Sebastian', quantity: 1, unitPriceCents: 15500, totalCents: 15500 },
                ]).map((i) => (
                  <div key={i.id} className="flex justify-between items-baseline">
                    <span>
                      {i.quantity}x {i.name}
                    </span>
                    <span className="font-bold tabular-nums">{formatMoney(i.totalCents)}</span>
                  </div>
                ))}
              </div>

              {/* Mali Toplamlar */}
              <div className="space-y-1 pt-1 border-b border-dashed border-gray-400">
                <div className="flex justify-between text-gray-600 text-[11px]">
                  <span>KDV Matrahı:</span>
                  <span className="tabular-nums">{formatMoney(subtotal)}</span>
                </div>
                <div className="flex justify-between text-gray-600 text-[11px]">
                  <span>Hesaplanan KDV (%10):</span>
                  <span className="tabular-nums">{formatMoney(tax)}</span>
                </div>
                <div className="flex justify-between items-baseline text-sm font-bold pt-1 border-t border-gray-300">
                  <span>TOPLAM TUTAR:</span>
                  <span className="tabular-nums text-base">{formatMoney(total)}</span>
                </div>
                <div className="flex justify-between text-[11px] text-gray-600 pt-0.5">
                  <span>Tahsilat Şekli:</span>
                  <span className="font-semibold uppercase">Nakit / Kredi Kartı</span>
                </div>
              </div>

              <div className="text-center text-[10px] text-gray-500 pt-1">
                KASAM360 Yerel Öncelikli POS Motoru İle Üretilmiştir. Mali Değeri Vardır.
              </div>
            </div>
          ) : (
            /* Format 2: Mutfak / İstasyon Sipariş Bileti */
            <div className="space-y-3">
              <div className="text-center pb-2 border-b-2 border-dashed border-gray-700">
                <div className="text-3xl font-black tracking-tight">{activeTableName}</div>
                <div className="text-xs font-bold mt-1">MUTFAK SİPARİŞ BİLETİ #104</div>
                <div className="text-[10px] text-gray-600">Saat: {formatDateTime()} · Garson: Mehmet K.</div>
              </div>

              <div className="space-y-3 py-2 border-b-2 border-dashed border-gray-700">
                {(ticketItems.length > 0
                  ? ticketItems
                  : [
                      {
                        id: 'demo_k1',
                        name: 'Antrikot Izgara (220g)',
                        quantity: 2,
                        cookingDegree: 'ORTA PİŞMİŞ',
                        notes: 'SOS AYRI',
                        course: 2,
                      },
                      {
                        id: 'demo_k2',
                        name: '360 Smash Burger',
                        quantity: 1,
                        notes: 'SOĞANSIZ · PATATES AYRI',
                        course: 2,
                      },
                    ]
                ).map((kItem) => (
                  <div key={kItem.id} className="flex items-start gap-3">
                    <span className="text-2xl font-black tabular-nums">{kItem.quantity}x</span>
                    <div>
                      <span className="text-sm font-black uppercase">{kItem.name}</span>
                      {kItem.cookingDegree || kItem.notes ? (
                        <span className="block text-xs font-bold text-red-700 mt-0.5">
                          *** {[kItem.cookingDegree, kItem.notes].filter(Boolean).join(' · ')}
                        </span>
                      ) : null}
                      <span className="block text-[10px] text-gray-600 font-bold uppercase">
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
