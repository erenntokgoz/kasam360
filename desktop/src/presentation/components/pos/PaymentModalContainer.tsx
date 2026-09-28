/**
 * PaymentModalContainer — Apple HIG ve Spatial Glass Ödeme Modalı Kapsayıcısı
 *
 * useCartStore ile PaymentModalPanel arasındaki köprüyü oluşturur.
 * Tuş takımı mantığı, tam tutar seçimi ve ödeme çağrısını yönetir.
 */

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { useCartStore } from '../../store/useCartStore';
import { PaymentModalPanel } from './ui/PaymentModalPanel';

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

  useEffect(() => {
    if (isPaymentModalOpen) {
      // Modal açıldığında yerel tutarı ve hata durumunu sıfırla
      setTenderedAmount('');
      setPaymentError(null);
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

  // Ödemeyi tamamlama ve sunucuya iletme
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

    try {
      setPaymentError(null);
      const result = await processPayment(method, finalAmount);
      if (result.success) {
        toast.success('Ödeme başarıyla alındı.');
        setPaymentModalOpen(false);
        navigate('FLOOR');
      } else {
        const msg = result.message || 'Ödeme işlemi onaylanmadı.';
        setPaymentError(msg);
        toast.error(msg);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Ödeme sırasında bir hata oluştu.';
      setPaymentError(msg);
      toast.error(msg);
    }
  };

  if (!isPaymentModalOpen) return null;

  return (
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
  );
}
