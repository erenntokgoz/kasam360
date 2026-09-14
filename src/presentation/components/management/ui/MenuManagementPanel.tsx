import { useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Edit2, Trash2 } from 'lucide-react';

export interface CategoryDto {
    id: string;
    name: string;
    display_order: number;
}

export interface ProductDto {
    id: string;
    category_id: string;
    name: string;
    price_cents: number;
    image_url?: string;
    is_active: boolean;
}

interface MenuManagementPanelProps {
    categories: CategoryDto[];
    products: ProductDto[];
    onAddCategory: () => void;
    onEditCategory: (category: CategoryDto) => void;
    onDeleteCategory: (categoryId: string) => void;
    onAddProduct: (categoryId: string) => void;
    onEditProduct: (product: ProductDto) => void;
    onDeleteProduct: (productId: string) => void;
    currentRole?: string;
}

export function MenuManagementPanel({
    categories,
    products,
    onAddCategory,
    onEditCategory,
    onDeleteCategory,
    onAddProduct,
    onEditProduct,
    onDeleteProduct,
    currentRole
}: MenuManagementPanelProps) {
    const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

    const toggleCategory = (categoryId: string) => {
        const newSet = new Set(expandedCategories);
        if (newSet.has(categoryId)) {
            newSet.delete(categoryId);
        } else {
            newSet.add(categoryId);
        }
        setExpandedCategories(newSet);
    };

    if (categories.length === 0) {
        return (
            <div className="flex flex-1 items-center justify-center p-8">
                <button
                    onClick={onAddCategory}
                    className="flex flex-col items-center justify-center gap-4 rounded-3xl border-2 border-dashed border-slate-700 bg-slate-900/50 p-16 text-slate-400 hover:border-indigo-500 hover:bg-slate-800 hover:text-white transition-all"
                >
                    <Plus size={48} />
                    <span className="text-2xl font-semibold">İlk Kategoriyi Ekle</span>
                </button>
            </div>
        );
    }

    return (
        <div className="flex flex-1 flex-col overflow-hidden bg-slate-950 p-6 text-slate-200">
            <div className="mb-6 flex items-center justify-between">
                <h1 className="text-2xl font-bold tracking-tight">Menü Yönetimi</h1>
                {currentRole === 'OWNER' && (
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => onAddProduct(categories[0]?.id || '')}
                            className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white transition-colors hover:bg-emerald-700 shadow"
                        >
                            <Plus size={20} />
                            Ürün Ekle
                        </button>
                        <button
                            onClick={onAddCategory}
                            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white transition-colors hover:bg-indigo-700 shadow"
                        >
                            <Plus size={20} />
                            Kategori Ekle
                        </button>
                    </div>
                )}
            </div>

            <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
                <div className="flex flex-col gap-4">
                    {categories.map((category) => {
                        const isExpanded = expandedCategories.has(category.id);
                        const categoryProducts = products.filter((p) => p.category_id === category.id);

                        return (
                            <div key={category.id} className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
                                {/* Accordion Header */}
                                <div 
                                    className="flex cursor-pointer items-center justify-between bg-slate-800/50 p-4 transition-colors hover:bg-slate-800"
                                >
                                    <div 
                                        className="flex flex-1 items-center gap-3" 
                                        onClick={() => toggleCategory(category.id)}
                                    >
                                        {isExpanded ? <ChevronDown size={20} className="text-slate-400" /> : <ChevronRight size={20} className="text-slate-400" />}
                                        <span className="text-lg font-semibold">{category.name}</span>
                                        <span className="ml-2 rounded-full bg-slate-700 px-2.5 py-0.5 text-xs font-medium text-slate-300">
                                            {categoryProducts.length} ürün
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {currentRole === 'OWNER' && (
                                            <>
                                                <button 
                                                    onClick={(e) => { e.stopPropagation(); onEditCategory(category); }}
                                                    className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-700 hover:text-white"
                                                    title="Düzenle"
                                                >
                                                    <Edit2 size={18} />
                                                </button>
                                                <button 
                                                    onClick={(e) => { e.stopPropagation(); onDeleteCategory(category.id); }}
                                                    className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-red-900/50 hover:text-red-400"
                                                    title="Sil"
                                                >
                                                    <Trash2 size={18} />
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </div>

                                {/* Accordion Content */}
                                {isExpanded && (
                                    <div className="p-4 border-t border-slate-800">
                                        {currentRole === 'OWNER' && (
                                            <div className="mb-4">
                                                <button
                                                    onClick={() => onAddProduct(category.id)}
                                                    className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-slate-600 bg-slate-800/30 py-3 text-sm font-medium text-slate-400 transition-colors hover:border-indigo-500 hover:bg-indigo-950/30 hover:text-indigo-400"
                                                >
                                                    <Plus size={18} />
                                                    Bu Kategoriye Ürün Ekle
                                                </button>
                                            </div>
                                        )}

                                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                                            {categoryProducts.map((product) => (
                                                <div 
                                                    key={product.id} 
                                                    className="group flex flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-800 transition-all hover:border-slate-600 hover:shadow-lg"
                                                >
                                                    <div className="relative aspect-video w-full bg-slate-900">
                                                        {product.image_url ? (
                                                            <img 
                                                                src={product.image_url} 
                                                                alt={product.name} 
                                                                className="h-full w-full object-cover opacity-80 transition-opacity group-hover:opacity-100"
                                                            />
                                                        ) : (
                                                            <div className="flex h-full w-full items-center justify-center text-slate-600">
                                                                <span className="text-xs font-medium uppercase tracking-widest">Görsel Yok</span>
                                                            </div>
                                                        )}
                                                        {!product.is_active && (
                                                            <div className="absolute inset-0 bg-slate-950/60 flex items-center justify-center">
                                                                <span className="rounded bg-red-500/20 px-2 py-1 text-xs font-bold text-red-400 border border-red-500/30">
                                                                    PASİF
                                                                </span>
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div className="flex flex-1 flex-col justify-between p-4">
                                                        <div className="mb-4">
                                                            <h3 className="line-clamp-1 font-semibold text-slate-200" title={product.name}>
                                                                {product.name}
                                                            </h3>
                                                            <p className="mt-1 text-sm font-medium text-indigo-400">
                                                                ₺{(product.price_cents / 100).toFixed(2)}
                                                            </p>
                                                        </div>
                                                        <div className="flex items-center justify-end gap-2 border-t border-slate-700 pt-3">
                                                            <button 
                                                                onClick={() => onEditProduct(product)}
                                                                className="rounded p-1.5 text-slate-400 hover:bg-slate-700 hover:text-white"
                                                            >
                                                                <Edit2 size={16} />
                                                            </button>
                                                            {currentRole === 'OWNER' && (
                                                                <button 
                                                                    onClick={() => onDeleteProduct(product.id)}
                                                                    className="rounded p-1.5 text-slate-400 hover:bg-red-900/50 hover:text-red-400"
                                                                >
                                                                    <Trash2 size={16} />
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                            {categoryProducts.length === 0 && (
                                                <div className="col-span-full py-8 text-center text-sm text-slate-500">
                                                    Bu kategoride henüz ürün bulunmuyor.
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
