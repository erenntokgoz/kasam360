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
        // Apple HIG: koyu yarı saydam arka plan ve blur efekti
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/75 backdrop-blur-2xl p-4">
            <div className="backdrop-blur-3xl dark:bg-[#121318]/95 bg-white/95 border dark:border-white/10 border-black/[0.08] rounded-3xl w-full max-w-lg p-6 shadow-2xl overflow-y-auto max-h-full">
                {/* Modal başlık satırı */}
                <div className="mb-6 flex items-center justify-between">
                    <h2 className="text-xl font-bold dark:text-white text-zinc-900">
                        {editingProduct ? (isManager ? 'Ürün Durumu Düzenle' : 'Ürün Düzenle') : 'Yeni Ürün Ekle'}
                    </h2>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-full p-2 dark:text-white/40 text-zinc-400 hover:dark:bg-white/[0.08] hover:bg-black/[0.05] hover:dark:text-white hover:text-zinc-900 transition-all"
                    >
                        <X size={20} />
                    </button>
                </div>
                <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                    <div>
                        {/* Apple HIG etiket stili */}
                        <label className="text-xs font-semibold dark:text-zinc-400 text-zinc-600 mb-1.5 block">Ürün Adı</label>
                        <input
                            type="text"
                            name="name"
                            required={!isManager}
                            disabled={isManager}
                            defaultValue={editingProduct?.name}
                            className="w-full dark:bg-white/[0.05] bg-black/[0.03] border dark:border-white/10 border-black/[0.08] rounded-2xl px-4 py-2.5 dark:text-white text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-[#007AFF]/50 transition-all disabled:opacity-40"
                            placeholder="Örn: Espresso"
                        />
                    </div>
                    {!hidePriceEdit && (
                        <div>
                            <label className="text-xs font-semibold dark:text-zinc-400 text-zinc-600 mb-1.5 block">Fiyat (₺)</label>
                            <input
                                type="number"
                                step="0.01"
                                name="price"
                                required
                                defaultValue={editingProduct ? (editingProduct.price_cents / 100).toFixed(2) : ''}
                                className="w-full dark:bg-white/[0.05] bg-black/[0.03] border dark:border-white/10 border-black/[0.08] rounded-2xl px-4 py-2.5 dark:text-white text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-[#007AFF]/50 transition-all"
                                placeholder="0.00"
                            />
                        </div>
                    )}
                    <div>
                        <label className="text-xs font-semibold dark:text-zinc-400 text-zinc-600 mb-1.5 block">Kategori</label>
                        <select
                            value={selectedCategoryId}
                            onChange={(e) => setSelectedCategoryId(e.target.value)}
                            disabled={isManager}
                            className="w-full dark:bg-white/[0.05] bg-black/[0.03] border dark:border-white/10 border-black/[0.08] rounded-2xl px-4 py-2.5 dark:text-white text-zinc-900 focus:outline-none focus:border-[#007AFF]/50 transition-all disabled:opacity-40"
                        >
                            {categories.map(cat => (
                                <option key={cat.id} value={cat.id} className="dark:bg-[#121318] bg-white dark:text-white text-zinc-900">{cat.name}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="text-xs font-semibold dark:text-zinc-400 text-zinc-600 mb-1.5 block">Görsel URL (Opsiyonel)</label>
                        <input
                            type="url"
                            name="image_url"
                            disabled={isManager}
                            defaultValue={editingProduct?.image_url}
                            className="w-full dark:bg-white/[0.05] bg-black/[0.03] border dark:border-white/10 border-black/[0.08] rounded-2xl px-4 py-2.5 dark:text-white text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-[#007AFF]/50 transition-all disabled:opacity-40"
                            placeholder="https://..."
                        />
                    </div>
                    {/* Aktif/Pasif toggle satırı */}
                    <div className="flex items-center gap-3 mt-2">
                        <input
                            type="checkbox"
                            id="is_active"
                            name="is_active"
                            defaultChecked={editingProduct ? editingProduct.is_active : true}
                            className="h-5 w-5 rounded border-zinc-400 dark:bg-white/[0.05] bg-white text-[#007AFF] focus:ring-[#007AFF] focus:ring-offset-0"
                        />
                        <label htmlFor="is_active" className="text-sm font-medium dark:text-zinc-300 text-zinc-700">
                            Ürün Aktif (Satışta)
                        </label>
                    </div>
                    {/* Apple HIG pill kapsül buton stili */}
                    <div className="mt-6 flex justify-end gap-3 border-t dark:border-white/10 border-black/[0.08] pt-4">
                        <button
                            type="button"
                            onClick={onClose}
                            className="rounded-2xl px-5 py-2 text-sm font-semibold dark:text-zinc-300 text-zinc-700 dark:bg-white/[0.08] bg-black/[0.05] hover:dark:bg-white/[0.12] hover:bg-black/[0.08] transition-all cursor-pointer"
                        >
                            İptal
                        </button>
                        <button
                            type="submit"
                            className="rounded-2xl px-6 py-2 text-sm font-semibold text-white bg-[#007AFF] hover:bg-[#0066CC] transition-all shadow-md shadow-[#007AFF]/25 cursor-pointer"
                        >
                            Kaydet
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
