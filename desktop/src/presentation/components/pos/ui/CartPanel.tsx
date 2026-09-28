/**
 * CartPanel — Apple HIG ve Spatial Glass Sepet Paneli (Sunum Bileşeni)
 *
 * Sağ tarafta konumlanan, temiz, lüks cam panel tasarımı.
 * Gereksiz açıklama metinleri barındırmaz, doğrudan net tipografi,
 * 1px hairline kenarlıklar ve Apple System Blue/Green eylemlerini kullanır.
 */

import { Minus, Plus, Trash2, ShoppingCart, CreditCard, X, Armchair } from 'lucide-react';
import { Button } from '@core/components/ui/button';
import { ScrollArea } from '@core/components/ui/scroll-area';
import { MoneyDisplay } from '../../common/MoneyDisplay';
import type { CartItem, CartTotals, PaymentMethod } from '../../../types';

// ─── Prop Sözleşmesi ──────────────────────────────────────────────────────────

export interface CartPanelProps {
  /** Mevcut sepet satır öğeleri */
  items: CartItem[];
  /** Önceden hesaplanmış toplu toplamlar */
  totals: CartTotals;
  /** Şu anda seçili/vurgulanmış sepet satırının kimliği (ID) */
  selectedItemId: string | null;
  /** Ödeme işleminin devam edip etmediği durumu */
  isProcessingPayment: boolean;

  // ── Öğe Düzeyinde Geri Çağırmalar ───────────────────────────────────────────
  onSelectItem: (itemId: string | null) => void;
  onIncrementQuantity: (itemId: string) => void;
  onDecrementQuantity: (itemId: string) => void;
  onRemoveItem: (itemId: string) => void;

  // ── Sepet Düzeyinde Geri Çağırmalar ─────────────────────────────────────────
  onClearCart: () => void;
  /** Ödeme akışını tetikler — kapsayıcı ödeme modalını açar */
  onProcessPayment: (method: PaymentMethod) => void;
  /** Masaya ait siparişi onaylama akışını tetikler */
  onSubmitOrder: () => void;
  /** Aktif masa seçimi olup olmadığı */
  isTableActive?: boolean;
  /** Aktif masa adı */
  activeTableName?: string;
  hidePayment?: boolean;
  /** Masa seçilmediğinde salon planına yönlendiren geri çağırma */
  onSelectTablePrompt?: () => void;
}

// ─── Alt Bileşen: Tekil Sepet Satırı ──────────────────────────────────────────

interface CartRowProps {
  item: CartItem;
  isSelected: boolean;
  onSelect: () => void;
  onIncrement: () => void;
  onDecrement: () => void;
  onRemove: () => void;
}

function CartRow({
  item,
  isSelected,
  onSelect,
  onIncrement,
  onDecrement,
  onRemove,
}: CartRowProps): JSX.Element {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onSelect();
      }}
      className={`group relative flex cursor-pointer flex-col gap-2.5 border-b dark:border-white/10 border-black/10 px-4 py-3.5 transition-all duration-150 border-l-2 ${
        isSelected
          ? 'dark:bg-white/[0.08] bg-black/[0.05] border-l-[#007AFF]'
          : 'border-l-transparent dark:hover:bg-white/[0.03] hover:bg-black/[0.02]'
      }`}
    >
      {/* Ürün İsmi + Silme Butonu */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <span className="text-sm font-semibold leading-snug dark:text-zinc-100 text-zinc-900 line-clamp-2 tracking-[-0.01em]">
            {item.product.name}
          </span>
          {/* Opsiyon / Modifier Listesi */}
          {item.modifiers && item.modifiers.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {item.modifiers.map((mod) => (
                <span
                  key={mod.id}
                  className="inline-flex items-center gap-1 rounded-md dark:bg-white/[0.06] bg-amber-500/10 border dark:border-white/10 border-amber-500/20 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-300"
                >
                  <span>+ {mod.name}</span>
                  {mod.priceCents > 0 && (
                    <span className="dark:text-zinc-400 text-zinc-500 font-mono">
                      (+{(mod.priceCents / 100).toFixed(2)} ₺)
                    </span>
                  )}
                </span>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label={`${item.product.name} ürününü kaldır`}
          className="flex h-8 w-8 min-h-[32px] min-w-[32px] shrink-0 items-center justify-center rounded-full dark:text-zinc-400 text-zinc-500 transition-all hover:text-[#FF453A] hover:bg-[#FF453A]/15 active:scale-90 touch-manipulation cursor-pointer"
        >
          <X size={16} />
        </button>
      </div>

      {/* Miktar Kontrolleri + Satır Tutarı */}
      <div className="flex items-center justify-between mt-0.5">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDecrement();
            }}
            aria-label="Miktarı azalt"
            className="flex h-9 w-9 min-h-[36px] min-w-[36px] items-center justify-center rounded-xl border dark:border-white/10 border-black/10 dark:bg-white/[0.05] bg-black/[0.04] dark:text-zinc-200 text-zinc-800 transition-all hover:border-[#007AFF]/50 hover:dark:bg-white/[0.1] hover:bg-black/[0.08] hover:dark:text-white hover:text-black active:scale-90 touch-manipulation cursor-pointer"
          >
            <Minus size={15} />
          </button>

          <span className="min-w-[2.5ch] text-center text-sm font-bold tabular-nums dark:text-white text-zinc-900">
            {item.quantity}
          </span>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onIncrement();
            }}
            aria-label="Miktarı artır"
            className="flex h-9 w-9 min-h-[36px] min-w-[36px] items-center justify-center rounded-xl border dark:border-white/10 border-black/10 dark:bg-white/[0.05] bg-black/[0.04] dark:text-zinc-200 text-zinc-800 transition-all hover:border-[#007AFF]/50 hover:dark:bg-white/[0.1] hover:bg-black/[0.08] hover:dark:text-white hover:text-black active:scale-90 touch-manipulation cursor-pointer"
          >
            <Plus size={15} />
          </button>
        </div>

        <div className="text-right">
          <span className="text-sm font-bold tabular-nums dark:text-white text-zinc-900 font-mono">
            <MoneyDisplay amountInCents={item.total} />
          </span>
          {item.quantity > 1 && (
            <p className="text-[11px] tabular-nums dark:text-zinc-400 text-zinc-500 font-mono">
              <MoneyDisplay amountInCents={item.unitPrice} /> / adet
            </p>
          )}
          {item.discount && item.discount.value > 0 && (
            <p className="text-xs font-semibold text-[#FF9F0A]">
              -{item.discount.type === 'PERCENTAGE'
                ? `%${item.discount.value}`
                : <MoneyDisplay amountInCents={item.discount.value} />}
            </p>
          )}
        </div>
      </div>

      {/* İsteğe Bağlı Mutfak Notu */}
      {item.note && (
        <p className="text-xs italic text-amber-600 dark:text-amber-300/80 line-clamp-1">
          Not: {item.note}
        </p>
      )}
    </div>
  );
}

