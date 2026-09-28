import { useState, useMemo } from 'react';
import { Plus, Edit2, Trash2, Info, Search, Check, X, UtensilsCrossed } from 'lucide-react';
import { tauriInvoke as invoke } from '../../../../data/ipc/tauriInvoke';

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

export interface MenuManagementPanelProps {
  categories: CategoryDto[];
  products: ProductDto[];
  onAddCategory: () => void;
  onEditCategory: (category: CategoryDto) => void;
  onDeleteCategory: (categoryId: string) => void;
  onAddProduct: (categoryId: string) => void;
  onEditProduct: (product: ProductDto) => void;
  onDeleteProduct: (productId: string) => void;
  onToggleProductStatus?: (product: ProductDto) => Promise<void> | void;
  currentRole?: string;
}

// macOS renksiz frosted glass tarzında modern ürün kartları ızgarası ve ON/OFF tek tık satış kontrolü
export function MenuManagementPanel({
  categories,
  products,
  onAddCategory,
  onEditCategory,
  onDeleteCategory,
  onAddProduct,
  onEditProduct,
  onDeleteProduct,
  onToggleProductStatus,
  currentRole = 'MANAGER',
}: MenuManagementPanelProps) {
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [togglingProductId, setTogglingProductId] = useState<string | null>(null);

  // Kategori isim haritası
  const categoryMap = useMemo(() => {
    const map = new Map<string, string>();
    categories.forEach((cat) => map.set(cat.id, cat.name));
    return map;
  }, [categories]);

  // Arama ve kategori filtrelemesi
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      const matchesCategory = selectedCategoryId === 'ALL' || p.category_id === selectedCategoryId;
      const matchesSearch =
        searchQuery.trim() === '' ||
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (categoryMap.get(p.category_id) || '').toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [products, selectedCategoryId, searchQuery, categoryMap]);

  // Ürünü tek tıkla satışa aç / kapat (ON/OFF switch)
  const handleToggle = async (product: ProductDto) => {
    if (togglingProductId) return;
    setTogglingProductId(product.id);
    try {
      if (onToggleProductStatus) {
        await onToggleProductStatus(product);
      } else {
        await invoke('update_product_status', {
          actorRole: currentRole,
          id: product.id,
          isActive: !product.is_active,
          is_active: !product.is_active,
        });
      }
    } catch (err) {
      console.error('Ürün durumu değiştirilemedi:', err);
    } finally {
      setTogglingProductId(null);
    }
  };

  if (categories.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <button
          onClick={onAddCategory}
          className="flex flex-col items-center justify-center gap-4 rounded-3xl border-2 border-dashed dark:border-white/10 border-black/10 dark:bg-white/[0.03] bg-white/70 backdrop-blur-xl p-16 dark:text-zinc-400 text-zinc-600 hover:border-[#007AFF]/50 hover:dark:bg-white/[0.06] hover:bg-white/90 hover:text-[#007AFF] transition-all cursor-pointer shadow-sm"
        >
          <Plus size={44} />
          <span className="text-xl font-semibold">İlk Menü Kategorisini Ekle</span>
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden text-zinc-900 dark:text-zinc-100">
      {/* Üst Eylem ve Arama Çubuğu — Bağımsız Yüzen Cam Ada */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4 p-4 rounded-3xl dark:bg-white/[0.04] bg-white/75 backdrop-blur-xl border dark:border-white/10 border-black/[0.08] shadow-lg">
        <div className="flex items-center gap-3">
          <div className="relative w-72">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              placeholder="Ürün veya kategori ara..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 rounded-2xl dark:bg-white/[0.04] bg-white/80 border dark:border-white/10 border-black/[0.08] backdrop-blur-md dark:text-white text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-[#007AFF] transition-all text-xs"
            />
          </div>
          <span className="text-xs font-mono dark:text-zinc-400 text-zinc-500">
            {filteredProducts.length} Ürün Listelendi
          </span>
        </div>

        {/* İşletme Sahibi (OWNER) İşlemleri — Renksiz Cam Butonlar */}
        {currentRole === 'OWNER' && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => onAddProduct(categories[0]?.id || '')}
              className="flex items-center gap-1.5 px-4 py-2 rounded-2xl dark:bg-white/[0.08] bg-black/[0.05] hover:dark:bg-white/[0.14] hover:bg-black/[0.08] border dark:border-white/15 border-black/10 dark:text-white text-zinc-900 text-xs font-semibold shadow-sm transition-all cursor-pointer active:scale-95"
            >
              <Plus size={15} />
              <span>Ürün Ekle</span>
            </button>
            <button
              onClick={onAddCategory}
              className="flex items-center gap-1.5 px-4 py-2 rounded-2xl dark:bg-white/[0.08] bg-black/[0.05] hover:dark:bg-white/[0.14] hover:bg-black/[0.08] border dark:border-white/15 border-black/10 dark:text-white text-zinc-900 text-xs font-medium transition-all cursor-pointer active:scale-95"
            >
              <Plus size={15} />
              <span>Kategori Ekle</span>
            </button>
          </div>
        )}
      </div>

      {/* Yönetici için yetki bilgilendirme rozeti — Renksiz Cam Ada */}
      {currentRole === 'MANAGER' && (
        <div className="mb-4 flex items-center gap-2.5 rounded-3xl border dark:border-white/10 border-black/[0.08] dark:bg-white/[0.04] bg-white/75 backdrop-blur-xl px-5 py-3 text-xs dark:text-zinc-200 text-zinc-800 shadow-md">
          <Info size={16} className="text-[#007AFF] shrink-0" />
          <span>
            Yönetici olarak ürünlerin aktif/pasif satış durumlarını kartların altındaki ON/OFF anahtarıyla anında güncelleyebilirsiniz. Fiyatlandırma Patron yetkisindedir.
          </span>
        </div>
      )}

      {/* macOS Kategori Filtre Kapsülleri — Bağımsız Yüzen Cam Kapsül */}
      <div className="mb-5 flex items-center gap-1.5 p-1.5 rounded-3xl dark:bg-white/[0.04] bg-white/75 backdrop-blur-xl border dark:border-white/10 border-black/[0.08] shadow-md overflow-x-auto no-scrollbar">
        <button
          onClick={() => setSelectedCategoryId('ALL')}
          className={`px-4 py-2 rounded-2xl text-xs font-semibold shrink-0 transition-all cursor-pointer ${
            selectedCategoryId === 'ALL'
              ? 'dark:bg-white/15 bg-white dark:text-white text-[#007AFF] shadow-sm border dark:border-white/10 border-black/[0.08]'
              : 'dark:text-zinc-400 text-zinc-600 hover:dark:text-white hover:text-zinc-900 dark:bg-white/[0.03] bg-black/[0.03]'
          }`}
        >
          Tümü ({products.length})
        </button>
        {categories.map((cat) => {
          const count = products.filter((p) => p.category_id === cat.id).length;
          const isSelected = selectedCategoryId === cat.id;
          return (
            <div key={cat.id} className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => setSelectedCategoryId(cat.id)}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-2xl text-xs font-semibold transition-all cursor-pointer ${
                  isSelected
                    ? 'dark:bg-white/15 bg-white dark:text-white text-[#007AFF] shadow-sm border dark:border-white/10 border-black/[0.08]'
                    : 'dark:text-zinc-400 text-zinc-600 hover:dark:text-white hover:text-zinc-900 dark:bg-white/[0.03] bg-black/[0.03]'
                }`}
              >
                <span>{cat.name}</span>
                <span className="text-[10px] opacity-70 font-mono">({count})</span>
              </button>
              {currentRole === 'OWNER' && isSelected && (
                <div className="flex items-center gap-0.5">
                  <button
                    onClick={() => onEditCategory(cat)}
                    className="p-1.5 rounded-lg text-zinc-400 hover:text-white transition-colors"
                    title="Kategoriyi Düzenle"
                  >
                    <Edit2 size={12} />
                  </button>
                  <button
                    onClick={() => onDeleteCategory(cat.id)}
                    className="p-1.5 rounded-lg text-red-400 hover:text-red-300 transition-colors"
                    title="Kategoriyi Sil"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Modern macOS Renksiz Frosted Glass Ürün Kartları Izgarası */}
      <div className="flex-1 overflow-y-auto pr-1 custom-scrollbar">
        {filteredProducts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-56 text-center text-zinc-400">
            <UtensilsCrossed size={36} className="mb-2 opacity-30" />
            <p className="text-sm font-medium">Bu kriterlere uygun ürün bulunamadı.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 pb-4">
            {filteredProducts.map((product) => {
              const categoryName = categoryMap.get(product.category_id) || 'Genel';
              const isBusy = togglingProductId === product.id;

              return (
                <div
                  key={product.id}
                  className={`group relative flex flex-col justify-between rounded-3xl border transition-all duration-200 overflow-hidden backdrop-blur-xl ${
                    product.is_active
                      ? 'dark:bg-white/[0.04] bg-white/80 dark:border-white/10 border-black/[0.08] hover:dark:bg-white/[0.07] hover:bg-white shadow-lg hover:shadow-xl'
                      : 'dark:bg-white/[0.01] bg-black/[0.02] dark:border-white/5 border-black/[0.05] opacity-70 shadow-sm'
                  }`}
                >
                  {/* Kart Üst Alanı: Görsel ve Kategori Etiketi */}
                  <div className="p-4 pb-2">
                    <div className="relative aspect-video w-full rounded-2xl overflow-hidden dark:bg-white/[0.02] bg-black/[0.04] border dark:border-white/5 border-black/[0.05] flex items-center justify-center mb-3">
                      {product.image_url ? (
                        <img
                          src={product.image_url}
                          alt={product.name}
                          className={`h-full w-full object-cover transition-transform duration-300 group-hover:scale-105 ${
                            !product.is_active ? 'grayscale contrast-75' : ''
                          }`}
                        />
                      ) : (
                        <div className="flex flex-col items-center gap-1 text-zinc-400">
                          <UtensilsCrossed size={24} className="opacity-40" />
                          <span className="text-[10px] tracking-wider uppercase font-medium">Görsel Yok</span>
                        </div>
                      )}

                      {/* Kategori Rozeti */}
                      <span className="absolute top-2 left-2 px-2.5 py-0.5 rounded-full text-[10px] font-semibold backdrop-blur-md dark:bg-black/60 bg-white/80 dark:text-zinc-200 text-zinc-800 border dark:border-white/10 border-black/10">
                        {categoryName}
                      </span>

                      {/* Satış Dışı Overlay Uyarısı */}
                      {!product.is_active && (
                        <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] flex items-center justify-center">
                          <span className="px-2.5 py-1 rounded-full text-[11px] font-bold tracking-wider bg-rose-500/20 text-rose-300 border border-rose-500/30 uppercase">
                            Satış Dışı
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Ürün İsmi ve Fiyat */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="font-semibold text-sm truncate dark:text-white text-zinc-900" title={product.name}>
                          {product.name}
                        </h3>
                        <p className="mt-0.5 text-sm font-bold tracking-tight text-[#007AFF] font-mono">
                          ₺{(product.price_cents / 100).toFixed(2)}
                        </p>
                      </div>

                      {/* Düzenle & Sil Hızlı Butonları */}
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => onEditProduct(product)}
                          className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                          title="Ürünü Düzenle"
                        >
                          <Edit2 size={13} />
                        </button>
                        {currentRole === 'OWNER' && (
                          <button
                            onClick={() => onDeleteProduct(product.id)}
                            className="p-1.5 rounded-lg text-zinc-400 hover:text-red-500 hover:bg-red-500/10 transition-colors"
                            title="Ürünü Sil"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Kart Alt Alanı: Net ON / OFF (Aktif / Pasif - Satışta) Toggle Anahtarı */}
                  <div className="mt-3 px-4 py-3 border-t dark:border-white/5 border-black/[0.05] dark:bg-white/[0.01] bg-black/[0.01] flex items-center justify-between">
                    <span className="text-[11px] font-medium dark:text-zinc-400 text-zinc-600">
                      Satış Durumu:
                    </span>

                    <button
                      type="button"
                      role="switch"
                      aria-checked={product.is_active}
                      disabled={isBusy}
                      onClick={() => handleToggle(product)}
                      className={`group/toggle relative inline-flex items-center gap-2 px-3 py-1.5 rounded-full transition-all duration-200 cursor-pointer border active:scale-95 disabled:opacity-50 select-none ${
                        product.is_active
                          ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/25'
                          : 'bg-zinc-500/15 border-zinc-500/30 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-500/25'
                      }`}
                    >
                      {/* Apple Stili Sürgülü Toggle Kapsülü */}
                      <div
                        className={`w-7 h-4 rounded-full transition-colors relative flex items-center px-0.5 ${
                          product.is_active ? 'bg-emerald-500' : 'bg-zinc-400 dark:bg-zinc-600'
                        }`}
                      >
                        <div
                          className={`w-3 h-3 rounded-full bg-white shadow-sm transition-transform duration-200 flex items-center justify-center ${
                            product.is_active ? 'translate-x-3 text-emerald-600' : 'translate-x-0 text-zinc-600'
                          }`}
                        >
                          {product.is_active ? <Check size={8} strokeWidth={3} /> : <X size={8} strokeWidth={3} />}
                        </div>
                      </div>

                      {/* Net ON / OFF Durum Metni */}
                      <span className="text-xs font-bold font-mono tracking-wide">
                        {product.is_active ? 'ON (Satışta)' : 'OFF (Kapalı)'}
                      </span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
