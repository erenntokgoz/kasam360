import { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, Info, Percent, Printer, Receipt as ReceiptIcon, X } from 'lucide-react';

import { tauriInvoke } from '../../../data/ipc/tauriInvoke';
import { useAuthStore } from '../../store/useAuthStore';
import { formatCents, type ReceiptDto } from '../../types/ledger';

interface ReceiptViewerModalProps {
  /** Görüntülenecek fişin tahsilat kimliği (`receipt_id`). */
  receiptId: string | null;
  onClose: () => void;
  onNotify: (message: string, tone: 'success' | 'error') => void;
}

const formatDateTime = (iso: string): string => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('tr-TR');
};

/**
 * Fiş görüntüleyici — Hesap Defteri'ndeki finansal harekete bağlı fiş penceresi.
 *
 * Neden ayrı ekran değil: Faz 7'de bağımsız "Fişler" sayfası kaldırıldı. Fiş,
 * satırın üzerindeki **"Fişi Görüntüle"** aksiyonuyla açılır ve verisini
 * `get_receipt_details` komutundan okur.
 *
 * Dürüstlük kuralı: kalem kaydı yoksa alt toplam/KDV **hesaplanmaz**. `total * 100 / 110`
 * gibi oran uydurmaları kaldırıldı; yoksa ekranda "kalem kaydı yok" yazar.
 */
