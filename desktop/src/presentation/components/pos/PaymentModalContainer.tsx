/**
 * PaymentModalContainer — Apple HIG ve Spatial Glass Ödeme Modalı Kapsayıcısı
 *
 * useCartStore ile PaymentModalPanel arasındaki köprüyü oluşturur.
 * Tuş takımı mantığı, tam tutar seçimi ve ödeme çağrısını yönetir.
 */

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { useCartStore } from '../../store/useCartStore';
import { useAuthStore } from '../../store/useAuthStore';
import { PaymentModalPanel } from './ui/PaymentModalPanel';
import InstantPinApprovalModal from '../cashier/InstantPinApprovalModal';
import { APPROVAL_OPERATIONS } from '../../../core/services/approvalService';

export function PaymentModalContainer(): JSX.Element | null {
  const isPaymentModalOpen = useCartStore((s) => s.isPaymentModalOpen);
  const setPaymentModalOpen = useCartStore((s) => s.setPaymentModalOpen);
  const processPayment = useCartStore((s) => s.processPayment);
  const isSubmitting = useCartStore((s) => s.isSubmitting);
  const navigate = useCartStore((s) => s.navigate);

  const getTotals = useCartStore((s) => s.getTotals);
  const totals = getTotals();

  const [tenderedAmount, setTenderedAmount] = useState<string>('');
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState<{
    method: 'CASH' | 'CREDIT_CARD';
    finalAmount: number;
  } | null>(null);

  useEffect(() => {
    if (isPaymentModalOpen) {
      // Modal açıldığında yerel tutarı ve hata durumunu sıfırla
      setTenderedAmount('');
      setPaymentError(null);
      setPendingApproval(null);
    }
  }, [isPaymentModalOpen]);

  // Sayısal tuş takımı ve banknot ekleme mantığı
  const handleNumpadPress = (value: string) => {
    setPaymentError(null);

    if (value === 'C') {
      setTenderedAmount('');
      return;
    }
    
    if (value.startsWith('PRESET_')) {
      const addVal = parseFloat(value.replace('PRESET_', '')) || 0;
      setTenderedAmount((prev) => {
        const curr = parseFloat(prev) || 0;
        const next = Math.round((curr + addVal) * 100) / 100;
        return next.toString();
      });
      return;
    }

    if (value === '.') {
      if (!tenderedAmount.includes('.')) {
        setTenderedAmount((prev) => (prev ? prev + '.' : '0.'));
      }
      return;
    }

    setTenderedAmount((prev) => {
      // Ondalık takip etmiyorsa baştaki tekil sıfırı değiştir
      if (prev === '0' && value !== '.') {
        return value;
      }
      
      // Kuruş basamağını 2 hane ile sınırla
      if (prev.includes('.')) {
        const [, decimal] = prev.split('.');
        if (decimal && decimal.length >= 2) return prev;
      }
      
      return prev + value;
    });
  };

  // Tam tutar butonu: Ödenecek toplam tutarı doğrudan aktarır
  const handleExactAmount = () => {
    setPaymentError(null);
    setTenderedAmount((totals.grandTotal / 100).toString());
  };

  const handleClose = () => {
    setPaymentModalOpen(false);
  };

  // Ödemeyi sunucuya ilet. Sepette indirim/ikram varsa onay penceresi açılır;
  // onaysız ödeme backend'de reddedilir (K2: her tutarda indirim onay ister).
  const settlePayment = async (
    method: 'CASH' | 'CREDIT_CARD',
    finalAmount: number,
    approvalToken?: string,
  ) => {
    const result = await processPayment(method, finalAmount, undefined, approvalToken);
    if (result.success) {
      toast.success('Ödeme başarıyla alındı.');
      setPaymentModalOpen(false);
      navigate('FLOOR');
    } else {
      const msg = result.message || 'Ödeme işlemi onaylanmadı.';
      setPaymentError(msg);
      toast.error(msg);
    }
  };

  const handleSubmitPayment = async (method: 'CASH' | 'CREDIT_CARD') => {
    let finalAmount = totals.grandTotal;

    if (method === 'CASH') {
      if (tenderedAmount) {
        const parsedAmount = parseFloat(tenderedAmount);
        finalAmount = Math.round(parsedAmount * 100);
      }

      if (finalAmount < totals.grandTotal) {
        setPaymentError('Alınan tutar toplam tutardan az olamaz.');
        return;
      }
    } else {
      // Kredi kartı ödemelerinde tahsil edilecek tutar daima net toplam tutardır
      finalAmount = totals.grandTotal;
    }

    if (totals.discountTotal > 0) {
      setPendingApproval({ method, finalAmount });
      return;
    }

    try {
      setPaymentError(null);
      await settlePayment(method, finalAmount);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Ödeme sırasında bir hata oluştu.';
      setPaymentError(msg);
      toast.error(msg);
    }
  };

  const user = useAuthStore((s) => s.user);
  // %100 indirim ikramdır: bu yüzden yüzey, tahsil edilecek tutardan türetilir.
  const approvalOperation =
    totals.grandTotal <= 0 ? APPROVAL_OPERATIONS.COMPLIMENTARY : APPROVAL_OPERATIONS.DISCOUNT;
  const approvalPercent =
    totals.grandTotal + totals.discountTotal > 0
      ? Math.round((totals.discountTotal / (totals.grandTotal + totals.discountTotal)) * 100)
      : 0;

  if (!isPaymentModalOpen) return null;

  return (
    <>
      <PaymentModalPanel
        isOpen={isPaymentModalOpen}
        totalAmount={totals.grandTotal}
        tenderedAmount={tenderedAmount}
        isSubmitting={isSubmitting}
        error={paymentError}
        onNumpadPress={handleNumpadPress}
        onClose={handleClose}
        onExactAmount={handleExactAmount}
        onSubmitPayment={handleSubmitPayment}
      />

      <InstantPinApprovalModal
        open={pendingApproval !== null}
        request={{
          operation: approvalOperation,
          resourceId: useCartStore.getState().customerRef ?? 'HIZLI_SATIS',
          actorId: user?.userId ?? 'CASHIER_01',
          actorRole: user?.role ?? 'CASHIER',
          amountCents: totals.discountTotal,
          discountPercent: approvalPercent,
          tenantId: user?.tenantId,
          terminalId: 'POS_MAIN_01',
        }}
        formatCents={(cents) =>
          `${(cents / 100).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺`
        }
        onApproved={async (approvalToken) => {
          const pending = pendingApproval;
          setPendingApproval(null);
          if (!pending) return;
          try {
            await settlePayment(pending.method, pending.finalAmount, approvalToken);
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : 'Ödeme sırasında bir hata oluştu.';
            setPaymentError(msg);
            toast.error(msg);
          }
        }}
        onCancel={() => setPendingApproval(null)}
      />
    </>
  );
}
