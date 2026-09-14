import React from 'react';
import { X } from 'lucide-react';
import { ProductDto, CategoryDto } from './MenuManagementPanel';

export interface ProductFormData {
    name: string;
    categoryId: string;
    priceCents: number;
    imageUrl: string | null;
    isActive: boolean;
}

interface ProductFormProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (data: ProductFormData) => Promise<void>;
    editingProduct: ProductDto | null;
    categories: CategoryDto[];
    initialCategoryId: string;
    hidePriceEdit?: boolean;
    currentRole?: string;
}

export function ProductForm({
    isOpen,
    onClose,
    onSubmit,
    editingProduct,
    categories,
    initialCategoryId,
    hidePriceEdit,
    currentRole
}: ProductFormProps) {
    const [selectedCategoryId, setSelectedCategoryId] = React.useState(initialCategoryId);
    
    // Modal yeni proplarla açıldığında yerel durumu güncelle
    React.useEffect(() => {
        if (isOpen) {
            setSelectedCategoryId(initialCategoryId || (categories.length > 0 ? categories[0].id : ''));
        }
    }, [isOpen, initialCategoryId, categories]);

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        const name = (formData.get('name') as string) || editingProduct?.name || '';
        
        let priceCents = editingProduct?.price_cents || 0;
        if (!hidePriceEdit) {
            const priceStr = (formData.get('price') as string) || (editingProduct ? (editingProduct.price_cents / 100).toString() : '0');
            priceCents = Math.round(parseFloat(priceStr) * 100);
        }

        const imageUrl = (formData.get('image_url') as string) || editingProduct?.image_url || null;
        const isActive = formData.get('is_active') === 'on';

        await onSubmit({
            name,
            categoryId: selectedCategoryId,
            priceCents,
            imageUrl,
            isActive
        });
    };

    const isManager = currentRole?.toUpperCase() === 'MANAGER';

    return (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
            <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl overflow-y-auto max-h-full">
                <div className="mb-6 flex items-center justify-between">
                    <h2 className="text-xl font-bold text-white">{editingProduct ? (isManager ? 'Ürün Durumu Düzenle' : 'Ürün Düzenle') : 'Yeni Ürün Ekle'}</h2>
                    <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white">
                        <X size={20} />
                    </button>
                </div>
                <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                    <div>
                        <label className="mb-1 block text-sm font-medium text-slate-300">Ürün Adı</label>
                        <input
                            type="text"
                            name="name"
                            required={!isManager}
                            disabled={isManager}
                            defaultValue={editingProduct?.name}
                            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2 text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
                            placeholder="Örn: Espresso"
                        />
                    </div>
                    {!hidePriceEdit && (
                        <div>
                            <label className="mb-1 block text-sm font-medium text-slate-300">Fiyat (₺)</label>
                            <input
                                type="number"
                                step="0.01"
                                name="price"
                                required
                                defaultValue={editingProduct ? (editingProduct.price_cents / 100).toFixed(2) : ''}
                                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2 text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                placeholder="0.00"
                            />
                        </div>
                    )}
                    <div>
                        <label className="mb-1 block text-sm font-medium text-slate-300">Kategori</label>
                        <select
                            value={selectedCategoryId}
                            onChange={(e) => setSelectedCategoryId(e.target.value)}
                            disabled={isManager}
                            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2 text-white focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
                        >
                            {categories.map(cat => (
                                <option key={cat.id} value={cat.id}>{cat.name}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="mb-1 block text-sm font-medium text-slate-300">Görsel URL (Opsiyonel)</label>
                        <input
                            type="url"
                            name="image_url"
                            disabled={isManager}
                            defaultValue={editingProduct?.image_url}
                            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2 text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
                            placeholder="https://..."
                        />
                    </div>
                    <div className="flex items-center gap-3 mt-2">
                        <input
                            type="checkbox"
                            id="is_active"
                            name="is_active"
                            defaultChecked={editingProduct ? editingProduct.is_active : true}
                            className="h-5 w-5 rounded border-slate-700 bg-slate-950 text-indigo-600 focus:ring-indigo-500 focus:ring-offset-slate-900"
                        />
                        <label htmlFor="is_active" className="text-sm font-medium text-slate-300">
                            Ürün Aktif (Satışta)
                        </label>
                    </div>
                    <div className="mt-6 flex justify-end gap-3 border-t border-slate-800 pt-4">
                        <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 font-medium text-slate-300 hover:bg-slate-800">İptal</button>
                        <button type="submit" className="rounded-lg bg-indigo-600 px-6 py-2 font-medium text-white hover:bg-indigo-700">Kaydet</button>
                    </div>
                </form>
            </div>
        </div>
    );
}
