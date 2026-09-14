import { useEffect, useState } from 'react';
 
import { tauriInvoke as invoke } from '../../../data/ipc/tauriInvoke';
import { MenuManagementPanel, CategoryDto, ProductDto } from './ui/MenuManagementPanel';
import { useCartStore } from '../../store/useCartStore';
import { CategoryForm, CategoryFormData } from './ui/CategoryForm';
import { ProductForm, ProductFormData } from './ui/ProductForm';
import { useAuthStore } from '../../store/useAuthStore';
import { toast as useToast } from '@core/components/ui/toast';
import { AuditLogsPanel } from './ui/AuditLogsPanel';
import { ApprovalsPanel } from './ui/ApprovalsPanel';
import { OperationsDashboard } from './ui/OperationsDashboard';
import { TablesOrdersPanel } from './ui/TablesOrdersPanel';
import { InventoryManagementPanel } from './ui/InventoryManagementPanel';
import { StaffManagementPanel } from './ui/StaffManagementPanel';
import { KdsOverviewPanel } from './ui/KdsOverviewPanel';
import { ReportsPanel } from './ui/ReportsPanel';
import { ConfirmationModal } from './ui/ConfirmationModal';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@core/components/ui/tabs';

export function ManagementContainer() {
    const [activeTab, setActiveTab] = useState('dashboard');
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

    const fetchCategories = useCartStore(state => state.fetchCategories);
    const fetchCatalog = useCartStore(state => state.fetchCatalog);
    const addToast = (msg: string, type: 'success' | 'error' | 'info') => useToast.add({ title: msg, type });
    
    const user = useAuthStore(state => state.user);
    const currentRole = user?.role || 'Guest';

    const refreshPOSState = async () => {
        await fetchCategories();
        await fetchCatalog();
    };

    const fetchData = async () => {
        setIsLoading(true);
        try {
            const cats = await invoke<CategoryDto[]>('get_management_categories', { actorRole: currentRole });
            const prods = await invoke<ProductDto[]>('get_management_products', { actorRole: currentRole });
            setCategories(cats || []);
            setProducts(prods || []);
        } catch (error) {
            console.error('Failed to fetch management data:', error);
            setCategories([]);
            setProducts([]);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (activeTab === 'menu') {
            fetchData();
        } else {
            setIsLoading(false);
        }
    }, [currentRole, activeTab]);

    // Kategori İşleyicileri
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
            addToast('Kategori başarıyla silindi.', 'success');
            setCategoryToDelete(null);
        } catch (error) {
            console.error('Failed to delete category:', error);
            addToast('Kategori silinirken yetki hatası veya başka bir hata oluştu.', 'error');
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
            console.error('Failed to save category:', error);
            addToast('Kategori kaydedilirken yetki hatası veya başka bir hata oluştu.', 'error');
        }
    };

    // Ürün İşleyicileri
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
            addToast('Ürün başarıyla silindi.', 'success');
            setProductToDelete(null);
        } catch (error) {
            console.error('Failed to delete product:', error);
            addToast('Ürün silinirken yetki hatası veya başka bir hata oluştu.', 'error');
        } finally {
            setIsDeletingProduct(false);
        }
    };

    const handleSaveProduct = async (data: ProductFormData) => {
        try {
            if (editingProduct) {
                if (currentRole === 'MANAGER') {
                    await invoke('update_product_status', {
                        actorRole: currentRole,
                        id: editingProduct.id,
                        isActive: data.isActive
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
                        isActive: data.isActive
                    });
                    addToast('Ürün güncellendi.', 'success');
                }
            } else {
                await invoke('create_product', {
                    actorRole: currentRole,
                    categoryId: data.categoryId,
                    name: data.name,
                    priceCents: data.priceCents,
                    imageUrl: data.imageUrl,
                    isActive: data.isActive
                });
                addToast('Ürün eklendi.', 'success');
            }
            setIsProductModalOpen(false);
            await fetchData();
            await refreshPOSState();
        } catch (error) {
            console.error('Failed to save product:', error);
            addToast('Ürün kaydedilirken hata oluştu.', 'error');
        }
    };

    return (
        <div className="flex h-full w-full flex-col bg-slate-950 p-6 overflow-hidden">
            <div className="mb-6 flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold text-white tracking-tight">Manager Dashboard</h1>
                    <p className="text-slate-400 mt-1">İşletme Yönetim ve Kontrol Merkezi</p>
                </div>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
                <TabsList className="bg-slate-900 border border-slate-800 p-1 rounded-lg w-full justify-start h-auto flex-wrap">
                    <TabsTrigger value="dashboard" className="data-[state=active]:bg-indigo-600 data-[state=active]:text-white">Dashboard</TabsTrigger>
                    <TabsTrigger value="tables" className="data-[state=active]:bg-indigo-600 data-[state=active]:text-white">Masalar & Siparişler</TabsTrigger>
                    <TabsTrigger value="menu" className="data-[state=active]:bg-indigo-600 data-[state=active]:text-white">Menü Yönetimi</TabsTrigger>
                    <TabsTrigger value="inventory" className="data-[state=active]:bg-indigo-600 data-[state=active]:text-white">Stok & Envanter</TabsTrigger>
                    <TabsTrigger value="staff" className="data-[state=active]:bg-indigo-600 data-[state=active]:text-white">Personel Kadrosu</TabsTrigger>
                    <TabsTrigger value="kds" className="data-[state=active]:bg-indigo-600 data-[state=active]:text-white">Mutfak (KDS)</TabsTrigger>
                    <TabsTrigger value="reports" className="data-[state=active]:bg-indigo-600 data-[state=active]:text-white">Raporlar</TabsTrigger>
                    <TabsTrigger value="approvals" className="data-[state=active]:bg-indigo-600 data-[state=active]:text-white">Onay Bekleyenler</TabsTrigger>
                    <TabsTrigger value="logs" className="data-[state=active]:bg-indigo-600 data-[state=active]:text-white">Sistem Logları</TabsTrigger>
                </TabsList>

                <div className="flex-1 mt-6 min-h-0 overflow-y-auto">
                    <TabsContent value="dashboard" className="h-full m-0">
                        <OperationsDashboard />
                    </TabsContent>
                    
                    <TabsContent value="tables" className="h-full m-0">
                        <TablesOrdersPanel />
                    </TabsContent>

                    <TabsContent value="menu" className="h-full m-0 flex flex-col">
                        {isLoading && categories.length === 0 ? (
                            <div className="flex h-full w-full items-center justify-center text-slate-400">Yükleniyor...</div>
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
                                    hidePriceEdit={true}
                                />
                            </>
                        )}
                    </TabsContent>

                    <TabsContent value="inventory" className="h-full m-0">
                        <InventoryManagementPanel />
                    </TabsContent>

                    <TabsContent value="staff" className="h-full m-0">
                        <StaffManagementPanel />
                    </TabsContent>

                    <TabsContent value="kds" className="h-full m-0">
                        <KdsOverviewPanel />
                    </TabsContent>

                    <TabsContent value="reports" className="h-full m-0">
                        <ReportsPanel />
                    </TabsContent>

                    <TabsContent value="approvals" className="h-full m-0">
                        <ApprovalsPanel />
                    </TabsContent>

                    <TabsContent value="logs" className="h-full m-0">
                        <AuditLogsPanel />
                    </TabsContent>
                </div>
            </Tabs>

            {/* Kategori Silme Onay Modalı */}
            <ConfirmationModal
                isOpen={Boolean(categoryToDelete)}
                onClose={() => setCategoryToDelete(null)}
                onConfirm={confirmDeleteCategory}
                title="Kategoriyi Sil"
                description="Bu kategoriyi ve içindeki tüm ürünleri silmek istediğinize emin misiniz? Bu işlem geri alınamaz."
                confirmText="Evet, Sil"
                cancelText="Vazgeç"
                confirmVariant="danger"
                isLoading={isDeletingCategory}
            />

            {/* Ürün Silme Onay Modalı */}
            <ConfirmationModal
                isOpen={Boolean(productToDelete)}
                onClose={() => setProductToDelete(null)}
                onConfirm={confirmDeleteProduct}
                title="Ürünü Sil"
                description="Bu ürünü menüden silmek istediğinize emin misiniz?"
                confirmText="Evet, Sil"
                cancelText="Vazgeç"
                confirmVariant="danger"
                isLoading={isDeletingProduct}
            />
        </div>
    );
}