// ─── Alt Bileşen: Boş Sepet Durumu (Minimal Apple HIG) ────────────────────────

function EmptyCart(): JSX.Element {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center py-20">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border dark:border-white/10 border-black/10 dark:bg-white/[0.03] bg-black/[0.03] backdrop-blur-md">
        <ShoppingCart size={22} className="dark:text-zinc-500 text-zinc-400" />
      </div>
      <p className="text-sm font-medium dark:text-zinc-500 text-zinc-600">Sepetiniz Boş</p>
    </div>
  );
}

// ─── Alt Bileşen: Toplamlar Özeti (Apple Spatial Glass) ────────────────────────

interface TotalsSummaryProps {
  totals: CartTotals;
}

function TotalsSummary({ totals }: TotalsSummaryProps): JSX.Element {
  return (
    <div className="border-t dark:border-white/10 border-black/10 dark:bg-black/20 bg-black/[0.02] backdrop-blur-xl px-5 py-3.5 space-y-2">
      {/* Ara Toplam */}
      <div className="flex justify-between text-xs dark:text-zinc-400 text-zinc-600 font-medium">
        <span>Ara Toplam</span>
        <span className="tabular-nums font-mono"><MoneyDisplay amountInCents={totals.subtotal} /></span>
      </div>

      {/* KDV */}
      <div className="flex justify-between text-xs dark:text-zinc-400 text-zinc-600 font-medium">
        <span>KDV</span>
        <span className="tabular-nums font-mono"><MoneyDisplay amountInCents={totals.taxTotal} /></span>
      </div>

      {/* İndirim — Sadece pozitifse gösterilir */}
      {totals.discountTotal > 0 && (
        <div className="flex justify-between text-xs text-[#FF9F0A] font-medium">
          <span>İndirim</span>
          <span className="tabular-nums font-mono">-<MoneyDisplay amountInCents={totals.discountTotal} /></span>
        </div>
      )}

      {/* 1px Hairline Ayırıcı */}
      <div className="border-t dark:border-white/10 border-black/10 pt-2" />

      {/* Genel Toplam */}
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-semibold dark:text-zinc-200 text-zinc-800">Toplam</span>
        <span className="text-2xl font-bold tabular-nums dark:text-white text-zinc-900 font-mono tracking-tight">
          <MoneyDisplay amountInCents={totals.grandTotal} />
        </span>
      </div>
    </div>
  );
}

// ─── Kök Bileşen ─────────────────────────────────────────────────────────────

