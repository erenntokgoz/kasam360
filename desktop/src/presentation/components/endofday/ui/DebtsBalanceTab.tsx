import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ArrowUpRight,
  ArrowDownLeft,
  CheckCircle2,
  DollarSign,
  X,
  RefreshCw,
} from 'lucide-react';
import { tauriInvoke } from '../../../../data/ipc/tauriInvoke';
import { toast } from '@core/components/ui/toast';

export interface DebtItem {
  id: string;
  tenantId: string;
  directoryId: string;
  directoryName?: string;
  type: 'GIVEN' | 'TAKEN';
  totalAmountCents: number;
  remainingAmountCents: number;
  dueDate?: string;
  status: 'PENDING' | 'PARTIAL' | 'PAID' | 'OVERDUE';
  isCash: boolean;
  orderId?: string;
  description?: string;
  createdAt: string;
}

/**
 * Borç & Alacak Net Bilanço Görünümü.
 * Sol Kolon Yeşil (Tahsil Edilecek Alacaklar) vs
 * Sağ Kolon Kırmızı (Ödenecek Tedarikçi Borçları) dengesini kurar.
 */
export const DebtsBalanceTab: React.FC = () => {
  const [debts, setDebts] = useState<DebtItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Ödeme/Tahsilat Modalı Durumları
  const [selectedDebt, setSelectedDebt] = useState<DebtItem | null>(null);
  const [payAmountStr, setPayAmountStr] = useState('');
  const [payMethod, setPayMethod] = useState<'CASH' | 'BANK_TRANSFER' | 'CREDIT_CARD'>('CASH');
  const [payNotes, setPayNotes] = useState('');
  const [isSubmittingPay, setIsSubmittingPay] = useState(false);

  // Bildirim yöneticisi
  const showToast = (title: string, type: 'success' | 'error' | 'info' = 'info') => {
    try {
      toast.add({ title, type });
    } catch {
      console.log(`[${type}] ${title}`);
    }
  };

  const fetchDebts = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await tauriInvoke<DebtItem[]>('get_debts', {});
      setDebts(Array.isArray(data) ? data : []);
    } catch (err) {
      showToast('Borç/Alacak kayıtları yüklenemedi', 'error');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDebts();
  }, [fetchDebts]);

  const receivables = useMemo(() => {
    return debts.filter((d) => d.type === 'GIVEN' && d.status !== 'PAID');
  }, [debts]);

  const payables = useMemo(() => {
    return debts.filter((d) => d.type === 'TAKEN' && d.status !== 'PAID');
  }, [debts]);

  const totalReceivablesCents = useMemo(() => {
    return receivables.reduce((sum, d) => sum + d.remainingAmountCents, 0);
  }, [receivables]);

  const totalPayablesCents = useMemo(() => {
    return payables.reduce((sum, d) => sum + d.remainingAmountCents, 0);
  }, [payables]);

  const netBalanceCents = totalReceivablesCents - totalPayablesCents;

  const handlePaySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDebt) return;

    const val = parseFloat(payAmountStr.replace(',', '.'));
    if (isNaN(val) || val <= 0) {
      showToast('Geçerli bir ödeme tutarı giriniz', 'error');
      return;
    }

    const cents = Math.round(val * 100);
    if (cents > selectedDebt.remainingAmountCents) {
      showToast('Ödeme tutarı kalan borçtan fazla olamaz', 'error');
      return;
    }

    setIsSubmittingPay(true);
    try {
      await tauriInvoke('pay_debt', {
        payload: {
          debtId: selectedDebt.id,
          amountCents: cents,
          paymentMethod: payMethod,
          actorId: 'Yetkili',
          notes: payNotes.trim() || undefined,
        },
      });
      showToast(
        selectedDebt.type === 'GIVEN'
          ? 'Alacak tahsilatı kaydedildi (Kasaya işlendi)'
          : 'Borç ödemesi kaydedildi',
        'success'
      );
      setSelectedDebt(null);
      setPayAmountStr('');
      setPayNotes('');
      fetchDebts();
    } catch (err) {
      showToast(typeof err === 'string' ? err : 'Ödeme işlenemedi', 'error');
    } finally {
      setIsSubmittingPay(false);
    }
  };

  const formatMoney = (cents: number) => {
    const liras = cents / 100;
    return new Intl.NumberFormat('tr-TR', {
      style: 'currency',
      currency: 'TRY',
      minimumFractionDigits: 2,
    }).format(liras);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12 text-sm text-zinc-400">
        <RefreshCw size={24} className="animate-spin mr-2" />
        <span>Bilanço hesaplanıyor...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Net Bilanço Skor Kartı */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Toplam Alacaklar */}
        <div className="backdrop-blur-xl dark:bg-emerald-950/20 bg-emerald-500/10 border border-emerald-500/30 rounded-3xl p-5 shadow-xl apple-specular">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
              Toplam Alacaklar (Günün Alacağı)
            </span>
            <div className="p-2 rounded-xl bg-emerald-500/15 text-emerald-500">
              <ArrowUpRight size={18} />
            </div>
          </div>
          <p className="text-2xl md:text-3xl font-bold font-mono text-emerald-600 dark:text-emerald-400 tabular-nums">
            {formatMoney(totalReceivablesCents)}
          </p>
          <p className="text-[11px] text-emerald-700 dark:text-emerald-300/70 mt-1">
            {receivables.length} aktif veresiye & alacak
          </p>
        </div>

        {/* Toplam Borçlar */}
        <div className="backdrop-blur-xl dark:bg-rose-950/20 bg-rose-500/10 border border-rose-500/30 rounded-3xl p-5 shadow-xl apple-specular">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-rose-600 dark:text-rose-400">
              Toplam Borçlar (Tedarikçi & Gider)
            </span>
            <div className="p-2 rounded-xl bg-rose-500/15 text-rose-500">
              <ArrowDownLeft size={18} />
            </div>
          </div>
          <p className="text-2xl md:text-3xl font-bold font-mono text-rose-600 dark:text-rose-400 tabular-nums">
            {formatMoney(totalPayablesCents)}
          </p>
          <p className="text-[11px] text-rose-700 dark:text-rose-300/70 mt-1">
            {payables.length} bekleyen ödeme fişi
          </p>
        </div>

        {/* Net Likidite & Cari Pozisyon */}
        <div className={`backdrop-blur-xl border rounded-3xl p-5 shadow-xl apple-specular ${
          netBalanceCents >= 0
            ? 'dark:bg-white/[0.04] bg-white/75 dark:border-white/10 border-black/10'
            : 'dark:bg-amber-950/20 bg-amber-500/10 border-amber-500/30'
        }`}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider dark:text-zinc-400 text-zinc-600">
              Net Bilanço Pozisyonu
            </span>
            <div className={`p-2 rounded-xl ${netBalanceCents >= 0 ? 'bg-[#007AFF]/15 text-[#007AFF]' : 'bg-amber-500/15 text-amber-500'}`}>
              <DollarSign size={18} />
            </div>
          </div>
          <p className={`text-2xl md:text-3xl font-bold font-mono tabular-nums ${
            netBalanceCents >= 0 ? 'text-[#007AFF] dark:text-[#0A84FF]' : 'text-amber-500'
          }`}>
            {formatMoney(netBalanceCents)}
          </p>
          <p className="text-[11px] dark:text-zinc-500 text-zinc-500 mt-1">
            {netBalanceCents >= 0 ? 'Pozitif Cari Denge (Alacaklı)' : 'Negatif Cari Denge (Ödeme Gerekli)'}
          </p>
        </div>
      </div>

      {/* İkili Bilanço Kolonları: Sol Yeşil (Alacaklar) vs Sağ Kırmızı (Borçlar) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* SOL: ALACAKLAR */}
        <div className="space-y-3">
          <div className="flex items-center justify-between px-2">
            <h4 className="text-sm font-bold tracking-tight text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
              <span>Tahsil Edilecek Alacaklar ({receivables.length})</span>
            </h4>
          </div>

          <div className="space-y-3">
            {receivables.length === 0 ? (
              <div className="p-8 text-center dark:bg-white/[0.02] bg-black/[0.02] rounded-3xl border dark:border-white/10 border-black/10 text-xs dark:text-zinc-500 text-zinc-500">
                Tahsil edilecek açık alacak bulunmuyor.
              </div>
            ) : (
              receivables.map((debt) => (
                <div
                  key={debt.id}
                  className="backdrop-blur-xl dark:bg-emerald-950/10 bg-emerald-500/[0.04] border border-emerald-500/20 rounded-2xl p-4 shadow-md flex items-center justify-between gap-4 transition-all hover:border-emerald-500/40"
                >
                  <div>
                    <h5 className="text-sm font-bold dark:text-white text-zinc-900">
                      {debt.directoryName || 'Kayıtlı Müşteri'}
                    </h5>
                    <p className="text-xs dark:text-zinc-400 text-zinc-600 mt-0.5">
                      {debt.description || 'Veresiye adisyon alacağı'}
                    </p>
                    <span className="text-[10px] font-mono text-zinc-500">
                      {new Date(debt.createdAt).toLocaleDateString('tr-TR')}
                    </span>
                  </div>

                  <div className="text-right shrink-0">
                    <div className="text-sm font-bold font-mono text-emerald-500 tabular-nums">
                      {formatMoney(debt.remainingAmountCents)}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedDebt(debt);
                        setPayAmountStr((debt.remainingAmountCents / 100).toFixed(2));
                      }}
                      className="mt-1.5 px-3 py-1 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-xs font-semibold transition-all active:scale-95 cursor-pointer"
                    >
                      Tahsil Et
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* SAĞ: BORÇLAR */}
        <div className="space-y-3">
          <div className="flex items-center justify-between px-2">
            <h4 className="text-sm font-bold tracking-tight text-rose-600 dark:text-rose-400 flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.6)]" />
              <span>Ödenecek Borçlar ({payables.length})</span>
            </h4>
          </div>

          <div className="space-y-3">
            {payables.length === 0 ? (
              <div className="p-8 text-center dark:bg-white/[0.02] bg-black/[0.02] rounded-3xl border dark:border-white/10 border-black/10 text-xs dark:text-zinc-500 text-zinc-500">
                Bekleyen tedarikçi borcu bulunmuyor.
              </div>
            ) : (
              payables.map((debt) => (
                <div
                  key={debt.id}
                  className="backdrop-blur-xl dark:bg-rose-950/10 bg-rose-500/[0.04] border border-rose-500/20 rounded-2xl p-4 shadow-md flex items-center justify-between gap-4 transition-all hover:border-rose-500/40"
                >
                  <div>
                    <h5 className="text-sm font-bold dark:text-white text-zinc-900">
                      {debt.directoryName || 'Tedarikçi Firma'}
                    </h5>
                    <p className="text-xs dark:text-zinc-400 text-zinc-600 mt-0.5">
                      {debt.description || 'Mal alım faturası'}
                    </p>
                    <span className="text-[10px] font-mono text-zinc-500">
                      {new Date(debt.createdAt).toLocaleDateString('tr-TR')}
                    </span>
                  </div>

                  <div className="text-right shrink-0">
                    <div className="text-sm font-bold font-mono text-rose-500 tabular-nums">
                      {formatMoney(debt.remainingAmountCents)}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedDebt(debt);
                        setPayAmountStr((debt.remainingAmountCents / 100).toFixed(2));
                      }}
                      className="mt-1.5 px-3 py-1 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs font-semibold transition-all active:scale-95 cursor-pointer"
                    >
                      Ödeme Yap
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Tahsilat / Ödeme Modalı */}
      {selectedDebt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-150">
          <div className="relative w-full max-w-md rounded-3xl dark:bg-[#121318]/90 bg-white/95 border dark:border-white/10 border-black/10 p-6 shadow-2xl backdrop-blur-2xl apple-specular animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between pb-3 mb-4 border-b dark:border-white/10 border-black/10">
              <h3 className="text-base font-semibold dark:text-white text-zinc-900">
                {selectedDebt.type === 'GIVEN' ? 'Alacak Tahsilatı' : 'Borç Ödeme Fişi'}
              </h3>
              <button
                type="button"
                onClick={() => setSelectedDebt(null)}
                className="p-1 rounded-full dark:text-zinc-400 text-zinc-600 hover:dark:text-white hover:text-black"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-3.5 mb-4 rounded-2xl dark:bg-white/[0.04] bg-black/[0.03] border dark:border-white/5 border-black/5 text-xs">
              <div className="flex justify-between">
                <span className="dark:text-zinc-400 text-zinc-600">Cari:</span>
                <span className="font-semibold dark:text-white text-zinc-900">{selectedDebt.directoryName}</span>
              </div>
              <div className="flex justify-between mt-1">
                <span className="dark:text-zinc-400 text-zinc-600">Toplam Borç:</span>
                <span className="font-mono">{formatMoney(selectedDebt.totalAmountCents)}</span>
              </div>
              <div className="flex justify-between mt-1">
                <span className="dark:text-zinc-400 text-zinc-600">Kalan Bakiye:</span>
                <span className="font-mono font-bold text-amber-500">{formatMoney(selectedDebt.remainingAmountCents)}</span>
              </div>
            </div>

            <form onSubmit={handlePaySubmit} className="space-y-4">
              <div>
                <label className="block mb-1 text-xs font-semibold uppercase tracking-wider dark:text-zinc-400 text-zinc-600">
                  Ödenecek / Tahsil Edilecek Tutar (₺)
                </label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={payAmountStr}
                  onChange={(e) => setPayAmountStr(e.target.value)}
                  className="w-full h-11 px-3 rounded-xl border dark:border-white/10 border-black/10 dark:bg-black/30 bg-black/[0.04] dark:text-white text-zinc-900 font-mono text-base font-bold focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40"
                />
              </div>

              <div>
                <label className="block mb-1 text-xs font-semibold uppercase tracking-wider dark:text-zinc-400 text-zinc-600">
                  Ödeme Yöntemi
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setPayMethod('CASH')}
                    className={`py-2 px-3 rounded-xl text-xs font-semibold border transition-all ${
                      payMethod === 'CASH'
                        ? 'dark:bg-white/20 bg-black text-white border-transparent shadow-sm'
                        : 'dark:bg-white/[0.04] bg-black/[0.04] dark:text-zinc-400 text-zinc-600 dark:border-white/10 border-black/10'
                    }`}
                  >
                    Nakit Kasa
                  </button>
                  <button
                    type="button"
                    onClick={() => setPayMethod('BANK_TRANSFER')}
                    className={`py-2 px-3 rounded-xl text-xs font-semibold border transition-all ${
                      payMethod === 'BANK_TRANSFER'
                        ? 'dark:bg-white/20 bg-black text-white border-transparent shadow-sm'
                        : 'dark:bg-white/[0.04] bg-black/[0.04] dark:text-zinc-400 text-zinc-600 dark:border-white/10 border-black/10'
                    }`}
                  >
                    Havale / EFT
                  </button>
                  <button
                    type="button"
                    onClick={() => setPayMethod('CREDIT_CARD')}
                    className={`py-2 px-3 rounded-xl text-xs font-semibold border transition-all ${
                      payMethod === 'CREDIT_CARD'
                        ? 'dark:bg-white/20 bg-black text-white border-transparent shadow-sm'
                        : 'dark:bg-white/[0.04] bg-black/[0.04] dark:text-zinc-400 text-zinc-600 dark:border-white/10 border-black/10'
                    }`}
                  >
                    Banka Kartı
                  </button>
                </div>
              </div>

              <div>
                <label className="block mb-1 text-xs font-semibold uppercase tracking-wider dark:text-zinc-400 text-zinc-600">
                  Makbuz / Not
                </label>
                <input
                  type="text"
                  value={payNotes}
                  onChange={(e) => setPayNotes(e.target.value)}
                  placeholder="İşlem no veya açıklama..."
                  className="w-full h-10 px-3 rounded-xl border dark:border-white/10 border-black/10 dark:bg-black/30 bg-black/[0.04] dark:text-white text-zinc-900 text-xs focus:outline-none"
                />
              </div>

              <div className="pt-2 flex gap-3">
                <button
                  type="button"
                  onClick={() => setSelectedDebt(null)}
                  className="flex-1 h-11 rounded-2xl dark:bg-white/[0.06] bg-black/[0.05] text-xs font-semibold dark:text-white text-zinc-800"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingPay}
                  className="flex-1 h-11 rounded-2xl bg-[#007AFF] hover:bg-[#0071E3] text-white text-xs font-semibold shadow-md flex items-center justify-center gap-1.5"
                >
                  <CheckCircle2 size={16} />
                  <span>{isSubmittingPay ? 'İşleniyor...' : 'Onayla'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
