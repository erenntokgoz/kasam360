/**
 * CartPanel — Sunum (Dumb) Bileşeni
 *
 * Tüm sağ panel sepet arayüzünü oluşturur: ürün listesi, ürün başı kontroller,
 * toplamlar özeti ve ödeme / temizleme eylem düğmeleri.
 *
 * SÖZLEŞME:
 *  - Tüm verileri ve geri çağırmaları (callback) prop olarak alır.
 *  - Zustand, repository'ler veya iş mantığı ile SIFIR içe aktarma içerir.
 *  - Her kullanıcı etkileşimi bir callback prop'u tetikler — ne yapılacağına
 *    kapsayıcı (container) karar verir.
 *
 * Düzen (yukarıdan → aşağıya):
 *  ┌─────────────────────────────────┐
 *  │  Başlık: "Sepet" + ürün sayısı  │  shrink-0
 *  ├─────────────────────────────────┤
 *  │  Ürün listesi (kaydırılabilir)  │  flex-1 overflow-y-auto
 *  ├─────────────────────────────────┤
 *  │  Toplamlar özeti                │  shrink-0
 *  ├─────────────────────────────────┤
 *  │  Eylem düğmeleri                │  shrink-0
 *  └─────────────────────────────────┘
 */

import { Minus, Plus, Trash2, ShoppingCart, CreditCard, X } from 'lucide-react';
import { Button } from '@core/components/ui/button';
import { ScrollArea } from '@core/components/ui/scroll-area';
import { MoneyDisplay } from '../../common/MoneyDisplay';
import type { CartItem, CartTotals, PaymentMethod } from '../../../types';

// Para birimi biçimlendirmesi MoneyDisplay tarafından işlenir

// ─── Prop sözleşmesi ───────────────────────────────────────────────────────────

export interface CartPanelProps {
  /** Mevcut sepet satır öğeleri */
  items: CartItem[];
  /** Önceden hesaplanmış toplu toplamlar — store tarafından hesaplanır, prop olarak geçirilir */
  totals: CartTotals;
  /** Şu anda seçili/vurgulanmış sepet satırının kimliği (ID) */
  selectedItemId: string | null;
  /** Bir ödeme işleminin devam edip etmediği (eylem düğmelerini devre dışı bırakır) */
  isProcessingPayment: boolean;

  // ── Öğe düzeyinde geri çağırmalar ──────────────────────────────────────────────────
  onSelectItem: (itemId: string | null) => void;
  onIncrementQuantity: (itemId: string) => void;
  onDecrementQuantity: (itemId: string) => void;
  onRemoveItem: (itemId: string) => void;

  // ── Sepet düzeyinde geri çağırmalar ──────────────────────────────────────────────────
  onClearCart: () => void;
  /** Ödeme akışını tetikler — kapsayıcı (container) ödeme modalını açacaktır */
  onProcessPayment: (method: PaymentMethod) => void;
  /** Ödeme yapmadan sipariş onayı akışını tetikler (aktif masalar için) */
  onSubmitOrder: () => void;
  /** Şu anda aktif bir masanın olup olmadığını belirtir (Siparişi Onayla düğmesini göstermek için) */
  isTableActive?: boolean;
  hidePayment?: boolean;
}

// ─── Alt bileşen: tek sepet satırı ──────────────────────────────────────────

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
      className={[
        'group relative flex cursor-pointer flex-col gap-1.5 border-b border-pos-border px-4 py-3 transition-colors',
        isSelected
          ? 'bg-pos-primary/10 border-l-2 border-l-pos-primary'
          : 'hover:bg-white/[0.03]',
      ].join(' ')}
    >
      {/* Product name + remove */}
      <div className="flex items-start justify-between gap-2">
        <span className="flex-1 text-sm font-medium leading-snug text-slate-100 line-clamp-2">
          {item.product.name}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label={`${item.product.name} ürününü kaldır`}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 opacity-0 transition-opacity hover:text-pos-danger hover:bg-pos-danger/10 group-hover:opacity-100 focus-visible:opacity-100"
        >
          <X size={16} />
        </button>
      </div>

      {/* Quantity controls + line total */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDecrement();
            }}
            aria-label="Miktarı azalt"
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-pos-border bg-pos-bg text-slate-400 transition-colors hover:border-pos-primary hover:text-pos-primary active:scale-95"
          >
            <Minus size={16} />
          </button>

          <span className="min-w-[3ch] text-center text-base font-bold tabular-nums text-slate-100">
            {item.quantity}
          </span>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onIncrement();
            }}
            aria-label="Miktarı artır"
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-pos-border bg-pos-bg text-slate-400 transition-colors hover:border-pos-primary hover:text-pos-primary active:scale-95"
          >
            <Plus size={16} />
          </button>
        </div>

        <div className="text-right">
          <span className="text-sm font-semibold tabular-nums text-slate-100">
            <MoneyDisplay amountInCents={item.total} />
          </span>
          {item.quantity > 1 && (
            <p className="text-xs tabular-nums text-slate-500">
              <MoneyDisplay amountInCents={item.unitPrice} /> / adet
            </p>
          )}
          {item.discount && item.discount.value > 0 && (
            <p className="text-xs text-pos-warning">
              -{item.discount.type === 'PERCENTAGE'
                ? `%${item.discount.value}`
                : <MoneyDisplay amountInCents={item.discount.value} />}
            </p>
          )}
        </div>
      </div>

      {/* İsteğe bağlı mutfak notu */}
      {item.note && (
        <p className="text-xs italic text-slate-500 line-clamp-1">
          Not: {item.note}
        </p>
      )}
    </div>
  );
}

