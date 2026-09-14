import { X } from 'lucide-react';
import { CategoryDto } from './MenuManagementPanel';

export interface CategoryFormData {
    name: string;
    displayOrder: number;
}

interface CategoryFormProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (data: CategoryFormData) => Promise<void>;
    editingCategory: CategoryDto | null;
    categoriesLength: number;
}

export function CategoryForm({
    isOpen,
    onClose,
    onSubmit,
    editingCategory,
    categoriesLength
}: CategoryFormProps) {
    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        const name = formData.get('name') as string;
        const displayOrder = parseInt(formData.get('display_order') as string, 10) || 0;

        await onSubmit({
            name,
            displayOrder
        });
    };

    return (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
                <div className="mb-6 flex items-center justify-between">
                    <h2 className="text-xl font-bold text-white">{editingCategory ? 'Kategori Düzenle' : 'Yeni Kategori Ekle'}</h2>
                    <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white">
                        <X size={20} />
                    </button>
                </div>
                <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                    <div>
                        <label className="mb-1 block text-sm font-medium text-slate-300">Kategori Adı</label>
                        <input
                            type="text"
                            name="name"
                            required
                            defaultValue={editingCategory?.name}
                            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2 text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            placeholder="Örn: Sıcak İçecekler"
                        />
                    </div>
                    <div>
                        <label className="mb-1 block text-sm font-medium text-slate-300">Sıra (Görünüm Sırası)</label>
                        <input
                            type="number"
                            name="display_order"
                            required
                            defaultValue={editingCategory?.display_order ?? categoriesLength * 10}
                            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2 text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                    </div>
                    <div className="mt-4 flex justify-end gap-3">
                        <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 font-medium text-slate-300 hover:bg-slate-800">İptal</button>
                        <button type="submit" className="rounded-lg bg-indigo-600 px-6 py-2 font-medium text-white hover:bg-indigo-700">Kaydet</button>
                    </div>
                </form>
            </div>
        </div>
    );
}
