/**
 * PaymentModalPanel — Apple HIG ve Spatial Glass Ödeme Modalı
 *
 * Apple Pay zarafetinde, büyük ve net tutar göstergeli, dokunmatik uyumlu
 * pürüzsüz butonlara ve sayısal tuş takımına sahip ödeme modalı.
 */

import React from 'react';
import { X, AlertCircle, CreditCard, Banknote } from 'lucide-react';
import { useModalA11y } from '../../../hooks/useModalA11y';

export interface PaymentModalPanelProps {
  isOpen: boolean;
  totalAmount: number;
  tenderedAmount: string;
  isSubmitting: boolean;
  error?: string | null;
  onNumpadPress: (value: string) => void;
  onClose: () => void;
  onExactAmount: () => void;
  onSubmitPayment: (method: 'CASH' | 'CREDIT_CARD') => void;
}

const PRESET_AMOUNTS = [10, 20, 50, 100, 200];

export function PaymentModalPanel({
  isOpen,
  totalAmount,
  tenderedAmount,
  isSubmitting,
  error,
  onNumpadPress,
  onClose,
  onExactAmount,
  onSubmitPayment,
}: PaymentModalPanelProps): JSX.Element | null {
  const { modalRef, handleBackdropClick } = useModalA11y({
    isOpen,
    onClose,
  });

  if (!isOpen) return null;

  const parsedTenderedCents = Math.round((parseFloat(tenderedAmount) || 0) * 100);
  const changeAmountCents = Math.max(0, parsedTenderedCents - totalAmount);

  // Tuş takımı butonu alt bileşeni
  const NumpadButton = ({
    label,
    onClick,
    className = '',
  }: {
    label: React.ReactNode;
    onClick: () => void;
    className?: string;
  }) => (
    <button
      type="button"
      onClick={onClick}
      disabled={isSubmitting}
      className={`h-14 sm:h-16 w-full rounded-2xl dark:bg-white/[0.06] bg-black/[0.04] dark:hover:bg-white/[0.1] hover:bg-black/[0.08] text-2xl font-semibold dark:text-zinc-100 text-zinc-800 border dark:border-white/10 border-black/[0.08] shadow-sm touch-manipulation active:scale-90 disabled:opacity-40 transition-all flex items-center justify-center ${className}`}
    >
      {label}
    </button>
  );

  return (
    <div
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/75 backdrop-blur-2xl p-4 sm:p-6 animate-in fade-in duration-200"
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-modal-title"
        className="flex flex-col md:flex-row w-full max-w-5xl h-auto max-h-[92vh] md:h-[620px] backdrop-blur-3xl dark:bg-[#121318]/95 bg-white/95 rounded-[32px] overflow-hidden shadow-[0_24px_80px_rgba(0,0,0,0.2)] dark:shadow-[0_24px_80px_rgba(0,0,0,0.65)] border dark:border-white/10 border-black/[0.08] animate-in zoom-in-95 duration-200"
      >
        {/* ── Sol Taraf: Sipariş Özeti ve Apple Pay Ödeme Düğmeleri ───── */}
        <div className="flex-1 p-6 md:p-8 flex flex-col justify-between border-b md:border-b-0 md:border-r dark:border-white/10 border-black/[0.08] dark:bg-white/[0.02] bg-black/[0.02] overflow-y-auto">
          <div>
            {/* Başlık ve Kapat Butonu */}
            <div className="flex justify-between items-start mb-6">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl dark:bg-white/10 bg-black/[0.06] border dark:border-white/10 border-black/[0.08] dark:text-white text-zinc-900">
                  <CreditCard size={20} />
                </div>
                <h2 id="payment-modal-title" className="text-2xl font-bold tracking-tight dark:text-white text-zinc-900">
                  Ödeme
                </h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                aria-label="Kapat"
                className="flex h-10 w-10 items-center justify-center rounded-full dark:bg-white/10 bg-black/[0.06] dark:hover:bg-white/15 hover:bg-black/10 dark:text-zinc-400 text-zinc-600 dark:hover:text-white hover:text-zinc-900 transition-all active:scale-90"
              >
                <X size={20} />
              </button>
            </div>

            {/* Hata Bildirimi */}
            {error && (
              <div className="mb-5 flex items-center gap-2.5 rounded-2xl bg-[#FF453A]/15 border border-[#FF453A]/30 p-3.5 text-[#FF453A] text-sm animate-shake">
                <AlertCircle size={18} className="shrink-0 text-[#FF453A]" />
                <span className="font-semibold">{error}</span>
              </div>
            )}

            {/* Büyük Net Tutar Göstergeleri */}
            <div className="space-y-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider dark:text-zinc-400 text-zinc-500 mb-1">
                  Ödenecek Tutar
                </p>
                <p className="text-5xl lg:text-6xl font-extrabold tracking-tight dark:text-white text-zinc-900 font-mono">
                  {(totalAmount / 100).toFixed(2)} ₺
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-2">
                <div className="rounded-2xl dark:bg-white/[0.04] bg-white/80 border dark:border-white/10 border-black/[0.08] p-4 backdrop-blur-md shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-wider dark:text-zinc-400 text-zinc-500 mb-1">
                    Alınan Tutar
                  </p>
                  <p className="text-2xl font-bold font-mono tracking-tight text-[#007AFF]">
                    {tenderedAmount ? `${tenderedAmount} ₺` : '0.00 ₺'}
                  </p>
                </div>

                <div className="rounded-2xl dark:bg-white/[0.04] bg-white/80 border dark:border-white/10 border-black/[0.08] p-4 backdrop-blur-md shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-wider dark:text-zinc-400 text-zinc-500 mb-1">
                    Para Üstü
                  </p>
                  <p className="text-2xl font-bold font-mono tracking-tight text-[#34C759]">
                    {(changeAmountCents / 100).toFixed(2)} ₺
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Ödeme Tamamlama Butonları (Apple Pay Tarzı) */}
          <div className="grid grid-cols-2 gap-4 mt-6">
            <button
              type="button"
              onClick={() => onSubmitPayment('CASH')}
              disabled={isSubmitting || (parsedTenderedCents > 0 && parsedTenderedCents < totalAmount)}
              className="py-4 rounded-2xl bg-[#34C759] hover:bg-[#30be55] text-white text-base font-bold shadow-lg shadow-[#34C759]/25 touch-manipulation active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100 transition-all flex items-center justify-center gap-2.5 border-0"
            >
              {isSubmitting ? (
                <>
                  <span className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  <span>İşleniyor…</span>
                </>
              ) : (
                <>
                  <Banknote size={20} />
                  <span>Nakit Ödeme</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => onSubmitPayment('CREDIT_CARD')}
              disabled={isSubmitting}
              className="py-4 rounded-2xl bg-[#007AFF] hover:bg-[#0071eb] text-white text-base font-bold shadow-lg shadow-[#007AFF]/25 touch-manipulation active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100 transition-all flex items-center justify-center gap-2.5 border-0"
            >
              {isSubmitting ? (
                <>
                  <span className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  <span>İşleniyor…</span>
                </>
              ) : (
                <>
                  <CreditCard size={20} />
                  <span>Kredi Kartı</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* ── Sağ Taraf: Hızlı Banknotlar ve Sayısal Tuş Takımı ────────── */}
        <div className="w-full md:w-[440px] p-6 flex flex-col justify-between dark:bg-white/[0.02] bg-black/[0.01] backdrop-blur-xl overflow-y-auto">
          <div>
            <div className="text-xs font-semibold dark:text-zinc-400 text-zinc-500 mb-2 uppercase tracking-wider">
              Hızlı Banknotlar (Eklemeli)
            </div>
            <div className="grid grid-cols-5 gap-2 mb-3">
              {PRESET_AMOUNTS.map((amount) => (
                <button
                  key={amount}
                  type="button"
                  onClick={() => onNumpadPress(`PRESET_${amount}`)}
                  disabled={isSubmitting}
                  className="h-12 rounded-xl dark:bg-white/[0.05] bg-white hover:dark:bg-white/[0.1] hover:bg-zinc-100 text-sm font-bold text-[#34C759] border dark:border-white/10 border-black/[0.08] shadow-sm touch-manipulation active:scale-95 disabled:opacity-40 transition-all"
                >
                  +{amount}₺
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={onExactAmount}
              disabled={isSubmitting}
              className="h-11 w-full mb-5 rounded-xl dark:bg-white/[0.08] bg-black/[0.06] hover:dark:bg-white/[0.12] hover:bg-black/[0.1] text-sm font-bold dark:text-white text-zinc-900 border dark:border-white/10 border-black/[0.08] shadow-sm touch-manipulation active:scale-[0.98] disabled:opacity-40 transition-all"
            >
              Tam Tutar ({(totalAmount / 100).toFixed(2)} ₺)
            </button>
          </div>

          <div className="flex justify-center pb-2 w-full">
            <div className="grid grid-cols-3 gap-3 w-full max-w-[320px]">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((num) => (
                <NumpadButton key={num} label={num} onClick={() => onNumpadPress(num)} />
              ))}
              <NumpadButton
                label="C"
                onClick={() => onNumpadPress('C')}
                className="bg-[#FF453A]/15 hover:bg-[#FF453A]/25 text-[#FF453A] border-[#FF453A]/30 font-bold"
              />
              <NumpadButton label="0" onClick={() => onNumpadPress('0')} />
              <NumpadButton label="." onClick={() => onNumpadPress('.')} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
