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
        // Apple HIG: yarı saydam donuk cam ve blur efekti ile modal kaplama
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/70 backdrop-blur-md p-4 animate-in fade-in duration-150">
            <div className="backdrop-blur-2xl dark:bg-[#121318]/90 bg-white/95 border dark:border-white/10 border-black/[0.08] rounded-3xl w-full max-w-md p-6 shadow-2xl animate-in zoom-in-95 duration-150">
                {/* Modal başlık satırı */}
                <div className="mb-6 flex items-center justify-between">
                    <h2 className="text-xl font-bold dark:text-white text-zinc-900">
                        {editingCategory ? 'Kategori Düzenle' : 'Yeni Kategori Ekle'}
                    </h2>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-xl p-2 dark:text-zinc-400 text-zinc-500 hover:dark:bg-white/10 hover:bg-black/5 hover:dark:text-white hover:text-zinc-900 transition-all cursor-pointer"
                    >
                        <X size={20} />
                    </button>
                </div>
                <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                    <div>
                        {/* Apple HIG etiket stili */}
                        <label className="text-xs font-semibold dark:text-zinc-400 text-zinc-600 mb-1.5 block">
                            Kategori Adı
                        </label>
                        <input
                            type="text"
                            name="name"
                            required
                            defaultValue={editingCategory?.name}
                            className="w-full backdrop-blur-md dark:bg-white/[0.05] bg-black/[0.03] border dark:border-white/10 border-black/[0.08] rounded-2xl px-4 py-2.5 dark:text-white text-zinc-900 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-[#007AFF] transition-all"
                            placeholder="Örn: Sıcak İçecekler"
                        />
                    </div>
                    <div>
                        <label className="text-xs font-semibold dark:text-zinc-400 text-zinc-600 mb-1.5 block">
                            Sıra (Görünüm Sırası)
                        </label>
                        <input
                            type="number"
                            name="display_order"
                            required
                            defaultValue={editingCategory?.display_order ?? categoriesLength * 10}
                            className="w-full backdrop-blur-md dark:bg-white/[0.05] bg-black/[0.03] border dark:border-white/10 border-black/[0.08] rounded-2xl px-4 py-2.5 dark:text-white text-zinc-900 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-[#007AFF] transition-all"
                        />
                    </div>
                    {/* Apple HIG pill kapsül buton stili */}
                    <div className="mt-4 flex justify-end gap-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="rounded-2xl px-5 py-2 text-xs font-semibold dark:text-zinc-300 text-zinc-700 dark:bg-white/[0.08] bg-black/[0.05] hover:dark:bg-white/[0.12] hover:bg-black/[0.08] transition-all cursor-pointer"
                        >
                            İptal
                        </button>
                        <button
                            type="submit"
                            className="rounded-2xl px-6 py-2 text-xs font-semibold text-white bg-[#007AFF] hover:bg-[#007AFF]/90 shadow-sm transition-all cursor-pointer active:scale-95"
                        >
                            Kaydet
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
