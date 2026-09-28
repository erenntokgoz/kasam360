import { useEffect, useState } from 'react';
import { tauriInvoke as invoke } from '../../../../data/ipc/tauriInvoke';
import { MenuManagementPanel, CategoryDto, ProductDto } from '../../management/ui/MenuManagementPanel';
import { CategoryForm, CategoryFormData } from '../../management/ui/CategoryForm';
import { ProductForm, ProductFormData } from '../../management/ui/ProductForm';
import { useCartStore } from '../../../store/useCartStore';
import { useAuthStore } from '../../../store/useAuthStore';
import { toast as useToast } from '@core/components/ui/toast';
import { AlertTriangle, X, Trash2, CheckCircle2 } from 'lucide-react';

// Apple Borsa / Sağlık tarzı mini trend eğrisi
function MetricMiniLine({ color }: { color: string }) {
  return (
    <div className="h-6 w-16 overflow-hidden">
      <svg className="w-full h-full" viewBox="0 0 50 16">
        <path
          d="M 0,12 Q 15,2 25,10 T 50,4"
          fill="none"
          stroke={color}
          strokeWidth="1.75"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

export function OwnerMenuTab() {
  const [categories, setCategories] = useState<CategoryDto[]>([]);
  const [products, setProducts] = useState<ProductDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  // Kategori & Ürün Modalları
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<CategoryDto | null>(null);

  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductDto | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('');

  // iOS Tarzı Silme Onay Penceresi Durumu
  const [deleteModalState, setDeleteModalState] = useState<{
    isOpen: boolean;
    type: 'category' | 'product';
    id: string;
    title: string;
    description: string;
  }>({
    isOpen: false,
    type: 'category',
    id: '',
    title: '',
    description: '',
  });
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchCategories = useCartStore(state => state.fetchCategories);
  const fetchCatalog = useCartStore(state => state.fetchCatalog);

  const showToast = (msg: string, type: 'success' | 'error') => {
    setFeedback({ msg, type });
    try {
      useToast.add({ title: msg, type });
    } catch {
      // fallback
    }
    setTimeout(() => setFeedback(null), 3500);
  };

  const user = useAuthStore(state => state.user);
  const currentRole = user?.role || 'OWNER';

  // POS State senkronizasyonu
  const refreshPOSState = async () => {
    try {
      await Promise.all([fetchCategories(), fetchCatalog()]);
    } catch (e) {
      console.warn('POS state yenileme uyarısı:', e);
    }
  };

  // Menü verilerini backend'den yükle
  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [cats, prods] = await Promise.all([
        invoke<CategoryDto[]>('get_management_categories', {
          actorRole: currentRole,
          actor_role: currentRole,
        }).catch(err => {
          console.warn('[OwnerMenuTab] get_management_categories fallback:', err);
          return [];
        }),
        invoke<ProductDto[]>('get_management_products', {
          actorRole: currentRole,
          actor_role: currentRole,
        }).catch(err => {
          console.warn('[OwnerMenuTab] get_management_products fallback:', err);
          return [];
        }),
      ]);

      setCategories(cats || []);
      setProducts(prods || []);
    } catch (error) {
      console.error('Menü verisi yükleme hatası:', error);
      showToast('Menü verileri yüklenirken hata oluştu.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [currentRole]);

  // Kategori İşlemleri
  const handleAddCategory = () => {
    setEditingCategory(null);
    setIsCategoryModalOpen(true);
  };

  const handleEditCategory = (category: CategoryDto) => {
    setEditingCategory(category);
    setIsCategoryModalOpen(true);
  };

  const promptDeleteCategory = (categoryId: string) => {
    const cat = categories.find(c => c.id === categoryId);
    setDeleteModalState({
      isOpen: true,
      type: 'category',
      id: categoryId,
      title: `"${cat?.name || 'Kategori'}" Silinsin mi?`,
      description: 'Bu işlem geri alınamaz ve kategori altındaki ürünler kaldırılır.',
    });
  };

  const handleSaveCategory = async (data: CategoryFormData) => {
    try {
      if (editingCategory) {
        await invoke('update_category', {
          actorRole: currentRole,
          actor_role: currentRole,
          id: editingCategory.id,
          name: data.name,
          displayOrder: data.displayOrder,
          display_order: data.displayOrder,
        });
        showToast('Kategori güncellendi.', 'success');
      } else {
        await invoke('create_category', {
          actorRole: currentRole,
          actor_role: currentRole,
          name: data.name,
          displayOrder: data.displayOrder,
          display_order: data.displayOrder,
        });
        showToast('Kategori oluşturuldu.', 'success');
      }
      setIsCategoryModalOpen(false);
      await fetchData();
      await refreshPOSState();
    } catch (error) {
      console.error('Kategori kaydetme hatası:', error);
      showToast('Kategori kaydedilemedi: ' + String(error), 'error');
    }
  };

  // Ürün İşlemleri
  const handleAddProduct = (categoryId: string) => {
    setEditingProduct(null);
    setSelectedCategoryId(categoryId);
    setIsProductModalOpen(true);
  };

  const handleEditProduct = (product: ProductDto) => {
    setEditingProduct(product);
    setSelectedCategoryId(product.category_id);
    setIsProductModalOpen(true);
  };

  const promptDeleteProduct = (productId: string) => {
    const prod = products.find(p => p.id === productId);
    setDeleteModalState({
      isOpen: true,
      type: 'product',
      id: productId,
      title: `"${prod?.name || 'Ürün'}" Silinsin mi?`,
      description: 'Seçili ürün menüden kalıcı olarak kaldırılacaktır.',
    });
  };

  const handleConfirmDelete = async () => {
    setIsDeleting(true);
    try {
      if (deleteModalState.type === 'category') {
        await invoke('delete_category', {
          actorRole: currentRole,
          actor_role: currentRole,
          id: deleteModalState.id,
        });
        showToast('Kategori silindi.', 'success');
      } else {
        await invoke('delete_product', {
          actorRole: currentRole,
          actor_role: currentRole,
          id: deleteModalState.id,
        });
        showToast('Ürün silindi.', 'success');
      }
      setDeleteModalState(prev => ({ ...prev, isOpen: false }));
      await fetchData();
      await refreshPOSState();
    } catch (error) {
      console.error('Silme hatası:', error);
      showToast('Silme işlemi başarısız: ' + String(error), 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSaveProduct = async (data: ProductFormData) => {
    try {
      if (editingProduct) {
        await invoke('update_product', {
          actorRole: currentRole,
          actor_role: currentRole,
          id: editingProduct.id,
          categoryId: data.categoryId,
          category_id: data.categoryId,
          name: data.name,
          priceCents: data.priceCents,
          price_cents: data.priceCents,
          imageUrl: data.imageUrl,
          image_url: data.imageUrl,
          isActive: data.isActive,
          is_active: data.isActive,
        });
        showToast('Ürün güncellendi.', 'success');
      } else {
        await invoke('create_product', {
          actorRole: currentRole,
          actor_role: currentRole,
          categoryId: data.categoryId,
          category_id: data.categoryId,
          name: data.name,
          priceCents: data.priceCents,
          price_cents: data.priceCents,
          imageUrl: data.imageUrl,
          image_url: data.imageUrl,
          isActive: data.isActive,
          is_active: data.isActive,
        });
        showToast('Ürün eklendi.', 'success');
      }
      setIsProductModalOpen(false);
      await fetchData();
      await refreshPOSState();
    } catch (error) {
      console.error('Ürün kaydetme hatası:', error);
      showToast('Ürün kaydedilemedi: ' + String(error), 'error');
    }
  };

  // Ürün tek tıkla aktif / pasif (satışta / satış dışı) durum geçişi
  const handleToggleProductStatus = async (product: ProductDto) => {
    const nextStatus = !product.is_active;
    try {
      await invoke('update_product_status', {
        actorRole: currentRole,
        actor_role: currentRole,
        id: product.id,
        isActive: nextStatus,
        is_active: nextStatus,
      });
      setProducts(prev => prev.map(p => p.id === product.id ? { ...p, is_active: nextStatus } : p));
      await refreshPOSState();
      showToast(
        `"${product.name}" ${nextStatus ? 'satışa açıldı (Aktif)' : 'satışa kapatıldı (Pasif)'}.`,
        'success'
      );
    } catch (error) {
      console.error('Ürün durumu değiştirme hatası:', error);
      showToast('Ürün durumu güncellenemedi.', 'error');
    }
  };

  if (isLoading && categories.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center text-xs text-zinc-500 py-16">
        Menü verileri yükleniyor...
      </div>
    );
  }

  const activeProductsCount = products.filter(p => p.is_active).length;

  return (
    <div className="flex h-full flex-col w-full m-0 relative max-w-7xl mx-auto space-y-5 pb-12 select-none">
      {/* Geri Bildirim Banner'ı */}
      {feedback && (
        <div
          className={`p-3.5 rounded-2xl border flex items-center justify-between text-xs backdrop-blur-xl animate-in fade-in duration-200 ${
            feedback.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
              : 'bg-red-500/10 border-red-500/20 text-red-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === 'success' ? (
              <CheckCircle2 size={15} className="text-emerald-400" />
            ) : (
              <AlertTriangle size={15} className="text-red-400" />
            )}
            <span>{feedback.msg}</span>
          </div>
          <button onClick={() => setFeedback(null)} className="text-zinc-400 hover:text-white">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Apple Sağlık / Borsa Tarzı Metrik Kartları */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white/[0.03] hover:bg-white/[0.05] border border-white/5 rounded-2xl p-5 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
              Kategoriler
            </span>
            <MetricMiniLine color="#818cf8" />
          </div>
          <div className="text-3xl font-semibold tracking-tight text-white mt-3">
            {categories.length}
          </div>
        </div>

        <div className="bg-white/[0.03] hover:bg-white/[0.05] border border-white/5 rounded-2xl p-5 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
              Toplam Ürün
            </span>
            <MetricMiniLine color="#38bdf8" />
          </div>
          <div className="text-3xl font-semibold tracking-tight text-white mt-3">
            {products.length}
          </div>
        </div>

        <div className="bg-white/[0.03] hover:bg-white/[0.05] border border-white/5 rounded-2xl p-5 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
              Aktif Satışta
            </span>
            <MetricMiniLine color="#34d399" />
          </div>
          <div className="text-3xl font-semibold tracking-tight text-emerald-400 mt-3">
            {activeProductsCount}
          </div>
        </div>
      </div>

      {/* Menü Yönetim Ana Listesi */}
      <MenuManagementPanel
        categories={categories}
        products={products}
        onAddCategory={handleAddCategory}
        onEditCategory={handleEditCategory}
        onDeleteCategory={promptDeleteCategory}
        onAddProduct={handleAddProduct}
        onEditProduct={handleEditProduct}
        onDeleteProduct={promptDeleteProduct}
        onToggleProductStatus={handleToggleProductStatus}
        currentRole={currentRole}
      />

      <CategoryForm
        isOpen={isCategoryModalOpen}
        onClose={() => setIsCategoryModalOpen(false)}
        onSubmit={handleSaveCategory}
        editingCategory={editingCategory}
        categoriesLength={categories.length}
      />

      <ProductForm
        isOpen={isProductModalOpen}
        onClose={() => setIsProductModalOpen(false)}
        onSubmit={handleSaveProduct}
        editingProduct={editingProduct}
        categories={categories}
        initialCategoryId={selectedCategoryId}
        currentRole={currentRole}
      />

      {/* Zarif Apple iOS Onay Dialogu (Silme İşlemi) */}
      {deleteModalState.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/70 backdrop-blur-md p-4 animate-in fade-in duration-150">
          <div className="backdrop-blur-2xl dark:bg-[#121318]/90 bg-white/95 border dark:border-white/10 border-black/[0.08] rounded-3xl max-w-sm w-full p-6 shadow-2xl flex flex-col items-center text-center dark:text-zinc-100 text-zinc-900 animate-in zoom-in-95 duration-150">
            <div className="w-12 h-12 rounded-full bg-red-500/15 border border-red-500/30 text-red-600 dark:text-red-400 flex items-center justify-center mb-3">
              <Trash2 size={20} />
            </div>

            <h3 className="font-bold text-base dark:text-white text-zinc-900">{deleteModalState.title}</h3>
            <p className="text-xs dark:text-zinc-400 text-zinc-600 mt-1.5 leading-relaxed">
              {deleteModalState.description}
            </p>

            <div className="flex gap-2 w-full mt-6">
              <button
                type="button"
                onClick={() => setDeleteModalState(prev => ({ ...prev, isOpen: false }))}
                disabled={isDeleting}
                className="flex-1 py-2.5 dark:bg-white/[0.08] bg-black/[0.05] hover:dark:bg-white/[0.12] hover:bg-black/[0.08] dark:text-zinc-300 text-zinc-700 font-semibold rounded-2xl text-xs transition-all cursor-pointer"
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="flex-1 py-2.5 bg-red-600 hover:bg-red-500 text-white font-semibold rounded-2xl text-xs transition-all disabled:opacity-50 cursor-pointer shadow-sm active:scale-95"
              >
                {isDeleting ? 'Siliniyor...' : 'Sil'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
