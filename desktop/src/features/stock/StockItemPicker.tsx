import { useEffect, useState } from 'react';
import type { CategoryDto, ProductDto } from '../../types/menu';
import { createStockCategory, createStockItem } from '../../lib/stockCreation';
import { mapCategory } from '../../lib/menuWire';
import { errorText } from '../../lib/cariInput';
import { invokeIPC } from '../../services/tauriClient';
import { sessionArgs } from '../../stores/cariStore';
import { useAuthStore } from '../../stores/authStore';
import { useStockStore } from '../../stores/stockStore';
import { matchesProduct } from '../../lib/searchText';
import { Button } from '../../ui/Button';
import { Modal } from '../../ui/Modal';
import { Input } from '../../ui/Input';

const field = 'min-h-12 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] px-3 text-sm';

interface Props {
  products: ProductDto[];
  value: string;
  onChange: (id: string) => void;
  label?: string;
  disabled?: boolean;
}

/** Alt kayıt açılırken üst işlem bağlı kalır; miktar ve fiyat alanları kaybolmaz. */
export function StockItemPicker({ products, value, onChange, label = 'Ürün', disabled = false }: Props) {
  const canCreate = useAuthStore((state) => state.user?.role === 'OWNER');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('adet');
  const [categories, setCategories] = useState<CategoryDto[]>([]);
  const [categoryId, setCategoryId] = useState('');
  const [newCategory, setNewCategory] = useState(false);
  const [categoryName, setCategoryName] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    Promise.resolve().then(() => {
      const { actorRole, tenantId } = sessionArgs();
      return invokeIPC<Parameters<typeof mapCategory>[0][]>('get_management_categories', { actorRole, tenantId });
    })
      .then((rows) => { if (active) setCategories(rows.map(mapCategory)); })
      .catch((caught) => { if (active) setError(errorText(caught)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      let chosen = categoryId;
      if (newCategory) {
        const category = await createStockCategory(categoryName);
        chosen = category.id;
        setCategories((current) => [...current, category]);
        setCategoryId(chosen);
        setNewCategory(false);
      }
      const product = await createStockItem({ name, categoryId: chosen, stockUnit: unit });
      useStockStore.setState((state) => ({ products: [...state.products.filter((item) => item.id !== product.id), product] }));
      setQuery('');
      onChange(product.id);
      setOpen(false);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  const selected = products.find((product) => product.id === value);
  const matches = products.filter((product) => product.id === value || matchesProduct(query, product.name, product.barcode));
  return (
    <div className="space-y-2 min-w-0">
      <Input disabled={disabled} aria-label={`${label} ara`} type="search" placeholder="Ürün ara" value={query} onChange={(event) => setQuery(event.target.value)} />
      <select disabled={disabled} aria-label={label} className={field} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Ürün seçin</option>
        {matches.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.stockUnit}</option>)}
      </select>
      {selected ? <p className="text-xs">Miktar birimi: {selected.stockUnit}</p> : null}
      {canCreate ? <Button disabled={disabled} type="button" variant="secondary" className="w-full" onClick={() => {
        setName(query); setUnit('adet'); setCategoryId(''); setCategoryName(''); setNewCategory(false); setError(null); setOpen(true);
      }}>Yeni stok kalemi oluştur</Button> : <p className="text-xs">Yeni kayıt için işletme sahibine başvurun.</p>}
      <Modal isOpen={open} title="Yeni stok kalemi" onClose={() => { if (!busy) setOpen(false); }} maxWidth="sm">
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          {error ? <p role="alert" className="text-sm text-[var(--accent-red)]">{error}</p> : null}
          <label className="block">Ad<Input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label className="block">Stok birimi<select className={field} value={unit} onChange={(event) => setUnit(event.target.value)}>
            {['adet', 'g', 'kg', 'ml', 'l'].map((item) => <option key={item}>{item}</option>)}
          </select></label>
          <label className="block">Kategori<select className={field} value={newCategory ? '__new' : categoryId} disabled={loading || busy} onChange={(event) => {
            setNewCategory(event.target.value === '__new');
            if (event.target.value !== '__new') setCategoryId(event.target.value);
          }}>
            <option value="">{loading ? 'Kategoriler yükleniyor' : 'Kategori seçin'}</option>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            <option value="__new">+ Yeni kategori oluştur</option>
          </select></label>
          {newCategory ? <label className="block">Yeni kategori adı<Input required maxLength={120} value={categoryName} onChange={(event) => setCategoryName(event.target.value)} /></label> : null}
          <div className="flex gap-2">
            <Button type="button" variant="secondary" disabled={busy} onClick={() => setOpen(false)}>Vazgeç</Button>
            <Button type="submit" variant="primary" isLoading={busy} disabled={loading || !name.trim() || (newCategory ? !categoryName.trim() : !categoryId)}>Oluştur ve Seç</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
