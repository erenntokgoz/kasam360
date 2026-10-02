import { useEffect, useState, useCallback } from 'react';
import { tauriInvoke as invoke } from '../../../data/ipc/tauriInvoke';
import {
  loadProductModifierGroupIds,
  saveProductModifierGroupIds,
} from '../../../data/ipc/modifierAssignmentApi';
import { MenuManagementPanel, CategoryDto, ProductDto } from './ui/MenuManagementPanel';
import { useCartStore } from '../../store/useCartStore';
import { CategoryForm, CategoryFormData } from './ui/CategoryForm';
import { ProductForm, ProductFormData } from './ui/ProductForm';
import { useAuthStore } from '../../store/useAuthStore';
import { toast as useToast } from '@core/components/ui/toast';
import { TablesOrdersPanel } from './ui/TablesOrdersPanel';
import { InventoryManagementPanel } from './ui/InventoryManagementPanel';
import { ReportsPanel } from './ui/ReportsPanel';
import { ConfirmationModal } from './ui/ConfirmationModal';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@core/components/ui/tabs';

// Yönetici (Manager) ana çalışma ekranı: Masalar, Menü, Stok ve Raporlar odaklı sadeleştirilmiş mimari
export function ManagementContainer() {
  // Müdür panelinde sayfa kalabalığını önlemek için varsayılan sekme Masalar olarak ayarlanır
  const [activeTab, setActiveTab] = useState('tables');
  const [categories, setCategories] = useState<CategoryDto[]>([]);
  const [products, setProducts] = useState<ProductDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<CategoryDto | null>(null);
  const [categoryToDelete, setCategoryToDelete] = useState<string | null>(null);
  const [isDeletingCategory, setIsDeletingCategory] = useState(false);

  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductDto | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('');
  const [productToDelete, setProductToDelete] = useState<string | null>(null);
  const [isDeletingProduct, setIsDeletingProduct] = useState(false);
  // Faz 4: formda seçilen modifier grupları; ürün kaydıyla birlikte yazılır.
  const [productModifierGroupIds, setProductModifierGroupIds] = useState<string[]>([]);

  const fetchCategories = useCartStore(state => state.fetchCategories);
  const fetchCatalog = useCartStore(state => state.fetchCatalog);
  const addToast = (msg: string, type: 'success' | 'error' | 'info') => useToast.add({ title: msg, type });

  const user = useAuthStore(state => state.user);
  const currentRole = user?.role || 'Guest';
  // Faz 4: modifier yönetimi işletme sahibine aittir. Backend de tüm modifier
  // komutlarında `OWNER` kapısı arar; müdür ekranda da bölümü görmez.
  const isOwner = currentRole.toUpperCase() === 'OWNER';

  // POS State ve sepet veritabanı senkronizasyonu
  const refreshPOSState = useCallback(async () => {
    await fetchCategories();
    await fetchCatalog();
  }, [fetchCategories, fetchCatalog]);

  // Menü yönetimi kategori ve ürün verilerini arka uçtan çek
  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const cats = await invoke<CategoryDto[]>('get_management_categories', { actorRole: currentRole });
      const prods = await invoke<ProductDto[]>('get_management_products', { actorRole: currentRole });
      setCategories(cats || []);
      setProducts(prods || []);
    } catch (error) {
      console.error('Yönetim verisi yükleme hatası:', error);
      setCategories([]);
      setProducts([]);
    } finally {
      setIsLoading(false);
    }
  }, [currentRole]);

  useEffect(() => {
    if (activeTab === 'menu') {
      fetchData();
    } else {
      setIsLoading(false);
    }
  }, [currentRole, activeTab, fetchData]);

  // Kategori İşlemleri
  const handleAddCategory = () => {
    setEditingCategory(null);
    setIsCategoryModalOpen(true);
  };

  const handleEditCategory = (category: CategoryDto) => {
    setEditingCategory(category);
    setIsCategoryModalOpen(true);
  };

  const handleDeleteCategory = (categoryId: string) => {
    setCategoryToDelete(categoryId);
  };

  const confirmDeleteCategory = async () => {
    if (!categoryToDelete) return;
    setIsDeletingCategory(true);
    try {
      await invoke('delete_category', { actorRole: currentRole, id: categoryToDelete });
      await fetchData();
      await refreshPOSState();
      addToast('Kategori silindi.', 'success');
      setCategoryToDelete(null);
    } catch (error) {
      console.error('Kategori silme hatası:', error);
      addToast('Kategori silinirken hata oluştu.', 'error');
    } finally {
      setIsDeletingCategory(false);
    }
  };

  const handleSaveCategory = async (data: CategoryFormData) => {
    try {
      if (editingCategory) {
        await invoke('update_category', { actorRole: currentRole, id: editingCategory.id, name: data.name, displayOrder: data.displayOrder });
        addToast('Kategori güncellendi.', 'success');
      } else {
        await invoke('create_category', { actorRole: currentRole, name: data.name, displayOrder: data.displayOrder });
        addToast('Kategori oluşturuldu.', 'success');
      }
      setIsCategoryModalOpen(false);
      await fetchData();
      await refreshPOSState();
    } catch (error) {
      console.error('Kategori kaydetme hatası:', error);
      addToast('Kategori kaydedilemedi.', 'error');
    }
  };

  // Ürün İşlemleri
  const handleAddProduct = (categoryId: string) => {
    setEditingProduct(null);
    setSelectedCategoryId(categoryId);
    setProductModifierGroupIds([]);
    setIsProductModalOpen(true);
  };

  const handleEditProduct = async (product: ProductDto) => {
    setEditingProduct(product);
    setSelectedCategoryId(product.category_id);
    // Faz 4: ürünün bağlı olduğu modifier grupları form açılmadan önce okunur.
    if (!isOwner) {
      setProductModifierGroupIds([]);
      setIsProductModalOpen(true);
      return;
    }
    try {
      const groupIds = await loadProductModifierGroupIds(product.id, {
        actorRole: currentRole,
        tenantId: user?.tenantId,
      });
      setProductModifierGroupIds(groupIds);
    } catch {
      setProductModifierGroupIds([]);
    }
    setIsProductModalOpen(true);
  };

  const handleDeleteProduct = (productId: string) => {
    setProductToDelete(productId);
  };

  const confirmDeleteProduct = async () => {
    if (!productToDelete) return;
    setIsDeletingProduct(true);
    try {
      await invoke('delete_product', { actorRole: currentRole, id: productToDelete });
      await fetchData();
      await refreshPOSState();
      addToast('Ürün silindi.', 'success');
      setProductToDelete(null);
    } catch (error) {
      console.error('Ürün silme hatası:', error);
      addToast('Ürün silinirken hata oluştu.', 'error');
    } finally {
      setIsDeletingProduct(false);
    }
  };

  // Ürün tek tıkla aktif / pasif (satışta / satış dışı) geçiş işleyicisi
  const handleToggleProductStatus = async (product: ProductDto) => {
    const nextStatus = !product.is_active;
    try {
      await invoke('update_product_status', {
        actorRole: currentRole,
        id: product.id,
        isActive: nextStatus,
        is_active: nextStatus,
      });
      // Yerel listeyi anında güncelle
      setProducts(prev => prev.map(p => p.id === product.id ? { ...p, is_active: nextStatus } : p));
      await refreshPOSState();
      addToast(
        `"${product.name}" ${nextStatus ? 'satışa açıldı (Aktif)' : 'satışa kapatıldı (Pasif)'}.`,
        'success'
      );
    } catch (error) {
      console.error('Ürün durumu değiştirme hatası:', error);
      addToast('Ürün durumu güncellenemedi.', 'error');
    }
  };

  const handleSaveProduct = async (data: ProductFormData) => {
    try {
      let savedProductId: string | null = editingProduct?.id ?? null;
      if (editingProduct) {
        if (currentRole === 'MANAGER') {
          await invoke('update_product_status', {
            actorRole: currentRole,
            id: editingProduct.id,
            isActive: data.isActive,
            is_active: data.isActive,
          });
          addToast('Ürün durumu güncellendi.', 'success');
        } else {
          await invoke('update_product', {
            actorRole: currentRole,
            id: editingProduct.id,
            categoryId: data.categoryId,
            name: data.name,
            priceCents: data.priceCents,
            imageUrl: data.imageUrl,
            isActive: data.isActive,
          });
          addToast('Ürün güncellendi.', 'success');
        }
      } else {
        const created = await invoke<{ id?: string }>('create_product', {
          actorRole: currentRole,
          categoryId: data.categoryId,
          name: data.name,
          priceCents: data.priceCents,
          imageUrl: data.imageUrl,
          isActive: data.isActive,
        });
        savedProductId = created?.id ?? null;
        addToast('Ürün eklendi.', 'success');
      }
      // Faz 4: modifier ataması ürünün kendisinden sonra yazılır; yeni üründe
      // kimlik ancak `create_product` yanıtıyla öğrenilir. Yetki sahibi
      // olmayan roller bu komutu çağırmaz.
      if (isOwner && savedProductId && data.modifierGroupIds) {
        await saveProductModifierGroupIds(savedProductId, data.modifierGroupIds, {
          actorRole: currentRole,
          tenantId: user?.tenantId,
        });
      }
      setIsProductModalOpen(false);
      await fetchData();
      await refreshPOSState();
    } catch (error) {
      console.error('Ürün kaydetme hatası:', error);
      addToast('Ürün kaydedilemedi.', 'error');
    }
  };

  return (
    // macOS Apple HIG renksiz şeffaf cam zemin ve tipografi
    <div className="flex h-full w-full flex-col dark:bg-[#060609] bg-[#f5f5f7] dark:text-zinc-100 text-zinc-900 p-6 overflow-hidden select-none gap-4">
      {/* Apple HIG Bağımsız Yüzen Üst Başlık Adası */}
      <header className="flex flex-wrap items-center justify-between gap-4 p-5 rounded-3xl dark:bg-white/[0.04] bg-white/75 backdrop-blur-xl border dark:border-white/10 border-black/[0.08] shadow-lg shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-2.5 h-2.5 rounded-full bg-[#007AFF] shadow-sm shadow-[#007AFF]/50" />
          <h1 className="text-xl font-bold tracking-tight dark:text-white text-zinc-900">Yönetici Paneli</h1>
        </div>
      </header>

      {/* Sadeleştirilmiş Sekme Menüsü: Masalar, Menü, Stok, Raporlar */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0 gap-4">
        <TabsList className="dark:bg-white/[0.04] bg-white/75 border dark:border-white/10 border-black/[0.08] p-1.5 rounded-3xl w-full justify-start h-auto flex-wrap backdrop-blur-xl gap-1.5 shadow-lg shrink-0">
          <TabsTrigger
            value="tables"
            className="data-[state=active]:dark:bg-white/15 data-[state=active]:bg-white data-[state=active]:dark:text-white data-[state=active]:text-[#007AFF] dark:text-zinc-400 text-zinc-600 transition-all rounded-2xl text-xs font-semibold px-5 py-2.5 shadow-sm cursor-pointer"
          >
            Masalar
          </TabsTrigger>
          <TabsTrigger
            value="menu"
            className="data-[state=active]:dark:bg-white/15 data-[state=active]:bg-white data-[state=active]:dark:text-white data-[state=active]:text-[#007AFF] dark:text-zinc-400 text-zinc-600 transition-all rounded-2xl text-xs font-semibold px-5 py-2.5 shadow-sm cursor-pointer"
          >
            Menü
          </TabsTrigger>
          <TabsTrigger
            value="inventory"
            className="data-[state=active]:dark:bg-white/15 data-[state=active]:bg-white data-[state=active]:dark:text-white data-[state=active]:text-[#007AFF] dark:text-zinc-400 text-zinc-600 transition-all rounded-2xl text-xs font-semibold px-5 py-2.5 shadow-sm cursor-pointer"
          >
            Stok
          </TabsTrigger>
          <TabsTrigger
            value="reports"
            className="data-[state=active]:dark:bg-white/15 data-[state=active]:bg-white data-[state=active]:dark:text-white data-[state=active]:text-[#007AFF] dark:text-zinc-400 text-zinc-600 transition-all rounded-2xl text-xs font-semibold px-5 py-2.5 shadow-sm cursor-pointer"
          >
            Raporlar
          </TabsTrigger>
        </TabsList>

        {/* Renksiz Şeffaf Cam Panel İçeriği — Bağımsız Yüzen Ada */}
        <div className="flex-1 min-h-0 overflow-y-auto rounded-3xl dark:bg-white/[0.04] bg-white/80 backdrop-blur-xl dark:border-white/10 border-black/[0.08] border p-6 shadow-xl">
          <TabsContent value="tables" className="h-full m-0">
            <TablesOrdersPanel />
          </TabsContent>

          <TabsContent value="menu" className="h-full m-0 flex flex-col">
            {isLoading && categories.length === 0 ? (
              <div className="flex h-full w-full items-center justify-center text-xs text-zinc-500">
                Yükleniyor...
              </div>
            ) : (
              <>
                <MenuManagementPanel
                  categories={categories}
                  products={products}
                  onAddCategory={handleAddCategory}
                  onEditCategory={handleEditCategory}
                  onDeleteCategory={handleDeleteCategory}
                  onAddProduct={handleAddProduct}
                  onEditProduct={handleEditProduct}
                  onDeleteProduct={handleDeleteProduct}
                  onToggleProductStatus={handleToggleProductStatus}
                  currentRole={currentRole}
                />

                <CategoryForm
                  isOpen={isCategoryModalOpen}
                  onClose={() => setIsCategoryModalOpen(false)}
                  onSubmit={handleSaveCategory}
                  editingCategory={editingCategory}
                  categoriesLength={categories.length}
                  canManageModifiers={isOwner}
                />

                <ProductForm
                  isOpen={isProductModalOpen}
                  onClose={() => setIsProductModalOpen(false)}
                  onSubmit={handleSaveProduct}
                  editingProduct={editingProduct}
                  categories={categories}
                  initialCategoryId={selectedCategoryId}
                  currentRole={currentRole}
                  canManageModifiers={isOwner}
                  modifierGroupIds={productModifierGroupIds}
                  hidePriceEdit={editingProduct !== null && currentRole === 'MANAGER'}
                />
              </>
            )}
          </TabsContent>

          <TabsContent value="inventory" className="h-full m-0">
            <InventoryManagementPanel />
          </TabsContent>

          <TabsContent value="reports" className="h-full m-0">
            <ReportsPanel />
          </TabsContent>
        </div>
      </Tabs>

      {/* iOS Standartlarında Kategori Silme Onay Modalı */}
      <ConfirmationModal
        isOpen={Boolean(categoryToDelete)}
        onClose={() => setCategoryToDelete(null)}
        onConfirm={confirmDeleteCategory}
        title="Kategoriyi Sil"
        description="Bu kategori ve bağlı tüm ürünler menüden kalıcı olarak kaldırılacaktır."
        confirmText="Sil"
        cancelText="Vazgeç"
        confirmVariant="danger"
        isLoading={isDeletingCategory}
      />

      {/* iOS Standartlarında Ürün Silme Onay Modalı */}
      <ConfirmationModal
        isOpen={Boolean(productToDelete)}
        onClose={() => setProductToDelete(null)}
        onConfirm={confirmDeleteProduct}
        title="Ürünü Sil"
        description="Seçili ürün menüden kalıcı olarak kaldırılacaktır."
        confirmText="Sil"
        cancelText="Vazgeç"
        confirmVariant="danger"
        isLoading={isDeletingProduct}
      />
    </div>
  );
}