export function CartPanel({
  items,
  totals,
  selectedItemId,
  isProcessingPayment,
  onSelectItem,
  onIncrementQuantity,
  onDecrementQuantity,
  onRemoveItem,
  onClearCart,
  onProcessPayment,
  onSubmitOrder,
  isTableActive,
  activeTableName,
  hidePayment,
  onSelectTablePrompt,
}: CartPanelProps): JSX.Element {
  const isEmpty = items.length === 0;

  return (
    <div className="flex h-full flex-col overflow-hidden dark:bg-[#1c1d22]/95 bg-white/80 backdrop-blur-2xl dark:text-zinc-100 text-zinc-900">
      {/* ── Başlık Çubuğu ─────────────────────────────────────────────── */}
      <div className="flex h-14 shrink-0 items-center justify-between border-b dark:border-white/10 border-black/10 px-4 dark:bg-white/[0.02] bg-black/[0.02]">
        <div className="flex items-center gap-2.5">
          <ShoppingCart size={17} className="dark:text-zinc-400 text-zinc-500" />
          <h2 className="text-sm font-semibold tracking-tight dark:text-white text-zinc-900">Sepet</h2>
          {totals.itemCount > 0 && (
            <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-[#007AFF] px-1.5 text-[10px] font-bold text-white tabular-nums shadow-sm">
              {totals.itemCount}
            </span>
          )}
          <span className="truncate max-w-[150px] rounded-xl dark:bg-white/[0.06] bg-black/[0.04] px-2.5 py-1 text-[11px] font-medium dark:text-zinc-300 text-zinc-700 border dark:border-white/10 border-black/10">
            {activeTableName ? `Masa: ${activeTableName}` : isTableActive ? 'Masa Seçili' : 'Tezgâh Satışı'}
          </span>
        </div>

        {/* Sepeti Temizle Butonu */}
        {!isEmpty && (
          <button
            type="button"
            onClick={onClearCart}
            disabled={isProcessingPayment}
            aria-label="Sepeti temizle"
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs dark:text-zinc-400 text-zinc-500 transition-all hover:bg-[#FF453A]/10 hover:text-[#FF453A] disabled:pointer-events-none disabled:opacity-40 active:scale-95 cursor-pointer"
          >
            <Trash2 size={13} />
            <span>Temizle</span>
          </button>
        )}
      </div>

      {/* ── Ürün Listesi ──────────────────────────────────────────────── */}
      <ScrollArea className="flex-1 min-h-0">
        {isEmpty ? (
          <EmptyCart />
        ) : (
          <div className="flex flex-col">
            {items.map((item) => (
              <CartRow
                key={item.id}
                item={item}
                isSelected={selectedItemId === item.id}
                onSelect={() => onSelectItem(item.id)}
                onIncrement={() => onIncrementQuantity(item.id)}
                onDecrement={() => onDecrementQuantity(item.id)}
                onRemove={() => onRemoveItem(item.id)}
              />
            ))}
          </div>
        )}
      </ScrollArea>

      {/* ── Toplamlar ve Eylem Butonları ──────────────────────────────── */}
      <div className="shrink-0">
        {!isEmpty && <TotalsSummary totals={totals} />}

        <div className="border-t dark:border-white/10 border-black/10 p-3.5 space-y-2.5 dark:bg-black/30 bg-white/70 backdrop-blur-xl">
          {/* Siparişi Onayla veya Masa Seçim Butonu */}
          {(isTableActive || hidePayment) && (
            <>
              {!isTableActive ? (
                <Button
                  type="button"
                  onClick={onSelectTablePrompt}
                  className="h-12 w-full rounded-2xl bg-[#FF9F0A] hover:bg-[#e08b07] text-sm font-bold text-white flex items-center justify-center gap-2 shadow-lg shadow-[#FF9F0A]/20 transition-all active:scale-[0.98] touch-manipulation border-0"
                >
                  <Armchair size={18} />
                  <span>Masa Seçmek İçin Dokunun</span>
                </Button>
              ) : (
                <Button
                  disabled={isEmpty || isProcessingPayment}
                  onClick={onSubmitOrder}
                  className="h-12 w-full rounded-2xl bg-[#007AFF] hover:bg-[#006ee6] text-sm font-bold text-white shadow-lg shadow-[#007AFF]/25 transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 border-0"
                >
                  {isProcessingPayment ? (
                    <span className="flex items-center gap-2">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      İşleniyor…
                    </span>
                  ) : (
                    <span>Siparişi Onayla</span>
                  )}
                </Button>
              )}
            </>
          )}

          {/* Ödeme Alma Butonu (Apple System Green) */}
          {!hidePayment && (
            <Button
              disabled={isEmpty || isProcessingPayment}
              onClick={() => onProcessPayment('CASH')}
              className="h-12 w-full rounded-2xl bg-[#34C759] hover:bg-[#30be55] text-sm font-bold text-white shadow-lg shadow-[#34C759]/25 transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 border-0"
            >
              {isProcessingPayment ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  İşleniyor…
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2 w-full">
                  <CreditCard size={17} />
                  <span>Ödeme Al</span>
                  {!isEmpty && (
                    <span className="tabular-nums font-mono opacity-90">
                      (<MoneyDisplay amountInCents={totals.grandTotal} />)
                    </span>
                  )}
                </span>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