export function ReceiptViewerModal({ receiptId, onClose, onNotify }: ReceiptViewerModalProps) {
  // Rol ve tenant oturumdan gelir; backend fail-closed çalışır.
  const session = useAuthStore((state) => state.user);
  const actorRole = session?.role;
  const tenantId = session?.tenantId;

  const [receipt, setReceipt] = useState<ReceiptDto | null>(null);
  const [tab, setTab] = useState<'DETAILS' | 'THERMAL'>('DETAILS');
  const [error, setError] = useState<string | null>(null);
  const [isPrinting, setIsPrinting] = useState(false);
  const thermalRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (id: string) => {
    setError(null);
    try {
      const data = await tauriInvoke<ReceiptDto | null>('get_receipt_details', {
        receiptId: id,
        actorRole,
        tenantId,
      });
      setReceipt(data);
    } catch (err) {
      setReceipt(null);
      setError(err instanceof Error ? err.message : 'Fiş okunamadı.');
    }
  }, [actorRole, tenantId]);

  useEffect(() => {
    if (!receiptId) {
      setReceipt(null);
      return;
    }
    void load(receiptId);
  }, [receiptId, load]);

  useEffect(() => {
    if (!receiptId) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [receiptId, onClose]);

  /** Termal basım: içerik backend'den okunur, istemci yükü gönderilmez. */
  const handleThermalPrint = async () => {
    if (!receipt) return;
    setIsPrinting(true);
    try {
      await tauriInvoke('print_receipt', {
        receiptId: receipt.transaction_id || receipt.id,
        actorRole,
        tenantId,
      });
      onNotify('Fiş termal yazıcıya gönderildi.', 'success');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Yazdırma başarısız.', 'error');
    } finally {
      setIsPrinting(false);
    }
  };

  /** Tarayıcıdan PDF: 80mm önizleme aynen kullanılır (termal akış bozulmaz). */
  const handleBrowserPrint = () => {
    if (!thermalRef.current) return;
    const popup = window.open('', '_blank', 'width=420,height=720');
    if (!popup) return;
    popup.document.write(
      `<title>Fiş ${receipt?.fiscal_receipt_no ?? ''}</title><body style="margin:0;padding:12px">${thermalRef.current.innerHTML}</body>`,
    );
    popup.document.close();
    popup.focus();
    popup.print();
  };

  if (!receiptId) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-2xl p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Fiş detayı"
        className="relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-black/[0.08] dark:border-white/10 bg-white/95 dark:bg-[#1F2024]/95 backdrop-blur-3xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-black/[0.08] dark:border-white/10 px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-black/[0.08] dark:border-white/10 bg-black/[0.04] dark:bg-white/[0.06]">
              <ReceiptIcon size={18} />
            </span>
            <div>
              <h3 className="text-[15px] font-semibold dark:text-white text-zinc-900">Fiş Detayı</h3>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                {receipt
                  ? `${receipt.fiscal_receipt_no ?? receipt.id} · ${formatDateTime(receipt.created_at)}`
                  : 'Fiş yükleniyor'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fiş penceresini kapat"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-black/[0.05] dark:bg-white/[0.06] text-zinc-600 dark:text-zinc-300 hover:bg-black/[0.08] dark:hover:bg-white/[0.1] cursor-pointer"
          >
            <X size={16} />
          </button>
        </header>

        <div className="flex shrink-0 gap-1 px-6 pt-3">
          {([
            { id: 'DETAILS' as const, label: 'Sipariş & Kalemler', icon: FileText },
            { id: 'THERMAL' as const, label: '80mm Termal Önizleme', icon: Printer },
          ]).map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={
                  tab === item.id
                    ? 'flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-black/[0.07] dark:bg-white/[0.12] px-3 py-2 text-[11px] font-semibold text-zinc-900 dark:text-white'
                    : 'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-medium text-zinc-500 dark:text-zinc-400 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
                }
              >
                <Icon size={14} />
                {item.label}
              </button>
            );
          })}
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          {error && (
            <p role="alert" className="text-[12px] text-[#FF453A] dark:text-[#FF6B60]">
              {error}
            </p>
          )}

          {!error && !receipt && (
            <p className="text-[12px] text-zinc-500 dark:text-zinc-400">Fiş yükleniyor…</p>
          )}

          {receipt && tab === 'DETAILS' && (
            <>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                {[
                  { label: 'Masa', value: receipt.table_id || 'Belirtilmedi' },
                  { label: 'Kasiyer', value: receipt.cashier_name || '—' },
                  { label: 'Ödeme', value: receipt.payment_method },
                  { label: 'Fiş No', value: receipt.fiscal_receipt_no ?? receipt.id },
                ].map((cell) => (
                  <div
                    key={cell.label}
                    className="rounded-2xl border border-black/[0.06] dark:border-white/10 bg-black/[0.03] dark:bg-white/[0.03] p-3"
                  >
                    <span className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                      {cell.label}
                    </span>
                    <span className="block truncate text-[13px] font-semibold text-zinc-900 dark:text-white">
                      {cell.value}
                    </span>
                  </div>
                ))}
              </div>

              <div className="overflow-hidden rounded-2xl border border-black/[0.06] dark:border-white/10">
                <table className="w-full text-left text-[11px] text-zinc-700 dark:text-zinc-200">
                  <thead className="bg-black/[0.03] dark:bg-white/[0.04] text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                    <tr>
                      <th className="px-3 py-2">Ürün</th>
                      <th className="px-3 py-2 text-center">Adet</th>
                      <th className="px-3 py-2 text-right">Tutar</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/[0.04] dark:divide-white/[0.06]">
                    {receipt.items.length > 0 ? (
                      receipt.items.map((item, index) => (
                        <tr key={item.id || index}>
                          <td className="px-3 py-2">
                            <span className="font-medium">{item.product_name}</span>
                            {item.modifiers && item.modifiers.length > 0 && (
                              <span className="ml-1 text-[10px] text-zinc-500 dark:text-zinc-400">
                                (+ {item.modifiers.join(', ')})
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-center tabular-nums">{item.quantity}</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">
                            {formatCents(item.total_cents)}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={3} className="px-3 py-6 text-center text-zinc-500 dark:text-zinc-400">
                          Bu tahsilat için kalem kaydı yok. Yalnız tahsilat tutarı
                          geçerlidir.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="space-y-2 rounded-2xl border border-black/[0.06] dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.03] p-4 text-[12px]">
                {receipt.has_items ? (
                  <>
                    <div className="flex justify-between text-zinc-600 dark:text-zinc-300">
                      <span>Ara Toplam (Matrah)</span>
                      <span className="font-mono tabular-nums">{formatCents(receipt.subtotal_cents)}</span>
                    </div>
                    {receipt.discount_cents > 0 && (
                      <div className="flex justify-between text-[#30D158]">
                        <span className="flex items-center gap-1">
                          <Percent size={12} /> İndirim
                        </span>
                        <span className="font-mono tabular-nums">
                          -{formatCents(Math.abs(receipt.discount_cents))}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between text-zinc-600 dark:text-zinc-300">
                      <span>Hesaplanan KDV</span>
                      <span className="font-mono tabular-nums">{formatCents(receipt.tax_total_cents)}</span>
                    </div>
                  </>
                ) : (
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    Alt toplam ve KDV hesaplanmadı: kalem satırı yok. Oran
                    uydurularak tutar üretilmez.
                  </p>
                )}
                <div className="flex justify-between border-t border-black/[0.08] dark:border-white/10 pt-2 text-[13px] font-semibold text-zinc-900 dark:text-white">
                  <span>Genel Toplam</span>
                  <span className="font-mono tabular-nums">{formatCents(receipt.total_cents)}</span>
                </div>
                {receipt.tendered_cents != null && (
                  <div className="flex justify-between text-[11px] text-zinc-500 dark:text-zinc-400">
                    <span>Tahsil Edilen</span>
                    <span className="font-mono tabular-nums">{formatCents(receipt.tendered_cents)}</span>
                  </div>
                )}
              </div>

              {receipt.notes && (
                <p className="flex items-start gap-2 rounded-2xl border border-black/[0.06] dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.03] p-3 text-[11px] text-zinc-600 dark:text-zinc-300">
                  <Info size={14} className="mt-0.5 shrink-0 text-[#0A84FF]" />
                  <span>
                    <strong className="dark:text-white">Fiş notu:</strong> {receipt.notes}
                  </span>
                </p>
              )}
            </>
          )}

          {receipt && tab === 'THERMAL' && (
            <div className="flex justify-center">
              <div
                ref={thermalRef}
                className="w-full max-w-[360px] rounded-xl border border-gray-300 bg-white p-6 font-mono text-xs text-black shadow-2xl select-text"
                style={{ fontFamily: '"Courier New", Courier, monospace' }}
              >
                <div className="border-b border-dashed border-gray-400 pb-3 text-center">
                  <div className="text-base font-extrabold tracking-wider">KASAM360 RESTAURANT</div>
                  <div className="text-[11px] text-gray-700">MODERN ADİSYON & POS SİSTEMİ</div>
                </div>

                <div className="space-y-1 border-b border-dashed border-gray-400 py-2 text-[11px]">
                  <div className="flex justify-between">
                    <span>FİŞ NO:</span>
                    <span className="font-bold">{receipt.fiscal_receipt_no ?? receipt.id}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>TARİH:</span>
                    <span>{formatDateTime(receipt.created_at)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>MASA:</span>
                    <span className="font-bold">{receipt.table_id || 'Masa'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>KASİYER:</span>
                    <span>{receipt.cashier_name || 'Kasiyer'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>ÖDEME:</span>
                    <span className="font-bold uppercase">{receipt.payment_method}</span>
                  </div>
                </div>

                <div className="border-b border-dashed border-gray-400 py-2 text-[11px]">
                  {receipt.items.length > 0 ? (
                    receipt.items.map((item, index) => (
                      <div key={item.id || index} className="flex justify-between py-0.5">
                        <span className="w-1/2 truncate font-semibold">{item.product_name}</span>
                        <span className="w-1/6 text-center">{item.quantity}</span>
                        <span className="w-1/3 text-right">{formatCents(item.total_cents)}</span>
                      </div>
                    ))
                  ) : (
                    <div className="text-center text-[10px] text-gray-600">
                      KALEM KAYDI YOK
                    </div>
                  )}
                </div>

                <div className="space-y-1 border-b border-dashed border-gray-400 py-2 text-[11px]">
                  {receipt.has_items && (
                    <>
                      <div className="flex justify-between">
                        <span>ARA TOPLAM:</span>
                        <span>{formatCents(receipt.subtotal_cents)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>KDV TOPLAMI:</span>
                        <span>{formatCents(receipt.tax_total_cents)}</span>
                      </div>
                    </>
                  )}
                  <div className="flex justify-between border-t border-gray-400 pt-1 text-sm font-extrabold">
                    <span>TOPLAM:</span>
                    <span>{formatCents(receipt.total_cents)}</span>
                  </div>
                </div>

                <div className="pt-3 text-center">
                  <div className="text-[10px] font-bold text-gray-800">
                    MALİ DEĞERİ YOKTUR - BİLGİ FİŞİDİR
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-black/[0.08] dark:border-white/10 px-6 py-4">
          <button
            type="button"
            onClick={handleBrowserPrint}
            disabled={!receipt}
            className="flex items-center gap-1.5 rounded-xl border border-black/[0.08] dark:border-white/10 px-3 py-2 text-[11px] font-medium text-zinc-700 dark:text-zinc-200 disabled:opacity-40 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] cursor-pointer"
          >
            <Printer size={13} />
            Yazdır (PDF)
          </button>
          <button
            type="button"
            onClick={handleThermalPrint}
            disabled={!receipt || isPrinting}
            className="flex items-center gap-1.5 rounded-xl bg-[#0A84FF] dark:bg-[#007AFF] px-3.5 py-2 text-[11px] font-semibold text-white disabled:opacity-50 cursor-pointer"
          >
            <Printer size={13} />
            {isPrinting ? 'Gönderiliyor…' : 'Termal Fiş Yazdır'}
          </button>
        </footer>
      </div>
    </div>
  );
}