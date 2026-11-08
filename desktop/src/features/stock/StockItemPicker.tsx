import { stockUnitLabel } from '../../lib/stockUnitLabel';
import { useState } from 'react';
import type { ProductDto } from '../../types/menu';
import { useAuthStore } from '../../stores/authStore';
import { matchesProduct } from '../../lib/searchText';
import { Button } from '../../ui/Button';
import { StockItemEditor } from './StockItemEditor';
import { Input } from '../../ui/Input';

const field = 'min-h-12 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] px-3 text-sm';

interface Props {
  products: ProductDto[];
  value: string;
  onChange: (id: string) => void;
  label?: string;
  disabled?: boolean;
  allowCreate?: boolean;
}

/** Alt kayıt açılırken üst işlem bağlı kalır; miktar ve fiyat alanları kaybolmaz. */
export function StockItemPicker({ products, value, onChange, label = 'Ürün', disabled = false, allowCreate = true }: Props) {
  const canCreate = useAuthStore((state) => state.user?.role === 'OWNER');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = products.find((product) => product.id === value);
  const searching = query.trim().length > 0;
  const matches = products.filter((product) => matchesProduct(query, product.name, product.barcode, product.sku));
  const selectProduct = (id: string) => {
    onChange(id);
    setQuery('');
  };

  return (
    <div className="space-y-2 min-w-0">
      <Input disabled={disabled} aria-label={`${label} ara`} type="search" value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
          event.preventDefault();
          if (searching && matches.length === 1) selectProduct(matches[0].id);
        }} />
      {searching && matches.length === 0 ? (
        <p role="status" className="text-sm">Eşleşen kayıt yok.</p>
      ) : (
        <select disabled={disabled} aria-label={label} className={field}
          size={searching ? Math.min(5, Math.max(2, matches.length)) : undefined}
          value={matches.some((product) => product.id === value) ? value : ''}
          onChange={(event) => selectProduct(event.target.value)}>
          <option value="" hidden={searching}>{label} seçin</option>
          {matches.map((product) => <option key={product.id} value={product.id}>{product.name} · {stockUnitLabel(product.stockUnit)}</option>)}
        </select>
      )}
      {selected ? <p className="text-xs">Miktar birimi: {stockUnitLabel(selected.stockUnit)}</p> : null}
      {allowCreate && canCreate ? <Button disabled={disabled} type="button" variant="secondary" className="ml-auto flex" onClick={() => {
        setOpen(true);
      }}>Yeni Stok Kalemi</Button> : null}
      {open && <StockItemEditor initialName={query} onClose={() => setOpen(false)} onSaved={(product) => {
        selectProduct(product.id);
        setOpen(false);
      }} />}
    </div>
  );
}
