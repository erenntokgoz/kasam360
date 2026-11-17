import React, { useMemo, useState } from 'react';
import { Minus, Plus, Search } from 'lucide-react';
import { formatMoney } from '../../lib/formatMoney';
import { cartSubtotalCents, type PackageCartLine } from '../../lib/packageModel';
import { matchesProduct } from '../../lib/searchText';
import { usePosStore } from '../../stores/posStore';
import type { Product } from '../../types/pos';
import { Bar, BarTab } from '../../ui/Bar';
import { InlineAlert } from '../../ui/InlineAlert';

interface PackageProductPickerProps {
  lines: PackageCartLine[];
  onChange: (lines: PackageCartLine[]) => void;
}

/** Menüden ürün seçimi. Fiyatlar yalnız gösterim içindir; sunucu siparişte fiyatı kendisi hesaplar. */
export const PackageProductPicker: React.FC<PackageProductPickerProps> = ({ lines, onChange }) => {
  const categories = usePosStore((state) => state.categories);
  const products = usePosStore((state) => state.products);
  const loadModifierGroups = usePosStore((state) => state.loadModifierGroups);
  const [categoryId, setCategoryId] = useState('');
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const visible = useMemo(() => products.filter((product) => {
    if (query.trim()) return matchesProduct(query.trim(), product.name, product.barcode);
    return !categoryId || product.categoryId === categoryId;
  }), [products, categoryId, query]);

  const quantityOf = (productId: string) => lines.find((line) => line.productId === productId)?.quantity ?? 0;

  const add = async (product: Product) => {
    setNotice(null);
    // Seçenekli ürün bu ekranda seçeneksiz gönderilemez: zorunlu seçim atlanırdı.
    const groups = await loadModifierGroups(product.id);
    if (groups === null) {
      setNotice(`${product.name} için seçenekler okunamadı, ürün eklenmedi.`);
      return;
    }
    if (groups.length > 0) {
      setNotice(`${product.name} seçenek grubu taşıyor; paket siparişine şimdilik seçeneksiz ürünler eklenir.`);
      return;
    }
    const existing = lines.find((line) => line.productId === product.id);
    onChange(existing
      ? lines.map((line) => (line === existing ? { ...line, quantity: line.quantity + 1 } : line))
      : [...lines, { productId: product.id, name: product.name, unitPriceCents: product.unitPriceCents, quantity: 1, note: '' }]);
  };

  const change = (productId: string, delta: number) => {
    onChange(lines
      .map((line) => (line.productId === productId ? { ...line, quantity: line.quantity + delta } : line))
      .filter((line) => line.quantity > 0));
  };

  return (
    <div className="space-y-3">
      <Bar label="Kategoriler" plain actions={
        <label className="bar-search">
          <Search className="size-4 shrink-0" aria-hidden="true" />
          <input type="search" aria-label="Ürün ara" placeholder="Ürün ara" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
      }>
        <BarTab active={categoryId === ''} onClick={() => setCategoryId('')}>Tümü</BarTab>
        {categories.filter((category) => category.id !== 'cat_all').map((category) => (
          <BarTab key={category.id} active={categoryId === category.id} onClick={() => setCategoryId(category.id)}>{category.name}</BarTab>
        ))}
      </Bar>
      {notice ? <InlineAlert message={notice} onDismiss={() => setNotice(null)} /> : null}
      <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(min(100%,150px),1fr))]">
        {visible.map((product) => {
          const soldOut = !product.isAvailable;
          const quantity = quantityOf(product.id);
          return (
            <button
              key={product.id}
              type="button"
              disabled={soldOut}
              onClick={() => void add(product)}
              className="work-surface flex min-h-24 flex-col justify-between rounded-2xl border border-[var(--border)] p-3 text-left disabled:opacity-60"
            >
              <span className="line-clamp-2 font-bold leading-snug">{product.name}</span>
              <span className="flex items-center justify-between tabular-nums">
                {soldOut ? <span className="font-bold text-[var(--accent-red)]">Tükendi</span> : <span className="font-bold">{formatMoney(product.unitPriceCents)}</span>}
                {quantity > 0 ? <span className="rounded-full bg-[var(--brand)] px-2 text-sm font-bold text-[var(--button)]">{quantity}</span> : null}
              </span>
            </button>
          );
        })}
        {visible.length === 0 ? <p className="col-span-full py-6 text-center text-sm text-[var(--text-secondary)]">{query ? 'Aramayla eşleşen ürün yok.' : 'Bu kategoride ürün yok.'}</p> : null}
      </div>

      {lines.length > 0 ? (
        <ul className="divide-y rounded-lg border border-[var(--border)] px-3" aria-label="Sepet">
          {lines.map((line) => (
            <li key={line.productId} className="flex flex-wrap items-center gap-3 py-2">
              <span className="min-w-0 flex-1 font-semibold break-words">{line.name}</span>
              <span className="flex items-center gap-1">
                <button type="button" aria-label={`${line.name} azalt`} className="flex size-12 items-center justify-center rounded-full border border-[var(--border)]" onClick={() => change(line.productId, -1)}><Minus className="size-4" aria-hidden="true" /></button>
                <span className="w-8 text-center font-bold tabular-nums">{line.quantity}</span>
                <button type="button" aria-label={`${line.name} artır`} className="flex size-12 items-center justify-center rounded-full border border-[var(--border)]" onClick={() => change(line.productId, 1)}><Plus className="size-4" aria-hidden="true" /></button>
              </span>
              <span className="w-24 text-right font-bold tabular-nums">{formatMoney(line.unitPriceCents * line.quantity)}</span>
            </li>
          ))}
          <li className="flex justify-between py-2 font-bold tabular-nums"><span>Ürün toplamı</span><span>{formatMoney(cartSubtotalCents(lines))}</span></li>
        </ul>
      ) : null}
    </div>
  );
};
