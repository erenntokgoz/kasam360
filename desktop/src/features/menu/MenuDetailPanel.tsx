import React, { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { errorText } from '../../lib/cariInput';
import { useMenuStore, parseMoneyToCents } from '../../stores/menuStore';
import { Button } from '../../ui/Button';
import { ErrorToast } from '../../ui/ErrorToast';
import { MenuCategoryModal } from './MenuCategoryModal';
import { MenuDetailTemel } from './MenuDetailTemel';

export const MenuDetailPanel: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const { categories, filters, saveProduct, busy } = useMenuStore();
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState(() => filters.categoryId ?? categories[0]?.id ?? '');
  const [priceInput, setPriceInput] = useState('');
  const [barcode, setBarcode] = useState('');
  const [description, setDescription] = useState('');
  const [stockUnit, setStockUnit] = useState('adet');
  const [taxRateBp, setTaxRateBp] = useState(1000);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (useMenuStore.getState().busy) return;
    setError(null);
    if (!name.trim() || !categoryId) {
      setError('Ürün adı ve kategori zorunlu.');
      return;
    }
    try {
      if (await saveProduct({
        name: name.trim(), categoryId, priceCents: parseMoneyToCents(priceInput),
        barcode: barcode.trim() || undefined, description: description.trim() || undefined,
        stockUnit, taxRateBp,
      })) onBack();
    } catch (caught) {
      setError(errorText(caught));
    }
  };

  return (
    <section className="flex flex-1 flex-col min-h-0 min-w-0 overflow-hidden">
      <header className="shrink-0 flex items-center gap-3 px-3 py-2 border-b border-[var(--border)] bg-[var(--bg-panel)]">
        <Button type="button" variant="ghost" onClick={onBack} disabled={busy}>
          <ArrowLeft aria-hidden="true" className="w-4 h-4" /> Ürünler
        </Button>
        <h2 className="font-bold">Yeni Ürün</h2>
      </header>
      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        <form className="paper border border-[var(--border)] rounded-lg p-4 max-w-2xl space-y-4" onSubmit={(event) => void submit(event)}>
          <fieldset disabled={busy}>
            <MenuDetailTemel name={name} setName={setName} categoryId={categoryId} setCategoryId={setCategoryId}
              priceInput={priceInput} setPriceInput={setPriceInput} barcode={barcode} setBarcode={setBarcode}
              description={description} setDescription={setDescription} stockUnit={stockUnit} setStockUnit={setStockUnit}
              taxRateBp={taxRateBp} setTaxRateBp={setTaxRateBp} categories={categories} onNewCategory={() => setCategoryOpen(true)} />
          </fieldset>
          <ErrorToast message={error} />
          <div className="flex justify-end gap-2">
            <Button type="button" onClick={onBack} disabled={busy}>Vazgeç</Button>
            <Button type="submit" variant="primary" isLoading={busy}>Ürünü Oluştur</Button>
          </div>
        </form>
      </div>
      <MenuCategoryModal isOpen={categoryOpen} onClose={() => setCategoryOpen(false)} onCreated={(category) => setCategoryId(category.id)} />
    </section>
  );
};
