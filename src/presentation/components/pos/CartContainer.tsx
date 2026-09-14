/**
 * CartContainer — Akıllı Kapsayıcı (Smart Container) Bileşeni
 *
 * Zustand store'u CartPanel sunucu bileşenine bağlar.
 *
 * SORUMLULUKLAR:
 *  1. Ayrıntılı (granular) Zustand dilimlerine abone olmak (tüm store'u çekmez).
 *  2. Render anında getTotals() işlevini çağırmak — bu saf (pure) bir hesaplama işlevidir.
 *  3. Store eylemlerini CartPanel callback prop'larına bağlamak.
 *  4. SIFIR JSX render mantığı içeren <CartPanel /> bileşenine iletmek.
 *
 * KESİNLİKLE BULUNMAYAN ANTİ-PATTERNLER:
 *  - Düzen/stil kararları yok.
 *  - Sunucu (presenter) dışında herhangi bir şeyin koşullu render edilmesi yok.
 *  - Yerel durum (local state) yok (useState / useReducer).
 *  - Doğrudan DOM manipülasyonu yok.
 */

import { useCartStore } from '../../store/useCartStore';
import { useAuthStore } from '../../store/useAuthStore';
import { CartPanel } from './ui/CartPanel';


export function CartContainer(): JSX.Element {
  const user = useAuthStore(s => s.user);
  const isWaiter = user?.role === 'WAITER';

  // ── Ayrıntılı durum abonelikleri ──────────────────────────────────────────
  // Yeniden render işlemlerini en aza indirmek için her bir seçici bağımsız olarak abone olur.
  const items = useCartStore((s) => s.items);
  const selectedItemId = useCartStore((s) => s.selectedItemId);
  const isProcessingPayment = useCartStore((s) => s.isProcessingPayment);
  const isPaymentModalOpen = useCartStore((s) => s.isPaymentModalOpen);

  // getTotals kararlı (stable) bir işlev referansıdır — bunu burada çağırmak (bir
  // seçici içinde değil), bu kapsayıcının her render işleminde toplamları hesapladığımız
  // anlamına gelir ki bu doğrudur: öğelerdeki herhangi bir değişiklik zaten bu kapsayıcının
  // yeniden render edilmesini tetikler, bu nedenle aşırı abonelik olmadan her zaman güncel toplamları alırız.
  const getTotals = useCartStore((s) => s.getTotals);
  const totals = getTotals();

  // ── Eylem bağlayıcıları ────────────────────────────────────────────────────────
  const selectItem = useCartStore((s) => s.selectItem);
  const incrementQuantity = useCartStore((s) => s.incrementQuantity);
  const decrementQuantity = useCartStore((s) => s.decrementQuantity);
  const removeItem = useCartStore((s) => s.removeItem);
  const clearCart = useCartStore((s) => s.clearCart);
  const setPaymentModalOpen = useCartStore((s) => s.setPaymentModalOpen);
  const submitOrder = useCartStore((s) => s.submitOrder);
  const activeTableId = useCartStore((s) => s.activeTableId);
  // ── Geri çağırmalar (Callbacks) ─────────────────────────────────────────────────────────────

  function handleProcessPayment(): void {
    // Ödeme modalını aç; modal, tahsilat ayrıntılarını toplayacak
    // ve tam yük ile processPayment işlevini çağıracaktır.
    if (isPaymentModalOpen) return;
    setPaymentModalOpen(true);
  }

  // ── Render ────────────────────────────────────────────────────────────────
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
      hidePayment={isWaiter}
    />
  );
}
