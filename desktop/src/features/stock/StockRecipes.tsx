import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { MenuRecipeTab } from '../menu/MenuRecipeTab';
import { invokeIPC } from '../../services/tauriClient';
import { useAuthStore } from '../../stores/authStore';
import { sessionArgs } from '../../stores/cariStore';
import { useMenuStore } from '../../stores/menuStore';
import { useStockStore } from '../../stores/stockStore';
import { errorText } from '../../lib/cariInput';
import { matchesProduct } from '../../lib/searchText';
import { ErrorToast } from '../../ui/ErrorToast';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { Modal } from '../../ui/Modal';

interface RecipeSummary { product_id: string }

export function StockRecipes() {
  const { products, error: stockError, load } = useStockStore();
  const { productRecipe, error, busy, setSelectedProductId, createRecipe, deactivateRecipe } = useMenuStore();
  const [recipes, setRecipes] = useState<Set<string> | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [recipeLoading, setRecipeLoading] = useState(false);
  const requestId = useRef(0);

  const openRecipe = async (id: string) => {
    const request = ++requestId.current;
    setSelectedId(id);
    setRecipeLoading(true);
    await setSelectedProductId(id);
    if (request === requestId.current) setRecipeLoading(false);
  };

  const loadRecipeIndex = useCallback(async () => {
    setListError(null);
    try {
      const { actorRole, tenantId } = sessionArgs();
      const activeModules = useAuthStore.getState().user?.activeModules ?? [];
      const rows = await invokeIPC<RecipeSummary[]>('list_inventory_recipes', { actorRole, tenantId, activeModules });
      setRecipes(new Set(rows.map((recipe) => recipe.product_id)));
    } catch (caught) {
      setListError(errorText(caught));
    }
  }, []);

  useEffect(() => { void load(); void loadRecipeIndex(); }, [load, loadRecipeIndex]);

  const product = products.find((item) => item.id === selectedId);
  const cost = productRecipe?.productId === selectedId ? productRecipe : null;
  // Reçete yalnız satış ürünlerine tanımlanır; hammadde reçete malzemesi olarak kalemlerde seçilir.
  const visible = products
    .filter((item) => !item.isRaw && matchesProduct(query, item.name, item.barcode, item.sku))
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'));

  return (
    <section className="page-fill flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold">Reçeteler</h2>
        <Input type="search" aria-label="Reçete için ürün ara" className="sm:!w-64"
          value={query} onChange={(event) => setQuery(event.target.value)} />
      </header>
      <ErrorToast message={listError ?? stockError ?? error} />
      {listError && <Button onClick={() => void loadRecipeIndex()}>Reçeteleri Yeniden Yükle</Button>}
      {!listError && recipes === null && <p role="status">Reçeteler yükleniyor.</p>}
      {visible.length === 0 && recipes !== null && <p role="status">{query.trim() ? 'Eşleşen ürün yok.' : 'Henüz ürün yok.'}</p>}
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,240px),1fr))] gap-3">
        {visible.map((item) => (
          <li key={item.id}>
            <button type="button" disabled={!recipes} onClick={() => void openRecipe(item.id)} className="paper min-h-20 w-full rounded-xl border border-[var(--border)] p-4 text-left hover:bg-[var(--bg-hover)] focus-visible:outline-2 focus-visible:outline-[var(--accent-blue)]">
              <span className="flex items-center justify-between gap-2 font-semibold">
                {item.name}<ChevronRight aria-hidden="true" className="size-4 shrink-0" />
              </span>
              {recipes && <span className="mt-1 block text-sm text-[var(--text-secondary)]">
                {recipes.has(item.id) ? 'Reçete Var' : 'Reçete Eklenmemiş'}
              </span>}
            </button>
          </li>
        ))}
      </ul>
      {product && <Modal cardFlow isOpen title={product.name} subtitle="Reçete" maxWidth="2xl"
        onClose={() => { if (!busy) { requestId.current += 1; setSelectedId(null); } }}>
        {recipeLoading ? <p role="status">Reçete yükleniyor.</p> : recipes?.has(product.id) && !cost ? (
          <Button onClick={() => { void loadRecipeIndex(); void openRecipe(product.id); }}>Reçeteyi Yeniden Yükle</Button>
        ) : <MenuRecipeTab key={product.id} product={product} products={products} cost={cost} busy={busy}
          createRecipe={async (input, replacing) => {
            const saved = await createRecipe(input, replacing);
            if (saved) setRecipes((current) => new Set([...(current ?? []), input.productId]));
            return saved;
          }}
          deactivateRecipe={async (id, recipeId) => {
            const saved = await deactivateRecipe(id, recipeId);
            if (saved) setRecipes((current) => new Set([...(current ?? [])].filter((item) => item !== id)));
            return saved;
          }} />}
      </Modal>}
    </section>
  );
}