// ─── Alt bileşen: boş durum ───────────────────────────────────────────────

function EmptyCart(): JSX.Element {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full border border-pos-border bg-pos-bg">
        <ShoppingCart size={24} className="text-slate-600" />
      </div>
      <p className="text-sm font-medium text-slate-500">Sepet boş</p>
      <p className="text-xs text-slate-600">Ürün eklemek için sol paneli kullanın</p>
    </div>
  );
}

// ─── Alt bileşen: toplamlar özeti ───────────────────────────────────────────

interface TotalsSummaryProps {
  totals: CartTotals;
}

function TotalsSummary({ totals }: TotalsSummaryProps): JSX.Element {
  return (
    <div className="border-t border-pos-border bg-pos-bg px-4 py-3 space-y-1.5">
      {/* Subtotal */}
      <div className="flex justify-between text-xs text-slate-500">
        <span>Ara Toplam</span>
        <span className="tabular-nums"><MoneyDisplay amountInCents={totals.subtotal} /></span>
      </div>

      {/* Tax */}
      <div className="flex justify-between text-xs text-slate-500">
        <span>KDV</span>
        <span className="tabular-nums"><MoneyDisplay amountInCents={totals.taxTotal} /></span>
      </div>

      {/* İndirim — sadece sıfırdan farklı olduğunda gösterilir */}
      {totals.discountTotal > 0 && (
        <div className="flex justify-between text-xs text-pos-warning">
          <span>İndirim</span>
          <span className="tabular-nums">-<MoneyDisplay amountInCents={totals.discountTotal} /></span>
        </div>
      )}

      {/* Divider */}
      <div className="border-t border-pos-border pt-1.5" />

      {/* Grand total */}
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-semibold text-slate-200">Toplam</span>
        <span className="text-xl font-bold tabular-nums text-slate-100">
          <MoneyDisplay amountInCents={totals.grandTotal} />
        </span>
      </div>
    </div>
  );
}

// ─── Kök bileşen ───────────────────────────────────────────────────────────

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
  hidePayment,
}: CartPanelProps): JSX.Element {
  const isEmpty = items.length === 0;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Başlık ─────────────────────────────────────────────────────── */}
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-pos-border px-4">
        <div className="flex items-center gap-2">
          <ShoppingCart size={16} className="text-slate-400" />
          <h2 className="text-sm font-semibold text-slate-200">Sepet</h2>
          {totals.itemCount > 0 && (
            <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-pos-primary px-1.5 text-[10px] font-bold text-white tabular-nums">
              {totals.itemCount}
            </span>
          )}
        </div>

        {/* Sepeti temizle — sadece sepette ürün olduğunda gösterilir */}
        {!isEmpty && (
          <button
            type="button"
            onClick={onClearCart}
            disabled={isProcessingPayment}
            aria-label="Sepeti temizle"
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-500 transition-colors hover:bg-pos-danger/10 hover:text-pos-danger disabled:pointer-events-none disabled:opacity-40"
          >
            <Trash2 size={12} />
            <span>Temizle</span>
          </button>
        )}
      </div>

      {/* ── Ürün listesi ──────────────────────────────────────────────────── */}
      <ScrollArea className="flex-1">
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

      {/* ── Toplamlar + eylemler — her zaman görünür ──────────────────────────── */}
      <div className="shrink-0">
        {!isEmpty && <TotalsSummary totals={totals} />}

        {/* Action buttons */}
        <div className="border-t border-pos-border p-3 space-y-2">
          {/* Siparişi Onayla (Garsonlar için her zaman görünür, masa yoksa pasif) */}
          {(isTableActive || hidePayment) && (
            <Button
              disabled={isEmpty || isProcessingPayment || !isTableActive}
              onClick={onSubmitOrder}
              className="h-12 w-full rounded-lg bg-pos-primary text-sm font-bold text-white transition-colors hover:bg-pos-primary-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              {!isTableActive ? (
                <span>Lütfen Masa Seçin</span>
              ) : isProcessingPayment ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  İşleniyor…
                </span>
              ) : (
                <span>Siparişi Onayla</span>
              )}
            </Button>
          )}

          {/* Birincil: ödeme al */}
          {!hidePayment && (
            <Button
              disabled={isEmpty || isProcessingPayment}
              onClick={() => onProcessPayment('CASH')}
              className="h-12 w-full rounded-lg bg-pos-success text-sm font-bold text-white transition-colors hover:bg-pos-success-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isProcessingPayment ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  İşleniyor…
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <CreditCard size={16} />
                  Ödeme Al&nbsp;
                  {!isEmpty && (
                    <span className="tabular-nums opacity-90">
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
