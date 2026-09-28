/**
 * CartContainer — Apple HIG ve Spatial Glass Sepet Akıllı Kapsayıcısı (Smart Container)
 *
 * Zustand store'u CartPanel sunum bileşenine bağlar.
 *
 * Sorumluluklar:
 *  1. Ayrıntılı (granular) Zustand dilimlerine abone olmak.
 *  2. Render anında getTotals() işlevini çağırmak.
 *  3. Store eylemlerini CartPanel callback prop'larına bağlamak.
 *  4. SIFIR JSX render mantığı içeren CartPanel bileşenine iletmek.
 */

import { useCartStore } from '../../store/useCartStore';
import { useAuthStore } from '../../store/useAuthStore';
import { useFloorStore } from '../../store/useFloorStore';
import { CartPanel } from './ui/CartPanel';

export function CartContainer(): JSX.Element {
  const user = useAuthStore((s) => s.user);
  // Kasiyer ve İşletme Sahibi (Patron) doğrudan ödeme alabilir; Garson ve Müdür sadece siparişi masaya iletir
  const canTakePayment = ['CASHIER', 'OWNER'].includes(user?.role || '');

  // ── Ayrıntılı Durum Abonelikleri ──────────────────────────────────────────
  const items = useCartStore((s) => s.items);
  const selectedItemId = useCartStore((s) => s.selectedItemId);
  const isProcessingPayment = useCartStore((s) => s.isProcessingPayment);
  const isPaymentModalOpen = useCartStore((s) => s.isPaymentModalOpen);
  const navigate = useCartStore((s) => s.navigate);

  // Güncel toplam tutarlar
  const getTotals = useCartStore((s) => s.getTotals);
  const totals = getTotals();

  // ── Eylem Bağlayıcıları ────────────────────────────────────────────────────
  const selectItem = useCartStore((s) => s.selectItem);
  const incrementQuantity = useCartStore((s) => s.incrementQuantity);
  const decrementQuantity = useCartStore((s) => s.decrementQuantity);
  const removeItem = useCartStore((s) => s.removeItem);
  const clearCart = useCartStore((s) => s.clearCart);
  const setPaymentModalOpen = useCartStore((s) => s.setPaymentModalOpen);
  const submitOrder = useCartStore((s) => s.submitOrder);
  const activeTableId = useCartStore((s) => s.activeTableId);
  const tables = useFloorStore((s) => s.tables);
  const activeTableName = activeTableId ? tables.find((t) => t.id === activeTableId)?.name : undefined;

  // ── Geri Çağırmalar ────────────────────────────────────────────────────────
  function handleProcessPayment(): void {
    if (isPaymentModalOpen) return;
    setPaymentModalOpen(true);
  }

  // ── Sunum Bileşeni Render ──────────────────────────────────────────────────
  return (
    <CartPanel
      items={items}
      totals={totals}
      selectedItemId={selectedItemId}
      isProcessingPayment={isProcessingPayment}
      onSelectItem={selectItem}
      onIncrementQuantity={incrementQuantity}
      onDecrementQuantity={decrementQuantity}
      onRemoveItem={removeItem}
      onClearCart={clearCart}
      onProcessPayment={handleProcessPayment}
      onSubmitOrder={submitOrder}
      isTableActive={!!activeTableId}
      activeTableName={activeTableName}
      hidePayment={!canTakePayment}
      onSelectTablePrompt={() => navigate('FLOOR')}
    />
  );
}
