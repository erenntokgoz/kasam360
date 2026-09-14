import { useEffect, useState } from 'react';
import { tauriInvoke as invoke } from '../../../../data/ipc/tauriInvoke';
import { MenuManagementPanel, CategoryDto, ProductDto } from '../../management/ui/MenuManagementPanel';
import { CategoryForm, CategoryFormData } from '../../management/ui/CategoryForm';
import { ProductForm, ProductFormData } from '../../management/ui/ProductForm';
import { useCartStore } from '../../../store/useCartStore';
import { useAuthStore } from '../../../store/useAuthStore';
import { toast as useToast } from '@core/components/ui/toast';
import { AlertTriangle, X, Trash2, CheckCircle2 } from 'lucide-react';

export function OwnerMenuTab() {
  const [categories, setCategories] = useState<CategoryDto[]>([]);
  const [products, setProducts] = useState<ProductDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  // Modals for Create / Edit
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<CategoryDto | null>(null);

  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductDto | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('');

  // Delete Confirmation Modal (NO window.confirm!)
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
    setTimeout(() => setFeedback(null), 4000);
  };

  const user = useAuthStore(state => state.user);
  const currentRole = user?.role || 'OWNER';

  const refreshPOSState = async () => {
    try {
      await Promise.all([fetchCategories(), fetchCatalog()]);
    } catch (e) {
      console.warn('POS state refresh warning:', e);
    }
  };

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
      console.error('Failed to fetch management data:', error);
      showToast('Menü verileri yüklenirken hata oluştu.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [currentRole]);

  // Category Actions
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
      title: `"${cat?.name || 'Kategori'}" Silinecek`,
      description: 'Bu kategoriyi sildiğinizde, bu kategori altındaki tüm ürünler de silinecektir. Bu işlem geri alınamaz.',
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
        showToast('Yeni kategori başarıyla oluşturuldu.', 'success');
      }
      setIsCategoryModalOpen(false);
      await fetchData();
      await refreshPOSState();
    } catch (error) {
      console.error('Failed to save category:', error);
      showToast('Kategori kaydedilirken hata: ' + String(error), 'error');
    }
  };

  // Product Actions
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
      title: `"${prod?.name || 'Ürün'}" Silinecek`,
      description: 'Bu ürünü menüden tamamen silmek istediğinize emin misiniz?',
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
        showToast('Kategori ve bağlı ürünler silindi.', 'success');
      } else {
        await invoke('delete_product', {
          actorRole: currentRole,
          actor_role: currentRole,
          id: deleteModalState.id,
        });
        showToast('Ürün menüden silindi.', 'success');
      }
      setDeleteModalState(prev => ({ ...prev, isOpen: false }));
      await fetchData();
      await refreshPOSState();
    } catch (error) {
      console.error('Failed to delete:', error);
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
        showToast('Ürün detayları güncellendi.', 'success');
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
        showToast('Yeni ürün menüye eklendi.', 'success');
      }
      setIsProductModalOpen(false);
      await fetchData();
      await refreshPOSState();
    } catch (error) {
      console.error('Failed to save product:', error);
      showToast('Ürün kaydedilirken hata: ' + String(error), 'error');
    }
  };

  if (isLoading && categories.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center text-slate-400 py-16">
        Menü verileri yükleniyor...
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col w-full m-0 relative">
      {feedback && (
        <div
          className={`mx-6 mt-4 p-3 rounded-xl border flex items-center justify-between text-sm shadow-lg ${
            feedback.type === 'success'
              ? 'bg-emerald-950/80 border-emerald-700 text-emerald-300'
              : 'bg-red-950/80 border-red-700 text-red-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === 'success' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
            <span>{feedback.msg}</span>
          </div>
          <button onClick={() => setFeedback(null)} className="text-slate-400 hover:text-white">
            <X size={16} />
          </button>
        </div>
      )}

      <MenuManagementPanel
        categories={categories}
        products={products}
        onAddCategory={handleAddCategory}
        onEditCategory={handleEditCategory}
        onDeleteCategory={promptDeleteCategory}
        onAddProduct={handleAddProduct}
        onEditProduct={handleEditProduct}
        onDeleteProduct={promptDeleteProduct}
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

      {/* Modern Confirmation Modal (Replacing window.confirm) */}
      {deleteModalState.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 shadow-2xl flex flex-col gap-5">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-red-500/10 text-red-400 rounded-xl">
                <AlertTriangle size={24} />
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-lg text-white">{deleteModalState.title}</h3>
                <p className="text-sm text-slate-300 mt-1 leading-relaxed">
                  {deleteModalState.description}
                </p>
              </div>
            </div>

            <div className="flex gap-3 mt-2">
              <button
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-semibold rounded-xl transition-colors text-sm shadow-lg shadow-red-600/20"
              >
                <Trash2 size={16} />
                <span>{isDeleting ? 'Siliniyor...' : 'Evet, Kalıcı Olarak Sil'}</span>
              </button>
              <button
                onClick={() => setDeleteModalState(prev => ({ ...prev, isOpen: false }))}
                className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium rounded-xl transition-colors text-sm"
              >
                Vazgeç
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
