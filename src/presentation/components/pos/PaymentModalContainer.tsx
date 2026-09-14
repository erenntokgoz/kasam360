import { useState, useEffect } from 'react';
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

  useEffect(() => {
    if (isPaymentModalOpen) {
      // Modal açıldığında yerel durumu sıfırla
      setTenderedAmount('');
    }
  }, [isPaymentModalOpen]);

  const handleNumpadPress = (value: string) => {
    if (value === 'C') {
      setTenderedAmount('');
      return;
    }
    
    if (value.startsWith('PRESET_')) {
      const amount = value.replace('PRESET_', '');
      setTenderedAmount(amount);
      return;
    }

    if (value === '.') {
      if (!tenderedAmount.includes('.')) {
        setTenderedAmount((prev) => (prev ? prev + '.' : '0.'));
      }
      return;
    }

    setTenderedAmount((prev) => {
      // Ondalık izlemiyorsa baştaki sıfırları engelle
      if (prev === '0' && value !== '.') {
        return value;
      }
      
      // Ondalık basamakları 2 ile sınırla
      if (prev.includes('.')) {
        const [, decimal] = prev.split('.');
        if (decimal && decimal.length >= 2) return prev;
      }
      
      return prev + value;
    });
  };

  const handleExactAmount = () => {
    setTenderedAmount((totals.grandTotal / 100).toString());
  };

  const handleClose = () => {
    setPaymentModalOpen(false);
  };

  const handleSubmitPayment = async (method: 'CASH' | 'CREDIT_CARD') => {
    let finalAmount = totals.grandTotal;
    
    if (tenderedAmount) {
      const parsedAmount = parseFloat(tenderedAmount);
      finalAmount = Math.round(parsedAmount * 100);
    }

    if (finalAmount < totals.grandTotal) return;

    try {
      const result = await processPayment(method, finalAmount);
      if (result.success) {
        setPaymentModalOpen(false);
        navigate('FLOOR');
      } else {
        // Gerekirse hatayı işle, store lastPaymentResult'ı ayarlar
        console.error('Payment failed', result.message);
      }
    } catch (e) {
      console.error(e);
    }
  };

  if (!isPaymentModalOpen) return null;

  return (
    <PaymentModalPanel
      isOpen={isPaymentModalOpen}
      totalAmount={totals.grandTotal}
      tenderedAmount={tenderedAmount}
      isSubmitting={isSubmitting}
      onNumpadPress={handleNumpadPress}
      onClose={handleClose}
      onExactAmount={handleExactAmount}
      onSubmitPayment={handleSubmitPayment}
    />
  );
}
